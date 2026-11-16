const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { lockAdminLifecycle, hasOtherEligibleAdmin } = require('../src/services/adminLifecycle.service');

test('PostgreSQL lifecycle lock serializes connections and excludes ineligible admins', async () => {
  for (const key of ['TEST_DB_HOST', 'TEST_DB_NAME', 'TEST_DB_ADMIN_USER', 'TEST_DB_ADMIN_PASSWORD']) {
    assert.ok(process.env[key], `${key} is required; never fall back to the application database`);
  }
  assert.notEqual(process.env.TEST_DB_NAME, process.env.DB_NAME, 'Use a separate test database');
  const pool = new Pool({ host: process.env.TEST_DB_HOST,
    port: Number(process.env.TEST_DB_PORT || 5432), database: process.env.TEST_DB_NAME,
    user: process.env.TEST_DB_ADMIN_USER, password: process.env.TEST_DB_ADMIN_PASSWORD,
    connectionTimeoutMillis: 3000 });
  let first, second;
  try {
    first = await pool.connect();
    second = await pool.connect();
    for (const client of [first, second]) {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '5s'");
    }
    // Temp fixtures only; no changes to existing test or application users.
    await first.query(`CREATE TEMP TABLE users (
      user_id integer PRIMARY KEY, role text, is_active boolean, is_verified boolean) ON COMMIT DROP`);
    await first.query(`INSERT INTO users VALUES
      (1, 'admin', true, true), (2, 'admin', true, true),
      (3, 'admin', false, true), (4, 'admin', true, false), (5, 'parent', true, true)`);
    await lockAdminLifecycle(first);
    assert.equal(await hasOtherEligibleAdmin(first, 1), true);
    assert.equal((await second.query('SELECT pg_try_advisory_xact_lock(1279479630, 1) AS acquired')).rows[0].acquired, false);
    const waiting = lockAdminLifecycle(second);
    await first.query('DELETE FROM users WHERE user_id=1');
    assert.equal(await hasOtherEligibleAdmin(first, 2), false);
    await first.query('COMMIT');
    await waiting;
    assert.equal((await second.query('SELECT pg_try_advisory_xact_lock(1279479630, 1) AS acquired')).rows[0].acquired, true);
    await second.query('ROLLBACK');
  } finally {
    for (const client of [first, second]) {
      if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
    }
    await pool.end();
  }
});
