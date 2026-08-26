const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.test') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// Tuyệt đối không fallback sang DB dev/prod: phải khai báo riêng TEST_DB_*.
const TEST_ENV = {
  DB_HOST: process.env.TEST_DB_HOST,
  DB_PORT: process.env.TEST_DB_PORT,
  DB_NAME: process.env.TEST_DB_NAME,
  DB_ADMIN_USER: process.env.TEST_DB_ADMIN_USER,
  DB_ADMIN_PASSWORD: process.env.TEST_DB_ADMIN_PASSWORD,
  DB_BACKEND_USER: process.env.TEST_DB_BACKEND_USER,
  DB_BACKEND_PASSWORD: process.env.TEST_DB_BACKEND_PASSWORD,
};
const missing = Object.entries(TEST_ENV).filter(([, value]) => !value).map(([key]) => `TEST_${key}`);
if (!process.env.TEST_REDIS_URL) missing.push('TEST_REDIS_URL');
if (missing.length) {
  throw new Error(`Integration tests require isolated PostgreSQL and Redis services: ${missing.join(', ')}`);
}

Object.assign(process.env, TEST_ENV, {
  NODE_ENV: 'test',
  JWT_SECRET: process.env.TEST_JWT_SECRET || crypto.randomBytes(32).toString('hex'),
  REDIS_URL: process.env.TEST_REDIS_URL,
});

const { adminPool, backendPool, validateRlsConfiguration } = require('../src/config/db');
const { initializeRedis, closeRedis } = require('../src/config/redis');

const runId = `it_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
const emails = [`${runId}_one@example.test`, `${runId}_two@example.test`];
let server;
let baseUrl;
let userOne;
let userTwo;
let childOne;
let childTwo;
let deviceOne;
let plaintextDeviceSecret;
let app;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return { status: response.status, body };
}

before(async () => {
  const redisReady = await initializeRedis();
  assert.equal(redisReady, true, 'integration tests require a real Redis connection');
  app = require('../src/app');
  await validateRlsConfiguration();
  const adminRoleResult = await adminPool.query(`
    SELECT rolname, rolsuper, rolbypassrls
    FROM pg_roles
    WHERE rolname = current_user
  `);
  const adminRole = adminRoleResult.rows[0];
  if (!adminRole || (!adminRole.rolsuper && !adminRole.rolbypassrls)) {
    throw new Error(
      `TEST_DB_ADMIN_USER must have BYPASSRLS (or SUPERUSER) in the isolated test DB; ` +
      `current role='${adminRole?.rolname || 'unknown'}'`
    );
  }

  const passwordHash = await bcrypt.hash('Integration1!', 4);
  const users = await adminPool.query(
    `INSERT INTO users(name, email, password, role, is_verified)
     VALUES ($1, $2, $3, 'parent', TRUE), ($4, $5, $3, 'parent', TRUE)
     RETURNING user_id`,
    ['Integration One', emails[0], passwordHash, 'Integration Two', emails[1]]
  );
  [userOne, userTwo] = users.rows.map((row) => row.user_id);

  const children = await adminPool.query(
    `INSERT INTO children(user_id, name, age)
     VALUES ($1, $2, 10), ($3, $4, 11) RETURNING child_id`,
    [userOne, `${runId}_child_one`, userTwo, `${runId}_child_two`]
  );
  [childOne, childTwo] = children.rows.map((row) => row.child_id);

  plaintextDeviceSecret = crypto.randomUUID();
  const secretHash = crypto.createHash('sha256').update(plaintextDeviceSecret).digest('hex');
  const device = await adminPool.query(
    `INSERT INTO devices(child_id, device_name, device_uid, device_secret)
     VALUES ($1, $2, $3, $4) RETURNING device_id`,
    [childOne, `${runId}_device`, `${runId}_uid`, secretHash]
  );
  deviceOne = device.rows[0].device_id;

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  let cleanupError;
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    await adminPool.query('DELETE FROM audit_logs WHERE actor_user_id = ANY($1::int[])', [[userOne, userTwo]]);
    await adminPool.query('DELETE FROM users WHERE email = ANY($1::text[])', [emails]);
  } catch (error) {
    cleanupError = error;
  } finally {
    await Promise.allSettled([adminPool.end(), backendPool.end(), closeRedis()]);
  }
  if (cleanupError) throw cleanupError;
});

test('auth login succeeds and a refresh token can only be rotated once concurrently', async () => {
  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: emails[0], password: 'Integration1!' }),
  });
  assert.equal(login.status, 200);
  assert.ok(login.body.accessToken);
  assert.ok(login.body.refreshToken);

  const refreshRequest = () => request('/api/auth/refresh', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: login.body.refreshToken }),
  });
  const results = await Promise.all([refreshRequest(), refreshRequest()]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 401]);

  const tokenCount = await adminPool.query(
    'SELECT COUNT(*)::int AS count FROM refresh_tokens WHERE user_id = $1',
    [userOne]
  );
  assert.equal(tokenCount.rows[0].count, 1);
});

test('RLS context isolates children belonging to different parents', async () => {
  const client = await backendPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(userOne)]);
    const visible = await client.query(
      'SELECT child_id FROM children WHERE child_id = ANY($1::int[]) ORDER BY child_id',
      [[childOne, childTwo]]
    );
    assert.deepEqual(visible.rows.map((row) => row.child_id), [childOne]);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

test('batch retry is idempotent and acknowledges the same client record ID', async () => {
  const clientRecordId = crypto.randomUUID();
  const payload = {
    records: [{
      client_record_id: clientRecordId,
      app_name: 'msedge.exe',
      category: 'browsers',
      start_time: new Date().toISOString(),
      duration_seconds: 30,
    }],
  };
  const sendBatch = () => request('/api/logs/app/batch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-device-secret': plaintextDeviceSecret,
    },
    body: JSON.stringify(payload),
  });

  const first = await sendBatch();
  const retry = await sendBatch();
  assert.equal(first.status, 201);
  assert.equal(first.body.inserted, 1);
  assert.deepEqual(first.body.accepted_client_record_ids, [clientRecordId]);
  assert.equal(retry.status, 201);
  assert.equal(retry.body.inserted, 0);
  assert.equal(retry.body.duplicates, 1);
  assert.deepEqual(retry.body.accepted_client_record_ids, [clientRecordId]);

  const stored = await adminPool.query(
    `SELECT COUNT(*)::int AS count, MIN(category::text) AS category
     FROM app_usage WHERE device_id = $1 AND client_record_id = $2`,
    [deviceOne, clientRecordId]
  );
  assert.equal(stored.rows[0].count, 1);
  assert.equal(stored.rows[0].category, 'browsers');
});

test('monthly usage summary splits Vietnam midnight, fills empty days and respects RLS', async () => {
  const month = '2042-02';
  const crossingId = crypto.randomUUID();
  const sameDayId = crypto.randomUUID();
  const ignoredId = crypto.randomUUID();

  await adminPool.query(
    `INSERT INTO app_usage(
       client_record_id, device_id, app_name, category,
       start_time, end_time, duration_seconds
     ) VALUES
       ($1, $4, 'cross-midnight.exe', 'unknown',
        '2042-02-10T16:59:50Z'::timestamptz, '2042-02-10T17:00:10Z'::timestamptz, 20),
       ($2, $4, 'same-day.exe', 'unknown',
        '2042-02-11T03:00:00Z'::timestamptz, '2042-02-11T03:00:10Z'::timestamptz, 10),
       ($3, $4, 'stale-agent-gap.exe', 'unknown',
        '2042-02-11T04:00:00Z'::timestamptz, '2042-02-11T04:02:01Z'::timestamptz, 121)`,
    [crossingId, sameDayId, ignoredId, deviceOne]
  );
  await adminPool.query(
    `INSERT INTO app_usage(
       device_id, app_name, category,
       start_time, end_time, duration_seconds
     ) VALUES(
       $1, 'LockApp.exe', 'unknown',
       '2042-02-11T05:00:00Z'::timestamptz,
       '2042-02-11T05:00:30Z'::timestamptz,
       30
     )`,
    [deviceOne]
  );
  await adminPool.query(
    `INSERT INTO website_logs(device_id, url, domain, category, visit_time, duration_seconds)
     VALUES($1, 'https://usage-summary.example.test', 'usage-summary.example.test',
            'education', '2042-02-11T03:00:00Z'::timestamptz, 3600)`,
    [deviceOne]
  );

  const loginOne = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: emails[0], password: 'Integration1!' }),
  });
  const loginTwo = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: emails[1], password: 'Integration1!' }),
  });
  assert.equal(loginOne.status, 200);
  assert.equal(loginTwo.status, 200);

  const owned = await request(
    `/api/logs/usage-summary?month=${month}&device_id=${deviceOne}&child_id=${childOne}`,
    { headers: { authorization: `Bearer ${loginOne.body.accessToken}` } }
  );
  assert.equal(owned.status, 200);
  assert.equal(owned.body.timezone, 'Asia/Ho_Chi_Minh');
  assert.equal(owned.body.daily.length, 28);
  assert.equal(owned.body.daily.find((day) => day.date === '2042-02-10').duration_seconds, 10);
  assert.equal(owned.body.daily.find((day) => day.date === '2042-02-11').duration_seconds, 20);
  assert.equal(owned.body.daily.find((day) => day.date === '2042-02-12').duration_seconds, 0);
  assert.equal(owned.body.month_total_seconds, 30);
  assert.equal(owned.body.today_seconds, 0);
  assert.equal(owned.body.ignored_segment_count, 2);
  assert.equal(owned.body.max_valid_agent_segment_seconds, 120);

  const hiddenByRls = await request(
    `/api/logs/usage-summary?month=${month}&device_id=${deviceOne}`,
    { headers: { authorization: `Bearer ${loginTwo.body.accessToken}` } }
  );
  assert.equal(hiddenByRls.status, 200);
  assert.equal(hiddenByRls.body.month_total_seconds, 0);
  assert.equal(hiddenByRls.body.ignored_segment_count, 0);

  const invalidMonth = await request('/api/logs/usage-summary?month=0000-01', {
    headers: { authorization: `Bearer ${loginOne.body.accessToken}` },
  });
  assert.equal(invalidMonth.status, 400);
});

test('classification policies have safe defaults and are isolated by RLS', async () => {
  const defaults = await adminPool.query(
    `SELECT resource_type::text AS resource_type, category, action::text AS action
     FROM child_category_policies
     WHERE child_id = $1
     ORDER BY resource_type, category`,
    [childOne]
  );

  assert.deepEqual(defaults.rows, [
    { resource_type: 'app', category: 'browsers', action: 'allow' },
    { resource_type: 'app', category: 'entertainment', action: 'block' },
    { resource_type: 'app', category: 'learning', action: 'allow' },
    { resource_type: 'app', category: 'unknown', action: 'allow' },
    { resource_type: 'web', category: 'education', action: 'allow' },
    { resource_type: 'web', category: 'entertainment', action: 'block' },
    { resource_type: 'web', category: 'social', action: 'block' },
    { resource_type: 'web', category: 'unknown', action: 'allow' },
    { resource_type: 'web', category: 'unsafe', action: 'block' },
  ]);

  const settings = await adminPool.query(
    `INSERT INTO settings(child_id)
     VALUES ($1), ($2)
     ON CONFLICT (child_id) DO UPDATE SET child_id = EXCLUDED.child_id
     RETURNING child_id, enable_app_classification, enable_web_classification`,
    [childOne, childTwo]
  );
  assert.equal(settings.rows.length, 2);
  for (const row of settings.rows) {
    assert.equal(row.enable_app_classification, false);
    assert.equal(row.enable_web_classification, false);
  }

  const client = await backendPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(userOne)]);
    const visible = await client.query(
      `SELECT DISTINCT child_id
       FROM child_category_policies
       WHERE child_id = ANY($1::int[])
       ORDER BY child_id`,
      [[childOne, childTwo]]
    );
    assert.deepEqual(visible.rows.map((row) => row.child_id), [childOne]);

    const forbiddenUpdate = await client.query(
      `UPDATE child_category_policies
       SET action = 'allow'
       WHERE child_id = $1 AND resource_type = 'web' AND category = 'unsafe'`,
      [childTwo]
    );
    assert.equal(forbiddenUpdate.rowCount, 0);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

test('parent classification APIs toggle settings and update only owned policies', async () => {
  const loginOne = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: emails[0], password: 'Integration1!' }),
  });
  const loginTwo = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: emails[1], password: 'Integration1!' }),
  });
  assert.equal(loginOne.status, 200);
  assert.equal(loginTwo.status, 200);

  const authOne = {
    authorization: `Bearer ${loginOne.body.accessToken}`,
    'content-type': 'application/json',
  };
  const authTwo = {
    authorization: `Bearer ${loginTwo.body.accessToken}`,
    'content-type': 'application/json',
  };

  const toggled = await request(`/api/settings/${childOne}`, {
    method: 'PUT',
    headers: authOne,
    body: JSON.stringify({
      enable_app_classification: true,
      enable_web_classification: false,
    }),
  });
  assert.equal(toggled.status, 200);
  assert.equal(toggled.body.enable_app_classification, true);
  assert.equal(toggled.body.enable_web_classification, false);

  const settings = await request(`/api/settings/${childOne}`, { headers: authOne });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.enable_app_classification, true);
  assert.equal(settings.body.enable_web_classification, false);

  const invalidToggle = await request(`/api/settings/${childOne}`, {
    method: 'PUT',
    headers: authOne,
    body: JSON.stringify({ enable_web_classification: 'true' }),
  });
  assert.equal(invalidToggle.status, 400);

  const policies = await request(`/api/settings/${childOne}/policies`, { headers: authOne });
  assert.equal(policies.status, 200);
  assert.equal(policies.body.child_id, childOne);
  assert.equal(policies.body.policies.length, 9);

  const updatedPolicy = await request(`/api/settings/${childOne}/policies/web/social`, {
    method: 'PUT',
    headers: authOne,
    body: JSON.stringify({ action: 'allow' }),
  });
  assert.equal(updatedPolicy.status, 200);
  assert.deepEqual(
    {
      child_id: updatedPolicy.body.child_id,
      resource_type: updatedPolicy.body.resource_type,
      category: updatedPolicy.body.category,
      action: updatedPolicy.body.action,
    },
    { child_id: childOne, resource_type: 'web', category: 'social', action: 'allow' }
  );

  const invalidPolicy = await request(`/api/settings/${childOne}/policies/app/social`, {
    method: 'PUT',
    headers: authOne,
    body: JSON.stringify({ action: 'block' }),
  });
  assert.equal(invalidPolicy.status, 400);

  const invalidAction = await request(`/api/settings/${childOne}/policies/web/social`, {
    method: 'PUT',
    headers: authOne,
    body: JSON.stringify({ action: 'deny' }),
  });
  assert.equal(invalidAction.status, 400);

  const foreignToggle = await request(`/api/settings/${childOne}`, {
    method: 'PUT',
    headers: authTwo,
    body: JSON.stringify({ enable_app_classification: false }),
  });
  assert.equal(foreignToggle.status, 404);

  const foreignPolicies = await request(`/api/settings/${childOne}/policies`, { headers: authTwo });
  assert.equal(foreignPolicies.status, 404);

  const foreignUpdate = await request(`/api/settings/${childOne}/policies/web/unsafe`, {
    method: 'PUT',
    headers: authTwo,
    body: JSON.stringify({ action: 'allow' }),
  });
  assert.equal(foreignUpdate.status, 404);

  const audit = await adminPool.query(
    `SELECT action, target_id, metadata
     FROM audit_logs
     WHERE actor_user_id = $1
       AND action IN ('settings.update', 'classification_policy.update')
     ORDER BY audit_id`,
    [userOne]
  );
  assert.deepEqual(audit.rows.map((row) => row.action), [
    'settings.update',
    'classification_policy.update',
  ]);
  assert.equal(audit.rows[1].target_id, `${childOne}:web:social`);
  assert.equal(audit.rows[1].metadata.access_action, 'allow');
});

test('Agent config exposes switches and web backfill becomes visible to parent activity API', async () => {
  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: emails[0], password: 'Integration1!' }),
  });
  const parentHeaders = {
    authorization: `Bearer ${login.body.accessToken}`,
    'content-type': 'application/json',
  };
  const enabled = await request(`/api/settings/${childOne}`, {
    method: 'PUT',
    headers: parentHeaders,
    body: JSON.stringify({
      enable_app_classification: true,
      enable_web_classification: true,
    }),
  });
  assert.equal(enabled.status, 200);

  const agentHeaders = {
    'content-type': 'application/json',
    'x-device-secret': plaintextDeviceSecret,
  };
  const previouslyClassifiedDomain = `gamevui-${Date.now()}.example.test`;
  const classifiedInsert = await request('/api/logs/web/batch', {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ records: [{
      client_record_id: crypto.randomUUID(),
      url: `https://${previouslyClassifiedDomain}/`,
      domain: previouslyClassifiedDomain,
      category: 'entertainment',
      classification_source: 'trained_model',
      classification_confidence: 0.94,
      visit_time: new Date().toISOString(),
      duration_seconds: 3,
      page_title: 'Previously classified entertainment',
    }] }),
  });
  assert.equal(classifiedInsert.status, 201);

  const heartbeat = await request('/api/agent/heartbeat', {
    method: 'POST',
    headers: agentHeaders,
    body: '{}',
  });
  assert.equal(heartbeat.status, 200);
  assert.equal(heartbeat.body.config.enable_app_classification, true);
  assert.equal(heartbeat.body.config.enable_web_classification, true);
  assert.deepEqual(heartbeat.body.config.blocked_app_categories, ['entertainment']);
  assert.deepEqual(heartbeat.body.config.blocked_web_categories, ['entertainment', 'unsafe']);
  assert.ok(heartbeat.body.policy_blocked_domains.includes(previouslyClassifiedDomain));

  const blockedAppRecordId = crypto.randomUUID();
  const blockedAppInsert = await request('/api/logs/app/batch', {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ records: [{
      client_record_id: blockedAppRecordId,
      app_name: 'sample-game.exe',
      category: 'entertainment',
      start_time: new Date().toISOString(),
      duration_seconds: 15,
    }] }),
  });
  assert.equal(blockedAppInsert.status, 201);

  const appActivity = await request(`/api/logs/app?device_id=${deviceOne}&limit=200`, {
    headers: parentHeaders,
  });
  assert.equal(appActivity.status, 200);
  const blockedApp = appActivity.body.data.find(
    (row) => row.client_record_id === blockedAppRecordId || row.app_name === 'sample-game.exe'
  );
  assert.equal(blockedApp.access_status, 'blocked');
  const openBrowser = appActivity.body.data.find((row) => row.app_name === 'msedge.exe');
  assert.equal(openBrowser.access_status, 'open');

  const pendingAppName = `study-${Date.now()}.exe`;
  const pendingAppRecordId = crypto.randomUUID();
  const pendingAppInsert = await request('/api/logs/app/batch', {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ records: [{
      client_record_id: pendingAppRecordId,
      app_name: pendingAppName,
      category: 'unknown',
      product_name: 'Study Classroom',
      file_description: 'Learning application',
      classification_source: 'disabled',
      classification_confidence: null,
      start_time: new Date().toISOString(),
      duration_seconds: 15,
    }] }),
  });
  assert.equal(pendingAppInsert.status, 201);

  const unknownApps = await request('/api/agent/classification/app/unknown-apps?limit=25', {
    headers: agentHeaders,
  });
  assert.equal(unknownApps.status, 200);
  assert.ok(unknownApps.body.apps.some((item) => item.app_name === pendingAppName));

  const appBackfill = await request('/api/agent/classification/app/backfill', {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({
      app_name: pendingAppName,
      category: 'learning',
      classification_source: 'trained_model',
      classification_confidence: 0.91,
    }),
  });
  assert.equal(appBackfill.status, 200);
  assert.equal(appBackfill.body.updated, 1);
  const classifiedAppRow = await adminPool.query(
    `SELECT category::text AS category, classification_source,
            classification_confidence, product_name
     FROM app_usage
     WHERE device_id = $1 AND client_record_id = $2`,
    [deviceOne, pendingAppRecordId]
  );
  assert.deepEqual(classifiedAppRow.rows[0], {
    category: 'learning',
    classification_source: 'trained_model',
    classification_confidence: 0.91,
    product_name: 'Study Classroom',
  });

  const domain = `legacy-${Date.now()}.example.test`;
  const clientRecordId = crypto.randomUUID();
  const inserted = await request('/api/logs/web/batch', {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ records: [{
      client_record_id: clientRecordId,
      url: `https://${domain}/`,
      domain,
      category: 'unknown',
      classification_source: 'disabled',
      classification_confidence: null,
      visit_time: new Date().toISOString(),
      duration_seconds: 3,
      page_title: 'Legacy unknown row',
    }] }),
  });
  assert.equal(inserted.status, 201);

  const unknowns = await request('/api/agent/classification/web/unknown-domains?limit=25', {
    headers: agentHeaders,
  });
  assert.equal(unknowns.status, 200);
  assert.ok(unknowns.body.domains.includes(domain));

  const backfilled = await request('/api/agent/classification/web/backfill', {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({
      domain,
      category: 'education',
      classification_source: 'trained_model',
      classification_confidence: 0.91,
    }),
  });
  assert.equal(backfilled.status, 200);
  assert.equal(backfilled.body.updated, 1);

  const activity = await request(`/api/logs/web?device_id=${deviceOne}&limit=200`, {
    headers: parentHeaders,
  });
  assert.equal(activity.status, 200);
  const visible = activity.body.data.find((row) => row.log_id && row.domain === domain);
  assert.equal(visible.category, 'education');
  assert.equal(visible.access_status, 'open');
  const blockedWebsite = activity.body.data.find(
    (row) => row.domain === previouslyClassifiedDomain
  );
  assert.equal(blockedWebsite.access_status, 'blocked');

  const disabled = await request(`/api/settings/${childOne}`, {
    method: 'PUT',
    headers: parentHeaders,
    body: JSON.stringify({ enable_web_classification: false }),
  });
  assert.equal(disabled.status, 200);
  const activityAfterDisable = await request(
    `/api/logs/web?device_id=${deviceOne}&limit=200`,
    { headers: parentHeaders }
  );
  const reopenedWebsite = activityAfterDisable.body.data.find(
    (row) => row.domain === previouslyClassifiedDomain
  );
  assert.equal(reopenedWebsite.access_status, 'open');
  const noFallback = await request('/api/agent/classification/web/fallback', {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ domain: 'youtube.com' }),
  });
  assert.equal(noFallback.status, 409);
});

test('Agent text moderation reaches the local provider, stores metadata and creates one alert', async () => {
  const rawText = 'Cách tự tử - integration private text';
  const clientRecordId = crypto.randomUUID();
  let providerCalls = 0;
  let capturedProviderRequest;
  const providerSecret = 'integration-local-secret-123';
  const providerServer = http.createServer((providerRequest, providerResponse) => {
    const chunks = [];
    providerRequest.on('data', (chunk) => chunks.push(chunk));
    providerRequest.on('end', () => {
      providerCalls += 1;
      assert.equal(providerRequest.method, 'POST');
      assert.equal(providerRequest.url, '/v1/moderate');
      assert.equal(providerRequest.headers['x-local-moderation-key'], providerSecret);
      capturedProviderRequest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const item = capturedProviderRequest.items[0];
      providerResponse.writeHead(200, { 'content-type': 'application/json' });
      providerResponse.end(JSON.stringify({
        provider: 'local',
        model: 'vi-context-rules-integration',
        taxonomyVersion: '1.0.0',
        results: [{
          id: item.id,
          flagged: true,
          action: 'alert',
          riskType: 'self_harm',
          severity: 'critical',
          primaryCategory: 'self-harm/instructions',
          confidence: 0.94,
          categoryScores: { 'self-harm/instructions': 0.94 },
          matchedSignals: ['self_harm_plan_or_method_request'],
        }],
      }));
    });
  });
  providerServer.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    providerServer.once('listening', resolve);
    providerServer.once('error', reject);
  });

  const previousProvider = process.env.TEXT_MODERATION_PROVIDER;
  const previousUrl = process.env.LOCAL_MODERATION_URL;
  const previousKey = process.env.LOCAL_MODERATION_API_KEY;
  try {
    process.env.TEXT_MODERATION_PROVIDER = 'local';
    process.env.LOCAL_MODERATION_URL = `http://127.0.0.1:${providerServer.address().port}`;
    process.env.LOCAL_MODERATION_API_KEY = providerSecret;
    await adminPool.query(
      `INSERT INTO settings(child_id, enable_text_moderation)
       VALUES($1, TRUE)
       ON CONFLICT (child_id) DO UPDATE SET enable_text_moderation = TRUE`,
      [childOne]
    );

    const payload = {
      records: [{
        client_record_id: clientRecordId,
        source_type: 'search_query',
        text: rawText,
        occurred_at: new Date().toISOString(),
        domain: 'search.example.test',
      }],
    };
    const sendBatch = () => request('/api/agent/text-moderation/batch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-device-id': String(deviceOne),
        'x-device-secret': plaintextDeviceSecret,
      },
      body: JSON.stringify(payload),
    });
    const first = await sendBatch();
    const retry = await sendBatch();

    assert.equal(first.status, 201);
    assert.deepEqual(first.body.accepted_client_record_ids, [clientRecordId]);
    assert.equal(first.body.flagged_count, 1);
    assert.equal(retry.status, 201);
    assert.equal(retry.body.flagged_count, 0);
    assert.equal(providerCalls, 1);
    assert.equal(capturedProviderRequest.items[0].id, clientRecordId);
    assert.equal(capturedProviderRequest.items[0].text, rawText);
    assert.equal(capturedProviderRequest.items[0].sourceType, 'search_query');
    assert.equal(capturedProviderRequest.items[0].direction, 'unknown');

    const event = await adminPool.query(
      `SELECT status, risk_type, severity, primary_category, confidence,
              moderation_model, category_scores
       FROM text_moderation_events
       WHERE device_id = $1 AND client_record_id = $2`,
      [deviceOne, clientRecordId]
    );
    assert.equal(event.rows.length, 1);
    assert.equal(event.rows[0].status, 'flagged');
    assert.equal(event.rows[0].risk_type, 'self_harm');
    assert.equal(event.rows[0].severity, 'critical');
    assert.equal(event.rows[0].primary_category, 'self-harm/instructions');
    assert.equal(event.rows[0].confidence, 0.94);
    assert.equal(event.rows[0].moderation_model, 'vi-context-rules-integration');
    assert.equal(event.rows[0].category_scores['self-harm/instructions'], 0.94);
    assert.equal(JSON.stringify(event.rows[0]).includes(rawText), false);

    const alerts = await adminPool.query(
      `SELECT alert_type::text AS alert_type, message
       FROM alerts
       WHERE device_id = $1 AND alert_type = 'text_self_harm'`,
      [deviceOne]
    );
    assert.equal(alerts.rows.length, 1);
    assert.equal(alerts.rows[0].alert_type, 'text_self_harm');
    assert.equal(alerts.rows[0].message.includes(rawText), false);

    const columns = await adminPool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'text_moderation_events'`
    );
    const columnNames = columns.rows.map((row) => row.column_name);
    assert.equal(columnNames.includes('text'), false);
    assert.equal(columnNames.includes('content_text'), false);
  } finally {
    if (previousProvider === undefined) delete process.env.TEXT_MODERATION_PROVIDER;
    else process.env.TEXT_MODERATION_PROVIDER = previousProvider;
    if (previousUrl === undefined) delete process.env.LOCAL_MODERATION_URL;
    else process.env.LOCAL_MODERATION_URL = previousUrl;
    if (previousKey === undefined) delete process.env.LOCAL_MODERATION_API_KEY;
    else process.env.LOCAL_MODERATION_API_KEY = previousKey;
    await new Promise((resolve) => providerServer.close(resolve));
  }
});
