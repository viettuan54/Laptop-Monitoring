const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODERATION_ENDPOINT,
  getModerationConfig,
  moderateTexts,
  normalizeModerationResult,
} = require('../src/services/textModeration.service');

function scores(overrides = {}) {
  return {
    harassment: 0.01,
    'harassment/threatening': 0.01,
    hate: 0.01,
    'hate/threatening': 0.01,
    'self-harm': 0.01,
    'self-harm/intent': 0.01,
    'self-harm/instructions': 0.01,
    violence: 0.01,
    'violence/graphic': 0.01,
    ...overrides,
  };
}

test('requires a backend OpenAI key and an allowlisted moderation model', () => {
  assert.throws(
    () => getModerationConfig({}),
    (error) => error.code === 'OPENAI_NOT_CONFIGURED'
  );
  assert.throws(
    () => getModerationConfig({ OPENAI_API_KEY: 'secret', OPENAI_MODERATION_MODEL: 'gpt-custom' }),
    (error) => error.code === 'OPENAI_INVALID_MODERATION_MODEL'
  );
});

test('maps self-harm intent to a critical parent alert without depending on overall flagged', () => {
  const result = normalizeModerationResult({
    flagged: true,
    categories: { 'self-harm/intent': true, harassment: false },
    category_scores: scores({ 'self-harm/intent': 0.94 }),
  });

  assert.equal(result.flagged, true);
  assert.equal(result.riskType, 'self_harm');
  assert.equal(result.severity, 'critical');
  assert.equal(result.primaryCategory, 'self-harm/intent');
  assert.equal(result.confidence, 0.94);
});

test('ignores categories outside the child text-safety taxonomy', () => {
  const result = normalizeModerationResult({
    flagged: true,
    categories: { sexual: true },
    category_scores: { ...scores(), sexual: 0.99 },
  });

  assert.equal(result.flagged, false);
  assert.equal(result.riskType, 'none');
  assert.equal(result.severity, 'low');
  assert.equal(result.primaryCategory, null);
});

test('sends one batched request to the official moderation endpoint', async () => {
  let captured;
  const response = await moderateTexts(['first text', 'second text'], {
    environment: {
      OPENAI_API_KEY: 'backend-only-key',
      OPENAI_MODERATION_MODEL: 'omni-moderation-latest',
    },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        async json() {
          return {
            model: 'omni-moderation-latest',
            results: [
              { categories: {}, category_scores: scores() },
              {
                categories: { 'harassment/threatening': true },
                category_scores: scores({ 'harassment/threatening': 0.88 }),
              },
            ],
          };
        },
      };
    },
  });

  assert.equal(captured.url, MODERATION_ENDPOINT);
  assert.equal(captured.options.headers.Authorization, 'Bearer backend-only-key');
  assert.deepEqual(JSON.parse(captured.options.body), {
    model: 'omni-moderation-latest',
    input: ['first text', 'second text'],
  });
  assert.equal(response.results[0].flagged, false);
  assert.equal(response.results[1].riskType, 'harassment');
  assert.equal(response.results[1].severity, 'critical');
});
