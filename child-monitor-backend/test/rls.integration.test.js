const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { once } = require('node:events');
const express = require('express');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test'), quiet: true });

test('HTTP success follows real PostgreSQL commit; deferred constraint failure returns 500', {
  timeout: 15000,
  skip: !process.env.TEST_DB_NAME || !process.env.TEST_DB_ADMIN_PASSWORD,
}, async (t) => {
  // Dedicated test credentials only; all writes are to a session-local temporary table.
  const pool = new Pool({
    host: process.env.TEST_DB_HOST, port: Number(process.env.TEST_DB_PORT || 5432),
    database: process.env.TEST_DB_NAME, user: process.env.TEST_DB_ADMIN_USER,
    password: process.env.TEST_DB_ADMIN_PASSWORD, max: 1, connectionTimeoutMillis: 3000,
  });
  t.after(() => pool.end());
  const setup = await pool.connect();
  try {
    await setup.query('CREATE TEMP TABLE rls_commit_probe (id INTEGER UNIQUE DEFERRABLE INITIALLY DEFERRED)');
  } finally { setup.release(); }
  const box = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/middlewares/rls.middleware.js'), 'utf8'), {
    module: box, require: () => ({ backendPool: pool }), console: { error() {} }, Promise,
  });
  const app = express();
  app.use((req, res, next) => { req.user = { user_id: 1 }; next(); });
  app.use(box.exports);
  app.post('/save', async (req, res) => {
    await req.db.query('INSERT INTO rls_commit_probe VALUES (1)');
    res.status(201).json({ saved: true });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/save`;
  const success = await fetch(url, { method: 'POST' });
  assert.equal(success.status, 201);
  assert.deepEqual(await success.json(), { saved: true });
  const stored = await pool.query('SELECT id FROM rls_commit_probe');
  assert.deepEqual(stored.rows, [{ id: 1 }]);
  // INSERT succeeds; the deferred unique check raises only at COMMIT.
  const failed = await fetch(url, { method: 'POST' });
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { message: 'Internal server error' });
  assert.equal(pool.totalCount, 0, 'failed commit connection must be discarded');
});
