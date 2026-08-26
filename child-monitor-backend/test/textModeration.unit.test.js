const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MODERATION_ENDPOINT,
  getModerationConfig,
  moderateRecords,
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
    'violence/inciting': 0.01,
    'violence/graphic': 0.01,
    ...overrides,
  };
}

function localResult(id, overrides = {}) {
  return {
    id,
    flagged: false,
    action: 'allow',
    riskType: 'none',
    severity: 'low',
    primaryCategory: null,
    confidence: 0.02,
    categoryScores: scores(),
    matchedSignals: [],
    ...overrides,
  };
}

test('defaults to the loopback local provider without requiring an OpenAI key', () => {
  const config = getModerationConfig({ NODE_ENV: 'development' });

  assert.equal(config.provider, 'local');
  assert.equal(config.endpoint, 'http://127.0.0.1:8100/v1/moderate');
  assert.equal(config.timeoutMs, 15_000);
  assert.equal(config.apiKey, '');
});

test('rejects unsafe or incomplete provider configuration', () => {
  assert.throws(
    () => getModerationConfig({ TEXT_MODERATION_PROVIDER: 'unknown' }),
    (error) => error.code === 'TEXT_MODERATION_INVALID_CONFIG'
  );
  assert.throws(
    () => getModerationConfig({
      TEXT_MODERATION_PROVIDER: 'local',
      NODE_ENV: 'production',
      LOCAL_MODERATION_URL: 'http://moderation.internal:8100',
      LOCAL_MODERATION_API_KEY: 'long-enough-local-secret',
    }),
    (error) => error.code === 'TEXT_MODERATION_INVALID_CONFIG'
  );
  assert.throws(
    () => getModerationConfig({
      TEXT_MODERATION_PROVIDER: 'openai',
      OPENAI_MODERATION_MODEL: 'gpt-custom',
      OPENAI_API_KEY: 'secret',
    }),
    (error) => error.code === 'TEXT_MODERATION_INVALID_CONFIG'
  );
  assert.throws(
    () => getModerationConfig({ TEXT_MODERATION_PROVIDER: 'openai' }),
    (error) => error.code === 'TEXT_MODERATION_INVALID_CONFIG'
  );
});

test('maps self-harm intent to a critical parent alert without depending on overall flagged', () => {
  const result = normalizeModerationResult({
    flagged: true,
    categories: { 'self-harm/intent': true, harassment: false },
    category_scores: scores({ 'self-harm/intent': 0.94 }),
  });

  assert.equal(result.flagged, true);
  assert.equal(result.action, 'alert');
  assert.equal(result.riskType, 'self_harm');
  assert.equal(result.severity, 'critical');
  assert.equal(result.primaryCategory, 'self-harm/intent');
  assert.equal(result.confidence, 0.94);
});

test('ignores OpenAI categories outside the child text-safety taxonomy', () => {
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

test('sends one batched request to OpenAI only when that provider is selected', async () => {
  let captured;
  const response = await moderateTexts(['first text', 'second text'], {
    environment: {
      TEXT_MODERATION_PROVIDER: 'openai',
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
  assert.equal(response.provider, 'openai');
  assert.equal(response.results[0].flagged, false);
  assert.equal(response.results[1].riskType, 'harassment');
  assert.equal(response.results[1].severity, 'critical');
});

test('local provider sends source context, authenticates and restores input order by ID', async () => {
  let captured;
  const response = await moderateRecords([
    {
      clientRecordId: 'record-one',
      text: 'Tao sẽ đánh mày',
      sourceType: 'chat_received',
      context: ['Mày là đồ ngu'],
    },
    {
      clientRecordId: 'record-two',
      text: 'Ngày mai học bài nhé',
      sourceType: 'chat_authored',
    },
  ], {
    environment: {
      TEXT_MODERATION_PROVIDER: 'local',
      LOCAL_MODERATION_URL: 'http://127.0.0.1:9999/',
      LOCAL_MODERATION_API_KEY: 'local-backend-secret',
      LOCAL_MODERATION_TIMEOUT_MS: '9000',
    },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        async json() {
          return {
            provider: 'local',
            model: 'vi-context-rules-v1',
            taxonomyVersion: '1.0.0',
            results: [
              localResult('record-two'),
              localResult('record-one', {
                flagged: true,
                action: 'alert',
                riskType: 'harassment',
                severity: 'critical',
                primaryCategory: 'harassment/threatening',
                confidence: 0.97,
                categoryScores: scores({ 'harassment/threatening': 0.97 }),
              }),
            ],
          };
        },
      };
    },
  });

  assert.equal(captured.url, 'http://127.0.0.1:9999/v1/moderate');
  assert.equal(captured.options.headers['X-Local-Moderation-Key'], 'local-backend-secret');
  const sent = JSON.parse(captured.options.body);
  assert.deepEqual(sent.items.map((item) => item.id), ['record-one', 'record-two']);
  assert.equal(sent.items[0].direction, 'received');
  assert.deepEqual(sent.items[0].context, ['Mày là đồ ngu']);
  assert.equal(sent.items[1].direction, 'authored');
  assert.equal(response.provider, 'local');
  assert.equal(response.model, 'vi-context-rules-v1');
  assert.equal(response.results[0].riskType, 'harassment');
  assert.equal(response.results[1].riskType, 'none');
});

test('local provider rejects inconsistent output without exposing input text', async () => {
  const privateText = 'private child text must not appear in the error';
  await assert.rejects(
    moderateRecords([{
      id: 'one',
      text: privateText,
      sourceType: 'search_query',
    }], {
      environment: { TEXT_MODERATION_PROVIDER: 'local' },
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            provider: 'local',
            model: 'vi-context-rules-v1',
            results: [localResult('wrong-id')],
          };
        },
      }),
    }),
    (error) => error.code === 'TEXT_MODERATION_PROVIDER_FAILED'
      && !error.message.includes(privateText)
  );
});

test('local provider retries temporary server failures exactly once', async () => {
  let attempts = 0;
  await assert.rejects(
    moderateTexts(['temporary failure'], {
      environment: { TEXT_MODERATION_PROVIDER: 'local' },
      fetchImpl: async () => {
        attempts += 1;
        return { ok: false, status: 503 };
      },
    }),
    (error) => error.code === 'TEXT_MODERATION_PROVIDER_FAILED'
  );
  assert.equal(attempts, 2);
});

test('local credential rejection is treated as configuration failure without retry', async () => {
  let attempts = 0;
  await assert.rejects(
    moderateTexts(['credential check'], {
      environment: {
        TEXT_MODERATION_PROVIDER: 'local',
        LOCAL_MODERATION_API_KEY: 'wrong-secret',
      },
      fetchImpl: async () => {
        attempts += 1;
        return { ok: false, status: 401 };
      },
    }),
    (error) => error.code === 'TEXT_MODERATION_INVALID_CONFIG'
  );
  assert.equal(attempts, 1);
});
