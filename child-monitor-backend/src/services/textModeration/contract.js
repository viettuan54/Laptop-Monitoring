const CATEGORY_RULES = Object.freeze({
  'self-harm/intent': { riskType: 'self_harm', severity: 'critical', priority: 100 },
  'self-harm/instructions': { riskType: 'self_harm', severity: 'critical', priority: 95 },
  'harassment/threatening': { riskType: 'harassment', severity: 'critical', priority: 90 },
  'hate/threatening': { riskType: 'harassment', severity: 'critical', priority: 85 },
  'violence/inciting': { riskType: 'violence', severity: 'critical', priority: 80 },
  'self-harm': { riskType: 'self_harm', severity: 'high', priority: 70 },
  harassment: { riskType: 'harassment', severity: 'high', priority: 60 },
  hate: { riskType: 'harassment', severity: 'high', priority: 55 },
  'violence/graphic': { riskType: 'violence', severity: 'high', priority: 50 },
  violence: { riskType: 'violence', severity: 'high', priority: 40 },
});

const SEVERITY_ORDER = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });
const VALID_RISK_TYPES = new Set(['none', 'self_harm', 'harassment', 'violence']);
const VALID_SEVERITIES = new Set(Object.keys(SEVERITY_ORDER));
const VALID_ACTIONS = new Set(['allow', 'review', 'alert']);
const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

function isSafeModelName(value) {
  return typeof value === 'string' && MODEL_NAME_PATTERN.test(value);
}

function normalizeOpenAIResult(result) {
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
      action: 'allow',
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
    action: 'alert',
    riskType: primary.riskType,
    severity: primary.severity,
    primaryCategory: primary.category,
    confidence: Math.max(...activeRules.map((item) => item.score)),
    categoryScores: relevantScores,
  };
}

function assertFiniteScore(value, field) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} must be a finite number between 0 and 1`);
  }
}

function normalizeLocalResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('Local moderation result must be an object');
  }
  if (typeof result.id !== 'string' || !result.id || result.id.length > 128) {
    throw new TypeError('Local moderation result ID is invalid');
  }
  if (typeof result.flagged !== 'boolean' || !VALID_ACTIONS.has(result.action)
      || !VALID_RISK_TYPES.has(result.riskType) || !VALID_SEVERITIES.has(result.severity)) {
    throw new TypeError('Local moderation decision fields are invalid');
  }
  if (result.primaryCategory !== null
      && (!Object.hasOwn(CATEGORY_RULES, result.primaryCategory)
        || result.primaryCategory.length > 40)) {
    throw new TypeError('Local moderation primary category is invalid');
  }
  assertFiniteScore(result.confidence, 'Local moderation confidence');
  if (!result.categoryScores || typeof result.categoryScores !== 'object'
      || Array.isArray(result.categoryScores)) {
    throw new TypeError('Local moderation category scores are invalid');
  }

  const categoryScores = {};
  for (const category of Object.keys(CATEGORY_RULES)) {
    const value = result.categoryScores[category] ?? 0;
    assertFiniteScore(value, `Local moderation score '${category}'`);
    categoryScores[category] = value;
  }

  if (result.flagged) {
    if (result.action !== 'alert' || result.riskType === 'none'
        || result.primaryCategory === null
        || !['high', 'critical'].includes(result.severity)) {
      throw new TypeError('Flagged local moderation decision is inconsistent');
    }
  } else if (result.action === 'alert') {
    throw new TypeError('Unflagged local moderation decision cannot alert');
  } else if (result.action === 'allow'
      && (result.riskType !== 'none' || result.severity !== 'low'
        || result.primaryCategory !== null)) {
    throw new TypeError('Allowed local moderation decision is inconsistent');
  } else if (result.action === 'review'
      && (result.riskType === 'none' || result.severity !== 'medium'
        || result.primaryCategory === null)) {
    throw new TypeError('Review local moderation decision is inconsistent');
  }

  return {
    id: result.id,
    flagged: result.flagged,
    action: result.action,
    riskType: result.riskType,
    severity: result.severity,
    primaryCategory: result.primaryCategory,
    confidence: result.confidence,
    categoryScores,
  };
}

module.exports = {
  CATEGORY_RULES,
  SEVERITY_ORDER,
  isSafeModelName,
  normalizeLocalResult,
  normalizeOpenAIResult,
};
