const test = require('node:test');
const assert = require('node:assert/strict');
const { adminPool } = require('../src/config/db');
const { heartbeat } = require('../src/controllers/agent.controller');

test('heartbeat returns the current global blacklist including removal of the last domain', async t => {
  let domains = ['blocked.example'];
  t.mock.method(adminPool, 'query', async sql => {
    if (/FROM website_blacklist/.test(sql)) return { rows: domains.map(domain => ({ domain })) };
    if (/UPDATE devices/.test(sql)) return { rows: [{ last_seen_at: new Date() }] };
    return { rows: [] };
  });
  for (const current of [['blocked.example'], [], ['another.example']]) {
    domains = current;
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await heartbeat({ device: { device_id: 7, child_id: 8 } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.blacklisted_domains, current);
    assert.ok(res.body.config);
    assert.ok(Array.isArray(res.body.policy_blocked_domains));
  }
});
