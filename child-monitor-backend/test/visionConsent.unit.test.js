const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('vision endpoint rejects each disabled feature before storing or notifying', async () => {
  for (const posture of [false, true]) for (const distance of [false, true]) {
    for (const [alert_type, enabled] of [['posture_warning', posture], ['eye_distance_warning', distance]]) {
      let queries = 0;
      const pool = { async query() {
        queries++;
        if (queries === 1) return { rows: [{ enable_webcam_monitoring: posture || distance,
          enable_posture_monitoring: posture, enable_eye_distance_monitoring: distance }] };
        // An already-existing alert ends the enabled path without push side effects.
        return { rows: [{ alert_id: 1 }] };
      } };
      const context = { exports: {}, console, require: name => name === '../config/db' ? { adminPool: pool } : {} };
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/controllers/agent.controller.js'), 'utf8'), context);
      const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
      await context.exports.sendVisionAlert({ device: { device_id: 1, child_id: 1 }, body: { alert_type, message: 'test' } }, res);
      assert.equal(res.code, enabled ? 200 : 403);
      assert.equal(queries, enabled ? 2 : 1);
    }
  }
});
