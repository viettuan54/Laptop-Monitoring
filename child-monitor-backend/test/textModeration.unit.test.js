const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LABELS, getModerationConfig, moderateRecords, moderateTexts,
} = require('../src/services/textModeration.service');

function localResult(id, label = 'SAFE') {
  const scores = {
    SAFE: label === 'SAFE' ? 0.9 : 0.05,
    RISK: label === 'RISK' ? 0.9 : 0.05,
    HIGH_RISK: label === 'HIGH_RISK' ? 0.9 : 0.05,
  };
  return {
    id, label, scores, confidence: 0.9,
    flagged: label !== 'SAFE',
    action: { SAFE: 'allow', RISK: 'review', HIGH_RISK: 'alert' }[label],
  };
}

test('uses exactly three mutually exclusive labels', () => {
  assert.deepEqual(LABELS, ['SAFE', 'RISK', 'HIGH_RISK']);
  assert.equal(getModerationConfig({ NODE_ENV: 'development' }).provider, 'local');
  assert.throws(
    () => getModerationConfig({ TEXT_MODERATION_PROVIDER: 'openai', OPENAI_API_KEY: 'key' }),
    (error) => error.code === 'TEXT_MODERATION_INVALID_CONFIG'
  );
});

test('rejects unsafe production local configuration', () => {
  assert.throws(
    () => getModerationConfig({ NODE_ENV: 'production', LOCAL_MODERATION_URL: 'http://remote:8100', LOCAL_MODERATION_API_KEY: 'long-enough-local-secret' }),
    (error) => error.code === 'TEXT_MODERATION_INVALID_CONFIG'
  );
});

test('local provider restores order and preserves the three-label result', async () => {
  let captured;
  const response = await moderateRecords([
    { id: 'one', text: 'Bạn dọa đánh em', sourceType: 'chat_received' },
    { id: 'two', text: 'Chào bạn', sourceType: 'chat_authored' },
  ], {
    environment: { TEXT_MODERATION_PROVIDER: 'local', LOCAL_MODERATION_API_KEY: 'secret' },
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, async json() {
        return { provider: 'local', model: 'vi-school-violence-char-nb-v2', labelVersion: '2.0.0', deploymentEligible: false,
          results: [localResult('two'), localResult('one', 'HIGH_RISK')] };
      } };
    },
  });
  assert.equal(captured.url, 'http://127.0.0.1:8100/v1/moderate');
  assert.equal(captured.options.headers['X-Local-Moderation-Key'], 'secret');
  assert.deepEqual(JSON.parse(captured.options.body).items.map((item) => item.id), ['one', 'two']);
  assert.equal(response.results[0].label, 'HIGH_RISK');
  assert.equal(response.results[1].label, 'SAFE');
});

test('rejects legacy ten-label or inconsistent local output without leaking text', async () => {
  const privateText = 'private child text must not appear in the error';
  await assert.rejects(
    moderateTexts([privateText], {
      environment: { TEXT_MODERATION_PROVIDER: 'local' },
      fetchImpl: async () => ({ ok: true, async json() {
        return { provider: 'local', model: 'legacy-model', labelVersion: '2.0.0', deploymentEligible: false,
          results: [{ ...localResult('0'), label: 'self-harm/intent' }] };
      } }),
    }),
    (error) => error.code === 'TEXT_MODERATION_PROVIDER_FAILED' && !error.message.includes(privateText)
  );
});

test('production backend refuses a service using an unapproved artifact', async () => {
  await assert.rejects(
    moderateTexts(['text'], {
      environment: { NODE_ENV: 'production', TEXT_MODERATION_PROVIDER: 'local',
        LOCAL_MODERATION_API_KEY: 'long-enough-local-secret' },
      fetchImpl: async () => ({ ok: true, async json() {
        return { provider: 'local', model: 'vi-school-violence-char-nb-v2',
          labelVersion: '2.0.0', deploymentEligible: false,
          results: [localResult('0', 'HIGH_RISK')] };
      } }),
    }),
    (error) => error.code === 'TEXT_MODERATION_PROVIDER_FAILED'
  );
});

test('retries temporary local failures once and not credential errors', async () => {
  let attempts = 0;
  await assert.rejects(moderateTexts(['text'], {
    environment: { TEXT_MODERATION_PROVIDER: 'local' },
    fetchImpl: async () => { attempts += 1; return { ok: false, status: 503 }; },
  }), (error) => error.code === 'TEXT_MODERATION_PROVIDER_FAILED');
  assert.equal(attempts, 2);
  attempts = 0;
  await assert.rejects(moderateTexts(['text'], {
    environment: { TEXT_MODERATION_PROVIDER: 'local' },
    fetchImpl: async () => { attempts += 1; return { ok: false, status: 401 }; },
  }), (error) => error.code === 'TEXT_MODERATION_INVALID_CONFIG');
  assert.equal(attempts, 1);
});
