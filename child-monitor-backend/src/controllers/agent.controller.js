const { adminPool } = require('../config/db');
const { sendPushNotification } = require('../services/notification.service');
const {
  APP_CATEGORIES,
  WEB_CATEGORIES,
  classifyAppWithGemini,
  classifyWebDomainWithGemini,
  normalizeAppContext,
  normalizeAppName,
  normalizeDomain,
} = require('../services/contentClassification.service');
const { getAgentPolicySnapshot } = require('../services/agentPolicy.service');
const { moderateTexts } = require('../services/textModeration.service');

const TEXT_MODERATION_BATCH_MAX = 20;
const TEXT_MODERATION_SOURCES = new Set([
  'search_query',
  'page_content',
  'chat_received',
  'chat_authored',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeTextModerationRecords(body) {
  if (!Array.isArray(body?.records) || body.records.length < 1
      || body.records.length > TEXT_MODERATION_BATCH_MAX) {
    throw new TypeError(`records must contain between 1 and ${TEXT_MODERATION_BATCH_MAX} items`);
  }
  const seenIds = new Set();
  return body.records.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError(`records[${index}] must be an object`);
    }
    const clientRecordId = typeof record.client_record_id === 'string'
      ? record.client_record_id.trim().toLowerCase()
      : '';
    if (!UUID_PATTERN.test(clientRecordId) || seenIds.has(clientRecordId)) {
      throw new TypeError(`records[${index}].client_record_id is invalid or duplicated`);
    }
    seenIds.add(clientRecordId);
    if (!TEXT_MODERATION_SOURCES.has(record.source_type)) {
      throw new TypeError(`records[${index}].source_type is invalid`);
    }
    if (typeof record.text !== 'string') {
      throw new TypeError(`records[${index}].text must be a string`);
    }
    const text = record.text.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (!text || text.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
      throw new TypeError(`records[${index}].text length or characters are invalid`);
    }
    if (typeof record.occurred_at !== 'string'
        || record.occurred_at.length > 64
        || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(record.occurred_at)
        || Number.isNaN(Date.parse(record.occurred_at))) {
      throw new TypeError(`records[${index}].occurred_at must be an ISO timestamp with offset`);
    }
    let domain = null;
    if (record.domain !== undefined && record.domain !== null && record.domain !== '') {
      if (typeof record.domain !== 'string') {
        throw new TypeError(`records[${index}].domain must be a string`);
      }
      try {
        domain = normalizeDomain(record.domain);
      } catch (error) {
        throw new TypeError(`records[${index}].domain is invalid`);
      }
      if (domain.length > 200) throw new TypeError(`records[${index}].domain is too long`);
    }
    return {
      clientRecordId,
      sourceType: record.source_type,
      text,
      occurredAt: new Date(record.occurred_at).toISOString(),
      domain,
    };
  });
}

function textAlertPresentation(result, sourceType, domain) {
  const sourceLabels = {
    search_query: 'truy vấn tìm kiếm',
    page_content: 'nội dung trang',
    chat_received: 'tin nhắn trẻ nhận được',
    chat_authored: 'tin nhắn trẻ soạn',
  };
  const origin = domain ? ` trên ${domain}` : '';
  const source = sourceLabels[sourceType] || 'nội dung văn bản';
  const presentations = {
    self_harm: {
      alertType: 'text_self_harm',
      title: 'Cảnh báo dấu hiệu tự hại',
      message: `Phát hiện dấu hiệu tự hại trong ${source}${origin}. Hãy chủ động kiểm tra và trò chuyện với trẻ.`,
    },
    harassment: {
      alertType: 'text_harassment',
      title: 'Cảnh báo bắt nạt hoặc đe dọa',
      message: `Phát hiện dấu hiệu bắt nạt, quấy rối hoặc đe dọa trong ${source}${origin}.`,
    },
    violence: {
      alertType: 'text_violence',
      title: 'Cảnh báo ngôn từ bạo lực',
      message: `Phát hiện ngôn từ bạo lực hoặc kích động trong ${source}${origin}.`,
    },
  };
  return presentations[result.riskType];
}

// ────────────────────────────────────────────────────────────────
// POST /api/agent/heartbeat
// Agent gửi định kỳ (mỗi 60 giây) để báo máy đang hoạt động.
// Cập nhật last_seen_at trên thiết bị và trả về config snapshot
// để Agent nhận lệnh ngay trong cùng một request (tiết kiệm round-trip).
// ────────────────────────────────────────────────────────────────
exports.heartbeat = async (req, res) => {
  const { device_id, child_id } = req.device;

  try {
    // Cập nhật last_seen_at và lấy giá trị vừa ghi để trả về cho Agent xác nhận
    const updateResult = await adminPool.query(
      'UPDATE devices SET last_seen_at = NOW() WHERE device_id = $1 RETURNING last_seen_at',
      [device_id]
    );
    const last_seen_at = updateResult.rows[0]?.last_seen_at ?? new Date();

    // Trả cả các nhóm allow/block để Agent có thể thực thi ngay sau khi AI
    // phân loại domain, thay vì chỉ lưu nhãn vào nhật ký.
    const { config, policy_blocked_domains } = await getAgentPolicySnapshot(
      adminPool,
      child_id
    );

    res.json({
      message: 'Heartbeat received',
      server_time: new Date().toISOString(),
      last_seen_at: last_seen_at instanceof Date ? last_seen_at.toISOString() : last_seen_at,
      config,
      policy_blocked_domains,
    });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// GET /api/agent/config
// Agent gọi endpoint này để lấy toàn bộ cấu hình giám sát
// áp dụng cho thiết bị (bao gồm is_locked để thực thi khóa máy).
// Endpoint này không cập nhật last_seen_at (dùng heartbeat cho việc đó).
// ────────────────────────────────────────────────────────────────
exports.getConfig = async (req, res) => {
  const { child_id, device_id, device_name } = req.device;

  try {
    // website_blacklist là danh sách global; policy category bên dưới là theo child.
    const [policySnapshot, blacklistResult] = await Promise.all([
      getAgentPolicySnapshot(adminPool, child_id),
      adminPool.query('SELECT domain FROM website_blacklist ORDER BY domain ASC'),
    ]);

    res.json({
      device_id,
      device_name,
      child_id,
      config: policySnapshot.config,
      blacklisted_domains: blacklistResult.rows.map((r) => r.domain),
      policy_blocked_domains: policySnapshot.policy_blocked_domains,
      server_time: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get config error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

async function isWebClassificationEnabled(childId) {
  const result = await adminPool.query(
    'SELECT enable_web_classification FROM settings WHERE child_id = $1',
    [childId]
  );
  return result.rows[0]?.enable_web_classification === true;
}

async function isAppClassificationEnabled(childId) {
  const result = await adminPool.query(
    'SELECT enable_app_classification FROM settings WHERE child_id = $1',
    [childId]
  );
  return result.rows[0]?.enable_app_classification === true;
}

// POST /api/agent/classification/app/fallback
// Chỉ nhận tên executable và metadata version-resource không nhạy cảm.
exports.classifyAppFallback = async (req, res) => {
  let appContext;
  try {
    appContext = normalizeAppContext(req.body);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  try {
    if (!await isAppClassificationEnabled(req.device.child_id)) {
      return res.status(409).json({ message: 'App classification is disabled' });
    }
    const result = await classifyAppWithGemini(appContext);
    return res.json({
      app_name: result.app_name,
      category: result.category,
      classification_source: result.source,
    });
  } catch (error) {
    if (error.code === 'GEMINI_NOT_CONFIGURED') {
      return res.status(503).json({ message: 'Gemini fallback is not configured' });
    }
    console.error('App classification fallback error:', error);
    return res.status(502).json({ message: 'Gemini classification failed' });
  }
};

// GET /api/agent/classification/app/unknown-apps
exports.getUnknownApps = async (req, res) => {
  const parsedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 100)) : 25;
  try {
    if (!await isAppClassificationEnabled(req.device.child_id)) {
      return res.json({ enabled: false, apps: [] });
    }
    const result = await adminPool.query(
      `SELECT DISTINCT ON (lower(app_name))
              app_name, product_name, file_description
       FROM app_usage
       WHERE device_id = $1
         AND category = 'unknown'
         AND classification_source IN ('pending', 'disabled')
       ORDER BY lower(app_name), start_time DESC, log_id DESC
       LIMIT $2`,
      [req.device.device_id, limit]
    );
    const apps = [];
    for (const row of result.rows) {
      try {
        apps.push({
          app_name: normalizeAppName(row.app_name),
          product_name: row.product_name || null,
          file_description: row.file_description || null,
        });
      } catch (error) {
        // Invalid legacy identifiers never reach Gemini.
      }
    }
    return res.json({ enabled: true, apps });
  } catch (error) {
    console.error('Get unknown apps error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /api/agent/classification/app/backfill
exports.backfillApp = async (req, res) => {
  let appName;
  try {
    appName = normalizeAppName(req.body?.app_name);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const category = req.body?.category;
  const source = req.body?.classification_source;
  const confidence = req.body?.classification_confidence;
  if (!APP_CATEGORIES.includes(category)) {
    return res.status(400).json({ message: 'category is outside the app taxonomy' });
  }
  if (!['exact_lookup', 'trained_model', 'gemini'].includes(source)) {
    return res.status(400).json({ message: 'classification_source is invalid' });
  }
  if (
    confidence !== null && confidence !== undefined
    && (typeof confidence !== 'number' || confidence < 0 || confidence > 1)
  ) {
    return res.status(400).json({ message: 'classification_confidence is invalid' });
  }
  if (source === 'exact_lookup' && confidence !== 1) {
    return res.status(400).json({ message: 'exact_lookup confidence must be 1' });
  }
  if (source === 'trained_model' && (confidence === null || confidence < 0.7)) {
    return res.status(400).json({ message: 'trained_model confidence must be at least 0.7' });
  }
  try {
    if (!await isAppClassificationEnabled(req.device.child_id)) {
      return res.status(409).json({ message: 'App classification is disabled' });
    }
    const result = await adminPool.query(
      `UPDATE app_usage
       SET category = $1,
           classification_source = $2,
           classification_confidence = $3
       WHERE device_id = $4
         AND category = 'unknown'
         AND classification_source IN ('pending', 'disabled')
         AND lower(app_name) = $5`,
      [category, source, confidence ?? null, req.device.device_id, appName]
    );
    return res.json({ app_name: appName, category, updated: result.rowCount ?? 0 });
  } catch (error) {
    console.error('Backfill app error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /api/agent/classification/web/fallback
// Body chỉ chứa domain; URL, page title và lịch sử duyệt web không được gửi Gemini.
exports.classifyWebFallback = async (req, res) => {
  let domain;
  try {
    domain = normalizeDomain(req.body?.domain);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  try {
    if (!await isWebClassificationEnabled(req.device.child_id)) {
      return res.status(409).json({ message: 'Website classification is disabled' });
    }
    const result = await classifyWebDomainWithGemini(domain);
    return res.json({
      domain: result.domain,
      category: result.category,
      classification_source: result.source,
    });
  } catch (error) {
    if (error.code === 'GEMINI_NOT_CONFIGURED') {
      return res.status(503).json({ message: 'Gemini fallback is not configured' });
    }
    console.error('Web classification fallback error:', error);
    return res.status(502).json({ message: 'Gemini classification failed' });
  }
};

// GET /api/agent/classification/web/unknown-domains
exports.getUnknownWebDomains = async (req, res) => {
  const parsedLimit = Number.parseInt(req.query.limit, 10);
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 100)) : 25;
  try {
    if (!await isWebClassificationEnabled(req.device.child_id)) {
      return res.json({ enabled: false, domains: [] });
    }
    const result = await adminPool.query(
      `SELECT DISTINCT domain
       FROM website_logs
       WHERE device_id = $1
         AND category = 'unknown'
         AND classification_source IN ('pending', 'disabled')
         AND domain IS NOT NULL
       ORDER BY domain
       LIMIT $2`,
      [req.device.device_id, limit]
    );
    const domains = [];
    const seen = new Set();
    for (const row of result.rows) {
      try {
        const domain = normalizeDomain(row.domain);
        if (!seen.has(domain)) {
          domains.push(domain);
          seen.add(domain);
        }
      } catch (error) {
        // Invalid legacy rows remain untouched and never reach Gemini.
      }
    }
    return res.json({ enabled: true, domains });
  } catch (error) {
    console.error('Get unknown web domains error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /api/agent/classification/web/backfill
exports.backfillWebDomain = async (req, res) => {
  let domain;
  try {
    domain = normalizeDomain(req.body?.domain);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
  const category = req.body?.category;
  const source = req.body?.classification_source;
  const confidence = req.body?.classification_confidence;
  if (!WEB_CATEGORIES.includes(category)) {
    return res.status(400).json({ message: 'category is outside the web taxonomy' });
  }
  if (!['trained_model', 'gemini'].includes(source)) {
    return res.status(400).json({ message: 'classification_source is invalid' });
  }
  if (
    confidence !== null && confidence !== undefined
    && (typeof confidence !== 'number' || confidence < 0 || confidence > 1)
  ) {
    return res.status(400).json({ message: 'classification_confidence is invalid' });
  }
  try {
    if (!await isWebClassificationEnabled(req.device.child_id)) {
      return res.status(409).json({ message: 'Website classification is disabled' });
    }
    const result = await adminPool.query(
      `UPDATE website_logs
       SET category = $1,
           classification_source = $2,
           classification_confidence = $3
       WHERE device_id = $4
         AND category = 'unknown'
         AND classification_source IN ('pending', 'disabled')
         AND lower(domain) IN ($5, 'www.' || $5)`,
      [category, source, confidence ?? null, req.device.device_id, domain]
    );
    return res.json({ domain, category, updated: result.rowCount ?? 0 });
  } catch (error) {
    console.error('Backfill web domain error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

// ────────────────────────────────────────────────────────────────
// POST /api/agent/vision-alert
// Agent gửi kết quả phân tích Computer Vision cục bộ.
// Chỉ gửi dữ liệu cảnh báo dạng số/loại, KHÔNG bao giờ gửi ảnh.
//
// Body: {
//   alert_type: 'posture_warning' | 'stranger_detected' | 'eye_distance_warning',
//   message: string (mô tả ngắn, ví dụ: "Khoảng cách mắt 25cm - quá gần")
// }
// ────────────────────────────────────────────────────────────────
exports.sendVisionAlert = async (req, res) => {
  const { device_id } = req.device;
  const { alert_type, message } = req.body;

  // Chỉ chấp nhận các alert_type liên quan đến Computer Vision
  const VALID_VISION_ALERT_TYPES = ['posture_warning', 'stranger_detected', 'eye_distance_warning'];

  if (!alert_type || !VALID_VISION_ALERT_TYPES.includes(alert_type)) {
    return res.status(400).json({
      message: `Invalid alert_type. Allowed: ${VALID_VISION_ALERT_TYPES.join(', ')}`,
    });
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ message: 'message is required' });
  }

  // Giới hạn độ dài message để tránh spam
  const trimmedMessage = message.trim().substring(0, 500);

  try {
    // ── Bảo mật: Kiểm tra xem phụ huynh có BẬT tính năng giám sát webcam không ──
    const settingsCheck = await adminPool.query(
      'SELECT enable_webcam_monitoring FROM settings WHERE child_id = $1',
      [req.device.child_id]
    );
    const hasWebcamEnabled = settingsCheck.rows[0]?.enable_webcam_monitoring ?? false;

    if (!hasWebcamEnabled) {
      return res.status(403).json({
        message: 'Webcam monitoring feature is disabled for this child. Vision alert rejected.',
      });
    }

    // Kiểm tra xem đã có cảnh báo cùng loại trong 5 phút qua chưa.
    // Tránh tạo hàng nghìn alert trùng lặp khi Agent phát hiện liên tục.
    const recentAlert = await adminPool.query(
      `SELECT alert_id FROM alerts
       WHERE device_id = $1 AND alert_type = $2 AND created_at > NOW() - INTERVAL '5 minutes'
       LIMIT 1`,
      [device_id, alert_type]
    );

    if (recentAlert.rows.length > 0) {
      // Cảnh báo đã được tạo gần đây, bỏ qua để tránh spam
      return res.status(200).json({
        message: 'Alert suppressed (duplicate within 5 minutes)',
        suppressed: true,
      });
    }

    const result = await adminPool.query(
      `INSERT INTO alerts(device_id, alert_type, message)
       VALUES($1, $2, $3)
       RETURNING alert_id, device_id, alert_type, message, is_read, created_at`,
      [device_id, alert_type, trimmedMessage]
    );

    // Truy vấn lấy user_id của phụ huynh để gửi thông báo đẩy
    const childResult = await adminPool.query(
      'SELECT user_id FROM children WHERE child_id = $1',
      [req.device.child_id]
    );
    const userId = childResult.rows[0]?.user_id;

    if (userId) {
      const friendlyTitles = {
        posture_warning: 'Cảnh báo tư thế ngồi',
        stranger_detected: 'Phát hiện người lạ đứng sau',
        eye_distance_warning: 'Cảnh báo khoảng cách mắt',
      };
      const title = friendlyTitles[alert_type] || 'Cảnh báo từ thiết bị';
      sendPushNotification(userId, title, trimmedMessage, {
        type: 'alert',
        route: 'alerts',
        alert_id: result.rows[0].alert_id,
        device_id,
        alert_type,
      })
        .catch(err => console.error('Failed to send vision push notification:', err));
    }

    res.status(201).json({
      message: 'Vision alert recorded',
      alert: result.rows[0],
    });
  } catch (error) {
    console.error('Send vision alert error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /api/agent/text-moderation/batch
// Raw text is sent to OpenAI for immediate moderation and is never inserted into PostgreSQL.
exports.moderateTextBatch = async (req, res) => {
  let records;
  try {
    records = normalizeTextModerationRecords(req.body);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  const acceptedIds = records.map((record) => record.clientRecordId);
  try {
    const settingsResult = await adminPool.query(
      'SELECT enable_text_moderation FROM settings WHERE child_id = $1',
      [req.device.child_id]
    );
    if (settingsResult.rows[0]?.enable_text_moderation !== true) {
      return res.status(201).json({
        enabled: false,
        accepted_client_record_ids: acceptedIds,
        flagged_count: 0,
      });
    }

    const existingResult = await adminPool.query(
      `SELECT client_record_id::text AS client_record_id
       FROM text_moderation_events
       WHERE device_id = $1 AND client_record_id = ANY($2::uuid[])`,
      [req.device.device_id, acceptedIds]
    );
    const existingIds = new Set(existingResult.rows.map((row) => row.client_record_id));
    const pendingRecords = records.filter((record) => !existingIds.has(record.clientRecordId));
    if (pendingRecords.length === 0) {
      return res.status(201).json({
        enabled: true,
        accepted_client_record_ids: acceptedIds,
        flagged_count: 0,
      });
    }

    const moderation = await moderateTexts(pendingRecords.map((record) => record.text));
    const client = await adminPool.connect();
    const alertsToPush = [];
    let flaggedCount = 0;
    try {
      await client.query('BEGIN');
      for (let index = 0; index < pendingRecords.length; index += 1) {
        const record = pendingRecords[index];
        const result = moderation.results[index];
        const eventInsert = await client.query(
          `INSERT INTO text_moderation_events(
             device_id, client_record_id, source_type, status, risk_type, severity,
             primary_category, confidence, category_scores, moderation_model,
             domain, occurred_at
           ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)
           ON CONFLICT (device_id, client_record_id) DO NOTHING
           RETURNING event_id`,
          [
            req.device.device_id,
            record.clientRecordId,
            record.sourceType,
            result.flagged ? 'flagged' : 'safe',
            result.riskType,
            result.severity,
            result.primaryCategory,
            result.confidence,
            JSON.stringify(result.categoryScores),
            moderation.model,
            record.domain,
            record.occurredAt,
          ]
        );
        if (!result.flagged || eventInsert.rows.length === 0) continue;
        flaggedCount += 1;
        const presentation = textAlertPresentation(result, record.sourceType, record.domain);
        if (!presentation) continue;

        const recentAlert = await client.query(
          `SELECT alert_id FROM alerts
           WHERE device_id = $1 AND alert_type = $2
             AND created_at > NOW() - INTERVAL '5 minutes'
           LIMIT 1`,
          [req.device.device_id, presentation.alertType]
        );
        if (recentAlert.rows.length > 0) continue;
        const alertInsert = await client.query(
          `INSERT INTO alerts(device_id, alert_type, message)
           VALUES($1, $2, $3)
           RETURNING alert_id`,
          [req.device.device_id, presentation.alertType, presentation.message]
        );
        alertsToPush.push({
          ...presentation,
          alertId: alertInsert.rows[0].alert_id,
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (alertsToPush.length > 0) {
      const childResult = await adminPool.query(
        'SELECT user_id FROM children WHERE child_id = $1',
        [req.device.child_id]
      );
      const userId = childResult.rows[0]?.user_id;
      if (userId) {
        for (const alert of alertsToPush) {
          sendPushNotification(userId, alert.title, alert.message, {
            type: 'alert',
            route: 'alerts',
            alert_id: alert.alertId,
            device_id: req.device.device_id,
            alert_type: alert.alertType,
          }).catch((error) => console.error('Failed to send text safety push:', error.message));
        }
      }
    }

    return res.status(201).json({
      enabled: true,
      accepted_client_record_ids: acceptedIds,
      flagged_count: flaggedCount,
    });
  } catch (error) {
    if (error.code === 'OPENAI_NOT_CONFIGURED' || error.code === 'OPENAI_INVALID_MODERATION_MODEL') {
      return res.status(503).json({ message: 'Text moderation is not configured' });
    }
    if (error.code === 'OPENAI_MODERATION_FAILED') {
      return res.status(502).json({ message: 'Text moderation provider failed' });
    }
    console.error('Text moderation batch error:', error.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
