const LABELS = Object.freeze(['SAFE', 'RISK', 'HIGH_RISK']);
const LABEL_SET = new Set(LABELS);
const ACTION_BY_LABEL = Object.freeze({ SAFE: 'allow', RISK: 'review', HIGH_RISK: 'alert' });
const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

function isSafeModelName(value) {
  return typeof value === 'string' && MODEL_NAME_PATTERN.test(value);
}

function normalizeLocalResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('Local classification result must be an object');
  }
  if (typeof result.id !== 'string' || !result.id || result.id.length > 128
      || !LABEL_SET.has(result.label)) {
    throw new TypeError('Local classification ID or label is invalid');
  }
  if (!result.scores || typeof result.scores !== 'object' || Array.isArray(result.scores)
      || Object.keys(result.scores).length !== LABELS.length) {
    throw new TypeError('Local classification scores are invalid');
  }
  const scores = {};
  for (const label of LABELS) {
    const score = result.scores[label];
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      throw new TypeError(`Local classification score for ${label} is invalid`);
    }
    scores[label] = score;
  }
  const sum = LABELS.reduce((total, label) => total + scores[label], 0);
  if (Math.abs(sum - 1) > 0.001 || !Number.isFinite(result.confidence)
      || Math.abs(result.confidence - scores[result.label]) > 0.001
      || scores[result.label] !== Math.max(...Object.values(scores))
      || result.flagged !== (result.label !== 'SAFE')
      || result.action !== ACTION_BY_LABEL[result.label]) {
    throw new TypeError('Local classification decision is inconsistent');
  }
  return {
    id: result.id,
    label: result.label,
    scores,
    confidence: result.confidence,
    flagged: result.flagged,
    action: result.action,
  };
}

module.exports = { LABELS, isSafeModelName, normalizeLocalResult };
