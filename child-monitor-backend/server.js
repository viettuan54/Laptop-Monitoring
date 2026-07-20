require('dotenv').config();

// ── Validate biến môi trường bắt buộc (fail-fast khi khởi động) ─────────
// Phát hiện lỗi cấu hình ngay lúc start, không phải khi có request đầu tiên
const REQUIRED_ENV = [
  'JWT_SECRET',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_ADMIN_USER',
  'DB_ADMIN_PASSWORD',
  'DB_BACKEND_USER',
  'DB_BACKEND_PASSWORD',
];

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`❌ Thiếu biến môi trường bắt buộc: ${missingEnv.join(', ')}`);
  console.error('   Hãy kiểm tra file .env và khởi động lại server.');
  process.exit(1);
}

const app = require('./src/app');
const { adminPool } = require('./src/config/db');
const { cleanupExpiredTokens, cleanupExpiredRefreshTokens } = require('./src/utils/tokenBlacklist');
const { initTransporter } = require('./src/utils/email');

// Khởi tạo SMTP Transporter ngay lúc khởi động (fail-fast ở production)
initTransporter();

const PORT = process.env.PORT || 3000;

if (!process.env.GEMINI_API_KEY) {
  console.warn('⚠️  Cảnh báo: Thiếu GEMINI_API_KEY. Các tính năng AI sẽ không hoạt động.');
}

if (!process.env.FRONTEND_URL) {
  console.warn('⚠️  Cảnh báo: Thiếu FRONTEND_URL. Link xác minh email và reset mật khẩu sẽ trỏ về http://localhost:3000 (chỉ phù hợp môi trường dev).');
}

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'development'}`);

  // ── Cron Job: Dọn dữ liệu cũ mỗi ngày lúc 2:00 AM ───────────────────
  // Sử dụng setInterval thay vì thư viện node-cron để không thêm dependency
  scheduleCleanup();
});

/**
 * Lên lịch dọn dữ liệu cũ mỗi ngày lúc 2:00 AM (giờ server).
 * - cleanup_old_logs(): xóa app_usage/website_logs > 6 tháng, alerts > 12 tháng đã đọc
 * - cleanupExpiredTokens(): xóa jti hết hạn khỏi token_blacklist
 */
function scheduleCleanup() {
  const runCleanup = async () => {
    console.log('[Cleanup] Bắt đầu dọn dữ liệu cũ...');
    try {
      // Gọi function cleanup_old_logs() được định nghĩa trong Data.sql
      await adminPool.query('SELECT cleanup_old_logs()');
      console.log('[Cleanup] cleanup_old_logs() hoàn thành');
    } catch (err) {
      console.error('[Cleanup] cleanup_old_logs() error:', err.message);
    }

    try {
      await cleanupExpiredTokens();
    } catch (err) {
      console.error('[Cleanup] cleanupExpiredTokens() error:', err.message);
    }

    try {
      await cleanupExpiredRefreshTokens();
    } catch (err) {
      console.error('[Cleanup] cleanupExpiredRefreshTokens() error:', err.message);
    }

    try {
      const cleanupResult = await adminPool.query(
        "DELETE FROM failed_login_attempts WHERE last_attempt < NOW() - INTERVAL '1 day'"
      );
      if (cleanupResult.rowCount > 0) {
        console.log(`[Cleanup] Đã dọn ${cleanupResult.rowCount} bản ghi failed_login_attempts cũ`);
      }
    } catch (err) {
      console.error('[Cleanup] failed_login_attempts cleanup error:', err.message);
    }

    console.log('[Cleanup] Hoàn thành. Lần tiếp theo sau 24 giờ.');
  };

  // Tính thời gian đến 2:00 AM tiếp theo
  const getNextRunMs = () => {
    const now = new Date();
    const next2AM = new Date(now);
    next2AM.setHours(2, 0, 0, 0);
    if (next2AM <= now) {
      // Nếu đã qua 2AM hôm nay → lên lịch cho ngày mai
      next2AM.setDate(next2AM.getDate() + 1);
    }
    return next2AM - now;
  };

  // Lưu vào biến để tránh gọi getNextRunMs() 2 lần (lần 2 có giá trị nhỏ hơn vài ms → log sai thời gian)
  const msUntilCleanup = getNextRunMs();

  // Chạy lần đầu vào 2:00 AM tiếp theo
  setTimeout(() => {
    runCleanup();
    // Sau đó lặp lại mỗi 24 giờ
    setInterval(runCleanup, 24 * 60 * 60 * 1000);
  }, msUntilCleanup);

  const nextRun = new Date(Date.now() + msUntilCleanup);
  console.log(`[Cleanup] Lần dọn dữ liệu tiếp theo: ${nextRun.toLocaleString()}`);
}