const { Pool } = require('pg');
require('dotenv').config();

const baseConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  // Giới hạn số connection tối đa để tránh pool cạn kiệt dưới tải cao
  max: 10,
  // Đóng connection idle quá 30 giây để giải phóng tài nguyên DB
  idleTimeoutMillis: 30000,
  // Timeout khi chờ lấy connection từ pool (tránh request treo vô thời hạn)
  connectionTimeoutMillis: 3000,
};

// ── adminPool ────────────────────────────────────────────────────────────────
// Dùng cho: register, login, auth middleware, agent logs, admin routes
// Bypass RLS (postgres superuser hoặc BYPASSRLS role)
// KHÔNG dùng cho routes đã qua middleware auth của phụ huynh
const adminPool = new Pool({
  ...baseConfig,
  user: process.env.DB_ADMIN_USER,
  password: process.env.DB_ADMIN_PASSWORD,
});

// ── backendPool ──────────────────────────────────────────────────────────────
// Dùng cho: mọi route phụ huynh đã qua middleware auth + withRls
// PHẢI là non-superuser (app_backend) để RLS có hiệu lực
// ⚠️ Nếu DB_BACKEND_USER = postgres (superuser), RLS bị bypass hoàn toàn!
const backendPool = new Pool({
  ...baseConfig,
  user: process.env.DB_BACKEND_USER,
  password: process.env.DB_BACKEND_PASSWORD,
});

// Bắt lỗi idle connection bị đóng đột ngột để tránh crash process
// Nếu không có handler này, lỗi sẽ bị throw ra process level → server crash
adminPool.on('error', (err) => {
  console.error('adminPool idle client error:', err.message);
});

backendPool.on('error', (err) => {
  console.error('backendPool idle client error:', err.message);
});

const RLS_TABLES = [
  'users', 'children', 'devices', 'app_usage', 'website_logs',
  'settings', 'ai_analysis', 'alerts', 'audit_logs',
];

async function validateRlsConfiguration() {
  if (process.env.DB_BACKEND_USER === process.env.DB_ADMIN_USER) {
    throw new Error('DB_BACKEND_USER must be different from DB_ADMIN_USER');
  }

  const roleResult = await backendPool.query(`
    SELECT r.rolname, r.rolsuper, r.rolbypassrls
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);
  const role = roleResult.rows[0];
  if (!role) {
    throw new Error('Cannot inspect DB backend role');
  }
  if (role.rolsuper || role.rolbypassrls) {
    throw new Error(`Unsafe DB backend role '${role.rolname}': SUPERUSER/BYPASSRLS is not allowed`);
  }

  const tablesResult = await backendPool.query(`
    SELECT c.relname,
           c.relrowsecurity,
           c.relforcerowsecurity,
           pg_get_userbyid(c.relowner) = current_user AS owned_by_backend
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
  `, [RLS_TABLES]);

  const byName = new Map(tablesResult.rows.map((row) => [row.relname, row]));
  const missing = RLS_TABLES.filter((name) => !byName.has(name));
  const rlsDisabled = tablesResult.rows
    .filter((row) => !row.relrowsecurity)
    .map((row) => row.relname);
  const unsafeOwned = tablesResult.rows
    .filter((row) => row.owned_by_backend && !row.relforcerowsecurity)
    .map((row) => row.relname);

  if (missing.length || rlsDisabled.length || unsafeOwned.length) {
    throw new Error(
      `Unsafe RLS configuration. Missing=[${missing.join(', ')}], ` +
      `RLS disabled=[${rlsDisabled.join(', ')}], ` +
      `backend-owned without FORCE RLS=[${unsafeOwned.join(', ')}]`
    );
  }

  console.log(`✅ RLS validated for role '${role.rolname}' on ${RLS_TABLES.length} tables`);
}

module.exports = { adminPool, backendPool, validateRlsConfiguration };
