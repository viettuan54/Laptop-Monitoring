const {
  CATEGORY_RULES,
  normalizeOpenAIResult,
} = require('./textModeration/contract');
const {
  DEFAULT_LOCAL_MODERATION_URL,
  getLocalConfig,
  moderateWithLocal,
} = require('./textModeration/local.provider');
const {
  DEFAULT_OPENAI_MODERATION_MODEL,
  OPENAI_MODERATION_ENDPOINT,
  getOpenAIConfig,
  moderateWithOpenAI,
} = require('./textModeration/openai.provider');

const DEFAULT_TEXT_MODERATION_PROVIDER = 'local';
const SUPPORTED_TEXT_MODERATION_PROVIDERS = new Set(['local', 'openai']);
const VALID_SOURCE_TYPES = new Set([
  'search_query',
  'page_content',
  'chat_received',
  'chat_authored',
]);

function getModerationConfig(environment = process.env) {
  const provider = String(
    environment.TEXT_MODERATION_PROVIDER || DEFAULT_TEXT_MODERATION_PROVIDER
  ).trim().toLowerCase();
  if (!SUPPORTED_TEXT_MODERATION_PROVIDERS.has(provider)) {
    const error = new Error('TEXT_MODERATION_PROVIDER must be local or openai');
    error.code = 'TEXT_MODERATION_INVALID_CONFIG';
    throw error;
  }
  const providerConfig = provider === 'local'
    ? getLocalConfig(environment)
    : getOpenAIConfig(environment);
  return { provider, ...providerConfig };
}

function directionForSource(sourceType) {
  if (sourceType === 'chat_received') return 'received';
  if (sourceType === 'chat_authored') return 'authored';
  return 'unknown';
}

function normalizeRecords(records) {
  if (!Array.isArray(records) || records.length === 0 || records.length > 20) {
    throw new TypeError('Moderation input must contain between 1 and 20 records');
  }
  const seenIds = new Set();
  return records.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError(`Moderation record ${index} must be an object`);
    }
    const id = String(record.id ?? record.clientRecordId ?? index).trim();
    const sourceType = record.sourceType || 'page_content';
    const direction = record.direction || directionForSource(sourceType);
    const context = record.context ?? [];
    if (!id || id.length > 128 || seenIds.has(id)) {
      throw new TypeError(`Moderation record ${index} has an invalid or duplicated ID`);
    }
    seenIds.add(id);
    if (typeof record.text !== 'string' || !record.text.trim() || record.text.length > 4000) {
      throw new TypeError(`Moderation record ${index} has invalid text`);
    }
    if (!VALID_SOURCE_TYPES.has(sourceType)) {
      throw new TypeError(`Moderation record ${index} has an invalid source type`);
    }
    if (!['unknown', 'received', 'authored'].includes(direction)) {
      throw new TypeError(`Moderation record ${index} has an invalid direction`);
    }
    if (!Array.isArray(context) || context.length > 5
        || context.some((value) => typeof value !== 'string'
          || !value.trim() || value.length > 1000)) {
      throw new TypeError(`Moderation record ${index} has invalid context`);
    }
    return { id, text: record.text, sourceType, direction, context };
  });
}

async function moderateRecords(records, options = {}) {
  const normalizedRecords = normalizeRecords(records);
  const config = getModerationConfig(options.environment);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    const error = new Error('fetch is unavailable');
    error.code = 'TEXT_MODERATION_PROVIDER_FAILED';
    throw error;
  }
  const providerOptions = { config, fetchImpl };
  return config.provider === 'local'
    ? moderateWithLocal(normalizedRecords, providerOptions)
    : moderateWithOpenAI(normalizedRecords, providerOptions);
}

async function moderateTexts(texts, options = {}) {
  if (!Array.isArray(texts)) {
    throw new TypeError('Moderation input must be an array');
  }
  return moderateRecords(
    texts.map((text, index) => ({
      id: String(index),
      text,
      sourceType: 'page_content',
    })),
    options
  );
}

module.exports = {
  CATEGORY_RULES,
  DEFAULT_LOCAL_MODERATION_URL,
  DEFAULT_MODERATION_MODEL: DEFAULT_OPENAI_MODERATION_MODEL,
  DEFAULT_OPENAI_MODERATION_MODEL,
  DEFAULT_TEXT_MODERATION_PROVIDER,
  MODERATION_ENDPOINT: OPENAI_MODERATION_ENDPOINT,
  OPENAI_MODERATION_ENDPOINT,
  getModerationConfig,
  moderateRecords,
  moderateTexts,
  normalizeModerationResult: normalizeOpenAIResult,
  normalizeOpenAIResult,
};
