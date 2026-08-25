const MODERATION_ENDPOINT = 'https://api.openai.com/v1/moderations';
const DEFAULT_MODERATION_MODEL = 'omni-moderation-latest';
const SUPPORTED_MODERATION_MODELS = new Set([
  DEFAULT_MODERATION_MODEL,
  'omni-moderation-2024-09-26',
]);

const CATEGORY_RULES = Object.freeze({
  'self-harm/intent': { riskType: 'self_harm', severity: 'critical', priority: 40 },
  'self-harm/instructions': { riskType: 'self_harm', severity: 'critical', priority: 40 },
  'harassment/threatening': { riskType: 'harassment', severity: 'critical', priority: 30 },
  'hate/threatening': { riskType: 'harassment', severity: 'critical', priority: 30 },
  'self-harm': { riskType: 'self_harm', severity: 'high', priority: 25 },
  harassment: { riskType: 'harassment', severity: 'high', priority: 20 },
  hate: { riskType: 'harassment', severity: 'high', priority: 20 },
  'violence/graphic': { riskType: 'violence', severity: 'high', priority: 15 },
  violence: { riskType: 'violence', severity: 'high', priority: 10 },
});

const SEVERITY_ORDER = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });

function getModerationConfig(environment = process.env) {
  const model = String(environment.OPENAI_MODERATION_MODEL || DEFAULT_MODERATION_MODEL).trim();
  if (!SUPPORTED_MODERATION_MODELS.has(model)) {
    const error = new Error('OPENAI_MODERATION_MODEL is not supported');
    error.code = 'OPENAI_INVALID_MODERATION_MODEL';
    throw error;
  }
  const apiKey = String(environment.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('OpenAI moderation is not configured');
    error.code = 'OPENAI_NOT_CONFIGURED';
    throw error;
  }
  return { apiKey, model };
}

function normalizeModerationResult(result) {
  const categories = result?.categories || {};
  const scores = result?.category_scores || {};
  const activeRules = Object.entries(CATEGORY_RULES)
    .filter(([category]) => categories[category] === true)
    .map(([category, rule]) => ({
      category,
      ...rule,
      score: Number.isFinite(scores[category]) ? scores[category] : 0,
    }));

  const relevantScores = Object.fromEntries(
    Object.keys(CATEGORY_RULES).map((category) => [
      category,
      Number.isFinite(scores[category]) ? scores[category] : 0,
    ])
  );

  if (activeRules.length === 0) {
    return {
      flagged: false,
      riskType: 'none',
      severity: 'low',
      primaryCategory: null,
      confidence: Math.max(0, ...Object.values(relevantScores)),
      categoryScores: relevantScores,
    };
  }

  activeRules.sort((left, right) => (
    SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity]
    || right.priority - left.priority
    || right.score - left.score
  ));
  const primary = activeRules[0];
  return {
    flagged: true,
    riskType: primary.riskType,
    severity: primary.severity,
    primaryCategory: primary.category,
    confidence: Math.max(...activeRules.map((item) => item.score)),
    categoryScores: relevantScores,
  };
}

async function moderateTexts(texts, options = {}) {
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > 20) {
    throw new TypeError('Moderation input must contain between 1 and 20 texts');
  }
  const { apiKey, model } = getModerationConfig(options.environment);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable');
  }

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(MODERATION_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const error = new Error(`OpenAI moderation returned HTTP ${response.status}`);
        error.code = 'OPENAI_MODERATION_FAILED';
        error.status = response.status;
        throw error;
      }
      const payload = await response.json();
      if (!Array.isArray(payload?.results) || payload.results.length !== texts.length) {
        const error = new Error('OpenAI moderation returned an invalid result count');
        error.code = 'OPENAI_MODERATION_FAILED';
        throw error;
      }
      return {
        model: typeof payload.model === 'string' ? payload.model : model,
        results: payload.results.map(normalizeModerationResult),
      };
    } catch (error) {
      lastError = error;
      const retryable = error?.name === 'TimeoutError'
        || error?.name === 'AbortError'
        || error?.code === 'ECONNRESET'
        || (Number.isInteger(error?.status) && (error.status === 429 || error.status >= 500));
      if (!retryable || attempt === 2) break;
    }
  }
  if (!lastError.code) lastError.code = 'OPENAI_MODERATION_FAILED';
  throw lastError;
}

module.exports = {
  CATEGORY_RULES,
  DEFAULT_MODERATION_MODEL,
  MODERATION_ENDPOINT,
  getModerationConfig,
  moderateTexts,
  normalizeModerationResult,
};
