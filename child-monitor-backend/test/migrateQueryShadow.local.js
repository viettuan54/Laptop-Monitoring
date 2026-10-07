// Apply v24 (including its v23 prerequisite) only to the isolated test DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { Client } = require('pg');

async function main() {
  const root = path.resolve(__dirname, '..');
  const test = { ...dotenv.parse(fs.readFileSync(path.join(root, '.env.test'))), ...process.env };
  const local = dotenv.parse(fs.readFileSync(path.join(root, '.env')));
  assert.match(test.TEST_DB_NAME, /(^|_)test($|_)/i);
  assert.ok(['127.0.0.1', 'localhost'].includes(test.TEST_DB_HOST));
  assert.notEqual(test.TEST_DB_NAME, local.DB_NAME, 'Test migration must not target the application database');
  // Only credentials are reused; the database target always comes from TEST_DB_*.
  const user = test.TEST_DB_MIGRATION_USER || local.DB_ADMIN_USER;
  const password = test.TEST_DB_MIGRATION_PASSWORD || local.DB_ADMIN_PASSWORD;
  assert.ok(user && password, 'Missing local migration-owner credentials');
  const client = new Client({ host: test.TEST_DB_HOST, port: test.TEST_DB_PORT,
    database: test.TEST_DB_NAME, user, password, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
    const database = await client.query('SELECT current_database() AS name');
    assert.equal(database.rows[0].name, test.TEST_DB_NAME);
    await client.query(fs.readFileSync(path.join(root, 'migration_v24.sql'), 'utf8'));
    await client.query("SELECT 'text_risk'::alert_type");
    console.log('Migration v24 applied to isolated test database.');
  } finally { await client.end(); }
}
main().catch(error => { console.error('Test migration failed:', error.code || error.name); process.exitCode = 1; });
