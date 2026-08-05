const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
  if (server) await new Promise((resolve) => server.close(resolve));
  await adminPool.query('DELETE FROM users WHERE email = ANY($1::text[])', [emails]);
  await Promise.all([adminPool.end(), backendPool.end(), closeRedis()]);
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
