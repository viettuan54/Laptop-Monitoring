const { adminPool } = require('../config/db');
const { GoogleAuth } = require('google-auth-library');

const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
const EXPO_BATCH_SIZE = 100;
const FCM_CONCURRENCY = 20;
const RECEIPT_BATCH_SIZE = 1000;
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const EXPO_TOKEN_PATTERN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;
const FCM_TOKEN_PATTERN = /^[A-Za-z0-9_:.-]+$/;

let fcmAuth;
let fcmProjectId;
let receiptScheduler;

function isPushEnabled() {
  return /^(1|true|yes)$/i.test(String(process.env.PUSH_NOTIFICATIONS_ENABLED || ''));
}

function getEnabledProviders() {
  const configured = String(process.env.PUSH_PROVIDERS || 'expo,fcm')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value === 'expo' || value === 'fcm');
  return new Set(configured);
}

function parseFirebaseCredential() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;

  let decoded = raw;
  if (!raw.startsWith('{')) {
    decoded = Buffer.from(raw, 'base64').toString('utf8');
  }

  const serviceAccount = JSON.parse(decoded);
  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing required service-account fields');
  }
  return serviceAccount;
}

function getFcmAuth() {
  if (fcmAuth) return fcmAuth;
  const credentials = parseFirebaseCredential();
  fcmProjectId = String(process.env.FIREBASE_PROJECT_ID || credentials?.project_id || '').trim();
  fcmAuth = new GoogleAuth({
    scopes: [FCM_SCOPE],
    ...(credentials ? { credentials } : {}),
    ...(fcmProjectId ? { projectId: fcmProjectId } : {}),
  });
  return fcmAuth;
}

async function initializePushProviders() {
  if (!isPushEnabled()) {
    console.warn('[Push] PUSH_NOTIFICATIONS_ENABLED is false; delivery is disabled.');
    return { enabled: false, providers: [] };
  }

  const providers = [...getEnabledProviders()];
  if (providers.length === 0) {
    throw new Error('PUSH_PROVIDERS must contain expo, fcm, or both');
  }
  if (providers.includes('fcm')) {
    const auth = getFcmAuth();
    await auth.getClient();
    fcmProjectId = fcmProjectId || await auth.getProjectId();
    if (!fcmProjectId) {
      throw new Error('FIREBASE_PROJECT_ID could not be determined for FCM');
    }
  }

  console.log(`[Push] Enabled providers: ${providers.join(', ')}`);
  return { enabled: true, providers };
}

function validatePushToken(provider, token) {
  if (typeof token !== 'string') return false;
  const normalized = token.trim();
  if (normalized.length < 20 || normalized.length > 4096) return false;
  if (provider === 'expo') return EXPO_TOKEN_PATTERN.test(normalized);
  if (provider === 'fcm') return FCM_TOKEN_PATTERN.test(normalized);
  return false;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeNotification(title, message, data = {}) {
  const normalizedTitle = String(title || '').trim().slice(0, 100);
  const normalizedMessage = String(message || '').trim().slice(0, 500);
  if (!normalizedTitle || !normalizedMessage) {
    throw new Error('Push notification title and message are required');
  }

  const normalizedData = {};
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(data).slice(0, 20)) {
      if (!/^[A-Za-z0-9_.-]{1,50}$/.test(key) || value === undefined || value === null) continue;
      normalizedData[key] = typeof value === 'string' ? value.slice(0, 500) : JSON.stringify(value).slice(0, 500);
    }
  }

  if (Buffer.byteLength(JSON.stringify(normalizedData), 'utf8') > 2500) {
    throw new Error('Push notification data payload is too large');
  }
  return { title: normalizedTitle, message: normalizedMessage, data: normalizedData };
}

async function fetchWithRetry(url, options, fetchImpl = fetch) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) return response;

      const detail = (await response.text()).slice(0, 500);
      lastError = new Error(`Push provider returned HTTP ${response.status}: ${detail}`);
      lastError.status = response.status;
      lastError.detail = detail;
      if (response.status !== 429 && response.status < 500) {
        lastError.retryable = false;
        throw lastError;
      }
    } catch (error) {
      lastError = error;
      if (error.retryable === false) throw error;
      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        lastError = new Error('Push provider request timed out');
      }
      if (attempt === 2) throw lastError;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
  }
  throw lastError;
}

async function markSuccessfulTokens(ids) {
  if (!ids.length) return;
  await adminPool.query(
    `UPDATE push_tokens
     SET last_used_at = NOW(), failure_count = 0, last_error = NULL
     WHERE push_token_id = ANY($1::bigint[])`,
    [ids]
  );
}

async function markFailedTokens(ids, error, deactivate = false) {
  if (!ids.length) return;
  await adminPool.query(
    `UPDATE push_tokens
     SET failure_count = failure_count + 1,
         last_error = $2,
         is_active = CASE WHEN $3::boolean THEN FALSE ELSE is_active END
     WHERE push_token_id = ANY($1::bigint[])`,
    [ids, String(error || 'Push delivery failed').slice(0, 500), deactivate]
  );
}

async function storeExpoReceipts(receipts) {
  if (!receipts.length) return;
  await adminPool.query(
    `INSERT INTO push_receipts(receipt_id, push_token_id)
     SELECT receipt_id, push_token_id
     FROM UNNEST($1::text[], $2::bigint[]) AS value(receipt_id, push_token_id)
     ON CONFLICT (receipt_id) DO NOTHING`,
    [
      receipts.map((item) => item.receiptId),
      receipts.map((item) => item.pushTokenId),
    ]
  );
}

function expoHeaders() {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (process.env.EXPO_ACCESS_TOKEN) {
    headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN.trim()}`;
  }
  return headers;
}

async function sendExpoNotifications(tokens, notification, fetchImpl = fetch) {
  let sent = 0;
  let failed = 0;

  for (const batch of chunk(tokens, EXPO_BATCH_SIZE)) {
    const response = await fetchWithRetry(EXPO_SEND_URL, {
      method: 'POST',
      headers: expoHeaders(),
      body: JSON.stringify(batch.map((item) => ({
        to: item.token,
        title: notification.title,
        body: notification.message,
        data: notification.data,
        sound: 'default',
        priority: 'high',
        channelId: 'alerts',
      }))),
    }, fetchImpl);

    const payload = await response.json();
    if (Array.isArray(payload.errors) && payload.errors.length) {
      throw new Error(payload.errors.map((error) => error.message).join('; ').slice(0, 500));
    }
    const tickets = Array.isArray(payload.data) ? payload.data : [payload.data];
    const successfulIds = [];
    const transientIds = [];
    const permanentIds = [];
    const receipts = [];

    batch.forEach((item, index) => {
      const ticket = tickets[index];
      if (ticket?.status === 'ok' && ticket.id) {
        sent += 1;
        successfulIds.push(item.push_token_id);
        receipts.push({ receiptId: ticket.id, pushTokenId: item.push_token_id });
      } else {
        failed += 1;
        if (ticket?.details?.error === 'DeviceNotRegistered') {
          permanentIds.push(item.push_token_id);
        } else {
          transientIds.push(item.push_token_id);
        }
      }
    });

    await Promise.all([
      markSuccessfulTokens(successfulIds),
      markFailedTokens(permanentIds, 'Expo: DeviceNotRegistered', true),
      markFailedTokens(transientIds, 'Expo rejected the push ticket'),
      storeExpoReceipts(receipts),
    ]);
  }
  return { sent, failed };
}

async function sendFcmNotifications(tokens, notification) {
  let sent = 0;
  let failed = 0;
  const auth = getFcmAuth();
  const authClient = await auth.getClient();
  fcmProjectId = fcmProjectId || await auth.getProjectId();
  if (!fcmProjectId) throw new Error('FIREBASE_PROJECT_ID could not be determined for FCM');
  const accessTokenResult = await authClient.getAccessToken();
  const accessToken = typeof accessTokenResult === 'string' ? accessTokenResult : accessTokenResult?.token;
  if (!accessToken) throw new Error('Unable to obtain an OAuth access token for FCM');
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(fcmProjectId)}/messages:send`;

  for (const batch of chunk(tokens, FCM_CONCURRENCY)) {
    const successfulIds = [];
    const transientIds = [];
    const permanentIds = [];
    const results = await Promise.all(batch.map(async (item) => {
      try {
        await fetchWithRetry(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token: item.token,
              notification: {
                title: notification.title,
                body: notification.message,
              },
              data: notification.data,
              android: {
                priority: 'HIGH',
                notification: { channel_id: 'alerts', sound: 'default' },
              },
              apns: {
                payload: { aps: { sound: 'default' } },
              },
              webpush: {
                fcm_options: { link: process.env.FRONTEND_URL || 'http://localhost:5173' },
              },
            },
          }),
        });
        return { item, success: true };
      } catch (error) {
        return { item, success: false, error };
      }
    }));

    results.forEach((result) => {
      if (result.success) {
        sent += 1;
        successfulIds.push(result.item.push_token_id);
      } else {
        failed += 1;
        const detail = String(result.error?.detail || '');
        const isPermanent = /"errorCode"\s*:\s*"(UNREGISTERED|INVALID_ARGUMENT|SENDER_ID_MISMATCH)"/.test(detail);
        if (isPermanent) permanentIds.push(result.item.push_token_id);
        else transientIds.push(result.item.push_token_id);
      }
    });

    await Promise.all([
      markSuccessfulTokens(successfulIds),
      markFailedTokens(permanentIds, 'FCM token is no longer registered', true),
      markFailedTokens(transientIds, 'FCM delivery failed'),
    ]);
  }
  return { sent, failed };
}

/**
 * Sends a notification to every active push token belonging to a parent.
 * Network calls happen after tokens are loaded, so no PostgreSQL connection is held.
 */
async function sendPushNotification(userId, title, message, data = {}) {
  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) {
    throw new Error('A valid userId is required for push delivery');
  }
  if (!isPushEnabled()) {
    return { enabled: false, requested: 0, sent: 0, failed: 0, skipped: 0, errors: [] };
  }

  const notification = normalizeNotification(title, message, data);
  const providers = getEnabledProviders();
  const result = await adminPool.query(
    `SELECT push_token_id, provider, token
     FROM push_tokens
     WHERE user_id = $1 AND is_active = TRUE
     ORDER BY push_token_id ASC`,
    [Number(userId)]
  );
  const eligible = result.rows.filter((row) => providers.has(row.provider));
  const skipped = result.rows.length - eligible.length;
  const groups = {
    expo: eligible.filter((row) => row.provider === 'expo'),
    fcm: eligible.filter((row) => row.provider === 'fcm'),
  };

  const jobs = [];
  if (groups.expo.length) {
    jobs.push({ provider: 'expo', count: groups.expo.length, promise: sendExpoNotifications(groups.expo, notification) });
  }
  if (groups.fcm.length) {
    jobs.push({ provider: 'fcm', count: groups.fcm.length, promise: sendFcmNotifications(groups.fcm, notification) });
  }

  const settled = await Promise.allSettled(jobs.map((job) => job.promise));
  let sent = 0;
  let failed = 0;
  const errors = [];
  const failedProviderUpdates = [];
  settled.forEach((outcome, index) => {
    const job = jobs[index];
    if (outcome.status === 'fulfilled') {
      sent += outcome.value.sent;
      failed += outcome.value.failed;
    } else {
      failed += job.count;
      errors.push({ provider: job.provider, message: 'Delivery failed' });
      failedProviderUpdates.push(markFailedTokens(
        groups[job.provider].map((item) => item.push_token_id),
        `${job.provider.toUpperCase()} provider request failed`
      ));
      console.error(`[Push] ${job.provider} delivery error:`, outcome.reason.message);
    }
  });
  await Promise.all(failedProviderUpdates);

  return {
    enabled: true,
    requested: result.rows.length,
    sent,
    failed,
    skipped,
    errors,
  };
}

async function processExpoReceipts(fetchImpl = fetch) {
  if (!isPushEnabled() || !getEnabledProviders().has('expo')) {
    return { checked: 0, delivered: 0, failed: 0, expired: 0 };
  }

  const expired = await adminPool.query(
    `UPDATE push_receipts
     SET status = 'expired', checked_at = NOW(),
         error_code = 'ReceiptExpired',
         error_message = 'Expo receipt was not available within 24 hours'
     WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours'
     RETURNING receipt_id`
  );
  const pending = await adminPool.query(
    `SELECT receipt_id, push_token_id
     FROM push_receipts
     WHERE status = 'pending'
       AND created_at <= NOW() - INTERVAL '15 minutes'
     ORDER BY created_at ASC
     LIMIT $1`,
    [RECEIPT_BATCH_SIZE]
  );

  let delivered = 0;
  let failed = 0;
  for (const batch of chunk(pending.rows, RECEIPT_BATCH_SIZE)) {
    const response = await fetchWithRetry(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: expoHeaders(),
      body: JSON.stringify({ ids: batch.map((item) => item.receipt_id) }),
    }, fetchImpl);
    const payload = await response.json();
    if (Array.isArray(payload.errors) && payload.errors.length) {
      throw new Error(payload.errors.map((error) => error.message).join('; ').slice(0, 500));
    }

    const deliveredIds = [];
    const permanentTokenIds = [];
    const transientTokenIds = [];
    for (const item of batch) {
      const receipt = payload.data?.[item.receipt_id];
      if (!receipt) continue;
      if (receipt.status === 'ok') {
        delivered += 1;
        deliveredIds.push(item.receipt_id);
      } else if (receipt.status === 'error') {
        failed += 1;
        await adminPool.query(
          `UPDATE push_receipts
           SET status = 'failed', checked_at = NOW(), error_code = $2, error_message = $3
           WHERE receipt_id = $1`,
          [
            item.receipt_id,
            String(receipt.details?.error || 'Unknown').slice(0, 100),
            String(receipt.message || 'Expo delivery failed').slice(0, 500),
          ]
        );
        if (receipt.details?.error === 'DeviceNotRegistered') {
          permanentTokenIds.push(item.push_token_id);
        } else {
          transientTokenIds.push(item.push_token_id);
        }
      }
    }
    if (deliveredIds.length) {
      await adminPool.query(
        `UPDATE push_receipts
         SET status = 'delivered', checked_at = NOW()
         WHERE receipt_id = ANY($1::text[])`,
        [deliveredIds]
      );
    }
    await Promise.all([
      markFailedTokens(permanentTokenIds, 'Expo receipt: DeviceNotRegistered', true),
      markFailedTokens(transientTokenIds, 'Expo receipt reported a delivery failure'),
    ]);
  }

  return {
    checked: delivered + failed,
    delivered,
    failed,
    expired: expired.rowCount,
  };
}

function scheduleExpoReceiptProcessing() {
  if (receiptScheduler || !isPushEnabled() || !getEnabledProviders().has('expo')) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await processExpoReceipts();
      if (result.checked || result.expired) {
        console.log(`[Push] Expo receipts: ${result.delivered} delivered, ${result.failed} failed, ${result.expired} expired`);
      }
    } catch (error) {
      console.error('[Push] Expo receipt processing error:', error.message);
    } finally {
      running = false;
    }
  };

  const initial = setTimeout(run, 60 * 1000);
  initial.unref();
  receiptScheduler = setInterval(run, 5 * 60 * 1000);
  receiptScheduler.unref();
}

module.exports = {
  initializePushProviders,
  processExpoReceipts,
  scheduleExpoReceiptProcessing,
  sendPushNotification,
  validatePushToken,
  _private: {
    chunk,
    getEnabledProviders,
    isPushEnabled,
    normalizeNotification,
    sendExpoNotifications,
  },
};
