// Bootstrap a fresh database from Data.sql through migration_v34.sql and verify RLS + privileges.
// Usage:
//   node scripts/setup-fresh-db.js --test   (reads .env.test / TEST_DB_* env vars)
//   node scripts/setup-fresh-db.js          (reads .env / DB_* env vars)
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');
const isTest = process.argv.includes('--test');
dotenv.config({ path: path.join(root, isTest ? '.env.test' : '.env'), quiet: true });

const prefix = isTest ? 'TEST_' : '';
const getEnv = (key, fallback = '') => {
  const val = process.env[prefix + key] || fallback;
  if (!val) throw new Error(`Missing required environment variable: ${prefix + key}`);
  return val;
};

const quoteIdent = (identifier) => `"${String(identifier).replaceAll('"', '""')}"`;
const quoteLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

function getOrderedSqlFiles() {
  const migrationFiles = fs.readdirSync(root)
    .filter((name) => /^migration_v\d+\.sql$/i.test(name))
    .sort((a, b) => {
      const va = Number(a.match(/v(\d+)/i)[1]);
      const vb = Number(b.match(/v(\d+)/i)[1]);
      return va - vb;
    });
  return ['Data.sql', 'migration.sql', ...migrationFiles];
}

async function main() {
  const host = getEnv('DB_HOST', '127.0.0.1');
  const port = Number(getEnv('DB_PORT', '5432'));
  const database = getEnv('DB_NAME');
  const adminUser = getEnv('DB_ADMIN_USER');
  const adminPassword = getEnv('DB_ADMIN_PASSWORD');
  const backendUser = getEnv('DB_BACKEND_USER');
  const backendPassword = getEnv('DB_BACKEND_PASSWORD');

  // Owner/superuser executing DDL & migrations (defaults to TEST_DB_MIGRATION_USER if set, else adminUser)
  const ownerUser = process.env[prefix + 'DB_MIGRATION_USER'] || adminUser;
  const ownerPassword = process.env[prefix + 'DB_MIGRATION_PASSWORD'] || adminPassword;

  if (adminUser === backendUser) {
    throw new Error('DB_ADMIN_USER and DB_BACKEND_USER must be distinct roles');
  }

  const client = new Client({
    host,
    port,
    database,
    user: ownerUser,
    password: ownerPassword,
    connectionTimeoutMillis: 10000,
  });

  await client.connect();
  try {
    // 1. Align database/session timezone with Vietnam time for usage-summary & consent boundary checks
    await client.query(`SET timezone TO 'Asia/Ho_Chi_Minh'`);
    await client.query(`ALTER DATABASE ${quoteIdent(database)} SET timezone TO 'Asia/Ho_Chi_Minh'`).catch(() => {});

    // 2. Ensure service roles exist when running as superuser (e.g. postgres on GitHub Actions CI)
    const { rows: [callerRole] } = await client.query(
      'SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user'
    );
    if (callerRole?.rolsuper || callerRole?.rolcreaterole) {
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(adminUser)}) THEN
            CREATE ROLE ${quoteIdent(adminUser)} LOGIN PASSWORD ${quoteLiteral(adminPassword)} NOSUPERUSER BYPASSRLS;
          ELSE
            ALTER ROLE ${quoteIdent(adminUser)} WITH LOGIN PASSWORD ${quoteLiteral(adminPassword)} NOSUPERUSER BYPASSRLS;
          END IF;

          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${quoteLiteral(backendUser)}) THEN
            CREATE ROLE ${quoteIdent(backendUser)} LOGIN PASSWORD ${quoteLiteral(backendPassword)} NOSUPERUSER NOBYPASSRLS;
          ELSE
            ALTER ROLE ${quoteIdent(backendUser)} WITH LOGIN PASSWORD ${quoteLiteral(backendPassword)} NOSUPERUSER NOBYPASSRLS;
          END IF;
        END $$;
      `);
    }

    // 3. Apply Data.sql + all migrations in strict numerical order
    const sqlFiles = getOrderedSqlFiles();
    for (const file of sqlFiles) {
      let sql = fs.readFileSync(path.join(root, file), 'utf8');
      sql = sql
        .replaceAll('ON DATABASE child_monitor_db', `ON DATABASE ${quoteIdent(database)}`)
        .replaceAll(/\bTO\s+app_backend\b/g, `TO ${quoteIdent(backendUser)}`)
        .replaceAll(/\bTO\s+app_admin\b/g, `TO ${quoteIdent(adminUser)}`)
        .replaceAll(/\bFROM\s+app_backend\b/g, `FROM ${quoteIdent(backendUser)}`)
        .replaceAll(/\bFROM\s+app_admin\b/g, `FROM ${quoteIdent(adminUser)}`)
        .replaceAll(/\bROLE\s+app_admin\b/g, `ROLE ${quoteIdent(adminUser)}`)
        .replaceAll(/\bROLE\s+app_backend\b/g, `ROLE ${quoteIdent(backendUser)}`);
      await client.query(sql);
      console.log(`  [OK] Applied ${file}`);
    }

    // 4. Verify audit_logs & admin_face_templates privileges for adminUser
    const privCheck = await client.query(`
      SELECT
        has_table_privilege($1, 'public.audit_logs', 'SELECT, INSERT, DELETE') AS audit_ok,
        has_table_privilege($1, 'public.admin_face_templates', 'SELECT, INSERT, UPDATE, DELETE') AS face_ok
    `, [adminUser]);
    const { audit_ok, face_ok } = privCheck.rows[0];
    if (!audit_ok || !face_ok) {
      throw new Error(`Privilege verification failed for ${adminUser}: audit_ok=${audit_ok}, face_ok=${face_ok}`);
    }

    console.log(`✅ Successfully applied ${sqlFiles.length} SQL files and verified role privileges on '${database}'.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('❌ setup-fresh-db failed:', err.message);
  process.exitCode = 1;
});
