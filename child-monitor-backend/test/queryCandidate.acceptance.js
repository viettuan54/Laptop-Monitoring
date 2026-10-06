// Explicit local acceptance run: real Agent, provider, PostgreSQL and parent API.
// Redis is deliberately disabled; Express's test MemoryStore handles rate limits.
// Push delivery is captured locally so this test cannot notify external accounts.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');

async function main(input) {
  dotenv.config({ path: path.join(__dirname, '..', '.env.test'), quiet: true });
  const required = ['HOST', 'NAME', 'ADMIN_USER', 'ADMIN_PASSWORD', 'BACKEND_USER', 'BACKEND_PASSWORD'];
  for (const name of required) assert.ok(process.env[`TEST_DB_${name}`], `Missing TEST_DB_${name}`);
  assert.match(process.env.TEST_DB_NAME, /(^|_)test($|_)/i);
  assert.ok(['127.0.0.1', 'localhost'].includes(process.env.TEST_DB_HOST));
  const providerUrl = new URL(input.provider_url);
  assert.equal(providerUrl.hostname, '127.0.0.1');
  assert.equal(providerUrl.protocol, 'http:');
  for (const name of [...required, 'PORT']) process.env[`DB_${name}`] = process.env[`TEST_DB_${name}`] || '';
  Object.assign(process.env, {
    NODE_ENV: 'test', REDIS_URL: '', JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    TEXT_MODERATION_PROVIDER: 'local', LOCAL_MODERATION_URL: input.provider_url,
    LOCAL_MODERATION_API_KEY: input.provider_key, LOCAL_MODERATION_TIMEOUT_MS: '3000',
  });
  const { adminPool, backendPool, validateRlsConfiguration } = require('../src/config/db');
  const pushes = [];
  require('../src/services/notification.service').sendPushNotification = async (...args) => pushes.push(args);
  let server, worker;
  const users = [];
  const checks = [];
  const runId = `query_acceptance_${crypto.randomUUID().replaceAll('-', '')}`;
  try {
    const database = await adminPool.query('SELECT current_database() AS name');
    assert.equal(database.rows[0].name, process.env.TEST_DB_NAME);
    await validateRlsConfiguration();
    const app = require('../src/app');
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const bcrypt = require('bcrypt');
    const password = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 4);
    for (let i = 0; i < 2; i++) {
      const created = await adminPool.query(
        'INSERT INTO users(name,email,password,role,is_verified) VALUES($1,$2,$3,$4,TRUE) RETURNING user_id,token_version',
        [`${runId}_${i}`, `${runId}_${i}@example.test`, password, 'parent']);
      users.push(created.rows[0]);
    }
    const child = await adminPool.query('INSERT INTO children(user_id,name,age) VALUES($1,$2,10) RETURNING child_id',
      [users[0].user_id, `${runId}_child`]);
    const secret = crypto.randomUUID();
    const device = await adminPool.query(
      'INSERT INTO devices(child_id,device_name,device_uid,device_secret) VALUES($1,$2,$3,$4) RETURNING device_id',
      [child.rows[0].child_id, runId, `${runId}_uid`, crypto.createHash('sha256').update(secret).digest('hex')]);
    const deviceId = device.rows[0].device_id;
    await adminPool.query('INSERT INTO settings(child_id,enable_text_moderation) VALUES($1,TRUE)', [child.rows[0].child_id]);
    const fixtures = JSON.parse(fs.readFileSync(input.fixtures_path, 'utf8'));
    assert.deepEqual(fixtures.map(item => item.label), ['SAFE', 'RISK', 'HIGH_RISK']);

    worker = spawn(input.python, ['-B', input.agent_probe], {
      cwd: path.resolve(__dirname, '..', '..'), windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let waiter;
    const lines = [];
    readline.createInterface({ input: worker.stdout }).on('line', line => {
      const value = JSON.parse(line);
      if (waiter) { const resolve = waiter; waiter = null; resolve(value); } else lines.push(value);
    });
    worker.stderr.on('data', () => {});
    const next = () => lines.length ? Promise.resolve(lines.shift()) : new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiter = null; reject(new Error('Agent acceptance worker timeout')); }, 15000);
      waiter = value => { clearTimeout(timer); resolve(value); };
    });
    const command = async value => { worker.stdin.write(JSON.stringify(value) + '\n'); return next(); };
    assert.equal((await command({ base_url: baseUrl, device_secret: secret })).ready, true);
    const makeRecords = () => fixtures.map(item => ({ client_record_id: crypto.randomUUID(), text: item.text }));
    const counts = async () => {
      const events = await adminPool.query('SELECT classification_label,moderation_model,label_scores FROM text_moderation_events WHERE device_id=$1', [deviceId]);
      const alerts = await adminPool.query('SELECT alert_type,message FROM alerts WHERE device_id=$1', [deviceId]);
      for (const item of fixtures) assert.equal(JSON.stringify([events.rows, alerts.rows, pushes]).includes(item.text), false);
      return { events: events.rows, alerts: alerts.rows };
    };
    const enqueued = await command({ command: 'enqueue', records: makeRecords() });
    assert.equal(enqueued.queued, 3);
    assert.equal(enqueued.all_dpapi_protected, true);
    checks.push('real_agent_queue_uses_windows_dpapi');

    process.env.LOCAL_MODERATION_API_KEY = 'intentional-invalid-acceptance-key';
    const failedHttp = await fetch(`${baseUrl}/api/agent/text-moderation/batch`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-device-secret': secret },
      body: JSON.stringify({ records: [{ client_record_id: crypto.randomUUID(), text: fixtures[0].text,
        source_type: 'search_query', occurred_at: new Date().toISOString() }] }),
    });
    assert.equal(failedHttp.status, 503);
    const failure = await command({ command: 'sync' });
    assert.equal(failure.queued, 3);
    assert.deepEqual(failure.statuses, [null]);
    assert.equal((await counts()).events.length, 0);
    checks.push('provider_failure_retains_queue_without_events_or_alerts');

    process.env.LOCAL_MODERATION_API_KEY = input.provider_key;
    const disconnectedPort = require('node:net').createServer();
    await new Promise(resolve => disconnectedPort.listen(0, '127.0.0.1', resolve));
    const unusedPort = disconnectedPort.address().port;
    await new Promise(resolve => disconnectedPort.close(resolve));
    process.env.LOCAL_MODERATION_URL = `http://127.0.0.1:${unusedPort}`;
    const disconnected = await command({ command: 'sync' });
    assert.equal(disconnected.queued, 3);
    assert.deepEqual(disconnected.statuses, [null]);
    assert.equal((await counts()).events.length, 0);
    checks.push('model_connection_failure_retains_queue_for_retry');
    process.env.LOCAL_MODERATION_URL = input.provider_url;
    const synced = await command({ command: 'sync' });
    assert.equal(synced.queued, 0);
    assert.deepEqual(synced.statuses, [201]);
    const first = await counts();
    assert.equal(first.events.length, 3);
    assert.deepEqual(first.events.map(row => row.classification_label).sort(), ['HIGH_RISK', 'RISK', 'SAFE']);
    assert.ok(first.events.every(row => row.moderation_model === input.model_version));
    assert.equal(first.alerts.length, 2);
    assert.deepEqual(first.alerts.map(row => row.alert_type).sort(), ['text_risk', 'text_violence']);
    assert.deepEqual(pushes.map(row => row[1]).sort(), ['Bé có dấu hiệu bị bạo lực', 'Cần quan sát bé trong thời gian này'].sort());
    checks.push('actual_model_three_labels_reach_parent_alert_policy', 'acknowledgement_deletes_agent_raw_queue');

    const repeated = await command({ command: 'resend' });
    assert.equal(repeated.status, 201);
    assert.equal(repeated.response.flagged_count, 0);
    assert.equal((await counts()).events.length, 3);
    checks.push('same_record_retry_is_idempotent');

    await command({ command: 'enqueue', records: makeRecords() });
    assert.equal((await command({ command: 'sync' })).queued, 0);
    const cooled = await counts();
    assert.equal(cooled.events.length, 6);
    assert.equal(cooled.alerts.length, 2);
    assert.equal(pushes.length, 2);
    checks.push('cooldown_suppresses_duplicate_alerts_per_label');

    for (let i = 0; i < users.length; i++) {
      const token = jwt.sign({ user_id: users[i].user_id, token_version: users[i].token_version }, process.env.JWT_SECRET, { expiresIn: '5m', algorithm: 'HS256' });
      const response = await fetch(`${baseUrl}/api/alerts?device_id=${deviceId}`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(response.status, 200);
      const alerts = (await response.json()).data;
      assert.equal(alerts.length, i === 0 ? 2 : 0);
      if (i === 0) {
        assert.ok(alerts.some(row => row.message.includes('Bé có dấu hiệu bị bạo lực')));
        assert.ok(alerts.some(row => row.message.includes('quan sát, trò chuyện và quan tâm bé trong thời gian này')));
        const { renderQueryAlerts } = require('../../child-monitor-web/test/queryAlertRenderer');
        const rendered = await renderQueryAlerts({ deviceId, api: async route => {
          const result = await fetch(`${baseUrl}/api${route}`, { headers: { authorization: `Bearer ${token}` } });
          assert.equal(result.status, 200);
          return result.json();
        } });
        assert.equal(rendered.rows.length, 2);
        assert.equal((rendered.html.match(/class="alert-row /g) || []).length, 2);
        assert.ok(rendered.html.includes('Bé có dấu hiệu bị bạo lực'));
        assert.ok(rendered.html.includes('Cần quan sát bé trong thời gian này'));
        assert.ok(rendered.html.includes('alert-symbol danger'));
        assert.ok(rendered.html.includes('alert-symbol warning'));
      }
    }
    checks.push('parent_api_returns_correct_messages_and_enforces_ownership_rls',
      'parent_alert_renderer_displays_actual_api_results');

    await command({ command: 'enqueue', records: [makeRecords()[0]] });
    await command({ command: 'credential', device_secret: crypto.randomUUID() });
    const invalid = await command({ command: 'sync' });
    assert.equal(invalid.queued, 1);
    assert.equal(invalid.suspended, true);
    assert.deepEqual(invalid.statuses, [401]);
    checks.push('invalid_agent_credential_retains_queue_and_suspends_sending');
    await command({ command: 'credential', device_secret: secret });
    await adminPool.query('UPDATE settings SET enable_text_moderation=FALSE WHERE child_id=$1', [child.rows[0].child_id]);
    assert.equal((await command({ command: 'sync' })).queued, 0);
    assert.equal((await counts()).events.length, 6);
    checks.push('disabled_consent_discards_pending_query_without_new_event');
    for (const source of ['page_content', 'chat_received', 'chat_authored']) {
      const response = await fetch(`${baseUrl}/api/agent/text-moderation/batch`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-device-secret': secret },
        body: JSON.stringify({ records: [{ client_record_id: crypto.randomUUID(), source_type: source,
          text: 'synthetic scope check', occurred_at: new Date().toISOString() }] }),
      });
      assert.equal(response.status, 400);
    }
    checks.push('page_and_chat_inputs_are_rejected_by_backend');
    worker.stdin.write(JSON.stringify({ command: 'close' }) + '\n');
    console.log('ACCEPTANCE_RESULT ' + JSON.stringify({ checks, check_count: checks.length,
      model: input.model_version, database_isolated: true, actual_model_http: true,
      actual_agent_client_and_queue: true, real_postgresql_and_rls: true,
      external_push_delivery_mocked: true, rate_limit_store: 'test_memory',
      independent_accuracy_evaluation: false, browser_ui_tested: false,
      dashboard_alert_renderer_tested_with_live_api: true }));
  } finally {
    if (worker) {
      const exited = new Promise(resolve => worker.once('exit', resolve));
      worker.stdin.end();
      if (worker.exitCode === null) await Promise.race([exited, new Promise(resolve => {
        const timer = setTimeout(() => { worker.kill(); resolve(); }, 3000);
        timer.unref();
      })]);
    }
    if (server) await new Promise(resolve => server.close(resolve));
    for (const user of users) await adminPool.query('DELETE FROM users WHERE user_id=$1', [user.user_id]);
    await Promise.allSettled([adminPool.end(), backendPool.end()]);
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => main(JSON.parse(input)).catch(error => {
  console.error(error.stack); process.exitCode = 1;
}));
