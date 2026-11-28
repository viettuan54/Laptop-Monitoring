const categoryLabels = {
  learning: 'Học tập',
  education: 'Giáo dục',
  entertainment: 'Giải trí',
  browsers: 'Trình duyệt',
  social: 'Mạng xã hội',
  unsafe: 'Không an toàn',
  unknown: 'Chưa phân loại',
};

const accessStatusLabels = Object.freeze({
  blocked: 'Đã chặn',
  open: 'Đang mở',
});

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function localizeError(message = '') {
  const translations = {
    'Internal server error': 'Máy chủ gặp lỗi nội bộ.',
    'Access denied': 'Bạn không có quyền thực hiện thao tác này.',
    'User not found': 'Không tìm thấy tài khoản.',
    'Account has been disabled': 'Tài khoản đã bị khóa.',
    'Invalid email or password': 'Email hoặc mật khẩu không chính xác.',
    'Email not verified. Please verify your email first.': 'Email chưa được xác minh.',
    'Device not found or access denied': 'Không tìm thấy thiết bị hoặc bạn không có quyền truy cập.',
    'Child not found or access denied': 'Không tìm thấy hồ sơ trẻ hoặc bạn không có quyền truy cập.',
    'Domain already in blacklist': 'Tên miền đã có trong danh sách chặn.',
    'Reason must be a string': 'Lý do chặn phải là chuỗi văn bản.',
    'Blacklist id must be a positive integer': 'Mã danh sách chặn không hợp lệ.',
    'You cannot delete your own admin account': 'Bạn không thể xóa tài khoản quản trị của chính mình.',
    'Account roles cannot be changed. Create a separate account instead': 'Không thể đổi vai trò tài khoản. Hãy tạo tài khoản riêng với vai trò cần dùng.',
    'Name must contain 1 to 100 characters': 'Họ tên phải có từ 1 đến 100 ký tự.',
    'Email already exists': 'Email này đã được sử dụng. Hãy dùng email khác.',
    'Invalid role or verification status': 'Vai trò hoặc trạng thái xác minh không hợp lệ.',
    'Password must be 8 to 72 bytes and include an uppercase letter, a number, and a special character': 'Mật khẩu cần ít nhất 8 ký tự, tối đa 72 byte, gồm chữ hoa, số và ký tự đặc biệt.',
    'At least one active verified admin must remain': 'Không thể thực hiện: hệ thống phải còn ít nhất một quản trị viên đang hoạt động và đã xác minh email.',
    'You cannot unverify your own admin account': 'Bạn không thể tự bỏ xác minh email của tài khoản quản trị.',
    'Transfer child profiles and devices before promoting to admin': 'Tài khoản còn hồ sơ trẻ hoặc thiết bị. Hãy chuyển dữ liệu sang tài khoản phụ huynh khác trước khi cấp quyền quản trị.',
    'Only parent accounts can own child profiles': 'Chỉ tài khoản phụ huynh được tạo hồ sơ trẻ. Vui lòng đăng nhập lại để cập nhật quyền.',
    'Account changed. Please sign in again': 'Tài khoản đã thay đổi. Vui lòng đăng nhập lại.',
    'You cannot demote or disable your own admin account': 'Bạn không thể tự hạ quyền hoặc khóa tài khoản quản trị của mình.',
    'Push notifications are disabled on the server': 'Máy chủ chưa bật tính năng thông báo đẩy.',
    'No active push token is registered': 'Chưa có thiết bị nhận thông báo nào được đăng ký.',
    'Push provider is unavailable': 'Dịch vụ gửi thông báo hiện không khả dụng.',
    'Invalid EXPO push token': 'Expo push token không hợp lệ.',
    'Invalid FCM push token': 'FCM push token không hợp lệ.',
    'This push token is already registered to another account': 'Push token này đã được đăng ký cho một tài khoản khác.',
    'Face verification failed': 'Khuôn mặt không khớp với tài khoản hoặc các ảnh chụp không nhất quán. Hãy thử lại với đủ ánh sáng.',
    'Invalid camera frames': 'Cần 5 ảnh khác nhau, mỗi ảnh có đúng một khuôn mặt rõ nét, đủ sáng và không bị cắt.',
    'Face already enrolled on another account': 'Khuôn mặt đã được đăng kí ở một tài khoản khác. Vui lòng đăng kí lại bằng khuôn mặt của chủ tài khoản này.',
    'Only another admin can reset your face data': 'Chỉ quản trị viên khác mới có thể đặt lại dữ liệu khuôn mặt của bạn.',
    'Your password is required to reset face data': 'Nhập mật khẩu của bạn để xác nhận đặt lại khuôn mặt.',
    'Password or admin session is invalid': 'Mật khẩu hoặc phiên quản trị không hợp lệ. Hãy kiểm tra hoặc đăng nhập lại.',
    'Admin face verification required. Please sign in again': 'Cần xác thực khuôn mặt. Vui lòng đăng nhập lại.',
    'Admin face enrollment required. Please sign in again': 'Cần đăng ký khuôn mặt. Vui lòng đăng nhập lại.',
    'Face verification challenge is invalid or expired': 'Phiên xác thực khuôn mặt đã hết hạn. Vui lòng đăng nhập lại.',
    'Face verification challenge has already been used': 'Phiên xác thực khuôn mặt đã được sử dụng.',
    'Face recognition service is unavailable': 'Dịch vụ nhận diện khuôn mặt chưa sẵn sàng.',
    'Face recognition runtime is blocked by Windows Application Control': 'Windows trên máy Backend đang chặn thư viện nhận diện khuôn mặt. Cần xử lý chính sách Application Control trên máy Backend; chụp lại ảnh không khắc phục được lỗi này.',
    'Too many face verification attempts, try again later': 'Bạn đã thử xác thực khuôn mặt quá nhiều lần. Vui lòng thử lại sau.',
  };
  return translations[message] || message;
}

function localizeMessage(message = '') {
  const translations = {
    'Registration successful. Please check your email to verify your account.': 'Đăng ký thành công. Hãy kiểm tra email để xác minh tài khoản.',
    'If the email exists, a password reset link has been sent.': 'Nếu email tồn tại, liên kết đặt lại mật khẩu đã được gửi.',
    'Email verified successfully. You can now login.': 'Xác minh email thành công. Bạn có thể đăng nhập.',
    'Verification email resent successfully': 'Đã gửi lại email xác minh.',
    'Password reset successfully. All previous sessions revoked.': 'Đặt lại mật khẩu thành công. Mọi phiên cũ đã bị thu hồi.',
    'Password changed successfully. All previous sessions revoked.': 'Đổi mật khẩu thành công. Mọi phiên cũ đã bị thu hồi.',
  };
  return translations[message] || message;
}

function relativeTime(value) {
  if (!value) return 'Chưa có dữ liệu';
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.max(0, Math.round(diff / 60000));
  if (mins < 1) return 'Vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  if (mins < 1440) return `${Math.round(mins / 60)} giờ trước`;
  return `${Math.round(mins / 1440)} ngày trước`;
}

function duration(value) {
  const seconds = Number(value) || 0;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} phút`;
  return `${Math.floor(mins / 60)} giờ ${mins % 60} phút`;
}

function categoryLabel(value) {
  return categoryLabels[String(value || 'unknown').toLowerCase()] || String(value || 'Chưa phân loại');
}

function categoryBadge(value) {
  const normalized = String(value || 'unknown').toLowerCase();
  const tone = normalized === 'unsafe' ? 'coral' : normalized === 'unknown' ? 'neutral' : '';
  return `<span class="badge ${tone}">${escapeHtml(categoryLabel(normalized))}</span>`;
}

function initials(name = 'Phụ huynh') {
  return name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function queryString(params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, value);
  });
  const text = query.toString();
  return text ? `?${text}` : '';
}

function reconcileSelectedId(currentId, items, key) {
  if (items.some((item) => String(item[key]) === String(currentId))) return currentId;
  return items[0]?.[key] ?? null;
}

export {
  accessStatusLabels,
  categoryBadge,
  categoryLabel,
  duration,
  escapeHtml,
  initials,
  localizeError,
  localizeMessage,
  queryString,
  reconcileSelectedId,
  relativeTime,
};
