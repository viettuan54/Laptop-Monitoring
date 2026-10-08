// Idempotent migration for existing installations. --test never falls back to the live DB.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
const test = process.argv.includes('--test');
dotenv.config({ path: path.join(root, test ? '.env.test' : '.env'), quiet: true });
const prefix = test ? 'TEST_' : '';
const env = (key) => {
  const value = process.env[prefix + key];
  if (!value) throw new Error(`Missing ${prefix + key}`);
  return value;
};
const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
async function main() {
  const admin = env('DB_ADMIN_USER');
  const backend = env('DB_BACKEND_USER');
  const client = new Client({ host: env('DB_HOST'), port: Number(env('DB_PORT')),
    database: env('DB_NAME'), user: admin, password: env('DB_ADMIN_PASSWORD'), connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const sql = fs.readFileSync(path.join(root, 'migration_v25.sql'), 'utf8')
      .replaceAll('TO app_backend;', `TO ${quote(backend)};`)
      .replaceAll('TO app_admin;', `TO ${quote(admin)};`);
    await client.query(sql);
    await client.query(fs.readFileSync(path.join(root, 'migration_v26.sql'), 'utf8'));
    console.log(`Screenshot migrations V25-V26 applied to ${test ? 'test' : 'configured'} database.`);
  } finally { await client.end(); }
}
main().catch((error) => { console.error('Screenshot migration failed:', error.message); process.exitCode = 1; });
