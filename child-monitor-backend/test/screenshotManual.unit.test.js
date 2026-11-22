const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const service = require('../src/services/screenshot.service');

test('periodic off accepts only the current unexpired manual photo', async () => {
  for (const kind of ['current', 'wrong-id', 'expired', 'old-policy']) {
    const id = crypto.randomUUID();
    const revision = new Date(Date.now() - 2000).toISOString();
    let inserted = false;
    const db = { release() {}, async query(sql) {
      if (sql.includes('FROM settings')) return { rows: [{ enable_screenshot_review: false, updated_at: revision }] };
      if (sql.includes('FROM devices')) return { rows: [{ screenshot_request_id: id,
        screenshot_requested_at: new Date(), request_fresh: kind !== 'expired' }] };
      if (sql.includes('INSERT INTO screenshots')) { inserted = true; return { rows: [{ screenshot_id: 1 }] }; }
      return { rows: [] };
    } };
    const sandbox = { exports: {}, console, require(name) {
      if (name === '../config/db') return { adminPool: { connect: async () => db } };
      if (name === '../services/screenshot.service') return service;
      if (name === '../services/devicePresence.service') return { deviceOnlineSql: () => 'TRUE' };
      return require(name);
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/controllers/screenshots.controller.js'), 'utf8'), sandbox);
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await sandbox.exports.upload({ device: { child_id: 1, device_id: 1 }, body: {
      client_record_id: kind === 'wrong-id' ? crypto.randomUUID() : id,
      policy_revision: kind === 'old-policy' ? new Date(0).toISOString() : revision,
      captured_at: new Date().toISOString(),
      image_base64: fs.readFileSync(path.join(__dirname, 'fixtures/screenshot.jpg')).toString('base64'),
      thumbnail_base64: fs.readFileSync(path.join(__dirname, 'fixtures/screenshot-thumb.jpg')).toString('base64'),
    } }, res);
    assert.equal(res.code, kind === 'current' ? 201 : 409, kind);
    assert.equal(inserted, kind === 'current', kind);
  }
});
