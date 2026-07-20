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

// Cảnh báo khi khởi động nếu cả hai pool dùng cùng user
// (RLS sẽ bị vô hiệu hóa nếu user đó là superuser)
if (process.env.DB_BACKEND_USER === process.env.DB_ADMIN_USER) {
  console.warn(
    '⚠️  [RLS Warning] DB_BACKEND_USER và DB_ADMIN_USER đang trùng nhau. ' +
    'Nếu user này là superuser/BYPASSRLS, Row Level Security sẽ bị vô hiệu hoàn toàn. ' +
    'Hãy tạo user app_backend riêng biệt bằng cách chạy: psql -U postgres -d child_monitor_db -f migration_v9.sql'
  );
}

module.exports = { adminPool, backendPool };