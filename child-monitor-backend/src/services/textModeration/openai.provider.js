const { isSafeModelName, normalizeOpenAIResult } = require('./contract');

const OPENAI_MODERATION_ENDPOINT = 'https://api.openai.com/v1/moderations';
const DEFAULT_OPENAI_MODERATION_MODEL = 'omni-moderation-latest';
const SUPPORTED_OPENAI_MODERATION_MODELS = new Set([
  DEFAULT_OPENAI_MODERATION_MODEL,
  'omni-moderation-2024-09-26',
]);

function configurationError(message) {
  const error = new Error(message);
  error.code = 'TEXT_MODERATION_INVALID_CONFIG';
  return error;
}

function getOpenAIConfig(environment) {
  const model = String(
    environment.OPENAI_MODERATION_MODEL || DEFAULT_OPENAI_MODERATION_MODEL
  ).trim();
  if (!SUPPORTED_OPENAI_MODERATION_MODELS.has(model)) {
    throw configurationError('OPENAI_MODERATION_MODEL is not supported');
  }
  const apiKey = String(environment.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw configurationError('OpenAI moderation is not configured');
  }
  return { apiKey, model };
}

function isRetryable(error) {
  return error?.name === 'TimeoutError'
    || error?.name === 'AbortError'
    || error?.code === 'ECONNRESET'
    || error?.cause?.code === 'ECONNRESET'
    || (Number.isInteger(error?.status) && (error.status === 429 || error.status >= 500));
}

async function moderateWithOpenAI(records, options) {
  const { config, fetchImpl } = options;
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(OPENAI_MODERATION_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          input: records.map((record) => record.text),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const error = new Error(`OpenAI moderation returned HTTP ${response.status}`);
        error.code = 'TEXT_MODERATION_PROVIDER_FAILED';
        error.status = response.status;
        throw error;
      }
      const payload = await response.json();
      if (!Array.isArray(payload?.results) || payload.results.length !== records.length) {
        const error = new Error('OpenAI moderation returned an invalid result count');
        error.code = 'TEXT_MODERATION_PROVIDER_FAILED';
        throw error;
      }
      const model = typeof payload.model === 'string' ? payload.model : config.model;
      if (!isSafeModelName(model)) {
        const error = new Error('OpenAI moderation returned an invalid model name');
        error.code = 'TEXT_MODERATION_PROVIDER_FAILED';
        throw error;
      }
      return {
        provider: 'openai',
        model,
        results: payload.results.map(normalizeOpenAIResult),
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
  DEFAULT_OPENAI_MODERATION_MODEL,
  OPENAI_MODERATION_ENDPOINT,
  getOpenAIConfig,
  moderateWithOpenAI,
};
