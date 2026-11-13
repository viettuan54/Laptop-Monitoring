const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test'), quiet: true });
const { updateSettings, getSettings } = require('../src/controllers/settings.controller');
const { getAgentPolicyConfig } = require('../src/services/agentPolicy.service');

// Only TEST credentials, and session-local temporary tables. Never touch real settings.
test('vision migration and settings API preserve legacy consent and independent partial updates', {
  skip: !process.env.TEST_DB_NAME || !process.env.TEST_DB_ADMIN_PASSWORD,
}, async () => {
  const client = new Client({ host: process.env.TEST_DB_HOST, port: Number(process.env.TEST_DB_PORT || 5432),
    database: process.env.TEST_DB_NAME, user: process.env.TEST_DB_ADMIN_USER,
    password: process.env.TEST_DB_ADMIN_PASSWORD, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query(`CREATE TEMP TABLE settings (
      setting_id SERIAL, child_id INTEGER PRIMARY KEY, daily_limit_minutes INTEGER DEFAULT 120,
      allowed_start_time TIME DEFAULT '07:00', allowed_end_time TIME DEFAULT '21:00', is_locked BOOLEAN DEFAULT FALSE,
      enable_webcam_monitoring BOOLEAN DEFAULT FALSE, enable_screenshot_review BOOLEAN DEFAULT FALSE,
      enable_break_reminders BOOLEAN DEFAULT FALSE, enable_app_classification BOOLEAN DEFAULT FALSE,
      enable_web_classification BOOLEAN DEFAULT FALSE, enable_text_moderation BOOLEAN DEFAULT FALSE,
      break_interval_minutes INTEGER DEFAULT 30, break_duration_minutes INTEGER DEFAULT 5,
      updated_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TEMP TABLE children (child_id INTEGER);
      CREATE TEMP TABLE devices (device_id INTEGER PRIMARY KEY, child_id INTEGER);
      CREATE TEMP TABLE alerts (alert_id SERIAL, device_id INTEGER, alert_type TEXT,
        message TEXT, is_read BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TEMP TABLE child_category_policies (resource_type TEXT, category TEXT, child_id INTEGER, action TEXT);
      CREATE TEMP TABLE audit_logs (actor_user_id INTEGER, actor_role TEXT, action TEXT, target_type TEXT,
        target_id TEXT, metadata JSONB, ip_address TEXT, user_agent TEXT);
      INSERT INTO children VALUES (1), (2), (3);
      INSERT INTO settings (child_id, enable_webcam_monitoring) VALUES (1, TRUE), (2, FALSE);`);
    // Resolve unqualified names only to our temporary schema, including migrations.
    await client.query('SET search_path TO pg_temp');
    const migration = fs.readFileSync(path.join(__dirname, '..', 'migration_v30.sql'), 'utf8');
    await client.query(migration);
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'migration_v31.sql'), 'utf8'));
    const request = (body, child_id = 1) => ({ db: client, params: { child_id }, body, user: { user_id: 1, role: 'parent' } });
    const invoke = async (handler, req) => {
      const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
      await handler(req, res);
      assert.equal(res.code, 200, JSON.stringify(res.body));
      return res.body;
    };
    for (const [id, enabled] of [[1, true], [2, false]]) {
      const row = await invoke(getSettings, request({}, id));
      assert.equal(row.enable_posture_monitoring, enabled);
      assert.equal(row.enable_eye_distance_monitoring, enabled);
    }
    for (const posture of [false, true]) for (const distance of [false, true]) {
      const row = await invoke(updateSettings, request({ enable_posture_monitoring: posture, enable_eye_distance_monitoring: distance }));
      assert.equal(row.enable_posture_monitoring, posture);
      assert.equal(row.enable_eye_distance_monitoring, distance);
      assert.equal(row.enable_webcam_monitoring, posture || distance);
      const policy = await getAgentPolicyConfig(client, 1);
      assert.equal(policy.enable_posture_monitoring, posture);
      assert.equal(policy.enable_eye_distance_monitoring, distance);
    }
    await invoke(updateSettings, request({ enable_webcam_monitoring: false }));
    let row = await invoke(updateSettings, request({ enable_eye_distance_monitoring: true }));
    assert.equal(row.enable_posture_monitoring, false);
    assert.equal(row.enable_eye_distance_monitoring, true);
    await client.query(migration); // A rerun must not turn posture back on.
    row = await invoke(updateSettings, request({ daily_limit_minutes: 60 }));
    assert.equal(row.enable_posture_monitoring, false);
    assert.equal(row.enable_eye_distance_monitoring, true);
    row = await invoke(updateSettings, request({ enable_webcam_monitoring: true }));
    assert.equal(row.enable_posture_monitoring, true);
    assert.equal(row.enable_eye_distance_monitoring, true);
    row = await invoke(updateSettings, request({ enable_eye_distance_monitoring: true }, 3));
    assert.equal(row.enable_posture_monitoring, false);
    assert.equal(row.enable_eye_distance_monitoring, true);

    // Exercise real INSERT and parent list retrieval, with no real push notifications.
    const firstSession = row.vision_session_id;
    assert.ok(firstSession);
    row = await invoke(updateSettings, request({ vision_session_minutes: 10 }, 3));
    assert.equal(row.vision_session_id, firstSession);
    assert.equal(row.vision_session_minutes, 10);
    row = await invoke(updateSettings, request({ start_vision_session: true }, 3));
    assert.notEqual(row.vision_session_id, firstSession);
    const restartedSession = row.vision_session_id;
    row = await invoke(updateSettings, request({ daily_limit_minutes: 90 }, 3));
    assert.equal(row.vision_session_id, restartedSession);
    row = await invoke(updateSettings, request({ enable_eye_distance_monitoring: false }, 3));
    assert.equal(row.vision_session_id, null);

    await client.query('ALTER TABLE children ADD COLUMN user_id INTEGER DEFAULT 1');
    const context = { exports: {}, console, require: name => {
      if (name === '../config/db') return { adminPool: client };
      if (name === '../services/notification.service') return { sendPushNotification: async () => {} };
      return {};
    } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/controllers/agent.controller.js'), 'utf8'), context);
    for (const alert_type of ['posture_warning', 'eye_distance_warning']) {
      const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
      await context.exports.sendVisionAlert({ device: { device_id: 99, child_id: 1 },
        body: { alert_type, message: 'isolated test' } }, res);
      assert.equal(res.code, 201, JSON.stringify(res.body));
      assert.equal(res.body.alert.alert_type, alert_type);
    }
    const { getAlerts } = require('../src/controllers/alerts.controller');
    const listed = await invoke(getAlerts, { db: client, query: { device_id: '99', is_read: 'false' } });
    assert.deepEqual(new Set(listed.data.map(a => a.alert_type)), new Set(['posture_warning', 'eye_distance_warning']));
    // New explicit sessions must each produce a parent alert, even within five minutes.
    const sessionOne = require('node:crypto').randomUUID();
    const sessionTwo = require('node:crypto').randomUUID();
    for (const [session_id, expected] of [[sessionOne, 201], [sessionOne, 200], [sessionTwo, 201]]) {
      const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
      await context.exports.sendVisionAlert({ device: { device_id: 99, child_id: 1 },
        body: { alert_type: 'eye_distance_warning', message: 'session test', session_id } }, res);
      assert.equal(res.code, expected);
    }
    // Reports are scoped to the authenticated device and cannot reopen ended sessions.
    const active = await invoke(updateSettings, request({ start_vision_session: true }));
    await client.query('INSERT INTO devices(device_id,child_id) VALUES (99,1)');
    const receiptContext = { exports: {}, console, require: () => ({ adminPool: client }) };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/controllers/visionSession.controller.js'), 'utf8'), receiptContext);
    for (const status of ['received', 'alert', 'received']) {
      await invoke(receiptContext.exports.report, { device: { device_id: 99, child_id: 1 }, body: { session_id: active.vision_session_id, status } });
    }
    assert.equal((await client.query('SELECT vision_session_status FROM devices WHERE device_id=99')).rows[0].vision_session_status, 'alert');
    const next = await invoke(updateSettings, request({ start_vision_session: true }));
    await invoke(receiptContext.exports.report, { device: { device_id: 99, child_id: 1 }, body: { session_id: next.vision_session_id, status: 'received' } });
    await invoke(receiptContext.exports.report, { device: { device_id: 99, child_id: 1 }, body: { session_id: active.vision_session_id, status: 'timeout' } });
    assert.equal((await client.query('SELECT vision_session_status FROM devices WHERE device_id=99')).rows[0].vision_session_status, 'received');
  } finally { await client.end(); }
});

test('settings reject non-boolean feature flags before accessing the database', async () => {
  for (const field of ['enable_posture_monitoring', 'enable_eye_distance_monitoring']) {
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await updateSettings({ params: { child_id: 1 }, body: { [field]: 'true' } }, res);
    assert.equal(res.code, 400);
    assert.equal(res.body.message, `${field} must be a boolean`);
  }
});

test('session duration validation rejects invalid ranges and types', async () => {
  for (const minutes of [0, 61, -1, 1.5, '5', null, true]) {
    const res = { status(code) { this.code = code; return this; }, json() {} };
    await updateSettings({ params: { child_id: 1 }, body: { vision_session_minutes: minutes } }, res);
    assert.equal(res.code, 400);
  }
});
