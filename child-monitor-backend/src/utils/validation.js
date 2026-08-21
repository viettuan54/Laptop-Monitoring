/**
 * Kiểm tra mật khẩu có đáp ứng chính sách bảo mật hay không:
 * - Tối thiểu 8 ký tự
 * - Ít nhất một chữ cái viết hoa (A-Z)
 * - Ít nhất một chữ số (0-9)
 * - Ít nhất một ký tự đặc biệt (ví dụ: !@#$%^&*...)
 * 
 * @param {string} password Mật khẩu cần kiểm tra
 * @returns {boolean} True nếu mật khẩu hợp lệ, ngược lại False
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return false;
  }
  
  const minLength = 8;
  const maxLength = 128;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
  
  return password.length >= minLength && password.length <= maxLength && hasUpperCase && hasDigit && hasSpecial;
}

const MAX_LOG_DURATION_SECONDS = 24 * 60 * 60;
const MAX_APP_USAGE_SEGMENT_SECONDS = 120;

/**
 * duration_seconds là tùy chọn, nhưng nếu có phải là số nguyên trong phạm vi
 * một ngày. Không ép kiểu chuỗi để tránh dữ liệu mơ hồ từ client.
 */
function validateDurationSeconds(value) {
  return value === undefined
    || value === null
    || (
      typeof value === 'number'
      && Number.isFinite(value)
      && Number.isInteger(value)
      && value >= 0
      && value <= MAX_LOG_DURATION_SECONDS
    );
}

/**
 * Foreground AppTracker flushes every 30 seconds. A bounded 120-second window
 * tolerates scheduler/IPC delays without allowing a lock/suspend gap to become
 * active screen time.
 */
function validateAppUsageDurationSeconds(value) {
  return value === undefined
    || value === null
    || (
      typeof value === 'number'
      && Number.isFinite(value)
      && Number.isInteger(value)
      && value >= 0
      && value <= MAX_APP_USAGE_SEGMENT_SECONDS
    );
}

module.exports = {
  validatePassword,
  validateDurationSeconds,
  MAX_LOG_DURATION_SECONDS,
  validateAppUsageDurationSeconds,
  MAX_APP_USAGE_SEGMENT_SECONDS,
};
