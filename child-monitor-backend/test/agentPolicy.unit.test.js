const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAgentPolicyConfig,
  getPolicyBlockedWebDomains,
  groupBlockedCategories,
} = require('../src/services/agentPolicy.service');

test('groups blocked policy categories by resource type without duplicates', () => {
  assert.deepEqual(groupBlockedCategories([
    { resource_type: 'web', category: 'unsafe' },
    { resource_type: 'app', category: 'entertainment' },
    { resource_type: 'web', category: 'entertainment' },
    { resource_type: 'web', category: 'unsafe' },
    { resource_type: 'other', category: 'ignored' },
  ]), {
    app: ['entertainment'],
    web: ['entertainment', 'unsafe'],
  });
});

test('Agent policy config includes classification switches and blocked categories', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (/FROM settings/.test(sql)) {
        return { rows: [{ enable_web_classification: true, daily_limit_minutes: 90 }] };
      }
      return { rows: [
        { resource_type: 'web', category: 'entertainment' },
        { resource_type: 'web', category: 'unsafe' },
      ] };
    },
  };

  const config = await getAgentPolicyConfig(db, 12);

  assert.equal(config.enable_web_classification, true);
  assert.equal(config.enable_text_moderation, false);
  assert.equal(config.daily_limit_minutes, 90);
  assert.equal(config.daily_limit_unlimited, false);
  assert.deepEqual(config.blocked_web_categories, ['entertainment', 'unsafe']);
  assert.deepEqual(config.blocked_app_categories, []);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.params), [[12], [12]]);
});

test('unlimited quota is compatible with old Agents and preserves other controls', async () => {
  const stored = {
    daily_limit_minutes: 0, allowed_start_time: '07:00:00',
    allowed_end_time: '21:00:00', is_locked: true,
  };
  const db = { async query(sql) {
    return { rows: /FROM settings/.test(sql) ? [stored] : [] };
  } };
  const config = await getAgentPolicyConfig(db, 12);
  assert.equal(config.daily_limit_minutes, 1440);
  assert.equal(config.daily_limit_unlimited, true);
  assert.equal(stored.daily_limit_minutes, 0);
  assert.equal(config.allowed_start_time, '07:00:00');
  assert.equal(config.allowed_end_time, '21:00:00');
  assert.equal(config.is_locked, true);
});

test('an explicit 24-hour quota and default quota remain finite', async () => {
  for (const rows of [[], [{ daily_limit_minutes: 1440 }]]) {
    const db = { async query(sql) {
      return { rows: /FROM settings/.test(sql) ? rows : [] };
    } };
    const config = await getAgentPolicyConfig(db, 12);
    assert.equal(config.daily_limit_minutes, rows.length ? 1440 : 120);
    assert.equal(config.daily_limit_unlimited, false);
  }
});

test('returns the latest previously classified domains selected by block policy', async () => {
  const db = {
    async query(sql, params) {
      assert.match(sql, /DISTINCT ON \(lower\(w\.domain\)\)/);
      assert.match(sql, /enable_web_classification = TRUE/);
      assert.match(sql, /policy\.action = 'block'/);
      assert.deepEqual(params, [12, 5000]);
      return { rows: [{ domain: 'gamevui.vn' }, { domain: 'video.example' }] };
    },
  };

  assert.deepEqual(await getPolicyBlockedWebDomains(db, 12), [
    'gamevui.vn',
    'video.example',
  ]);
});
