const test = require('node:test');
const assert = require('node:assert/strict');
const { updateSettings } = require('../src/controllers/settings.controller');
const { getAgentPolicyConfig } = require('../src/services/agentPolicy.service');

test('screenshot interval rejects invalid values before accessing the database', async () => {
  for (const value of [0, 61, 1.5, null, '5', true]) {
    const res = { status(code) { this.code = code; return this; }, json() {} };
    await updateSettings({ params: { child_id: 1 }, body: { screenshot_interval_minutes: value } }, res);
    assert.equal(res.code, 400);
  }
});

test('interval updates preserve consent and travel to Agent in seconds', async () => {
  for (const minutes of [1, 12, 60]) {
    let update;
    const db = { async query(sql, values) {
      if (sql.includes('INSERT INTO settings')) {
        update = { sql, values };
        return { rows: [{ child_id: 1, screenshot_interval_minutes: minutes, enable_screenshot_review: false }] };
      }
      return { rows: [{ child_id: 1 }] };
    } };
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await updateSettings({ db, user: { user_id: 1 }, params: { child_id: 1 }, body: { screenshot_interval_minutes: minutes } }, res);
    assert.equal(update.values.length, 19);
    assert.equal(update.values[18], minutes);
    assert.equal(update.values[6], undefined);
    assert.equal(res.body.screenshot_interval_minutes, minutes);
    const config = await getAgentPolicyConfig({ async query(sql) {
      return { rows: sql.includes('FROM settings') ? [res.body] : [] };
    } }, 1);
    assert.equal(config.screenshot_interval_seconds, minutes * 60);
    assert.equal(config.enable_screenshot_review, false);
  }
});
