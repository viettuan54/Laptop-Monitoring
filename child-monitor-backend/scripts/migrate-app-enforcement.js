// Apply only V28. --test requires isolated test credentials without live fallback.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
const test = process.argv.includes('--test');
dotenv.config({ path: path.join(root, test ? '.env.test' : '.env'), quiet: true });
const env = (key) => {
  const name = (test ? 'TEST_' : '') + key;
  if (!process.env[name]) throw new Error(`Missing ${name}`);
  return process.env[name];
};
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
async function main() {
  const admin = env('DB_ADMIN_USER');
  const backend = env('DB_BACKEND_USER');
  const prefix = test ? 'TEST_' : '';
  const migrationUser = process.env[prefix + 'DB_MIGRATION_USER'];
  const client = new Client({ host: env('DB_HOST'), port: Number(env('DB_PORT')),
    database: env('DB_NAME'), user: migrationUser || admin,
    password: migrationUser ? env('DB_MIGRATION_PASSWORD') : env('DB_ADMIN_PASSWORD'), connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query(fs.readFileSync(path.join(root, 'migration_v28.sql'), 'utf8')
      .replaceAll('TO app_backend;', `TO ${quote(backend)};`)
      .replaceAll('TO app_admin;', `TO ${quote(admin)};`));
    console.log(`Application enforcement migration V28 applied to ${test ? 'test' : 'configured'} database.`);
  } finally { await client.end(); }
}
main().catch((error) => { console.error('Application enforcement migration failed:', error.message); process.exitCode = 1; });
