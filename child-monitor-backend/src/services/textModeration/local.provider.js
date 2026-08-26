const { isSafeModelName, normalizeLocalResult } = require('./contract');

const DEFAULT_LOCAL_MODERATION_URL = 'http://127.0.0.1:8100';
const DEFAULT_LOCAL_MODERATION_TIMEOUT_MS = 15_000;

function configurationError(message) {
  const error = new Error(message);
  error.code = 'TEXT_MODERATION_INVALID_CONFIG';
  return error;
}

function getLocalConfig(environment) {
  const rawUrl = String(
    environment.LOCAL_MODERATION_URL || DEFAULT_LOCAL_MODERATION_URL
  ).trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (_) {
    throw configurationError('LOCAL_MODERATION_URL is invalid');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)
      || parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw configurationError('LOCAL_MODERATION_URL is invalid');
  }
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  if (environment.NODE_ENV === 'production'
      && parsedUrl.protocol !== 'https:'
      && !loopbackHosts.has(parsedUrl.hostname)) {
    throw configurationError('Remote LOCAL_MODERATION_URL must use HTTPS in production');
  }

  const apiKey = String(environment.LOCAL_MODERATION_API_KEY || '').trim();
  if (environment.NODE_ENV === 'production' && apiKey.length < 16) {
    throw configurationError(
      'LOCAL_MODERATION_API_KEY must contain at least 16 characters in production'
    );
  }
  const timeoutMs = Number(
    environment.LOCAL_MODERATION_TIMEOUT_MS || DEFAULT_LOCAL_MODERATION_TIMEOUT_MS
  );
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) {
    throw configurationError('LOCAL_MODERATION_TIMEOUT_MS must be between 1000 and 60000');
  }

  const baseUrl = parsedUrl.toString().replace(/\/$/, '');
  return {
    apiKey,
    endpoint: `${baseUrl}/v1/moderate`,
    timeoutMs,
  };
}

function isRetryable(error) {
  return error?.name === 'TimeoutError'
    || error?.name === 'AbortError'
    || ['ECONNRESET', 'ECONNREFUSED', 'EPIPE'].includes(error?.code)
    || ['ECONNRESET', 'ECONNREFUSED', 'EPIPE'].includes(error?.cause?.code)
    || (Number.isInteger(error?.status) && error.status >= 500);
}

function providerFailure(message, status) {
  const error = new Error(message);
  error.code = 'TEXT_MODERATION_PROVIDER_FAILED';
  if (Number.isInteger(status)) error.status = status;
  return error;
}

async function moderateWithLocal(records, options) {
  const { config, fetchImpl } = options;
  const requestItems = records.map((record) => ({
    id: record.id,
    text: record.text,
    sourceType: record.sourceType,
    direction: record.direction,
    context: record.context,
  }));

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers['X-Local-Moderation-Key'] = config.apiKey;
      const response = await fetchImpl(config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ items: requestItems }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!response.ok) {
        if ([401, 403].includes(response.status)) {
          throw configurationError('Local moderation credentials were rejected');
        }
        throw providerFailure(
          `Local moderation returned HTTP ${response.status}`,
          response.status
        );
      }

      const payload = await response.json();
      if (payload?.provider !== 'local' || !isSafeModelName(payload.model)
          || !Array.isArray(payload.results) || payload.results.length !== records.length) {
        throw providerFailure('Local moderation returned an invalid response');
      }
      let normalizedResults;
      try {
        normalizedResults = payload.results.map(normalizeLocalResult);
      } catch (_) {
        throw providerFailure('Local moderation returned an invalid result');
      }
      const byId = new Map();
      for (const result of normalizedResults) {
        if (byId.has(result.id)) {
          throw providerFailure('Local moderation returned duplicated result IDs');
        }
        byId.set(result.id, result);
      }
      const results = records.map((record) => byId.get(record.id));
      if (results.some((result) => !result)) {
        throw providerFailure('Local moderation result IDs do not match the request');
      }
      return {
        provider: 'local',
        model: payload.model,
        results: results.map(({ id, ...result }) => result),
      };
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === 2) break;
    }
  }
  if (!lastError.code) lastError.code = 'TEXT_MODERATION_PROVIDER_FAILED';
  throw lastError;
}

module.exports = {
  DEFAULT_LOCAL_MODERATION_TIMEOUT_MS,
  DEFAULT_LOCAL_MODERATION_URL,
  getLocalConfig,
  moderateWithLocal,
};
