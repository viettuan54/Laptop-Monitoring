/* Bảng điều khiển SafeNest — ứng dụng web không phụ thuộc framework */
'use strict';

const API = '/api';
const DEFAULT_BACKEND_URL = 'https://api.tuansosad.id.vn';
const USAGE_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const toastRoot = document.querySelector('#toast-root');

const INITIAL_CHAT = Object.freeze([
  Object.freeze({
    role: 'model',
    content:
      'Chào bạn, mình là trợ lý SafeNest. Hãy hỏi mình về cách cân bằng thời gian màn hình hoặc đọc hiểu một tín hiệu hành vi.',
  }),
]);

let refreshPromise = null;
let screenshotRefreshTimer = null;
let activityRenderVersion = 0;
let controlRenderVersion = 0;
let policySaveSequence = 0;
let breakReminderRefreshTimer = null;
let breakReminderRefreshVersion = 0;
const breakReminderHistoryState = new WeakMap();

let modalReturnFocus = null;
let accessibleControlSequence = 0;
let overviewRenderSequence = 0;
let alertRefreshTimer = null;
let alertRefreshPromise = null;
let alertRefreshSequence = 0;
let alertListRefreshPromise = null;
// clearSession replaces state.chat; token refresh preserves it. No persistent AI storage.
const aiSessions = new WeakMap();

const state = {
  accessToken: sessionStorage.getItem('lm_access_token') || '',
  refreshToken: sessionStorage.getItem('lm_refresh_token') || '',
  userId: null,
  role: sessionStorage.getItem('lm_role') || '',
  page: location.hash.slice(1) || 'overview',
  children: [],
  devices: [],
  alerts: [],
  unreadAlertCount: 0,
  analyses: [],
  appLogs: [],
  webLogs: [],
  usageSummary: emptyUsageSummary(),
  adminStats: null,
  adminUsers: [],
  adminAuditLogs: [],
  pushTokens: [],
  faceChallenge: '',
  faceRequiredFrames: 3,
  faceStream: null,
  adminUserFilter: {},
  adminUserOffset: 0,
  adminUserLimit: 25,
  blacklistSearch: '',
  blacklistOffset: 0,
  blacklistLimit: 25,
  auditFilter: {},
  auditOffset: 0,
  auditLimit: 25,
  activityTab: 'apps',
  activityOffset: 0,
  activityLimit: 50,
  activityViewRows: [],
  activityFilter: {},
  alertFilter: {},
  overviewChildId: '',
  selectedChildId: null,
  selectedDeviceId: null,
  categoryPolicies: {},
  policyRenderVersion: 0,
  policyDrafts: {},
  policyBaselinesByChild: {},
  policyPendingByChild: {},
  policyDataVersions: {},
  policySaveErrors: {},
  connectionStatus: 'checking',
  lastApiAt: null,
  parentLoadErrors: [],
  chat: INITIAL_CHAT.map((message) => ({ ...message })),
  sidebarOpen: false,
  userMenuOpen: false,
  agentSecret: '',
  agentEndpoint: 'heartbeat',
};

const icons = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/></svg>',
  child: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M5 21c0-4.4 3.1-7 7-7s7 2.6 7 7"/></svg>',
  device: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="14" rx="2"/><path d="M2 21h20M9 17v4m6-4v4"/></svg>',
  control: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h7m4 0h5"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="13" cy="18" r="2"/></svg>',
  policy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 5 6v5c0 4.7 2.8 8.1 7 10 4.2-1.9 7-5.3 7-10V6Z"/><path d="m9 12 2 2 4-5"/></svg>',
  activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12h4l2-7 4 14 2-7h6"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7Z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9Z"/></svg>',
  account: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-5 3.6-8 8-8s8 3 8 8"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h3m4 0h3M7 14h3m4 0h3"/></svg>',
  lab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3h6m-5 0v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7 16h10"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.6-2L20 12M4 12l2.3 5a7 7 0 0 0 11.6-2"/></svg>',
};

const pageTitles = {
  overview: ['Tổng quan gia đình', 'Góc nhìn rõ ràng, không phán xét về thói quen số của con.'],
  children: ['Hồ sơ trẻ', 'Quản lý hồ sơ và liên kết thiết bị theo từng trẻ.'],
  devices: ['Thiết bị', 'Quản lý thiết bị của trẻ, trạng thái kết nối và mã kết nối.'],
  controls: ['Điều khiển thiết bị', 'Giới hạn thời gian, yêu cầu khóa và cài đặt giám sát theo hồ sơ trẻ.'],
  policies: ['Chính sách sử dụng', 'Thiết lập phân loại AI và quyền truy cập nội dung cho từng hồ sơ.'],
  activity: ['Hoạt động số', 'Theo dõi ứng dụng và website theo thiết bị, thời gian.'],
  alerts: ['Cảnh báo', 'Những tín hiệu phụ huynh cần xem xét và phản hồi.'],
  ai: ['Trung tâm AI', 'Phân tích hành vi, báo cáo định kỳ và tư vấn bằng AI.'],
  account: ['Tài khoản & bảo mật', 'Quản lý phiên đăng nhập và các thao tác bảo mật.'],
  'admin-overview': ['Điều hành hệ thống', 'Sức khỏe, quy mô và hoạt động trên toàn hệ thống.'],
  users: ['Quản lý tài khoản', 'Theo dõi và quản trị tài khoản phụ huynh, quản trị viên.'],
  blacklist: ['Danh sách chặn tên miền', 'Danh sách chặn toàn cục được đồng bộ xuống Agent.'],
  audit: ['Nhật ký kiểm toán', 'Theo dõi các thao tác nhạy cảm trong hệ thống.'],
  'api-lab': ['Phòng thử nghiệm Agent API', 'Môi trường trình diễn các endpoint dành cho Agent.'],
};

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

const policyCategoryGroups = {
  app: [
    ['learning', 'Học tập', 'Ứng dụng phục vụ học tập và sáng tạo.'],
    ['entertainment', 'Giải trí', 'Trò chơi, nội dung giải trí và đa phương tiện.'],
    ['browsers', 'Trình duyệt', 'Các trình duyệt web được Agent nhận diện.'],
    ['unknown', 'Chưa phân loại', 'Ứng dụng chưa có nhãn hoặc mới xuất hiện.'],
  ],
  web: [
    ['education', 'Giáo dục', 'Website học tập, tài liệu và nghiên cứu.'],
    ['entertainment', 'Giải trí', 'Video, âm nhạc và nội dung giải trí.'],
    ['social', 'Mạng xã hội', 'Mạng xã hội và nền tảng cộng đồng.'],
    ['unsafe', 'Không an toàn', 'Nội dung được hệ thống đánh giá có rủi ro.'],
    ['unknown', 'Chưa phân loại', 'Website chưa có nhãn hoặc chưa đủ dữ liệu.'],
  ],
};

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
    'You cannot delete your own admin account': 'Bạn không thể xóa tài khoản quản trị của chính mình.',
    'You cannot demote or disable your own admin account': 'Bạn không thể tự hạ quyền hoặc khóa tài khoản quản trị của mình.',
    'Push notifications are disabled on the server': 'Máy chủ chưa bật tính năng thông báo đẩy.',
    'No active push token is registered': 'Chưa có thiết bị nhận thông báo nào được đăng ký.',
    'Push provider is unavailable': 'Dịch vụ gửi thông báo hiện không khả dụng.',
    'Invalid EXPO push token': 'Expo push token không hợp lệ.',
    'Invalid FCM push token': 'FCM push token không hợp lệ.',
    'This push token is already registered to another account': 'Push token này đã được đăng ký cho một tài khoản khác.',
    'Face verification failed': 'Khuôn mặt không khớp với nhãn quản trị viên.',
    'Face verification challenge is invalid or expired': 'Phiên xác thực khuôn mặt đã hết hạn. Vui lòng đăng nhập lại.',
    'Face verification challenge has already been used': 'Phiên xác thực khuôn mặt đã được sử dụng.',
    'Face recognition service is unavailable': 'Dịch vụ nhận diện khuôn mặt chưa sẵn sàng.',
    'Invalid camera frames': 'Khung hình camera không hợp lệ.',
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

function decodeJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

function formatDate(value, withTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: USAGE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function localMonthKey(date = new Date()) {
  return localDateKey(date).slice(0, 7);
}

function localDateFromKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day, 12));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === monthIndex
    && date.getUTCDate() === day
    ? date
    : null;
}

function shiftLocalDateKey(value, days) {
  const date = localDateFromKey(value);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyUsageSummary(month = localMonthKey()) {
  return {
    month,
    timezone: '',
    daily: [],
    recent_daily: [],
    month_total_seconds: 0,
    today_seconds: 0,
    ignored_segment_count: 0,
    max_valid_agent_segment_seconds: 0,
  };
}

function normalizeUsageSummary(value, requestedMonth = localMonthKey()) {
  const month = /^\d{4}-\d{2}$/.test(String(value?.month || ''))
    ? String(value.month)
    : requestedMonth;
  const daily = Array.isArray(value?.daily)
    ? value.daily
      .map((item) => ({
        date: String(item?.date || '').slice(0, 10),
        duration_seconds: Math.max(0, Number(item?.duration_seconds) || 0),
      }))
      .filter((item) => localDateFromKey(item.date) && item.date.startsWith(`${month}-`))
    : [];
  return {
    month,
    timezone: String(value?.timezone || ''),
    daily,
    recent_daily: [],
    month_total_seconds: Math.max(0, Number(value?.month_total_seconds) || 0),
    today_seconds: Math.max(0, Number(value?.today_seconds) || 0),
    ignored_segment_count: Math.max(0, Number(value?.ignored_segment_count) || 0),
    max_valid_agent_segment_seconds: Math.max(
      0,
      Number(value?.max_valid_agent_segment_seconds) || 0
    ),
  };
}

async function loadOverviewUsageSummary(today = new Date(), childId = '') {
  const currentDate = localDateKey(today);
  const currentMonth = currentDate.slice(0, 7);
  const recentStart = shiftLocalDateKey(currentDate, -6);
  const months = [...new Set([currentMonth, recentStart.slice(0, 7)])];
  const summaries = await Promise.all(months.map(async (month) => {
    const path = `/logs/usage-summary?month=${month}${childId ? `&child_id=${encodeURIComponent(childId)}` : ''}`;
    return normalizeUsageSummary(await api(path), month);
  }));
  const current = summaries.find((summary) => summary.month === currentMonth)
    || emptyUsageSummary(currentMonth);
  const secondsByDate = new Map(
    summaries.flatMap((summary) => summary.daily)
      .map((item) => [item.date, item.duration_seconds])
  );
  const recentDaily = Array.from({ length: 7 }, (_, index) => {
    const key = shiftLocalDateKey(currentDate, index - 6);
    return { date: key, duration_seconds: secondsByDate.get(key) || 0 };
  });
  return { ...current, recent_daily: recentDaily };
}

function usageMetricParts(seconds) {
  const minutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  if (minutes < 60) return { value: minutes, unit: 'phút' };
  return {
    value: new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(minutes / 60),
    unit: 'giờ',
  };
}

function usageDaysInMonth(summary) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(summary?.month || ''));
  if (!match) return [];
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const count = new Date(Date.UTC(year, monthIndex + 1, 0, 12)).getUTCDate();
  const secondsByDate = new Map((summary.daily || []).map((item) => [item.date, item.duration_seconds]));
  const todayKey = localDateKey();
  return Array.from({ length: count }, (_, index) => {
    const key = `${summary.month}-${String(index + 1).padStart(2, '0')}`;
    return {
      date: key,
      label: String(index + 1),
      seconds: Math.max(0, Number(secondsByDate.get(key)) || 0),
      isToday: key === todayKey,
    };
  });
}

function usageRecentDays(summary) {
  return (summary.recent_daily || []).map((item) => {
    const date = localDateFromKey(item.date);
    return {
      date: item.date,
      label: date
        ? new Intl.DateTimeFormat('vi-VN', { weekday: 'short', timeZone: 'UTC' }).format(date)
        : item.date,
      seconds: Math.max(0, Number(item.duration_seconds) || 0),
    };
  });
}

function usageMonthLabel(month) {
  const date = localDateFromKey(`${month}-01`);
  return date
    ? new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
    : month;
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

function accessStatusLabel(value, resourceType) {
  if (resourceType === 'app') return value === 'blocked' ? 'Yêu cầu chặn' : 'Cho phép';
  return accessStatusLabels[String(value || 'open').toLowerCase()] || accessStatusLabels.open;
}

function accessStatusBadge(value, resourceType) {
  const normalized = String(value || 'open').toLowerCase();
  const tone = normalized === 'blocked' ? 'red' : '';
  return `<span class="badge access-status-badge ${tone}">${escapeHtml(accessStatusLabel(normalized, resourceType))}</span>`;
}

function websiteActivityTitle(item) {
  const technicalBlockedTitle = 'Truy cập bị Agent chặn';
  const pageTitle = String(item?.page_title || '').trim();
  if (!pageTitle || pageTitle === technicalBlockedTitle) {
    return item?.domain || item?.url || 'Không có tiêu đề';
  }
  return pageTitle;
}

function websiteActivitySubtitle(item) {
  const domain = String(item?.domain || item?.url || '').trim();
  const title = websiteActivityTitle(item);
  return domain && domain.toLowerCase() !== String(title).toLowerCase() ? domain : '';
}

function safeExternalUrl(value) {
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function isDeviceOnline(device) {
  // Backend presence uses the database clock, shared with screenshot requests.
  // Only older API versions need the timestamp fallback.
  if (typeof device?.online === 'boolean') return device.online;
  if (!device?.last_seen_at) return false;
  const lastSeen = new Date(device.last_seen_at).getTime();
  return Number.isFinite(lastSeen) && Date.now() - lastSeen <= 5 * 60 * 1000;
}

function updateConnectionIndicator(status) {
  state.connectionStatus = status;
  if (status === 'online') state.lastApiAt = new Date();
  const pill = document.querySelector('#connection-pill');
  if (!pill) return;
  pill.className = `connection-pill ${status}`;
  pill.title = status === 'online' && state.lastApiAt
    ? `Kết nối API gần nhất lúc ${formatDate(state.lastApiAt)}`
    : 'Trạng thái kết nối API';
  const label = pill.querySelector('span');
  if (label) {
    label.textContent = status === 'online' ? 'Backend đã kết nối' : status === 'offline' ? 'Mất kết nối Backend' : 'Đang kiểm tra';
  }
}

function alertCountLabel(count) {
  return count > 99 ? '99+' : String(count);
}

function updateAlertIndicator() {
  const unread = state.unreadAlertCount;
  const description = unread ? `${alertCountLabel(unread)} cảnh báo chưa đọc` : 'Không có cảnh báo chưa đọc';
  document.querySelectorAll('.notification-button, .nav-link[data-page="alerts"], .mobile-nav-link[data-page="alerts"]').forEach((button) => {
    button.setAttribute('aria-label', `Cảnh báo: ${description}`);
    button.setAttribute('title', description);
    let badge = button.querySelector('b');
    if (!unread) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('b');
      badge.className = button.classList.contains('nav-link') ? 'nav-count' : '';
      button.appendChild(badge);
    }
    badge.textContent = alertCountLabel(unread);
    badge.setAttribute('aria-hidden', 'true');
  });
}

async function refreshUnreadAlertCount({ force = false } = {}) {
  if (!state.accessToken || state.role !== 'parent') return;
  if (alertRefreshPromise && !force) return alertRefreshPromise;
  const sequence = ++alertRefreshSequence;
  const request = (async () => {
    const result = await api('/alerts?is_read=false&limit=200');
    // Ignore a previous session or a response superseded by marking alerts read.
    if (sequence !== alertRefreshSequence || !state.accessToken || state.role !== 'parent') return;
    state.unreadAlertCount = (result.data || []).length;
    updateAlertIndicator();
  })();
  alertRefreshPromise = request;
  try {
    await request;
  } finally {
    if (alertRefreshPromise === request) alertRefreshPromise = null;
  }
}

function refreshAlertIndicatorInBackground() {
  if (document.hidden) return;
  // Keep the last known count on a failed request; the next refresh retries.
  return Promise.allSettled([refreshUnreadAlertCount(), refreshVisibleAlerts()]);
}

function refreshVisibleAlerts() {
  if (!state.accessToken || state.role !== 'parent' || state.page !== 'alerts') return;
  if (alertListRefreshPromise) return alertListRefreshPromise;
  const content = document.querySelector('#page-content');
  if (!content?.querySelector('.alerts-card') || content.alertsView?.pending) return;
  const request = renderAlerts(content, { background: true });
  alertListRefreshPromise = request;
  return request.finally(() => {
    if (alertListRefreshPromise === request) alertListRefreshPromise = null;
  });
}

function stopAlertPolling() {
  window.clearInterval(alertRefreshTimer);
  alertRefreshTimer = null;
  alertRefreshPromise = null;
  alertListRefreshPromise = null;
  alertRefreshSequence += 1;
}

function startAlertPolling() {
  stopAlertPolling();
  if (!state.accessToken || state.role !== 'parent') return;
  refreshAlertIndicatorInBackground();
  alertRefreshTimer = window.setInterval(refreshAlertIndicatorInBackground, 5_000);
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

function paginationMarkup(scope, result, label) {
  const total = Math.max(0, Number(result.total) || 0);
  const limit = Math.max(1, Number(result.limit) || 25);
  const offset = Math.max(0, Number(result.offset) || 0);
  const count = Array.isArray(result.data) ? result.data.length : 0;
  const start = count ? offset + 1 : 0;
  const end = offset + count;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  return `<nav class="pagination" aria-label="Phân trang ${escapeHtml(label)}">
    <button class="btn btn-secondary btn-sm" data-action="server-page" data-scope="${scope}" data-offset="${Math.max(0, offset - limit)}" ${offset === 0 ? 'disabled' : ''}>Trước</button>
    <span>Trang ${page}/${pages} · ${start}–${end} / ${total}</span>
    <button class="btn btn-secondary btn-sm" data-action="server-page" data-scope="${scope}" data-offset="${offset + limit}" ${end >= total ? 'disabled' : ''}>Sau</button>
  </nav>`;
}

async function api(path, options = {}, retry = true) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const requestAccessToken = !options.noAuth ? state.accessToken : '';
  if (requestAccessToken) {
    headers.Authorization = `Bearer ${requestAccessToken}`;
  }
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers,
      body:
        options.body !== undefined && !(options.body instanceof FormData)
          ? JSON.stringify(options.body)
          : options.body,
    });
    updateConnectionIndicator([502, 503, 504].includes(response.status) ? 'offline' : 'online');
  } catch (error) {
    updateConnectionIndicator('offline');
    const connectionError = new Error('Không thể kết nối tới Backend. Hãy kiểm tra Backend và Cloudflare Tunnel.');
    connectionError.cause = error;
    throw connectionError;
  }
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { message: await response.text() };

  if (response.status === 401 && retry && !options.noAuth && state.refreshToken && !path.includes('/auth/refresh')) {
    // Một request khác có thể vừa xoay token trong lúc request này còn đang bay.
    // Khi đó chỉ cần thử lại bằng access token mới, không tiêu thụ refresh token lần nữa.
    if (requestAccessToken && requestAccessToken !== state.accessToken) {
      return api(path, options, false);
    }
    const refreshed = await refreshSession();
    if (refreshed) return api(path, options, false);
  }
  if (!response.ok) {
    const error = new Error(payload.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function refreshSession() {
  if (refreshPromise) return refreshPromise;
  const refreshTokenAtStart = state.refreshToken;
  if (!refreshTokenAtStart) return false;

  refreshPromise = (async () => {
    try {
      const result = await api(
        '/auth/refresh',
        { method: 'POST', body: { refreshToken: refreshTokenAtStart }, noAuth: true },
        false
      );
      // Không khôi phục một phiên đã bị người dùng chủ động đăng xuất trong lúc refresh.
      if (state.refreshToken !== refreshTokenAtStart) return false;
      saveSession(result);
      return true;
    } catch {
      if (state.refreshToken === refreshTokenAtStart) {
        clearSession();
        renderAuth('login');
      }
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function saveSession(tokens) {
  state.accessToken = tokens.accessToken;
  state.refreshToken = tokens.refreshToken;
  state.userId = decodeJwt(tokens.accessToken).user_id || null;
  sessionStorage.setItem('lm_access_token', state.accessToken);
  sessionStorage.setItem('lm_refresh_token', state.refreshToken);
}

function stopScreenshotPolling() {
  clearTimeout(screenshotRefreshTimer);
  screenshotRefreshTimer = null;
}

function clearSession() {
  stopScreenshotPolling();
  stopBreakReminderPolling();
  activityRenderVersion += 1;
  stopAlertPolling();
  stopFaceCamera();
  modalRoot.innerHTML = '';
  app.inert = false;
  toastRoot.innerHTML = '';
  modalReturnFocus = null;
  state.policyRenderVersion = (state.policyRenderVersion || 0) + 1;
  Object.assign(state, {
    accessToken: '',
    refreshToken: '',
    role: '',
    userId: null,
    children: [],
    devices: [],
    alerts: [],
    unreadAlertCount: 0,
    analyses: [],
    appLogs: [],
    webLogs: [],
    screenshotRows: [],
    screenshotDevices: [],
    screenshotSignature: null,
    screenshotPollError: false,
    screenshotControlOperation: null,
    usageSummary: emptyUsageSummary(),
    adminStats: null,
    adminUsers: [],
    adminAuditLogs: [],
    pushTokens: [],
    faceChallenge: '',
    faceRequiredFrames: 3,
    adminUserFilter: {},
    adminUserOffset: 0,
    blacklistSearch: '',
    blacklistOffset: 0,
    auditFilter: {},
    auditOffset: 0,
    activityTab: 'apps',
    activityOffset: 0,
    activityViewRows: [],
    activityFilter: {},
    alertFilter: {},
    overviewChildId: '',
    selectedChildId: null,
    selectedDeviceId: null,
    categoryPolicies: {},
    policyDrafts: {},
    policyBaselinesByChild: {},
    policyPendingByChild: {},
    policyDataVersions: {},
    policySaveErrors: {},
    connectionStatus: 'checking',
    lastApiAt: null,
    parentLoadErrors: [],
    chat: INITIAL_CHAT.map((message) => ({ ...message })),
    sidebarOpen: false,
    userMenuOpen: false,
    agentSecret: '',
    agentEndpoint: 'heartbeat',
  });
  sessionStorage.removeItem('lm_access_token');
  sessionStorage.removeItem('lm_refresh_token');
  sessionStorage.removeItem('lm_role');
}

function stopFaceCamera() {
  if (state.faceStream) {
    state.faceStream.getTracks().forEach((track) => track.stop());
    state.faceStream = null;
  }
}

function toast(title, message = '', type = 'success') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  node.setAttribute('aria-atomic', 'true');
  node.innerHTML = `
    <div class="toast-icon">${type === 'error' ? '!' : '✓'}</div>
    <div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(message)}</small></div>
    <button aria-label="Đóng">×</button>`;
  node.querySelector('button').onclick = () => node.remove();
  toastRoot.appendChild(node);
  setTimeout(() => node.remove(), 4800);
}

function showModal(title, subtitle, body, { initialFocus } = {}) {
  if (deviceModalDismissBlocked()) return;
  if (!modalRoot.firstElementChild) modalReturnFocus = document.activeElement;
  app.inert = true;
  const describedBy = subtitle ? ' aria-describedby="modal-description"' : '';
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"${describedBy} tabindex="-1">
        <header class="modal-head">
          <div><h2 id="modal-title">${escapeHtml(title)}</h2>${subtitle ? `<p id="modal-description">${escapeHtml(subtitle)}</p>` : ''}</div>
          <button class="modal-close" data-action="close-modal" aria-label="Đóng">×</button>
        </header>
        <div class="modal-body">${body}</div>
      </section>
    </div>`;
  const backdrop = modalRoot.querySelector('.modal-backdrop');
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal();
  });
  requestAnimationFrame(() => {
    const modal = modalRoot.querySelector('.modal');
    const firstControl = (initialFocus && modal?.querySelector(initialFocus))
      || modal?.querySelector('[autofocus], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
    (firstControl || modal)?.focus();
  });
}

function closeModal() {
  if (deviceModalDismissBlocked()) return;
  const returnTarget = modalReturnFocus?.isConnected ? modalReturnFocus
    : modalRoot.querySelector('#secret-value') ? document.querySelector('[data-action="add-device"]') : modalReturnFocus;
  modalRoot.innerHTML = '';
  app.inert = false;
  modalReturnFocus = null;
  if (returnTarget && returnTarget.isConnected && typeof returnTarget.focus === 'function') {
    requestAnimationFrame(() => returnTarget.focus());
  }
}

function ensureControlId(control, prefix = 'field') {
  if (!control.id) control.id = `${prefix}-${++accessibleControlSequence}`;
  return control.id;
}

function enhanceFormAccessibility(root) {
  if (!root?.querySelectorAll) return;

  root.querySelectorAll('button[title]:not([aria-label])').forEach((button) => {
    button.setAttribute('aria-label', button.title);
  });
  root.querySelectorAll('svg:not([aria-label])').forEach((icon) => {
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
  });
  root.querySelectorAll('table').forEach((table) => {
    if (!table.getAttribute('aria-label')) {
      table.setAttribute('aria-label', pageTitles[state.page]?.[0] || 'Bảng dữ liệu SafeNest');
    }
    table.querySelectorAll('th:not([scope])').forEach((heading) => heading.setAttribute('scope', 'col'));
  });
  root.querySelectorAll('.tabs').forEach((tabList) => {
    tabList.setAttribute('role', 'tablist');
    tabList.querySelectorAll('.tab').forEach((tab) => {
      const selected = tab.classList.contains('active');
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
  });

  root.querySelectorAll('.field').forEach((field) => {
    const label = field.querySelector('label');
    const control = field.querySelector('input:not([type="hidden"]), select, textarea');
    if (!label || !control || label.contains(control)) return;
    label.htmlFor = ensureControlId(control);

    const hint = field.querySelector('small');
    if (hint) {
      if (!hint.id) hint.id = `${control.id}-hint`;
      if (!control.getAttribute('aria-describedby')) control.setAttribute('aria-describedby', hint.id);
    }
  });

  root.querySelectorAll('.switch-row').forEach((row) => {
    const control = row.querySelector('input[type="checkbox"]');
    const title = row.querySelector('.switch-copy strong');
    const hint = row.querySelector('.switch-copy small');
    if (!control || !title) return;
    ensureControlId(control, 'switch');
    if (!title.id) title.id = `${control.id}-label`;
    control.setAttribute('aria-labelledby', title.id);
    if (hint) {
      if (!hint.id) hint.id = `${control.id}-hint`;
      if (!control.closest('#policy-form') || !control.getAttribute('aria-describedby')?.trim()) {
        control.setAttribute('aria-describedby', hint.id);
      }
    }
  });
}

function emptyState(symbol, title, text, action = '') {
  return `<div class="empty-state"><div class="empty-icon">${symbol}</div><h3>${escapeHtml(
    title
  )}</h3><p>${escapeHtml(text)}</p>${action}</div>`;
}

function loading() {
  return '<div class="loading"><div class="spinner" aria-label="Đang tải"></div></div>';
}

function renderAuth(mode = 'login') {
  stopFaceCamera();
  const params = new URLSearchParams(location.search);
  if (location.pathname.includes('verify') || params.get('token') && location.pathname.includes('verify')) {
    mode = 'verify';
  } else if (location.pathname.includes('reset-password')) {
    mode = 'reset';
  }
  const forms = {
    login: `
      <form id="login-form" class="form-grid">
        <div class="field full"><label>Email</label><input class="input" type="email" name="email" required autocomplete="email" placeholder="parent@example.com"></div>
        <div class="field full"><label>Mật khẩu</label><input class="input" type="password" name="password" required autocomplete="current-password" placeholder="••••••••••"></div>
        <div class="form-actions between field full"><button class="link-button" type="button" data-auth-mode="forgot">Quên mật khẩu?</button><button class="btn" type="submit">Đăng nhập an toàn</button></div>
      </form>`,
    register: `
      <form id="register-form" class="form-grid">
        <div class="field full"><label>Họ và tên</label><input class="input" name="name" maxlength="100" required placeholder="Nguyễn Minh Anh"></div>
        <div class="field full"><label>Email</label><input class="input" type="email" name="email" required placeholder="parent@example.com"></div>
        <div class="field full"><label>Mật khẩu</label><input class="input" type="password" name="password" required minlength="8" placeholder="Tối thiểu 8 ký tự"><small>Cần chữ hoa, số và ký tự đặc biệt.</small></div>
        <div class="form-actions field full"><button class="btn" type="submit">Tạo tài khoản</button></div>
      </form>`,
    forgot: `
      <form id="forgot-form" class="form-grid">
        <div class="field full"><label>Email đã đăng ký</label><input class="input" type="email" name="email" required placeholder="parent@example.com"></div>
        <div class="form-actions between field full"><button class="link-button" type="button" data-auth-mode="login">Quay lại</button><button class="btn" type="submit">Gửi liên kết đặt lại</button></div>
      </form>`,
    verify: `
      <form id="verify-form" class="form-grid">
        <div class="field full"><label>Mã xác minh</label><textarea class="textarea" name="token" required placeholder="Dán mã nhận được từ email">${escapeHtml(params.get('token') || '')}</textarea></div>
        <div class="form-actions between field full"><button class="link-button" type="button" data-auth-mode="resend">Gửi lại email</button><button class="btn" type="submit">Xác minh email</button></div>
      </form>`,
    resend: `
      <form id="resend-form" class="form-grid">
        <div class="field full"><label>Email</label><input class="input" type="email" name="email" required></div>
        <div class="field full"><label>Mật khẩu</label><input class="input" type="password" name="password" required></div>
        <div class="form-actions between field full"><button class="link-button" type="button" data-auth-mode="login">Quay lại</button><button class="btn" type="submit">Gửi lại xác minh</button></div>
      </form>`,
    reset: `
      <form id="reset-form" class="form-grid">
        <input type="hidden" name="token" value="${escapeHtml(params.get('token') || '')}">
        <div class="field full"><label>Mật khẩu mới</label><input class="input" type="password" name="newPassword" required minlength="8"><small>Cần chữ hoa, số và ký tự đặc biệt.</small></div>
        <div class="form-actions field full"><button class="btn" type="submit">Đặt lại mật khẩu</button></div>
      </form>`,
  };
  const heading = {
    login: ['Chào mừng bạn trở lại', 'Đăng nhập để theo dõi nhịp sống số của gia đình.'],
    register: ['Bắt đầu cùng SafeNest', 'Tạo một không gian số lành mạnh hơn cho gia đình.'],
    forgot: ['Khôi phục quyền truy cập', 'Hệ thống sẽ gửi liên kết nếu email tồn tại.'],
    verify: ['Xác minh email', 'Hoàn tất bước cuối để bảo vệ tài khoản.'],
    resend: ['Gửi lại mã xác minh', 'Xác nhận thông tin để nhận email mới.'],
    reset: ['Tạo mật khẩu mới', 'Mọi phiên đăng nhập cũ sẽ được thu hồi.'],
  }[mode];
  document.title = `${heading[0]} — SafeNest`;

  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-story">
        ${brandMarkup()}
        <div class="auth-message">
          <p class="eyebrow">Nuôi dưỡng thói quen số lành mạnh</p>
          <h1>Thấu hiểu để <em>đồng hành.</em></h1>
          <p>SafeNest chuyển hoạt động trên thiết bị thành những tín hiệu rõ ràng, giúp phụ huynh trò chuyện đúng lúc và thiết lập giới hạn có chủ đích.</p>
        </div>
        <div class="trust-row"><span><i class="trust-dot"></i>RLS theo từng gia đình</span><span><i class="trust-dot"></i>Secret thiết bị một lần</span><span><i class="trust-dot"></i>AI có kiểm soát</span></div>
      </section>
      <section class="auth-panel" id="page-content" tabindex="-1">
        <div class="auth-card">
          <p class="eyebrow">Bảng điều khiển phụ huynh</p>
          <h2>${heading[0]}</h2><p>${heading[1]}</p>
          ${
            ['login', 'register'].includes(mode)
              ? `<div class="auth-tabs"><button class="auth-tab ${
                  mode === 'login' ? 'active' : ''
                }" data-auth-mode="login">Đăng nhập</button><button class="auth-tab ${
                  mode === 'register' ? 'active' : ''
                }" data-auth-mode="register">Đăng ký</button></div>`
              : ''
          }
          ${forms[mode]}
        </div>
      </section>
    </main>`;
}

async function renderAdminFaceVerification(challengeResult) {
  stopFaceCamera();
  document.title = 'Xác minh khuôn mặt — SafeNest';
  state.faceChallenge = challengeResult.faceChallenge;
  state.faceRequiredFrames = challengeResult.requiredFrames || 3;
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-story">
        ${brandMarkup()}
        <div class="auth-message">
          <p class="eyebrow">Bảo vệ quyền quản trị</p>
          <h1>Mật khẩu đúng.<br><em>Xác minh khuôn mặt.</em></h1>
          <p>SafeNest chỉ cấp phiên quản trị khi mô hình FaceNet xác nhận nhãn khuôn mặt là “admin” và nhãn này vẫn khớp role trong cơ sở dữ liệu.</p>
        </div>
        <div class="trust-row"><span><i class="trust-dot"></i>Challenge dùng một lần</span><span><i class="trust-dot"></i>Không lưu ảnh khuôn mặt</span><span><i class="trust-dot"></i>JWT chưa được cấp</span></div>
      </section>
      <section class="auth-panel" id="page-content" tabindex="-1">
        <div class="auth-card face-auth-card">
          <p class="eyebrow">Bước xác thực thứ hai</p>
          <h2>Đưa khuôn mặt vào khung hình</h2>
          <p>Giữ khuôn mặt thẳng, đủ sáng và không có người khác trong ảnh. Hệ thống sẽ chụp ${state.faceRequiredFrames} khung hình liên tiếp.</p>
          <div class="face-camera">
            <video id="face-video" autoplay muted playsinline></video>
            <div class="face-guide" aria-hidden="true"></div>
            <div class="face-camera-status" id="face-camera-status">Đang yêu cầu quyền camera…</div>
          </div>
          <canvas id="face-canvas" class="hidden"></canvas>
          <div class="form-actions between">
            <button class="link-button" type="button" data-action="cancel-face-auth">Hủy và đăng nhập lại</button>
            <button class="btn" type="button" data-action="verify-admin-face" disabled>Xác minh khuôn mặt</button>
          </div>
          <p class="face-privacy">Ảnh chỉ được giữ tạm trong bộ nhớ để suy luận và bị xóa ngay sau khi có kết quả.</p>
        </div>
      </section>
    </main>`;

  const status = document.querySelector('#face-camera-status');
  const verifyButton = document.querySelector('[data-action="verify-admin-face"]');
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Trình duyệt không hỗ trợ camera');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });
    state.faceStream = stream;
    const video = document.querySelector('#face-video');
    video.srcObject = stream;
    await video.play();
    status.textContent = 'Camera đã sẵn sàng';
    verifyButton.disabled = false;
  } catch (error) {
    status.textContent = 'Không thể truy cập camera';
    toast('Cần quyền sử dụng camera', error.message, 'error');
  }
}

async function captureAdminFaceFrames() {
  const video = document.querySelector('#face-video');
  const canvas = document.querySelector('#face-canvas');
  if (!video || !canvas || video.readyState < 2) {
    throw new Error('Camera chưa sẵn sàng');
  }
  const width = Math.min(640, video.videoWidth || 640);
  const height = Math.round(width * ((video.videoHeight || 480) / (video.videoWidth || 640)));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  const frames = [];
  for (let index = 0; index < state.faceRequiredFrames; index += 1) {
    context.drawImage(video, 0, 0, width, height);
    frames.push(canvas.toDataURL('image/jpeg', 0.78));
    if (index < state.faceRequiredFrames - 1) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  return frames;
}

async function completeLogin(result) {
  saveSession(result);
  await detectRole();
  state.page = state.role === 'admin' ? 'admin-overview' : 'overview';
  renderShell();
  startAlertPolling();
  await navigate(state.page);
  toast('Đăng nhập thành công', 'Chào mừng bạn trở lại SafeNest.');
}

function brandMarkup() {
  return `<div class="brand"><span class="brand-mark">${icons.policy}</span><span class="brand-copy">SafeNest<small>Laptop Monitor</small></span></div>`;
}

function renderStartupError(error) {
  document.title = 'Không thể kết nối — SafeNest';
  app.innerHTML = `<main class="startup-error-shell" id="page-content" tabindex="-1"><section class="startup-error-card">${brandMarkup()}<div class="startup-error-icon">!</div><p class="eyebrow">Kết nối tạm thời gián đoạn</p><h1>Chưa thể mở Dashboard</h1><p>SafeNest không thể xác định không gian tài khoản lúc này. Quyền của bạn không bị thay đổi; hãy kiểm tra Backend rồi thử lại.</p><div class="startup-error-detail">${escapeHtml(localizeError(error?.message || 'Máy chủ không phản hồi'))}</div><div class="form-actions"><button class="btn btn-secondary" data-action="logout">Đăng xuất</button><button class="btn" data-action="retry-initialize">Thử kết nối lại</button></div></section></main>`;
}

async function initialize() {
  if (!state.accessToken) return renderAuth();
  state.userId = decodeJwt(state.accessToken).user_id || null;
  try {
    await detectRole();
    renderShell();
    startAlertPolling();
    navigate(state.page);
  } catch (error) {
    if (error.status === 401) {
      clearSession();
      renderAuth();
    } else {
      renderStartupError(error);
    }
  }
}

async function detectRole() {
  try {
    state.adminStats = await api('/admin/stats');
    state.role = 'admin';
  } catch (error) {
    if (error.status !== 403) throw error;
    state.role = 'parent';
  }
  sessionStorage.setItem('lm_role', state.role);
}

function navItem(page, label, icon, count = 0) {
  const active = state.page === page;
  return `<li><button class="nav-link ${active ? 'active' : ''}" data-page="${page}" ${active ? 'aria-current="page"' : ''}>${
    icons[icon]
  }<span>${label}</span>${count ? `<b class="nav-count" aria-label="${count} mục mới">${alertCountLabel(count)}</b>` : ''}</button></li>`;
}

function mobileNavItem(page, label, icon, count = 0) {
  const active = state.page === page;
  return `<button class="mobile-nav-link ${active ? 'active' : ''}" data-page="${page}" ${active ? 'aria-current="page"' : ''}>${icons[icon]}<span>${label}</span>${count ? `<b>${alertCountLabel(count)}</b>` : ''}</button>`;
}

function currentDateLabel(date = new Date()) {
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function renderShell() {
  const parentNav = [
    ['overview', 'Tổng quan', 'home'],
    ['children', 'Hồ sơ trẻ', 'child'],
    ['devices', 'Thiết bị', 'device'],
    ['controls', 'Điều khiển thiết bị', 'control'],
    ['policies', 'Chính sách', 'policy'],
    ['activity', 'Hoạt động', 'activity'],
    ['alerts', 'Cảnh báo', 'alert'],
    ['ai', 'Trung tâm AI', 'ai'],
  ];
  const adminNav = [
    ['admin-overview', 'Tổng quan hệ thống', 'admin'],
    ['users', 'Quản lý tài khoản', 'child'],
    ['blacklist', 'Danh sách chặn', 'policy'],
    ['audit', 'Nhật ký kiểm toán', 'activity'],
  ];
  const nav = state.role === 'admin' ? adminNav : parentNav;
  const mobileNav = state.role === 'admin'
    ? [adminNav[0], adminNav[1], adminNav[3], ['account', 'Tài khoản', 'account']]
    : ['overview', 'activity', 'alerts', 'controls'].map((page) => {
      const item = parentNav.find(([itemPage]) => itemPage === page);
      return page === 'controls' ? [item[0], 'Điều khiển', item[2]] : item;
    });
  const systemPages = ['account', 'api-lab'];
  const unreadAlerts = state.unreadAlertCount;
  const connectionLabel = state.connectionStatus === 'online'
    ? 'Backend đã kết nối'
    : state.connectionStatus === 'offline'
      ? 'Mất kết nối Backend'
      : 'Đang kiểm tra';
  if (state.role === 'admin' && !adminNav.some(([page]) => page === state.page) && !systemPages.includes(state.page)) state.page = 'admin-overview';
  if (state.role === 'parent' && !parentNav.some(([page]) => page === state.page) && !systemPages.includes(state.page)) state.page = 'overview';
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar ${state.sidebarOpen ? 'open' : ''}" id="sidebar-navigation">
        <div class="sidebar-brand">${brandMarkup()}</div>
        <div class="workspace-card">
          <span class="workspace-icon">${state.role === 'admin' ? icons.admin : icons.home}</span>
          <span><small>Không gian hiện tại</small><strong>${state.role === 'admin' ? 'Quản trị hệ thống' : 'Gia đình của bạn'}</strong></span>
        </div>
        <p class="side-section">${state.role === 'admin' ? 'Điều hành' : 'Gia đình'}</p>
        <nav aria-label="Điều hướng chính"><ul class="nav-list">${nav.map((item) => navItem(...item, item[0] === 'alerts' ? unreadAlerts : 0)).join('')}</ul></nav>
        <p class="side-section">Công cụ & bảo mật</p>
        <nav aria-label="Công cụ và bảo mật"><ul class="nav-list">
          ${navItem('account', 'Tài khoản', 'account')}
          ${navItem('api-lab', 'Công cụ Agent', 'lab')}
        </ul></nav>
        <div class="sidebar-footer">
          <div class="security-note"><span class="security-note-icon">${icons.policy}</span><span><strong>Kết nối được bảo vệ</strong><small>Phiên đăng nhập và Device Secret chỉ được giữ tạm thời.</small></span></div>
          <button class="sidebar-profile" data-page="account"><span class="sidebar-avatar">${state.role === 'admin' ? 'AD' : 'PH'}</span><span><strong>${state.role === 'admin' ? 'Quản trị viên' : 'Phụ huynh'}</strong><small>Tài khoản & bảo mật</small></span><span aria-hidden="true">›</span></button>
        </div>
      </aside>
      ${state.sidebarOpen ? '<button type="button" class="mobile-overlay" data-action="toggle-sidebar" aria-label="Đóng menu điều hướng"></button>' : ''}
      <div class="main-shell">
        <header class="topbar">
          <button class="btn btn-secondary btn-icon menu-toggle" data-action="toggle-sidebar" aria-label="${state.sidebarOpen ? 'Đóng menu' : 'Mở menu'}" aria-controls="sidebar-navigation" aria-expanded="${state.sidebarOpen}">☰</button>
          <div class="topbar-context"><p>${state.role === 'admin' ? 'Trung tâm điều hành' : 'Không gian gia đình'}</p><strong id="topbar-title">${escapeHtml(pageTitles[state.page]?.[0] || 'SafeNest')}</strong></div>
          <div class="topbar-actions">
            <button class="topbar-shortcut" ${state.role === 'admin' ? 'data-page="api-lab"' : 'data-action="agent-guide"'}>${icons.lab}<span>${state.role === 'admin' ? 'Agent API' : 'Cài Agent'}</span></button>
            <span id="connection-pill" class="connection-pill ${state.connectionStatus}" title="Trạng thái kết nối API"><i></i><span>${connectionLabel}</span></span>
            ${state.role === 'parent' ? `<button class="notification-button" data-page="alerts" aria-label="Mở cảnh báo" title="Cảnh báo chưa đọc">${icons.alert}${unreadAlerts ? `<b>${alertCountLabel(unreadAlerts)}</b>` : ''}</button>` : ''}
            <div class="user-menu">
              <button class="avatar" data-action="toggle-user-menu" aria-label="Mở menu tài khoản" aria-controls="user-popover" aria-expanded="${state.userMenuOpen}">${state.role === 'admin' ? 'AD' : 'PH'}</button>
              <div class="user-popover ${state.userMenuOpen ? '' : 'hidden'}" id="user-popover">
                <div class="identity"><strong>${state.role === 'admin' ? 'Quản trị viên' : 'Phụ huynh'}</strong><small>Mã người dùng #${escapeHtml(state.userId || '—')}</small></div>
                <button class="popover-button" data-page="account">Tài khoản & bảo mật</button>
                <button class="popover-button" data-action="logout">Đăng xuất</button>
              </div>
            </div>
          </div>
        </header>
        <main id="page-content" class="content" tabindex="-1"></main>
        <nav class="mobile-quick-nav" aria-label="Điều hướng nhanh">${mobileNav.map((item) => mobileNavItem(...item, item[0] === 'alerts' ? unreadAlerts : 0)).join('')}</nav>
      </div>
    </div>`;
  updateAlertIndicator();
}

async function navigate(page) {
  stopScreenshotPolling();
  stopBreakReminderPolling();
  activityRenderVersion += 1;
  state.page = page;
  state.sidebarOpen = false;
  state.userMenuOpen = false;
  location.hash = page;
  renderShell();
  if (state.page !== page) {
    page = state.page;
    location.hash = page;
  }
  const content = document.querySelector('#page-content');
  content.innerHTML = page === 'devices'
    ? '<div class="loading devices-loading" role="status"><div class="spinner" aria-hidden="true"></div><p>Đang tải thiết bị…</p></div>'
    : page === 'controls'
      ? '<div class="loading controls-loading" role="status"><div class="spinner" aria-hidden="true"></div><p>Đang tải điều khiển thiết bị...</p></div>'
      : page === 'policies'
        ? '<div class="loading policies-loading" role="status" aria-live="polite" aria-atomic="true"><div class="spinner" aria-hidden="true"></div><p>Đang tải chính sách...</p></div>'
      : loading();
  content.setAttribute('aria-busy', 'true');
  document.querySelector('#topbar-title').textContent = pageTitles[page]?.[0] || 'SafeNest';
  document.title = `${pageTitles[page]?.[0] || 'Dashboard'} — SafeNest`;
  try {
    const renderers = {
      overview: renderOverview,
      children: renderChildren,
      devices: renderDevices,
      controls: renderDeviceControls,
      policies: renderPolicies,
      activity: renderActivity,
      alerts: renderAlerts,
      ai: renderAI,
      account: renderAccount,
      'admin-overview': renderAdminOverview,
      users: renderUsers,
      blacklist: renderBlacklist,
      audit: renderAudit,
      'api-lab': renderApiLab,
    };
    await (renderers[page] || renderOverview)(content);
  } catch (error) {
    content.innerHTML = emptyState('!', 'Không thể tải dữ liệu', localizeError(error.message), '<button class="btn" data-action="reload-page">Thử lại</button>');
  } finally {
    if (document.body.contains(content)) {
      content.removeAttribute('aria-busy');
      window.scrollTo({ top: 0, behavior: 'auto' });
      requestAnimationFrame(() => content.focus({ preventScroll: true }));
    }
  }
}

function pageHead(page, actions = '') {
  const [title, subtitle] = pageTitles[page];
  const pageClass = page === 'policies' ? ' page-head-policies' : '';
  const context = page === 'policies' ? '' : `<div class="page-context"><p class="eyebrow">${state.role === 'admin' ? 'Điều hành hệ thống' : 'Đồng hành cùng gia đình'}</p><span>${escapeHtml(currentDateLabel())}</span></div>`;
  return `<header class="page-head${pageClass}"><div class="page-head-copy">${context}<h1>${title}</h1><p>${subtitle}</p></div><div class="head-actions">${actions}</div></header>`;
}

const sectionVisuals = {
  children: {
    src: '/assets/section-child-profiles.jpg',
    alt: 'Phụ huynh cùng trẻ tạo hồ sơ số an toàn',
    eyebrow: 'Hồ sơ gia đình',
    title: 'Mỗi trẻ có một không gian đồng hành riêng.',
    text: 'Liên kết đúng thiết bị, chính sách và dữ liệu hoạt động để cả gia đình luôn có một góc nhìn rõ ràng.',
  },
  devices: {
    src: '/assets/section-managed-devices.jpg',
    alt: 'Laptop học tập được kết nối an toàn với hệ thống gia đình',
    eyebrow: 'Kết nối an toàn',
    title: 'Quản lý mọi laptop từ một nơi duy nhất.',
    text: 'Xem lần liên lạc gần nhất và quản lý mã kết nối của từng thiết bị. Agent là phần mềm được cài trên máy của trẻ.',
  },
  activity: {
    src: '/assets/section-digital-activity.jpg',
    alt: 'Bảng phân tích hoạt động ứng dụng và website trên laptop',
    eyebrow: 'Góc nhìn cân bằng',
    title: 'Hiểu thói quen số mà không phán xét.',
    text: 'Xem ứng dụng, website và thời lượng theo từng thiết bị để bắt đầu những cuộc trò chuyện tích cực.',
  },
  alerts: {
    src: '/assets/section-safety-alerts.jpg',
    alt: 'Trẻ ngồi đúng tư thế và khoảng cách khi sử dụng laptop',
    eyebrow: 'Tín hiệu an toàn',
    title: 'Ưu tiên những điều gia đình cần quan tâm.',
    text: 'Tập trung vào các cảnh báo về tư thế, khoảng cách mắt, thời gian và nội dung cần được xem xét.',
  },
  ai: {
    src: '/assets/section-ai-insights.jpg',
    alt: 'Trợ lý AI biến dữ liệu sức khỏe số thành gợi ý cho gia đình',
    eyebrow: 'Cố vấn SafeNest',
    title: 'Biến dữ liệu thành một cuộc trò chuyện tốt hơn.',
    text: 'AI tổng hợp tín hiệu hoạt động và đưa ra gợi ý dễ hiểu, giúp phụ huynh chủ động đồng hành cùng con.',
  },
};

function sectionVisual(page, extra = '') {
  const visual = sectionVisuals[page];
  if (!visual) return '';
  const headingId = `section-visual-${page}-title`;
  return `<section class="section-visual section-visual-${page}" aria-labelledby="${headingId}"><div class="section-visual-copy"><p class="eyebrow">${escapeHtml(visual.eyebrow)}</p><h2 id="${headingId}">${escapeHtml(visual.title)}</h2><p>${escapeHtml(visual.text)}</p>${extra ? `<div class="section-visual-extra">${extra}</div>` : ''}</div><figure class="section-visual-media"><img src="${escapeHtml(visual.src)}" alt="${escapeHtml(visual.alt)}" width="1200" height="800" loading="lazy" decoding="async"></figure></section>`;
}

const adminSectionContent = {
  users: {
    icon: icons.child,
    src: '/assets/admin-user-management.jpg',
    alt: 'Không gian quản trị tài khoản phụ huynh và hồ sơ gia đình an toàn',
    width: 1536,
    height: 1024,
    eyebrow: 'Quản trị danh tính',
    title: 'Tài khoản rõ trạng thái, thao tác có kiểm soát.',
    text: 'Tìm kiếm, phân quyền, xác minh và thu hồi phiên từ cùng một không gian quản trị.',
  },
  blacklist: {
    icon: icons.policy,
    src: '/assets/admin-domain-blacklist.jpg',
    alt: 'Lá chắn bảo vệ laptop gia đình khỏi các tên miền không an toàn',
    width: 1693,
    height: 929,
    eyebrow: 'Bảo vệ toàn hệ thống',
    title: 'Một danh sách chặn, đồng bộ đến mọi Agent.',
    text: 'Tên miền được kiểm tra định dạng tại Backend trước khi phân phối xuống các thiết bị đang quản lý.',
  },
  audit: {
    icon: icons.activity,
    src: '/assets/admin-audit-trail.jpg',
    alt: 'Dòng thời gian minh bạch của các sự kiện quản trị hệ thống',
    width: 1672,
    height: 941,
    eyebrow: 'Minh bạch vận hành',
    title: 'Mọi thay đổi nhạy cảm đều để lại dấu vết.',
    text: 'Theo dõi người thực hiện, đối tượng tác động, thời điểm, địa chỉ IP và metadata liên quan.',
  },
  'api-lab': {
    icon: icons.lab,
    eyebrow: 'Công cụ kỹ thuật',
    title: 'Kiểm thử Agent API trong một quy trình có cấu trúc.',
    text: 'Chọn endpoint, chuẩn bị payload và xem phản hồi mà không phải rời khỏi Dashboard quản trị.',
  },
};

function adminSectionIntro(page, stats = []) {
  const intro = adminSectionContent[page];
  if (!intro) return '';
  const headingId = `admin-intro-${page}-title`;
  const media = intro.src
    ? `<figure class="admin-intro-media"><img src="${escapeHtml(intro.src)}" alt="${escapeHtml(intro.alt)}" width="${intro.width}" height="${intro.height}" loading="lazy" decoding="async"></figure>`
    : '';
  return `<section class="admin-section-intro admin-section-intro-${page}" aria-labelledby="${headingId}"><div class="admin-intro-icon" aria-hidden="true">${intro.icon}</div><div class="admin-intro-copy"><p class="eyebrow">${escapeHtml(intro.eyebrow)}</p><h2 id="${headingId}">${escapeHtml(intro.title)}</h2><p>${escapeHtml(intro.text)}</p></div><div class="admin-intro-stats">${stats.map((item) => `<span class="admin-intro-stat"><b>${escapeHtml(item.value)}</b><small>${escapeHtml(item.label)}</small></span>`).join('')}</div>${media}</section>`;
}

async function loadParentCore(usageChildId = state.overviewChildId) {
  const overviewNow = new Date();
  const usageMonth = localMonthKey(overviewNow);
  const resources = [
    { key: 'children', label: 'hồ sơ trẻ', request: api('/children?limit=200'), pick: (value) => value || [] },
    { key: 'devices', label: 'thiết bị', request: api('/devices?limit=200'), pick: (value) => value.data || [] },
    { key: 'alerts', label: 'cảnh báo', request: api('/alerts?limit=200'), pick: (value) => value.data || [] },
    { key: 'analyses', label: 'phân tích AI', request: api('/ai-analysis?limit=50'), pick: (value) => value.data || [] },
    { key: 'appLogs', label: 'hoạt động ứng dụng', request: api('/logs/app?limit=200'), pick: (value) => value.data || [] },
    { key: 'webLogs', label: 'hoạt động website', request: api('/logs/web?limit=200'), pick: (value) => value.data || [] },
    { key: 'usageSummary', label: `tổng hợp sử dụng tháng ${usageMonth}`, request: loadOverviewUsageSummary(overviewNow, usageChildId), pick: (value) => value },
  ];
  const [results, unreadError] = await Promise.all([
    Promise.allSettled(resources.map((resource) => resource.request)),
    refreshUnreadAlertCount().then(() => null, (error) => error),
  ]);
  state.parentLoadErrors = unreadError ? ['cảnh báo chưa đọc'] : [];
  results.forEach((result, index) => {
    const resource = resources[index];
    if (result.status === 'fulfilled') {
      if (resource.key === 'usageSummary' && String(state.overviewChildId) !== String(usageChildId)) return;
      state[resource.key] = resource.pick(result.value);
    } else {
      state.parentLoadErrors.push(resource.label);
    }
  });
  if (state.overviewChildId && !state.children.some((item) => String(item.child_id) === String(state.overviewChildId))) {
    state.overviewChildId = '';
  }
  state.selectedChildId = reconcileSelectedId(state.selectedChildId, state.children, 'child_id');
  state.selectedDeviceId = reconcileSelectedId(state.selectedDeviceId, state.devices, 'device_id');
  updateAlertIndicator();
}

function childName(id) {
  return state.children.find((item) => String(item.child_id) === String(id))?.name || `Trẻ #${id}`;
}

function deviceName(id) {
  return state.devices.find((item) => String(item.device_id) === String(id))?.device_name || `Thiết bị #${id}`;
}

async function renderOverview(content) {
  const renderSequence = ++overviewRenderSequence;
  const usageChildId = state.overviewChildId;
  await loadParentCore(usageChildId);
  if (renderSequence !== overviewRenderSequence || !document.body.contains(content) || state.page !== 'overview') return;
  const unread = state.unreadAlertCount;
  const usageSummary = state.usageSummary || emptyUsageSummary();
  const todayUsage = usageMetricParts(usageSummary.today_seconds);
  const monthUsage = usageMetricParts(usageSummary.month_total_seconds);
  const monthDays = usageDaysInMonth(usageSummary);
  const recentDays = usageRecentDays(usageSummary);
  const recentTotalSeconds = recentDays.reduce((sum, item) => sum + item.seconds, 0);
  const recentMaxSeconds = Math.max(...recentDays.map((item) => item.seconds), 1);
  const monthMaxSeconds = Math.max(...monthDays.map((item) => item.seconds), 1);
  const risky = state.analyses.filter((item) => ['high', 'critical'].includes(String(item.risk_level).toLowerCase())).length;
  const onlineDevices = state.devices.filter(isDeviceOnline).length;
  const usageScopeName = state.overviewChildId ? childName(state.overviewChildId) : 'Toàn gia đình';
  const hasActivity = usageSummary.month_total_seconds > 0 || state.appLogs.length + state.webLogs.length > 0;
  const setupSteps = [
    { done: state.children.length > 0, label: 'Tạo hồ sơ trẻ', page: 'children' },
    { done: state.devices.length > 0, label: 'Đăng ký thiết bị', page: 'devices' },
    { done: onlineDevices > 0, label: 'Kết nối Agent', page: 'devices' },
    { done: hasActivity, label: 'Nhận dữ liệu hoạt động', page: 'activity' },
  ];
  // Category shares still use recent app logs; usage totals and charts use the aggregate.
  const categories = state.appLogs.reduce((map, item) => {
    const key = item.category || 'unknown';
    map[key] = (map[key] || 0) + (Number(item.duration_seconds) || 0);
    return map;
  }, {});
  const categorySampleSeconds = Object.values(categories).reduce((sum, seconds) => sum + seconds, 0);
  const sortedCategories = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const loadErrors = state.parentLoadErrors;
  const usageUnavailable = loadErrors.some((label) => label.startsWith('tổng hợp sử dụng'));
  const alertsUnavailable = loadErrors.includes('cảnh báo');
  const unreadUnavailable = loadErrors.includes('cảnh báo chưa đọc');
  const activityUnavailable = loadErrors.includes('hoạt động ứng dụng') || loadErrors.includes('hoạt động website');
  const recentAlerts = state.alerts.filter((item) => !item.is_read).slice(0, 5);
  const recentActivity = [...state.appLogs.map((item) => ({ ...item, type: 'app', at: item.start_time, title: item.app_name })),
    ...state.webLogs.map((item) => ({ ...item, type: 'web', at: item.visit_time, title: websiteActivityTitle(item) }))]
    .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 6);
  const partialNotice = loadErrors.length
    ? `<div class="overview-notice" role="status"><strong>Một phần dữ liệu chưa cập nhật được</strong><p>Hãy chọn Làm mới để thử lại: ${escapeHtml(loadErrors.join(', '))}. Các danh sách đã tải trước đó được giữ lại nếu có.</p></div>`
    : '';
  const usageQualityNotice = usageSummary.ignored_segment_count > 0
    ? `<details class="usage-quality-note"><summary>Đã bỏ qua ${usageSummary.ignored_segment_count} đoạn thời gian bất thường</summary><p>Các đoạn có thể phát sinh khi máy khóa hoặc ngủ${usageSummary.max_valid_agent_segment_seconds ? ` và dài hơn ${duration(usageSummary.max_valid_agent_segment_seconds)}` : ''}. Bản ghi gốc vẫn được giữ nguyên để kiểm tra và đối chiếu.</p></details>`
    : '';
  const restoreScopeFocus = document.activeElement?.id === 'overview-child';
  const monthExpanded = content.querySelector('.overview-month')?.open;
  const weekDescription = recentDays.map((day) => `${day.label}: ${duration(day.seconds)}`).join('; ');
  const monthDescription = monthDays.map((day) => `Ngày ${day.label}: ${duration(day.seconds)}`).join('; ');

  content.innerHTML = `
    <div class="overview-page">
      <header class="overview-header">
        <div><h1>Tổng quan gia đình</h1><p>${escapeHtml(currentDateLabel())}</p></div>
        <button class="btn btn-secondary" data-action="refresh-overview">${icons.refresh} Làm mới</button>
      </header>
      ${partialNotice}
      <div class="overview-family-status" aria-label="Thiết bị và hồ sơ toàn gia đình">
        <p><strong>${loadErrors.includes('thiết bị') ? 'Chưa cập nhật được kết nối thiết bị' : onlineDevices ? `${onlineDevices} thiết bị đang trực tuyến` : state.devices.length ? 'Không có thiết bị đang trực tuyến' : 'Chưa có thiết bị kết nối'}</strong></p>
        <div class="overview-family-links">
          <button class="link-button" data-page="devices">${loadErrors.includes('thiết bị') ? 'Xem thiết bị' : `${state.devices.length} thiết bị`}</button>
          <button class="link-button" data-page="children">${loadErrors.includes('hồ sơ trẻ') ? 'Xem hồ sơ trẻ' : `${state.children.length} hồ sơ trẻ`}</button>
          <button class="link-button" data-page="policies">Điều chỉnh chính sách</button>
        </div>
      </div>
      <div class="overview-priority">
        <section class="overview-alerts" aria-labelledby="overview-alerts-title">
          <div class="overview-section-heading">
            <div><h2 id="overview-alerts-title">Cảnh báo cần chú ý</h2><p>Toàn gia đình · <strong class="overview-alert-count">${unreadUnavailable ? 'Chưa cập nhật được số chưa đọc' : `${unread} cảnh báo chưa đọc`}</strong></p></div>
            <button class="link-button" data-page="alerts">Xem tất cả cảnh báo</button>
          </div>
          ${alertsUnavailable ? '<p class="overview-inline-status" role="status">Chưa cập nhật được danh sách cảnh báo. Dữ liệu bên dưới, nếu có, là lần tải trước.</p>' : ''}
          ${recentAlerts.length ? `<ul class="overview-alert-list">${recentAlerts.map((item) => {
            const presentation = alertPresentation(item.alert_type);
            return `<li><span class="overview-alert-type ${presentation.tone}">${escapeHtml(presentation.label)}</span><strong>${escapeHtml(item.message)}</strong><small>${escapeHtml(deviceName(item.device_id))} · ${relativeTime(item.created_at)}</small></li>`;
          }).join('')}</ul>` : alertsUnavailable || unreadUnavailable ? '<p class="overview-empty">Chưa đủ dữ liệu để xác định cảnh báo mới. Hãy thử làm mới.</p>' : unread ? '<p class="overview-empty">Mở tất cả cảnh báo để xem các mục chưa đọc.</p>' : '<p class="overview-empty">Chưa có cảnh báo mới.</p>'}
          <div class="overview-analysis-link">
            <button class="link-button" data-page="ai">Xem phân tích AI</button>
            ${loadErrors.includes('phân tích AI') ? '<span>Chưa cập nhật được phân tích.</span>' : risky ? `<span>${risky} kết quả phân tích có rủi ro cao · thống kê riêng.</span>` : ''}
          </div>
        </section>
        <section class="overview-usage-summary" aria-labelledby="overview-usage-title">
          <h2 id="overview-usage-title">Thời gian sử dụng</h2>
          <label class="overview-scope-control"><span>Thời gian sử dụng của</span><select class="select" id="overview-child" aria-describedby="overview-scope-help"><option value="">Toàn gia đình</option>${state.children.map((child) => `<option value="${child.child_id}" ${String(child.child_id) === String(state.overviewChildId) ? 'selected' : ''}>${escapeHtml(child.name)}</option>`).join('')}</select></label>
          <p class="overview-scope-help" id="overview-scope-help">Chỉ áp dụng cho thời gian sử dụng và các biểu đồ thời gian.</p>
          ${usageUnavailable ? '<p class="overview-inline-status" role="status">Chưa tải được thời gian sử dụng cho phạm vi này. Hãy thử làm mới.</p>' : `<dl class="overview-usage-totals"><div><dt>Hôm nay</dt><dd>${todayUsage.value}<span>${todayUsage.unit}</span></dd></div><div><dt>Tổng trong tháng</dt><dd>${monthUsage.value}<span>${monthUsage.unit}</span></dd></div></dl>`}
        </section>
      </div>
      ${setupSteps.every((step) => step.done) ? '' : `<section class="overview-setup" aria-labelledby="overview-setup-title"><h2 id="overview-setup-title">Hoàn tất kết nối gia đình</h2><ol>${setupSteps.map((step) => `<li><button class="link-button" data-page="${step.page}">${step.label}</button><span>${step.done ? 'Đã hoàn tất' : 'Chưa hoàn tất'}</span></li>`).join('')}</ol></section>`}
      <div class="overview-detail-grid">
        <section class="overview-activity" aria-labelledby="overview-activity-title">
          <div class="overview-section-heading"><div><h2 id="overview-activity-title">Hoạt động gần đây</h2><p>Ứng dụng và website · Toàn gia đình</p></div><button class="link-button" data-page="activity">Xem tất cả</button></div>
          ${activityUnavailable ? '<p class="overview-inline-status" role="status">Một phần hoạt động chưa cập nhật được. Các mục đã tải trước đó được giữ lại.</p>' : ''}
          ${recentActivity.length ? `<ul class="overview-activity-list">${recentActivity.map((item) => `<li><strong>${escapeHtml(item.title || 'Không có tiêu đề')}</strong><div class="overview-activity-meta"><span>${item.type === 'app' ? 'Ứng dụng' : 'Website'} · ${escapeHtml(categoryLabel(item.category))}</span><small>${escapeHtml(deviceName(item.device_id))} · ${relativeTime(item.at)}</small></div></li>`).join('')}</ul>` : `<p class="overview-empty">${activityUnavailable ? 'Chưa tải được hoạt động. Hãy thử làm mới.' : 'Chưa có hoạt động. Dữ liệu sẽ xuất hiện sau khi thiết bị gửi về.'}</p>`}
        </section>
        <section class="overview-time-detail" aria-labelledby="overview-week-title">
          <div class="overview-section-heading"><div><h2 id="overview-week-title">7 ngày gần nhất</h2><p>${escapeHtml(usageScopeName)}${usageUnavailable ? '' : ` · Tổng ${duration(recentTotalSeconds)}`}</p></div></div>
          ${usageUnavailable ? '<p class="overview-empty">Biểu đồ sẽ hiển thị khi tải được dữ liệu thời gian sử dụng.</p>' : `
            <div class="chart-wrap usage-week-chart" role="img" aria-label="${escapeHtml(`Thời gian sử dụng của ${usageScopeName} trong 7 ngày gần nhất. ${weekDescription}`)}">${recentDays
              .map((day) => `<div class="bar-column"><span class="bar-value">${Math.round(day.seconds / 60)}p</span><div class="bar-track" title="${escapeHtml(day.date)}: ${duration(day.seconds)}"><div class="bar-fill ${day.seconds ? '' : 'is-empty'}" style="height:${day.seconds ? Math.max(4, Math.round((day.seconds / recentMaxSeconds) * 100)) : 0}%;"></div></div><small>${escapeHtml(day.label)}</small></div>`)
              .join('')}</div>
            <p class="overview-chart-note">Đơn vị: phút · Thời gian tổng hợp từ thiết bị.</p>
            ${usageQualityNotice}
            <details class="overview-month" ${monthExpanded ? 'open' : ''}>
              <summary>Chi tiết từng ngày trong ${escapeHtml(usageMonthLabel(usageSummary.month))}</summary>
              <p>${escapeHtml(usageScopeName)} · ${usageSummary.timezone ? `Múi giờ: ${escapeHtml(usageSummary.timezone)}.` : 'Theo múi giờ của hệ thống.'} Ngày hôm nay được đánh dấu.</p>
              <div class="usage-month-scroll" tabindex="0" role="region" aria-label="Biểu đồ từng ngày trong tháng, có thể cuộn ngang"><div class="usage-month-chart" style="--usage-day-count:${monthDays.length}" role="img" aria-label="${escapeHtml(monthDescription)}">${monthDays
                .map((day) => `<div class="usage-month-day ${day.isToday ? 'is-today' : ''}"><span>${day.seconds ? `${Math.round(day.seconds / 60)}p` : ''}</span><div class="usage-month-track" title="Ngày ${day.label}: ${duration(day.seconds)}"><div class="usage-month-fill" style="height:${day.seconds ? Math.max(3, Math.round((day.seconds / monthMaxSeconds) * 100)) : 0}%"></div></div><small>${day.label}</small></div>`)
                .join('')}</div></div>
              <table class="overview-month-table"><caption>Thời gian sử dụng từng ngày · ${escapeHtml(usageScopeName)}</caption><thead><tr><th scope="col">Ngày</th><th scope="col">Thời gian</th></tr></thead><tbody>${monthDays.map((day) => `<tr ${day.isToday ? 'class="is-today"' : ''}><th scope="row">${day.label}${day.isToday ? ' · Hôm nay' : ''}</th><td>${duration(day.seconds)}</td></tr>`).join('')}</tbody></table>
            </details>`}
        </section>
      </div>
      <section class="overview-categories" aria-labelledby="overview-categories-title">
        <div class="overview-section-heading"><div><h2 id="overview-categories-title">Phân bổ ứng dụng gần đây</h2><p>Toàn gia đình · 3 danh mục có thời lượng cao nhất. Tỷ lệ tính trên toàn bộ thời lượng ứng dụng trong các bản ghi gần đây.</p></div></div>
        ${loadErrors.includes('hoạt động ứng dụng') ? '<p class="overview-inline-status" role="status">Chưa cập nhật được phân bổ. Dữ liệu bên dưới, nếu có, là lần tải trước.</p>' : ''}
        ${sortedCategories.length ? `<table class="overview-category-table"><thead><tr><th scope="col">Danh mục</th><th scope="col">Thời lượng</th><th scope="col">Tỷ lệ</th></tr></thead><tbody>${sortedCategories.map(([name, seconds]) => `<tr><th scope="row">${escapeHtml(categoryLabel(name))}</th><td>${duration(seconds)}</td><td>${categorySampleSeconds ? Math.round((seconds / categorySampleSeconds) * 100) : 0}%</td></tr>`).join('')}</tbody></table>` : `<p class="overview-empty">${loadErrors.includes('hoạt động ứng dụng') ? 'Chưa tải được dữ liệu phân bổ.' : 'Chưa đủ dữ liệu để hiển thị phân bổ.'}</p>`}
      </section>
    </div>`;
  if (restoreScopeFocus) content.querySelector('#overview-child')?.focus({ preventScroll: true });
}

function metric(label, value, suffix, icon, highlight = false) {
  return `<article class="metric-card metric-${icon} ${highlight ? 'highlight' : ''}" aria-label="${escapeHtml(`${label}: ${value} ${suffix}`)}"><span class="metric-accent" aria-hidden="true"></span><div class="metric-icon">${icons[icon]}</div><p class="metric-label">${label}</p><div class="metric-value">${value}<small>${suffix}</small></div></article>`;
}

function activityListItem(item) {
  return `<div class="list-item"><div class="list-icon">${item.type === 'app' ? 'A' : 'W'}</div><div class="list-copy"><strong>${escapeHtml(item.title || 'Không có tiêu đề')}</strong><small>${escapeHtml(deviceName(item.device_id))} · ${relativeTime(item.at)}</small></div>${categoryBadge(item.category)}</div>`;
}

function alertListItem(item) {
  const presentation = alertPresentation(item.alert_type);
  return `<div class="list-item"><div class="list-icon alert-list-icon ${presentation.tone}">${presentation.symbol}</div><div class="list-copy"><strong>${escapeHtml(item.message)}</strong><small>${escapeHtml(deviceName(item.device_id))} · ${relativeTime(item.created_at)}</small></div><span class="badge ${item.is_read ? 'neutral' : 'coral'}">${item.is_read ? 'Đã đọc' : 'Mới'}</span></div>`;
}

async function renderChildren(content) {
  state.children = await api('/children?limit=200');
  const deviceResult = await api('/devices?limit=200');
  state.devices = deviceResult.data || [];
  const linkedDevices = state.devices.filter((device) => state.children.some((child) => String(child.child_id) === String(device.child_id))).length;
  content.innerHTML = `
    ${pageHead('children', '<button class="btn" data-action="add-child">' + icons.plus + ' Thêm hồ sơ</button>')}
    ${sectionVisual('children', `<span class="section-visual-stat"><b>${state.children.length}</b> hồ sơ</span><span class="section-visual-stat"><b>${linkedDevices}</b> thiết bị đã liên kết</span>`)}
    <section class="entity-grid">${state.children.map((child) => {
      const count = state.devices.filter((device) => String(device.child_id) === String(child.child_id)).length;
      return `<article class="entity-card child-card"><div class="entity-top"><div class="entity-avatar">${escapeHtml(initials(child.name))}</div><span class="badge">${child.age ?? '—'} tuổi</span></div><h3>${escapeHtml(child.name)}</h3><p>Hồ sơ được tạo ngày ${formatDate(child.created_at, false)}.</p><div class="entity-detail"><span>${icons.device}</span><div><strong>${count} thiết bị</strong><small>${count ? 'Đang liên kết với hồ sơ này' : 'Chưa có thiết bị được liên kết'}</small></div></div><div class="entity-meta"><button class="entity-primary-action" data-action="child-policy" data-id="${child.child_id}">${icons.policy}<span>Thiết lập chính sách</span></button><div class="entity-actions"><button class="kebab" aria-label="Chỉnh sửa hồ sơ ${escapeHtml(child.name)}" title="Chỉnh sửa" data-action="edit-child" data-id="${child.child_id}">✎</button><button class="kebab danger" aria-label="Xóa hồ sơ ${escapeHtml(child.name)}" title="Xóa" data-action="delete-child" data-id="${child.child_id}">×</button></div></div></article>`;
    }).join('') || emptyState('＋', 'Chưa có hồ sơ trẻ', 'Tạo hồ sơ đầu tiên để liên kết laptop và thiết lập chính sách.', '<button class="btn" data-action="add-child">Thêm hồ sơ</button>')}</section>`;
}

function deviceRegistrationAction() {
  return state.children.length
    ? `<button class="btn" type="button" data-action="add-device">${icons.plus} Đăng ký thiết bị</button>`
    : `<button class="btn" type="button" data-action="add-child">${icons.plus} Tạo hồ sơ trẻ</button>`;
}

async function renderDevices(content) {
  const [children, devices] = await Promise.all([api('/children?limit=200'), api('/devices?limit=200')]);
  state.children = children;
  state.devices = devices.data || [];
  const onlineCount = state.devices.filter(isDeviceOnline).length;
  content.innerHTML = `
    <section class="devices-page" aria-labelledby="devices-title">
      <header class="devices-header">
        <div><h1 id="devices-title">Thiết bị</h1><p>Máy của trẻ và trạng thái kết nối.</p></div>
        <div class="devices-header-actions"><button class="btn btn-secondary" type="button" data-action="agent-guide">Hướng dẫn kết nối</button>${state.devices.length ? deviceRegistrationAction() : ''}</div>
      </header>
      ${state.devices.length ? `<div class="devices-summary"><p><strong>${state.devices.length} thiết bị</strong> · ${onlineCount} đang kết nối · ${Math.max(0, state.devices.length - onlineCount)} ngoại tuyến hoặc chưa từng kết nối</p><p>Trạng thái ghi nhận khi tải danh sách, không xác nhận các chức năng giám sát đang hoạt động.</p></div>` : ''}
      <div class="device-list">${state.devices.map((device) => {
      const online = isDeviceOnline(device);
      const connectionLabel = !device.last_seen_at ? 'Chưa từng kết nối' : online ? 'Đang kết nối' : 'Ngoại tuyến';
      return `<article class="device-row" aria-labelledby="device-name-${escapeHtml(device.device_id)}">
        <div class="device-row-main">
          <div class="device-identity"><h2 id="device-name-${escapeHtml(device.device_id)}">${escapeHtml(device.device_name)}</h2><p>Hồ sơ trẻ: ${escapeHtml(childName(device.child_id))}</p></div>
          <div class="device-connection">
            <p class="device-status${online ? ' is-online' : ''}">${connectionLabel}</p>
            ${device.last_seen_at
              ? `<p class="device-contact"><span>Lần liên lạc gần nhất</span><strong>${formatDate(device.last_seen_at)}</strong></p>`
              : '<p class="device-contact">Cài Agent bằng mã kết nối để bắt đầu.</p>'}
          </div>
          <div class="device-row-actions">
            <button class="device-action" type="button" aria-label="Đổi tên thiết bị ${escapeHtml(device.device_name)}" data-action="edit-device" data-id="${device.device_id}">Đổi tên</button>
            <button class="device-action" type="button" aria-label="Đổi mã kết nối cho ${escapeHtml(device.device_name)}" data-action="rotate-secret" data-id="${device.device_id}">Đổi mã kết nối</button>
            <button class="device-action device-action-danger" type="button" aria-label="Xóa thiết bị ${escapeHtml(device.device_name)}" data-action="delete-device" data-id="${device.device_id}">Xóa</button>
          </div>
        </div>
        <details class="device-metadata">
          <summary aria-label="Mã và ngày đăng ký của ${escapeHtml(device.device_name)}">Mã và ngày đăng ký</summary>
          <dl><div><dt>Mã định danh (Device UID)</dt><dd>${escapeHtml(device.device_uid)}</dd></div><div><dt>ID thiết bị</dt><dd>#${escapeHtml(device.device_id)}</dd></div><div><dt>Ngày đăng ký</dt><dd>${formatDate(device.created_at, false)}</dd></div></dl>
        </details>
      </article>`;
    }).join('') || `<div class="devices-empty"><h2>${state.children.length ? 'Chưa có thiết bị' : 'Tạo hồ sơ trẻ để bắt đầu'}</h2><p>${state.children.length
      ? 'Đăng ký máy để nhận mã kết nối, rồi dùng mã khi cài Agent trên máy của trẻ.'
      : 'Mỗi máy cần gắn với một hồ sơ trẻ. Tạo hồ sơ, rồi quay lại đây để đăng ký thiết bị.'}</p>${deviceRegistrationAction()}</div>`}</div>
    </section>`;
}

function breakReminderHistoryMarkup(result, stale = false) {
  const labels = { shown: 'Đã hiển thị lời nhắc', acknowledged: 'Trẻ chọn nghỉ ngay', snoozed: 'Nhắc lại sau 5 phút' };
  const rows = Array.isArray(result?.data) ? result.data : [];
  return `<div class="break-history-heading"><h3>Lịch sử nhắc nghỉ</h3><button class="btn btn-secondary btn-sm" type="button" data-action="refresh-break-reminders">Làm mới</button></div>
    <p class="break-reminder-help">10 phản hồi gần nhất từ các thiết bị của trẻ. Chọn “Nghỉ ngay” là xác nhận lời nhắc, không xác nhận trẻ đã nghỉ.</p>
    <p class="break-reminder-help">Tự cập nhật mỗi 15 giây. Khi mất kết nối, Agent gửi bù lịch sử sau khi kết nối lại.</p>
    ${stale && result !== null ? '<p role="status">Chưa cập nhật được lịch sử. Đang giữ dữ liệu lần tải thành công gần nhất và sẽ tự thử lại.</p>' : ''}
    ${result === null ? '<p role="status">Chưa tải được lịch sử nhắc nghỉ. Hệ thống sẽ tự thử lại; bạn cũng có thể chọn Làm mới.</p>' : rows.length ? `<ul class="break-history-list">${rows.map(row => `<li><div><strong>${escapeHtml(labels[row.event_type] || 'Phản hồi khác')}</strong><span>${escapeHtml(row.device_name || 'Thiết bị')} · Nghỉ ${escapeHtml(row.duration_minutes)} phút</span></div><time>${escapeHtml(formatDate(row.occurred_at))}</time></li>`).join('')}</ul>` : '<p>Chưa nhận được lịch sử từ Agent. Nếu lời nhắc vừa hiện trên máy, hãy chờ đồng bộ; danh sách sẽ tự cập nhật.</p>'}`;
}

function stopBreakReminderPolling() {
  clearTimeout(breakReminderRefreshTimer);
  breakReminderRefreshTimer = null;
  breakReminderRefreshVersion += 1;
}

function startBreakReminderPolling(panel, initialResult) {
  stopBreakReminderPolling();
  if (!panel) return;
  breakReminderHistoryState.set(panel, { result: initialResult, pending: null });
  const version = breakReminderRefreshVersion;
  const current = () => version === breakReminderRefreshVersion && state.page === 'controls'
    && state.accessToken && panel === document.querySelector('#break-reminder-history');
  const tick = async () => {
    if (!current()) return;
    try { await refreshBreakReminderHistory({ background: true }); }
    finally {
      if (current()) breakReminderRefreshTimer = setTimeout(tick, 15_000);
    }
  };
  breakReminderRefreshTimer = setTimeout(tick, 15_000);
}

async function refreshBreakReminderHistory({ background = false } = {}) {
  if (state.page !== 'controls' || !state.accessToken || (background && document.hidden)) return;
  const panel = document.querySelector('#break-reminder-history');
  if (!panel) return;
  const childId = panel.dataset.childId;
  if (String(childId) !== String(state.selectedChildId)) return;
  const record = breakReminderHistoryState.get(panel) || { result: null, pending: null };
  breakReminderHistoryState.set(panel, record);
  if (record.pending) return record.pending;
  const version = breakReminderRefreshVersion;
  const request = (async () => {
    const button = panel.querySelector('button');
    if (button) button.disabled = true;
    panel.setAttribute('aria-busy', 'true');
    try {
      const result = await api(`/logs/break-reminders?child_id=${encodeURIComponent(childId)}`,
        { signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (version !== breakReminderRefreshVersion || state.page !== 'controls' || !state.accessToken
          || panel !== document.querySelector('#break-reminder-history') || String(childId) !== String(state.selectedChildId)) return;
      if (result !== null) record.result = result;
      const markup = breakReminderHistoryMarkup(record.result, result === null);
      if (panel.innerHTML !== markup) {
        const restoreFocus = document.activeElement === button;
        panel.innerHTML = markup;
        if (restoreFocus) panel.querySelector('button')?.focus({ preventScroll: true });
      }
    } finally {
      panel.removeAttribute('aria-busy');
      const button = panel.querySelector('button');
      if (button) button.disabled = false;
    }
  })();
  record.pending = request;
  try { await request; }
  finally { if (record.pending === request) record.pending = null; }
}

async function renderDeviceControls(content) {
  stopBreakReminderPolling();
  const renderVersion = ++controlRenderVersion;
  const children = await api('/children?limit=200');
  if (renderVersion !== controlRenderVersion || state.page !== 'controls') return;
  state.children = children;
  state.selectedChildId = reconcileSelectedId(state.selectedChildId, state.children, 'child_id');
  if (!state.selectedChildId) {
    content.innerHTML = pageHead('controls') + emptyState('⌁', 'Cần có hồ sơ trẻ', 'Hãy tạo hồ sơ trước khi điều khiển các thiết bị liên kết.', '<button class="btn" data-page="children">Đến trang hồ sơ trẻ</button>');
    content.querySelector('.page-head').classList.add('controls-empty-head');
    return;
  }

  const childId = state.selectedChildId;
  const [settings, deviceResult, reminderHistory] = await Promise.all([
    api(`/settings/${childId}`),
    api('/devices?limit=200'),
    api(`/logs/break-reminders?child_id=${encodeURIComponent(childId)}`, { signal: AbortSignal.timeout(10_000) }).catch(() => null),
  ]);
  if (renderVersion !== controlRenderVersion || String(childId) !== String(state.selectedChildId) || state.page !== 'controls') return;
  state.devices = deviceResult.data || [];
  const selectedChild = state.children.find((child) => String(child.child_id) === String(state.selectedChildId));
  const linkedDevices = state.devices.filter((device) => String(device.child_id) === String(state.selectedChildId));
  const onlineDevices = linkedDevices.filter(isDeviceOnline).length;
  const controlScope = linkedDevices.length
    ? `Áp dụng cho tất cả ${linkedDevices.length} thiết bị của ${selectedChild?.name || 'hồ sơ đã chọn'}`
    : `Chưa có thiết bị liên kết với ${selectedChild?.name || 'hồ sơ đã chọn'}`;
  const connectionNote = !linkedDevices.length
    ? 'Bạn vẫn có thể lưu cấu hình, nhưng hiện chưa có thiết bị để áp dụng.'
    : !onlineDevices
      ? 'Tất cả thiết bị hiện ngoại tuyến. Bạn vẫn có thể lưu; thiết bị chỉ có thể nhận cấu hình khi kết nối lại.'
      : 'Lưu cấu hình không có nghĩa thiết bị đã áp dụng. Thiết bị cần Agent nhận cấu hình trước.';
  const startTime = String(settings.allowed_start_time).slice(0, 5);
  const endTime = String(settings.allowed_end_time).slice(0, 5);

  content.innerHTML = `
    <div class="controls-workspace">
      ${pageHead('controls', '<button class="btn btn-secondary" data-page="devices">' + icons.device + ' Quản lý thiết bị</button>')}
      <article class="control-panel">
        <section class="control-child-picker" aria-labelledby="control-child-heading">
          <h2 id="control-child-heading">Chọn hồ sơ trẻ</h2>
          <div class="control-child-options">${state.children.map((child) => `<button class="child-pick ${String(child.child_id) === String(state.selectedChildId) ? 'active' : ''}" type="button" aria-pressed="${String(child.child_id) === String(state.selectedChildId)}" data-action="select-control-child" data-id="${child.child_id}"><span class="mini-avatar" aria-hidden="true">${escapeHtml(initials(child.name))}</span><span><strong>${escapeHtml(child.name)}</strong><small>${String(child.child_id) === String(state.selectedChildId) ? '<span class="control-child-current">Đang chọn</span> · ' : ''}${child.age == null ? 'Chưa có thông tin tuổi' : `${escapeHtml(child.age)} tuổi`}</small></span></button>`).join('')}</div>
        </section>
        <form id="device-control-form" data-child-id="${settings.child_id}" data-render-version="${renderVersion}" data-saved-locked="${Boolean(settings.is_locked)}">
          <header class="control-scope-summary">
            <h2>${escapeHtml(controlScope)}</h2>
            ${linkedDevices.length ? `<p class="control-device-names">Thiết bị: ${linkedDevices.map((device) => escapeHtml(device.device_name)).join(', ')}.</p>` : ''}
            <p class="control-connection-note">${connectionNote}</p>
            <p>Dùng “Lưu điều khiển” để lưu lựa chọn, hoặc “Lưu và bắt đầu phiên camera mới” để yêu cầu theo dõi lại. Agent cần nhận cấu hình trước khi thiết bị áp dụng.</p>
          </header>
          <section class="control-section" aria-labelledby="control-time-heading">
            <h3 id="control-time-heading">Thời gian sử dụng</h3>
            <p class="control-section-help">Giới hạn được tính lại theo từng ngày tại múi giờ Việt Nam.</p>
            <div class="control-time-fields"><div class="field"><label>Giới hạn mỗi ngày (phút)</label><input class="input" type="number" name="daily_limit_minutes" min="0" max="1440" value="${settings.daily_limit_minutes}"><small>Nhập 0 nếu không giới hạn tổng thời gian.</small></div><div class="field"><label>Cho phép từ</label><input class="input" type="time" name="allowed_start_time" step="60" value="${startTime}"></div><div class="field"><label>Cho phép đến</label><input class="input" type="time" name="allowed_end_time" step="60" value="${endTime}"><small>Khung giờ qua đêm, ví dụ 20:00–06:00, được hỗ trợ.</small></div></div>
            <div class="control-break-settings">
              ${switchRow('enable_break_reminders', 'Nhắc nghỉ giải lao', 'Hiển thị lời nhắc khi trẻ sử dụng máy đến thời gian đã đặt.', settings.enable_break_reminders)}
              <fieldset id="break-reminder-options" class="break-reminder-options field full" ${settings.enable_break_reminders ? '' : 'disabled'}>
                <legend>Thời gian nhắc nghỉ</legend>
                <div class="break-reminder-fields">
                  <div class="field"><label for="break-interval">Nhắc sau (phút sử dụng)</label><input id="break-interval" class="input" type="number" name="break_interval_minutes" min="5" max="180" step="1" required value="${escapeHtml(settings.break_interval_minutes ?? 30)}"><small>Từ 5 đến 180 phút.</small></div>
                  <div class="field"><label for="break-duration">Thời gian nghỉ (phút)</label><input id="break-duration" class="input" type="number" name="break_duration_minutes" min="1" max="30" step="1" required value="${escapeHtml(settings.break_duration_minutes ?? 5)}"><small>Từ 1 đến 30 phút.</small></div>
                </div>
                <p class="break-reminder-help">Trẻ có thể chọn “Nghỉ ngay” hoặc “Nhắc lại sau 5 phút”. Máy và ứng dụng vẫn mở. Xem video hoặc đọc nội dung vẫn được tính khi Windows mở khóa; bộ đếm tạm dừng khi khóa hoặc ngủ máy.</p>
              </fieldset>
            </div>
          </section>
          <section class="control-section" aria-labelledby="control-safety-heading">
            <h3 id="control-safety-heading">An toàn và giám sát</h3>
            <div class="control-lock-setting">
              ${switchRow('is_locked', 'Yêu cầu khóa thiết bị', 'Áp dụng cho tất cả thiết bị thuộc hồ sơ đã chọn, không riêng một máy. Sau khi lưu, thiết bị có thể bị khóa khi Agent nhận và áp dụng cấu hình.', settings.is_locked)}
              <p class="control-lock-state ${settings.is_locked ? 'is-locked' : ''}">Đã lưu: ${settings.is_locked ? 'Cấu hình khóa đang bật' : 'Cấu hình khóa đang tắt'}</p>
            </div>
            ${switchRow('enable_posture_monitoring', 'Theo dõi tư thế', 'Dùng webcam để phát hiện và nhắc nhở khi con ngồi sai tư thế.', settings.enable_posture_monitoring ?? settings.enable_webcam_monitoring)}
            ${switchRow('enable_eye_distance_monitoring', 'Cảnh báo khoảng cách mắt', 'Dùng webcam để nhắc nhở khi mắt con ở quá gần màn hình.', settings.enable_eye_distance_monitoring ?? settings.enable_webcam_monitoring)}
            <label>Thời lượng phiên camera (phút)
              <input type="number" name="vision_session_minutes" min="1" max="60" step="1" value="${escapeHtml(settings.vision_session_minutes ?? 5)}" required aria-describedby="vision-session-help">
            </label>
            <p id="vision-session-help" class="muted">Mỗi laptop chạy tối đa thời lượng này từ khi nhận phiên. Camera tự tắt khi hết giờ hoặc có cảnh báo đầu tiên. Các công tắc là lựa chọn chức năng, không phải trạng thái camera. Bật thêm chức năng sẽ mở phiên mới; lưu thời lượng chỉ áp dụng cho phiên tiếp theo.</p>
            <ul aria-label="Trạng thái phiên camera">${linkedDevices.map(device => {
              const statuses = { received: 'Đã nhận phiên; chưa xác nhận camera đang mở', alert: 'Đã dừng sau cảnh báo', timeout: 'Đã dừng do hết giờ', stopped: 'Đã dừng theo cấu hình' };
              const status = !settings.vision_session_id ? 'Chưa yêu cầu phiên mới' : device.vision_session_id === settings.vision_session_id ? statuses[device.vision_session_status] || 'Chưa có xác nhận' : 'Chờ laptop nhận phiên';
              return `<li>${escapeHtml(device.device_name)}: ${escapeHtml(status)}</li>`;
            }).join('')}</ul>
            <p class="muted">Trạng thái cập nhật khi tải lại trang. Phiên đã dừng chỉ chạy lại khi bạn bật thêm chức năng hoặc chọn bắt đầu phiên mới.</p>
            ${switchRow('enable_screenshot_review', 'Bật chụp màn hình định kỳ', 'Chụp màn hình chính theo định kỳ khi Agent đang hoạt động. Xem ảnh tại Hoạt động → Giám sát màn hình; ảnh được lưu 7 ngày.', settings.enable_screenshot_review)}
          </section>
          <div class="form-actions control-save-bar"><span><strong>${escapeHtml(controlScope)}</strong><small data-control-save-status role="status" aria-live="polite" aria-atomic="true" tabindex="-1">Chọn một nút lưu để áp dụng thay đổi.</small></span><button class="btn" type="submit">Lưu điều khiển</button><button class="btn btn-secondary" type="submit" data-start-vision-session="true">Lưu và bắt đầu phiên camera mới</button></div>
        </form>
        <aside class="control-privacy-note"><strong>Ưu tiên quyền riêng tư</strong><p>Webcam và ảnh chụp màn hình mặc định tắt. Nhắc nghỉ giải lao chỉ dùng thời gian hoạt động, không đọc nội dung phím bấm.</p><p>Các thiết lập này không thay đổi quy tắc phân loại nội dung.</p></aside>
        <section id="break-reminder-history" class="break-reminder-history" data-child-id="${escapeHtml(childId)}" aria-live="polite">${breakReminderHistoryMarkup(reminderHistory)}</section>
      </article>
    </div>`;
  startBreakReminderPolling(document.querySelector('#break-reminder-history'), reminderHistory);
}

function isCurrentControlForm(form) {
  return form.isConnected && state.page === 'controls'
    && String(state.selectedChildId) === form.dataset.childId
    && Number(form.dataset.renderVersion) === controlRenderVersion
    && document.querySelector('#device-control-form') === form;
}

function showControlLockConfirmation(form, data) {
  if (!isCurrentControlForm(form) || form.dataset.controlPending === 'true' || modalRoot.firstElementChild) return;
  const child = state.children.find((item) => String(item.child_id) === form.dataset.childId);
  const devices = state.devices.filter((item) => String(item.child_id) === form.dataset.childId);
  const name = child?.name || 'Hồ sơ đã chọn';
  showModal(`Lưu yêu cầu khóa cho “${name}”?`, `Áp dụng cho tất cả ${devices.length} thiết bị của ${name}.`, `
    <div class="control-lock-confirmation">
      ${devices.length ? `<p>Thiết bị chịu tác động:</p><ul>${devices.map((device) => `<li>${escapeHtml(device.device_name)}</li>`).join('')}</ul>` : '<p>Hồ sơ hiện chưa có thiết bị. Bạn vẫn có thể lưu cấu hình để áp dụng khi có thiết bị liên kết.</p>'}
      <p>Thiết bị có thể bị khóa khi Agent kết nối, nhận và áp dụng cấu hình đã lưu. Thiết bị ngoại tuyến cần kết nối lại để nhận cấu hình.</p>
      <p>Các thay đổi khác trên form cũng được lưu cùng yêu cầu này.</p>
      <div class="form-actions"><button class="btn btn-secondary" type="button" data-action="close-modal" data-control-lock-cancel>Hủy</button><button class="btn btn-danger" type="button" data-control-lock-save>Lưu yêu cầu khóa</button></div>
    </div>`, { initialFocus: '[data-control-lock-cancel]' });
  const modal = modalRoot.querySelector('.modal');
  modal?.querySelector('[data-control-lock-save]')?.addEventListener('click', () => {
    // A dismissed/replaced confirmation cannot submit an old form or payload.
    if (modal !== modalRoot.querySelector('.modal')) return;
    if (!isCurrentControlForm(form) || form.dataset.controlPending === 'true') {
      closeModal();
      return;
    }
    closeModal();
    return saveDeviceControls(form, data);
  });
}

async function saveDeviceControls(form, data) {
  if (!isCurrentControlForm(form) || form.dataset.controlPending === 'true') return;
  const childId = form.dataset.childId;
  const submit = form.querySelector('[type="submit"]');
  const submitLabel = submit?.textContent;
  const saveStatus = form.querySelector('[data-control-save-status]');
  const controls = [...form.querySelectorAll('input, select, textarea, button')].map((control) => [control, control.disabled]);
  form.dataset.controlPending = 'true';
  controls.forEach(([control]) => { control.disabled = true; });
  if (submit) submit.textContent = 'Đang lưu điều khiển...';
  if (saveStatus) {
    saveStatus.textContent = 'Đang lưu điều khiển... Các trường tạm thời bị khóa để giữ đúng dữ liệu đã gửi.';
    saveStatus.focus();
  }
  try {
    await api(`/settings/${childId}`, { method: 'PUT', body: data });
    form.dataset.savedLocked = String(data.is_locked);
    if (!isCurrentControlForm(form)) return;
    if (saveStatus) saveStatus.textContent = 'Đã lưu cấu hình. Chưa có xác nhận thiết bị đã áp dụng.';
    toast('Đã lưu cấu hình điều khiển', 'Thiết bị cần Agent nhận cấu hình trước khi áp dụng. Chưa có xác nhận từ thiết bị.');
    const restoreFocus = document.activeElement === saveStatus;
    const refreshVersion = controlRenderVersion + 1;
    try {
      await renderDeviceControls(document.querySelector('#page-content'));
      const refreshedForm = document.querySelector('#device-control-form');
      if (restoreFocus && refreshedForm && isCurrentControlForm(refreshedForm)
        && refreshedForm.dataset.childId === childId && controlRenderVersion === refreshVersion
        && document.activeElement === document.body && !modalRoot.firstElementChild) {
        refreshedForm.querySelector('[type="submit"]')?.focus();
      }
    } catch (error) {
      // Saving succeeded. A failed refresh must not masquerade as a failed PUT.
      if (form.isConnected && document.querySelector('#device-control-form') === form
        && state.page === 'controls' && String(state.selectedChildId) === childId
        && controlRenderVersion === refreshVersion) {
        form.dataset.renderVersion = String(refreshVersion);
        if (saveStatus) saveStatus.textContent = 'Đã lưu cấu hình nhưng chưa tải lại được dữ liệu. Chưa có xác nhận thiết bị đã áp dụng.';
        toast('Đã lưu cấu hình, chưa tải lại được dữ liệu', localizeError(error.message), 'error');
      }
    }
  } catch (error) {
    if (isCurrentControlForm(form)) {
      if (saveStatus) saveStatus.textContent = 'Chưa xác nhận được cấu hình đã lưu. Các trường đã mở lại; kiểm tra thông báo lỗi và thử lại.';
      toast('Không thể lưu điều khiển', localizeError(error.message), 'error');
    }
  } finally {
    delete form.dataset.controlPending;
    controls.forEach(([control, disabled]) => { control.disabled = disabled; });
    if (submit) submit.textContent = submitLabel;
    if (isCurrentControlForm(form) && document.activeElement === saveStatus) submit?.focus();
  }
}

const policyClassificationFields = [
  'enable_app_classification',
  'enable_web_classification',
  'enable_text_moderation',
];

function policySnapshotFromForm(form) {
  const settings = Object.fromEntries(policyClassificationFields.map((name) => [name, Boolean(form.elements[name]?.checked)]));
  const categories = {};
  Object.entries(policyCategoryGroups).forEach(([resourceType, categoryList]) => {
    categoryList.forEach(([category]) => {
      categories[`${resourceType}:${category}`] = form.elements[`policy_${resourceType}_${category}`]?.value || 'allow';
    });
  });
  return { settings, categories };
}

function policySnapshotsEqual(left, right) {
  if (!left || !right) return false;
  return policyClassificationFields.every((name) => Boolean(left.settings?.[name]) === Boolean(right.settings?.[name]))
    && Object.entries(policyCategoryGroups).every(([resourceType, categories]) => categories.every(([category]) => {
      const key = `${resourceType}:${category}`;
      return (left.categories?.[key] || 'allow') === (right.categories?.[key] || 'allow');
    }));
}

function updatePolicyDraftStatus(form, message) {
  const status = form?.querySelector('[data-policy-draft-status]');
  if (status) status.textContent = message;
  const syncGuidance = form?.querySelector('[data-policy-sync-guidance]');
  if (syncGuidance) syncGuidance.textContent = policySyncGuidanceForChild(String(form.dataset.childId));
}

function capturePolicyDraft(form) {
  if (!form || form.id !== 'policy-form') return null;
  const childId = String(form.dataset.childId);
  const snapshot = policySnapshotFromForm(form);
  const pending = state.policyPendingByChild[childId];
  const baseline = pending?.snapshot || state.policyBaselinesByChild[childId];
  if (!baseline) return null;

  if (policySnapshotsEqual(snapshot, baseline)) {
    delete state.policyDrafts[childId];
  } else {
    const existing = state.policyDrafts[childId];
    const revision = existing?.revision
      + (existing && policySnapshotsEqual(existing.snapshot, snapshot) ? 0 : 1) || 1;
    state.policyDrafts[childId] = { snapshot, revision };
  }

  if (String(state.selectedChildId) === childId) state.categoryPolicies = { ...snapshot.categories };
  if (pending) {
    updatePolicyDraftStatus(form, state.policyDrafts[childId]
      ? 'Đang lưu phiên bản đã gửi; bản nháp hiện tại chưa được lưu.'
      : 'Đang lưu chính sách...');
  } else {
    updatePolicyDraftStatus(form, policyStatusForChild(childId));
  }
  syncPolicyClassificationUI(form);
  return state.policyDrafts[childId] || null;
}

function policyStatusForChild(childId) {
  if (state.policyPendingByChild[childId]) {
    return state.policyDrafts[childId]
      ? 'Đang lưu phiên bản đã gửi; bản nháp hiện tại chưa được lưu.'
      : 'Đang lưu chính sách...';
  }
  const saveOutcome = state.policySaveErrors[childId];
  if (saveOutcome?.requiresRefresh) {
    return saveOutcome.kind === 'partial'
      ? 'Một phần thay đổi có thể đã được lưu. Hãy kiểm tra trạng thái đã lưu trước khi tiếp tục.'
      : 'Chưa xác nhận được kết quả lưu. Bản nháp vẫn được giữ; hãy kiểm tra trạng thái trước khi thử lại.';
  }
  if (saveOutcome) {
    return state.policyDrafts[childId]
      ? 'Không lưu được. Bản nháp vẫn được giữ.'
      : 'Lần lưu trước không thành công';
  }
  if (state.policyDrafts[childId]) return 'Bản nháp chưa lưu';
  return 'Chính sách đã lưu';
}

function policySyncGuidanceForChild(childId) {
  const pending = state.policyPendingByChild[childId];
  const draft = state.policyDrafts[childId];
  const saveOutcome = state.policySaveErrors[childId];

  if (pending) {
    const hasNewDraft = draft && !policySnapshotsEqual(draft.snapshot, pending.snapshot);
    return hasNewDraft
      ? 'Đang lưu thay đổi đã gửi. Bản nháp hiện tại chưa được lưu; chưa thể coi là cấu hình sẽ được đồng bộ.'
      : 'Đang lưu chính sách. Chưa xác nhận cấu hình đã lưu hoặc thiết bị đã nhận.';
  }
  if (saveOutcome?.requiresRefresh) {
    return saveOutcome.kind === 'partial'
      ? 'Một phần thay đổi có thể đã được lưu. Hãy chọn “Kiểm tra trạng thái đã lưu” trước khi tiếp tục.'
      : 'Chưa xác nhận được kết quả lưu. Hãy chọn “Kiểm tra trạng thái đã lưu” trước khi tiếp tục.';
  }
  if (saveOutcome) return 'Lần lưu trước chưa thành công. Hãy kiểm tra trạng thái đã lưu trước khi tiếp tục.';
  if (draft) return 'Bản nháp chưa được lưu, vì vậy chưa thể coi đây là cấu hình sẽ được đồng bộ.';
  if (!state.policyBaselinesByChild[childId]) return 'Chưa tải được trạng thái đã lưu; chưa thể xác nhận cấu hình nào sẽ được đồng bộ.';
  return 'Chính sách đã lưu sẽ được đồng bộ tới thiết bị ở lần đồng bộ tiếp theo. Ứng dụng chưa xác nhận thiết bị đã nhận.';
}

function policySaveRequiresRefresh(childId) {
  return Boolean(state.policySaveErrors[childId]?.requiresRefresh);
}

function policySettingHasUncertainResult(childId, name) {
  const outcome = state.policySaveErrors[childId];
  return Boolean(outcome?.requiresRefresh && outcome.failedOperations?.some((operation) => operation.kind === 'settings'));
}

function policyGroupHasUncertainResult(childId, resourceType) {
  const outcome = state.policySaveErrors[childId];
  if (!outcome?.requiresRefresh) return false;
  if (outcome.failedOperations?.some((operation) => operation.kind === 'settings')) return true;
  const groupKeys = new Set(policyCategoryGroups[resourceType].map(([category]) => `${resourceType}:${category}`));
  return Boolean(outcome.failedOperations?.some((operation) => operation.kind === 'category' && groupKeys.has(operation.key)));
}

function policyClassificationSaveState(childId, name, value) {
  const pending = state.policyPendingByChild[childId];
  if (pending) return Boolean(pending.snapshot.settings?.[name]) === Boolean(value) ? 'Đang lưu' : 'Chưa lưu';
  if (policySettingHasUncertainResult(childId, name)) return 'Chưa xác định';
  const baseline = state.policyBaselinesByChild[childId];
  if (!baseline || baseline.settings?.[name] == null) return 'Chưa xác định';
  if (Boolean(baseline.settings[name]) === Boolean(value)) return 'Đã lưu';
  return state.policySaveErrors[childId] ? 'Lưu chưa thành công' : 'Chưa lưu';
}

function policyClassificationSaveNote(childId, name, value, saveState) {
  if (saveState === 'Đang lưu') return 'Đang lưu cấu hình; chưa xác nhận thiết bị đã nhận.';
  if (saveState === 'Chưa lưu') {
    return state.policyPendingByChild[childId]
      ? 'Thay đổi này chưa nằm trong lần lưu đang xử lý.'
      : 'Thay đổi này chưa được lưu.';
  }
  if (saveState === 'Lưu chưa thành công') return 'Bản nháp vẫn được giữ.';
  if (saveState === 'Chưa xác định') {
    return policySaveRequiresRefresh(childId)
      ? 'Chưa xác nhận kết quả lưu. Hãy kiểm tra lại trạng thái.'
      : 'Chưa tải được trạng thái đã lưu.';
  }
  if (!value) return 'Cấu hình đã lưu ở trạng thái tắt.';
  return '';
}

function policyGroupMatchesSnapshot(resourceType, enabled, snapshot) {
  if (!snapshot) return false;
  const settingName = resourceType === 'app' ? 'enable_app_classification' : 'enable_web_classification';
  if (Boolean(snapshot.settings?.[settingName]) !== Boolean(enabled)) return false;
  return policyCategoryGroups[resourceType].every(([category]) => {
    const key = `${resourceType}:${category}`;
    return (state.categoryPolicies[key] || 'allow') === (snapshot.categories?.[key] || 'allow');
  });
}

function policyGroupView(childId, resourceType, enabled) {
  const pending = state.policyPendingByChild[childId];
  const baseline = state.policyBaselinesByChild[childId];
  let saveState;
  if (pending) saveState = policyGroupMatchesSnapshot(resourceType, enabled, pending.snapshot) ? 'pending' : 'draft';
  else if (!baseline) saveState = 'unknown';
  else if (policyGroupHasUncertainResult(childId, resourceType)) saveState = 'error';
  else if (policyGroupMatchesSnapshot(resourceType, enabled, baseline)) saveState = 'saved';
  else saveState = state.policySaveErrors[childId] ? 'error' : 'draft';

  let message;
  if (saveState === 'pending') message = 'Đang lưu cấu hình. Chưa xác nhận thiết bị đã nhận.';
  else if (pending && saveState === 'draft') message = 'Thay đổi mới chưa được lưu; lần lưu trước vẫn đang xử lý.';
  else if (saveState === 'error') {
    message = 'Chưa xác nhận được kết quả lưu phần này. Bản nháp vẫn được giữ; hãy kiểm tra lại trước khi tiếp tục.';
  }
  else if (saveState === 'draft') {
    message = enabled
      ? 'Nhóm này có thay đổi chưa được lưu.'
      : 'Thay đổi chưa được lưu. Quy tắc sẽ ở trạng thái Chưa áp dụng khi phân loại tắt.';
  } else if (saveState === 'unknown') message = 'Chưa tải được trạng thái đã lưu.';
  else if (!enabled) message = 'Quy tắc được lưu nhưng chưa áp dụng khi phân loại tắt.';
  else message = 'Phân loại bật trong cấu hình đã lưu.';

  return {
    saveState,
    availability: enabled ? 'Phân loại bật' : 'Chưa áp dụng',
    message,
  };
}

function syncPolicyClassificationUI(form) {
  if (!form || form.id !== 'policy-form') return;
  const childId = String(form.dataset.childId);
  for (const name of policyClassificationFields) {
    const value = Boolean(form.elements[name]?.checked);
    const saveState = policyClassificationSaveState(childId, name, value);
    const stateNode = form.querySelector(`[data-policy-switch-status="${name}"]`);
    const noteNode = form.querySelector(`[data-policy-switch-note="${name}"]`);
    if (stateNode) {
      stateNode.textContent = saveState;
      stateNode.dataset.saveState = saveState;
    }
    if (noteNode) {
      noteNode.textContent = policyClassificationSaveNote(childId, name, value, saveState);
      noteNode.hidden = !noteNode.textContent;
    }
  }

  for (const [resourceType, settingName] of [
    ['app', 'enable_app_classification'],
    ['web', 'enable_web_classification'],
  ]) {
    const group = form.querySelector(`.policy-group[data-resource="${resourceType}"]`);
    if (!group) continue;
    const enabled = Boolean(form.elements[settingName]?.checked);
    const view = policyGroupView(childId, resourceType, enabled);
    const availability = group.querySelector('[data-policy-group-availability]');
    const explanation = group.querySelector('[data-policy-group-explanation]');
    if (availability) {
      availability.textContent = view.availability;
      availability.classList.toggle('neutral', !enabled);
    }
    if (explanation) explanation.textContent = view.message;
    if (group.classList) group.classList.toggle('classification-off', !enabled);
  }
}

function syncPolicyFormState(childId) {
  if (String(state.selectedChildId) !== String(childId) || state.page !== 'policies') return;
  const form = document.querySelector('#policy-form');
  if (!form || String(form.dataset.childId) !== String(childId)) return;
  const pending = state.policyPendingByChild[childId];
  const requiresRefresh = policySaveRequiresRefresh(childId);
  const submit = form.querySelector('[type="submit"]');
  const refreshButton = form.querySelector('[data-action="refresh-policy-state"]');
  const shouldRestoreFocus = submit && document.activeElement === submit;
  if (submit) {
    submit.disabled = Boolean(pending) || requiresRefresh;
    submit.textContent = pending ? 'Đang lưu chính sách...' : requiresRefresh ? 'Cần kiểm tra trạng thái' : 'Lưu chính sách';
  }
  if (refreshButton) refreshButton.hidden = !requiresRefresh;
  updatePolicyDraftStatus(form, policyStatusForChild(childId));
  syncPolicyClassificationUI(form);
  if (shouldRestoreFocus && requiresRefresh) refreshButton?.focus({ preventScroll: true });
}

async function savePolicyForm(form) {
  const childId = String(form.dataset.childId);
  if (!isCurrentPolicyForm(form) || state.policyPendingByChild[childId]) return;
  if (policySaveRequiresRefresh(childId)) {
    throw new Error('Hãy kiểm tra trạng thái đã lưu trước khi thử lại.');
  }
  const baseline = state.policyBaselinesByChild[childId];
  if (!baseline) throw new Error('Chưa tải được chính sách hiện tại. Hãy tải lại rồi thử lại.');

  const snapshot = policySnapshotFromForm(form);
  capturePolicyDraft(form);
  const settingsBody = Object.fromEntries(policyClassificationFields.map((name) => [name, snapshot.settings[name]]));
  const classificationSettingsChanged = policyClassificationFields.some((name) =>
    Boolean(baseline.settings?.[name]) !== snapshot.settings[name]
  );
  const policyUpdates = [];
  Object.entries(policyCategoryGroups).forEach(([resourceType, categories]) => {
    categories.forEach(([category]) => {
      const key = `${resourceType}:${category}`;
      const action = snapshot.categories[key] || 'allow';
      if (action !== (baseline.categories?.[key] || 'allow')) {
        policyUpdates.push({ resourceType, category, action });
      }
    });
  });
  const operations = [
    ...(classificationSettingsChanged ? [{
      kind: 'settings',
      descriptor: { kind: 'settings' },
      send: () => api(`/settings/${childId}`, { method: 'PUT', body: settingsBody }),
    }] : []),
    ...policyUpdates.map(({ resourceType, category, action }) => ({
      kind: 'category',
      key: `${resourceType}:${category}`,
      action,
      descriptor: { kind: 'category', key: `${resourceType}:${category}` },
      send: () => api(`/settings/${childId}/policies/${resourceType}/${category}`, { method: 'PUT', body: { action } }),
    })),
  ];

  const token = ++policySaveSequence;
  state.policyPendingByChild[childId] = { token, snapshot };
  state.policyDataVersions[childId] = (state.policyDataVersions[childId] || 0) + 1;
  delete state.policySaveErrors[childId];
  const submit = form.querySelector('[type="submit"]');
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Đang lưu chính sách...';
  }
  updatePolicyDraftStatus(form, 'Đang lưu chính sách...');
  syncPolicyClassificationUI(form);

  try {
    const results = await Promise.allSettled(operations.map((operation) => {
      try { return operation.send(); } catch (error) { return Promise.reject(error); }
    }));
    if (state.policyPendingByChild[childId]?.token !== token) return;

    const confirmedSnapshot = {
      settings: { ...(baseline.settings || {}) },
      categories: { ...(baseline.categories || {}) },
    };
    const failedOperations = [];
    results.forEach((result, index) => {
      const operation = operations[index];
      if (result.status === 'rejected') {
        failedOperations.push(operation.descriptor);
      } else if (operation.kind === 'settings') {
        confirmedSnapshot.settings = { ...snapshot.settings };
      } else {
        confirmedSnapshot.categories[operation.key] = operation.action;
      }
    });
    state.policyBaselinesByChild[childId] = confirmedSnapshot;

    const currentDraft = state.policyDrafts[childId];
    if (failedOperations.length) {
      state.policyDrafts[childId] = {
        snapshot: currentDraft?.snapshot || snapshot,
        revision: currentDraft?.revision || 1,
      };
      const succeededCount = results.length - failedOperations.length;
      const kind = succeededCount ? 'partial' : 'failed';
      state.policySaveErrors[childId] = { kind, requiresRefresh: true, failedOperations };
      const message = kind === 'partial'
        ? 'Một phần thay đổi có thể đã được lưu. Hãy kiểm tra trạng thái đã lưu trước khi tiếp tục.'
        : 'Chưa xác nhận được kết quả lưu. Bản nháp vẫn được giữ; hãy kiểm tra trạng thái trước khi thử lại.';
      throw new Error(message);
    }

    if (currentDraft && policySnapshotsEqual(currentDraft.snapshot, snapshot)) delete state.policyDrafts[childId];
    delete state.policySaveErrors[childId];
    const child = state.children.find((item) => String(item.child_id) === childId);
    const savedChanges = [];
    if (classificationSettingsChanged) savedChanges.push('cài đặt phân loại');
    if (policyUpdates.length) savedChanges.push(`${policyUpdates.length} quy tắc truy cập theo danh mục`);
    const childName = child?.name || 'hồ sơ trẻ';
    const savedMessage = savedChanges.length
      ? `${savedChanges.join(' và ')} của ${childName} đã được lưu.`
      : `Không có thay đổi mới cho ${childName}.`;
    toast('Đã lưu chính sách', savedMessage);
  } catch (error) {
    if (state.policyPendingByChild[childId]?.token === token && !policySaveRequiresRefresh(childId)) {
      state.policySaveErrors[childId] = {
        kind: 'failed',
        requiresRefresh: true,
        failedOperations: operations.map((operation) => operation.descriptor),
      };
      if (!state.policyDrafts[childId]) state.policyDrafts[childId] = { snapshot, revision: 1 };
    }
    throw error;
  } finally {
    if (state.policyPendingByChild[childId]?.token === token) {
      delete state.policyPendingByChild[childId];
      state.policyDataVersions[childId] = (state.policyDataVersions[childId] || 0) + 1;
      syncPolicyFormState(childId);
    }
  }
}

function isCurrentPolicyForm(form) {
  return form?.isConnected && state.page === 'policies'
    && String(state.selectedChildId) === String(form.dataset.childId)
    && Number(form.dataset.renderVersion) === state.policyRenderVersion
    && document.querySelector('#policy-form') === form;
}

async function renderPolicies(content, { focusChildId } = {}) {
  const renderVersion = ++state.policyRenderVersion;
  const requestedChildId = state.selectedChildId == null ? '' : String(state.selectedChildId);
  let children;
  try {
    children = await api('/children?limit=200');
  } catch (error) {
    if (renderVersion !== state.policyRenderVersion || state.page !== 'policies'
      || String(state.selectedChildId ?? '') !== requestedChildId) return;
    throw error;
  }
  if (renderVersion !== state.policyRenderVersion || state.page !== 'policies'
    || String(state.selectedChildId ?? '') !== requestedChildId) return;
  state.children = children;
  state.selectedChildId = reconcileSelectedId(state.selectedChildId, state.children, 'child_id');
  if (!state.selectedChildId) {
    state.categoryPolicies = {};
    content.innerHTML = pageHead('policies') + emptyState('⚙', 'Cần có hồ sơ trẻ', 'Hãy tạo hồ sơ trước khi cấu hình chính sách.', '<button class="btn" data-page="children">Đến trang hồ sơ trẻ</button>');
    return;
  }

  const childId = String(state.selectedChildId);
  const childDataVersion = state.policyDataVersions[childId] || 0;
  let settings;
  let policyResult;
  try {
    [settings, policyResult] = await Promise.all([
      api(`/settings/${childId}`),
      api(`/settings/${childId}/policies`),
    ]);
  } catch (error) {
    if (renderVersion !== state.policyRenderVersion || state.page !== 'policies'
      || String(state.selectedChildId) !== childId
      || (state.policyDataVersions[childId] || 0) !== childDataVersion) return;
    throw error;
  }
  if (renderVersion !== state.policyRenderVersion || state.page !== 'policies'
    || String(state.selectedChildId) !== childId
    || (state.policyDataVersions[childId] || 0) !== childDataVersion) return;

  const savedCategories = Object.fromEntries(
    (policyResult.policies || []).map((item) => [`${item.resource_type}:${item.category}`, item.action])
  );
  const savedSnapshot = {
    settings: Object.fromEntries(policyClassificationFields.map((name) => [name, Boolean(settings[name])])),
    categories: savedCategories,
  };
  state.policyBaselinesByChild[childId] = savedSnapshot;
  const draft = state.policyDrafts[childId];
  if (draft && policySnapshotsEqual(draft.snapshot, savedSnapshot)) delete state.policyDrafts[childId];
  delete state.policySaveErrors[childId];
  const visibleDraft = state.policyDrafts[childId];
  const pending = state.policyPendingByChild[childId];
  const visibleSnapshot = visibleDraft?.snapshot || pending?.snapshot || savedSnapshot;
  const visibleSettings = { ...settings, ...visibleSnapshot.settings };
  state.categoryPolicies = { ...visibleSnapshot.categories };
  const policyStatus = policyStatusForChild(childId);
  const refreshRequired = policySaveRequiresRefresh(childId);
  const saveButton = pending
    ? '<button class="btn" type="submit" disabled>Đang lưu chính sách...</button>'
    : `<button class="btn" type="submit" ${refreshRequired ? 'disabled' : ''}>${refreshRequired ? 'Cần kiểm tra trạng thái' : 'Lưu chính sách'}</button>`;
  const refreshButton = `<button class="btn btn-secondary policy-state-refresh" type="button" data-action="refresh-policy-state" data-id="${escapeHtml(childId)}" ${refreshRequired ? '' : 'hidden'}>Kiểm tra trạng thái đã lưu</button>`;
  content.innerHTML = `
    ${pageHead('policies')}
    <section class="policy-layout policy-settings-layout">
      <aside class="child-picker" aria-labelledby="policy-child-picker-title"><h2 id="policy-child-picker-title">Chọn hồ sơ trẻ</h2>${state.children.map((child) => `<button class="child-pick ${String(child.child_id) === childId ? 'active' : ''}" type="button" aria-pressed="${String(child.child_id) === childId}" data-action="select-policy-child" data-id="${child.child_id}"><span class="mini-avatar">${escapeHtml(initials(child.name))}</span><span><strong>${escapeHtml(child.name)}</strong><small>${child.age == null ? 'Chưa có thông tin tuổi' : `${escapeHtml(child.age)} tuổi`}</small></span></button>`).join('')}</aside>
      <article class="policy-form-panel">
        <form id="policy-form" class="form-grid" data-child-id="${escapeHtml(childId)}" data-render-version="${renderVersion}">
          <section class="setting-section"><h3>Phân loại AI & truy cập</h3><p>Chỉ phân loại và áp dụng chính sách Cho phép/Chặn khi công tắc tương ứng được bật. Khi tắt, nội dung đó được truy cập bình thường.</p>
            ${switchRow('enable_app_classification', 'Phân loại và chặn ứng dụng', 'Ứng dụng thuộc nhóm chặn sẽ nhận yêu cầu đóng; Agent buộc thoát sau 8 giây nếu vẫn chạy. Nội dung chưa lưu có thể bị mất.', visibleSettings.enable_app_classification, true)}
            ${switchRow('enable_web_classification', 'Phân loại website', 'Gán một trong 5 nhãn website rồi áp dụng chính sách truy cập.', visibleSettings.enable_web_classification, true)}
            ${switchRow('enable_text_moderation', 'Phân tích an toàn văn bản', 'Phân tích câu tìm kiếm mới của bé: SAFE không tạo cảnh báo; RISK nhắc phụ huynh quan sát bé trong thời gian này; HIGH_RISK cảnh báo bé có dấu hiệu bị bạo lực. Chưa phân tích nội dung trang hoặc chat. Không lưu nguyên văn câu tìm kiếm trên máy chủ. Thay đổi cần thời gian đồng bộ tới thiết bị.', visibleSettings.enable_text_moderation, true)}
          </section>
          <section class="setting-section"><h3>Quyền truy cập theo danh mục</h3><p>Chọn Cho phép hoặc Chặn cho từng nhóm. Với website, Agent ghi nhớ tên miền đã được AI phân loại và chặn các lần truy cập tiếp theo khi nhóm tương ứng đang chọn Chặn.</p>
            <div class="policy-groups">
              ${categoryPolicyGroup('app', 'Ứng dụng', visibleSettings.enable_app_classification)}
              ${categoryPolicyGroup('web', 'Website', visibleSettings.enable_web_classification)}
            </div>
          </section>
          <div class="form-actions policy-save-bar field full"><span><strong data-policy-draft-status role="status" aria-live="polite" aria-atomic="true">${policyStatus}</strong><small data-policy-sync-guidance>${escapeHtml(policySyncGuidanceForChild(childId))}</small></span>${refreshButton}${saveButton}</div>
        </form>
      </article>
    </section>`;
  if (focusChildId != null) {
    [...content.querySelectorAll('[data-action="select-policy-child"]')]
      .find((button) => String(button.dataset.id) === String(focusChildId))
      ?.focus({ preventScroll: true });
  }
}

function categoryPolicyGroup(resourceType, title, enabled) {
  const view = policyGroupView(String(state.selectedChildId), resourceType, enabled);
  return `<article class="policy-group ${enabled ? '' : 'classification-off'}" data-resource="${resourceType}"><div class="policy-group-head"><div><strong>${title}</strong><small data-policy-group-explanation>${escapeHtml(view.message)}</small></div><span class="badge ${enabled ? '' : 'neutral'}" data-policy-group-availability>${view.availability}</span></div><div class="policy-rule-list">${policyCategoryGroups[resourceType].map(([category, label, description]) => {
    const key = `${resourceType}:${category}`;
    const action = state.categoryPolicies[key] || 'allow';
    const descriptionId = `policy-${resourceType}-${category}-description`;
    return `<label class="policy-rule"><span><strong>${label}</strong><small id="${descriptionId}">${description}</small></span><select class="select policy-action ${action}" name="policy_${resourceType}_${category}" aria-label="Quyền truy cập ${label}, danh mục ${title}" aria-describedby="${descriptionId}"><option value="allow" ${action === 'allow' ? 'selected' : ''}>Cho phép</option><option value="block" ${action === 'block' ? 'selected' : ''}>Chặn</option></select></label>`;
  }).join('')}</div></article>`;
}

function switchRow(name, label, text, checked, policyClassification = false) {
  const childId = String(state.selectedChildId);
  const saveState = policyClassification ? policyClassificationSaveState(childId, name, checked) : '';
  const saveNote = policyClassification ? policyClassificationSaveNote(childId, name, checked, saveState) : '';
  const labelId = policyClassification ? `policy-${name}-label` : '';
  const labelMarkup = policyClassification ? `<strong id="${labelId}">${label}</strong>` : `<strong>${label}</strong>`;
  const accessibleName = policyClassification
    ? `aria-labelledby="${labelId}" aria-describedby="policy-${name}-description policy-${name}-status policy-${name}-note"`
    : '';
  const descriptionMarkup = policyClassification
    ? `<small id="policy-${name}-description">${text}</small>`
    : `<small>${text}</small>`;
  const policyState = policyClassification
    ? `<small id="policy-${name}-status" class="policy-switch-status" data-policy-switch-status="${name}" data-save-state="${saveState}">${saveState}</small><small id="policy-${name}-note" class="policy-switch-note" data-policy-switch-note="${name}" ${saveNote ? '' : 'hidden'}>${saveNote}</small>`
    : '';
  return `<div class="switch-row"><div class="switch-copy">${labelMarkup}${descriptionMarkup}${policyState}</div><label class="switch"><input type="checkbox" name="${name}" ${accessibleName} ${checked ? 'checked' : ''}><span></span></label></div>`;
}

function syncAdminRoleEnrollment(form) {
  const notice = form?.querySelector('[data-face-enrollment-warning]');
  const confirmation = form?.elements.confirm_face_enrollment;
  const role = form?.elements.role?.value;
  const promoting = form?.dataset.originalRole === 'parent' && role === 'admin';
  if (notice) notice.hidden = !promoting;
  if (confirmation) confirmation.required = promoting;
}

function activityRequestCurrent(content, version, session = state.accessToken) {
  return version === activityRenderVersion && state.page === 'activity'
    && Boolean(state.accessToken) && state.accessToken === session && content.isConnected;
}

function activitySurface(content) {
  if (!content.querySelector('#activity-surface')) {
    content.innerHTML = '<div id="activity-load-status" class="muted" role="status" aria-live="polite" aria-atomic="true"></div><div id="activity-surface"></div>';
  }
  return content.querySelector('#activity-surface');
}

function activityStatus(content, message) {
  // Keep the live region outside the busy panel and alive across result replacements.
  content.querySelector('#activity-load-status').textContent = message;
}

function activityPanelStart(busy = false) {
  const tab = state.activityTab;
  return ['apps', 'web', 'screenshots'].filter(key => key !== tab)
    .map(key => `<section id="activity-panel-${key}" role="tabpanel" aria-labelledby="activity-tab-${key}" hidden></section>`).join('')
    + `<section id="activity-panel-${tab}" role="tabpanel" aria-labelledby="activity-tab-${tab}" tabindex="-1" aria-busy="${busy}">`;
}

function activityFeedback(content, phase) {
  const loading = phase === 'loading';
  const label = { apps: 'hoạt động ứng dụng', web: 'hoạt động website', screenshots: 'ảnh màn hình' }[state.activityTab];
  activitySurface(content).innerHTML = pageHead('activity', activityTabs()) + activityPanelStart(loading)
    + (loading ? '' : '<p class="muted">Lựa chọn hiện tại được giữ lại. Kiểm tra kết nối rồi thử lại.</p><button class="btn" data-action="retry-activity">Thử lại</button>')
    + '</section>';
  activityStatus(content, loading ? `Đang tải ${label}…` : `Chưa tải được ${label}.`);
}

function activityFocus(content, interaction) {
  let owned = document.activeElement;
  let relinquished = !interaction || !content.contains(owned);
  const track = (event) => { if (event.target !== owned) relinquished = true; };
  document.addEventListener('focusin', track);
  return {
    restore(finished) {
      if (relinquished) return;
      const tab = content.querySelector(`#activity-tab-${state.activityTab}`);
      const panel = content.querySelector(`#activity-panel-${state.activityTab}`);
      const retry = content.querySelector('[data-action="retry-activity"]');
      const action = finished && ['refresh-screenshots', 'refresh-app-enforcement', 'clear-activity-filter'].includes(interaction)
        ? content.querySelector(`[data-action="${interaction}"]`) : null;
      owned = interaction === 'activity-tab' ? tab : (finished && retry) || action || panel;
      owned?.focus({ preventScroll: interaction === 'activity-tab' });
    },
    dispose() { document.removeEventListener('focusin', track); },
  };
}

async function renderActivity(content, interaction = '') {
  stopScreenshotPolling();
  const renderVersion = ++activityRenderVersion;
  const session = state.accessToken;
  const current = () => activityRequestCurrent(content, renderVersion, session);
  if (!current()) return;
  const focus = activityFocus(content, interaction);
  state.activityViewRows = [];
  activityFeedback(content, 'loading');
  focus.restore(false);
  try {
    if (!state.devices.length) {
      const devices = (await api('/devices?limit=200')).data || [];
      if (!current()) return;
      state.devices = devices;
    }
    if (!current()) return;
    if (state.activityTab === 'screenshots') {
      await renderScreenshotActivity(content, renderVersion);
      return;
    }
    const filter = state.activityFilter || {};
    const path = state.activityTab === 'apps' ? '/logs/app' : '/logs/web';
    const isApps = state.activityTab === 'apps';
    const activityQuery = queryString({
      device_id: filter.device_id,
      start: filter.start,
      end: filter.end,
      limit: 200,
    });
    const [result, enforcement] = await Promise.all([
      api(path + activityQuery),
      isApps ? api('/logs/app-enforcement' + activityQuery)
        .catch(() => ({ error: true, data: [] })) : Promise.resolve(null),
    ]);
    if (!current()) return;
    if (state.activityTab === 'apps') state.appLogs = result.data || [];
    else state.webLogs = result.data || [];
    const allRows = state.activityTab === 'apps' ? state.appLogs : state.webLogs;
    const search = String(filter.search || '').trim().toLowerCase();
    const filteredRows = allRows.filter((item) => {
      const text = state.activityTab === 'apps'
        ? `${item.app_name || ''} ${deviceName(item.device_id)}`
        : `${websiteActivityTitle(item)} ${item.domain || ''} ${item.url || ''} ${deviceName(item.device_id)}`;
      return (!search || text.toLowerCase().includes(search))
        && (!filter.category || String(item.category || 'unknown') === String(filter.category))
        && (!filter.access_status || String(item.access_status || 'open') === String(filter.access_status));
    });
    const maxOffset = Math.max(0, Math.floor(Math.max(0, filteredRows.length - 1) / state.activityLimit) * state.activityLimit);
    state.activityOffset = Math.min(state.activityOffset, maxOffset);
    const rows = filteredRows.slice(state.activityOffset, state.activityOffset + state.activityLimit);
    state.activityViewRows = filteredRows;
    const categories = policyCategoryGroups[state.activityTab === 'apps' ? 'app' : 'web'];
    const pageNumber = Math.floor(state.activityOffset / state.activityLimit) + 1;
    const pageCount = Math.max(1, Math.ceil(filteredRows.length / state.activityLimit));
    const filteredDuration = filteredRows.reduce((sum, item) => sum + (Number(item.duration_seconds) || 0), 0);
    const blockedCount = filteredRows.filter((item) => String(item.access_status || 'open') === 'blocked').length;
    const activeDeviceCount = new Set(filteredRows.map((item) => String(item.device_id))).size;
    activitySurface(content).innerHTML = `
      ${pageHead('activity', `<div class="activity-head-actions">${activityTabs()}<button class="btn btn-secondary" data-action="export-activity" ${filteredRows.length ? '' : 'disabled'}>Xuất kết quả CSV</button></div>`)}
      ${activityPanelStart()}
      <p class="activity-note">Trang tải tối đa 200 bản ghi gần nhất theo thiết bị và khoảng thời gian đã áp dụng. Khi chọn tất cả thiết bị, giới hạn này tính chung, không phải cho từng thiết bị. Tìm kiếm, danh mục và trạng thái chỉ lọc trong tập đã tải.</p>
      <section class="page-summary-strip" aria-label="Tóm tắt kết quả sau lọc trong tập đã tải">
        <div class="activity-summary-primary"><span><small>Bản ghi phù hợp</small><strong>${filteredRows.length} bản ghi</strong></span></div>
        <div><span><small>Thời lượng các kết quả</small><strong>${duration(filteredDuration)}</strong></span></div>
        <div><span><small>${isApps ? 'Bản ghi thuộc nhóm chặn' : 'Bản ghi có trạng thái chặn'}</small><strong>${blockedCount} lượt</strong></span></div>
        <div><span><small>Thiết bị trong kết quả</small><strong>${activeDeviceCount} thiết bị</strong></span></div>
      </section>
      <p class="activity-note">Các chỉ số và CSV gồm toàn bộ kết quả sau lọc trong tập đã tải, kể cả các trang kết quả khác. Thời lượng là tổng của các bản ghi này, không đại diện cho toàn bộ thời gian sử dụng.</p>
      <form id="activity-filter" class="filters activity-filters">
        <div class="field"><label>Tìm kiếm</label><input class="input" name="search" value="${escapeHtml(filter.search || '')}" placeholder="${state.activityTab === 'apps' ? 'Tên ứng dụng' : 'YouTube, tên miền hoặc URL'}"></div>
        <div class="field"><label>Thiết bị</label><select class="select" name="device_id"><option value="">Tất cả thiết bị</option>${state.devices.map((d) => `<option value="${d.device_id}" ${String(filter.device_id) === String(d.device_id) ? 'selected' : ''}>${escapeHtml(d.device_name)}</option>`).join('')}</select></div>
        <div class="field"><label>Danh mục</label><select class="select" name="category"><option value="">Tất cả danh mục</option>${categories.map(([value, label]) => `<option value="${value}" ${filter.category === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
        <div class="field"><label>${isApps ? 'Chính sách hiện tại' : 'Trạng thái hiện tại'}</label><select class="select" name="access_status"><option value="">Tất cả trạng thái</option><option value="blocked" ${filter.access_status === 'blocked' ? 'selected' : ''}>${isApps ? 'Yêu cầu chặn' : 'Đã chặn'}</option><option value="open" ${filter.access_status === 'open' ? 'selected' : ''}>${isApps ? 'Cho phép' : 'Đang mở'}</option></select></div>
        <div class="field"><label>Từ thời điểm</label><input class="input" type="datetime-local" name="start" value="${escapeHtml(filter.start || '')}"></div>
        <div class="field"><label>Đến thời điểm</label><input class="input" type="datetime-local" name="end" value="${escapeHtml(filter.end || '')}"></div>
        <div class="filter-actions"><button class="btn btn-ghost" type="button" data-action="clear-activity-filter">Xóa lọc</button><button class="btn" type="submit">Áp dụng</button></div>
      </form>
      <p class="activity-note">Khoảng thời gian được lọc theo ${isApps ? 'lúc ứng dụng bắt đầu hoạt động' : 'lúc truy cập website'}.</p>
      <section class="table-card activity-history"><div class="table-scroll"><table><thead><tr>${state.activityTab === 'apps' ? '<th>Ứng dụng</th><th>Danh mục</th><th>Chính sách hiện tại</th><th>Bắt đầu</th><th>Kết thúc</th>' : '<th>Website</th><th>Danh mục</th><th>Trạng thái hiện tại</th><th>Truy cập</th><th>Thiết bị</th>'}<th>Thời lượng</th></tr></thead><tbody>${rows.map((item) => {
        if (state.activityTab === 'apps') {
          return `<tr><td class="cell-title"><strong>${escapeHtml(item.app_name)}</strong><small>${escapeHtml(deviceName(item.device_id))}</small></td><td>${categoryBadge(item.category)}</td><td>${accessStatusBadge(item.access_status, 'app')}</td><td>${formatDate(item.start_time)}</td><td>${formatDate(item.end_time)}</td><td>${duration(item.duration_seconds)}</td></tr>`;
        }
        const externalUrl = safeExternalUrl(item.url);
        const subtitle = websiteActivitySubtitle(item);
        return `<tr><td class="cell-title website-cell"><strong>${escapeHtml(websiteActivityTitle(item))}</strong>${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''}${externalUrl ? `<a href="${escapeHtml(externalUrl)}" target="_blank" rel="noopener noreferrer">Mở website ↗</a>` : ''}</td><td>${categoryBadge(item.category)}</td><td>${accessStatusBadge(item.access_status)}</td><td>${formatDate(item.visit_time)}</td><td>${escapeHtml(deviceName(item.device_id))}</td><td>${duration(item.duration_seconds)}</td></tr>`;
      }).join('')}</tbody></table></div>${rows.length ? `<div class="table-footer"><span>Hiển thị ${state.activityOffset + 1}–${state.activityOffset + rows.length} / ${filteredRows.length} bản ghi phù hợp</span><div class="pagination"><button class="btn btn-secondary btn-sm" data-action="activity-page" data-offset="${Math.max(0, state.activityOffset - state.activityLimit)}" ${state.activityOffset === 0 ? 'disabled' : ''}>Trước</button><span>Trang ${pageNumber}/${pageCount}</span><button class="btn btn-secondary btn-sm" data-action="activity-page" data-offset="${state.activityOffset + state.activityLimit}" ${state.activityOffset + state.activityLimit >= filteredRows.length ? 'disabled' : ''}>Sau</button></div><span>Thời lượng các kết quả: ${duration(filteredDuration)}</span></div>` : emptyState('↗',
        allRows.length ? 'Không có kết quả phù hợp' : 'Chưa có bản ghi trong phạm vi đã chọn',
        allRows.length ? 'Thử đổi từ khóa, danh mục hoặc trạng thái. Các bộ lọc này chỉ tìm trong tối đa 200 bản ghi đã tải.'
          : 'Thử đổi thiết bị hoặc khoảng thời gian. Nếu vẫn chưa có dữ liệu, kiểm tra kết nối Agent.')}</section>
      ${isApps ? appEnforcementMarkup(enforcement, filter) : ''}
    </section>`;
    activityStatus(content, `Có ${filteredRows.length} bản ghi phù hợp trong ${allRows.length} bản ghi đã tải. Trang ${pageNumber}/${pageCount}.`);
  } catch (error) {
    if (current()) activityFeedback(content, 'error');
  } finally {
    if (current()) focus.restore(true);
    focus.dispose();
  }
}

function appEnforcementMarkup(result, filter = {}) {
  const outcomes = { closed: 'Đã đóng ứng dụng', failed: 'Chặn thất bại', cancelled: 'Đã hủy yêu cầu' };
  const reasons = {
    graceful_exit: 'Ứng dụng đã thoát sau yêu cầu đóng', terminated: 'Agent đã buộc ứng dụng thoát',
    access_denied: 'Không đủ quyền đóng ứng dụng', termination_timeout: 'Chưa xác nhận được ứng dụng đã thoát',
    policy_changed: 'Chính sách đã thay đổi', session_changed: 'Phiên sử dụng đã thay đổi', service_stopped: 'Agent đã dừng',
  };
  const search = String(filter.search || '').trim().toLowerCase();
  const rows = (result?.data || []).filter((item) =>
    (!search || `${item.app_name} ${deviceName(item.device_id)}`.toLowerCase().includes(search))
    && (!filter.category || item.category === filter.category)).slice(0, 10);
  return `<section class="card activity-enforcement" aria-labelledby="app-enforcement-title"><div class="card-head"><div><h2 id="app-enforcement-title">Kết quả chặn ứng dụng</h2><p>Tối đa 10 kết quả phù hợp trong 200 kết quả chặn gần nhất đã tải theo thiết bị và thời gian. Lọc thêm theo tìm kiếm và danh mục; không áp dụng bộ lọc Chính sách hiện tại. Chính sách yêu cầu chặn chưa xác nhận ứng dụng đã đóng.</p></div><button class="btn btn-secondary btn-sm" data-action="refresh-app-enforcement">Làm mới</button></div>${result?.error
    ? '<div class="card-body" role="status">Chưa tải được kết quả chặn. Nhấn Làm mới để thử lại.</div>'
    : rows.length ? `<div class="table-scroll"><table><thead><tr><th>Ứng dụng</th><th>Danh mục</th><th>Kết quả Agent xác nhận</th><th>Thời điểm</th></tr></thead><tbody>${rows.map((item) => `<tr><td class="cell-title"><strong>${escapeHtml(item.app_name)}</strong><small>${escapeHtml(deviceName(item.device_id))}</small></td><td>${categoryBadge(item.category)}</td><td><span class="badge ${item.outcome === 'failed' ? 'red' : item.outcome === 'closed' ? 'blue' : 'neutral'}">${escapeHtml(outcomes[item.outcome] || 'Chưa xác định')}</span><div class="muted">${escapeHtml(reasons[item.reason] || '')}</div></td><td>${formatDate(item.occurred_at)}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="card-body">${result?.data?.length
        ? 'Không có kết quả chặn phù hợp. Thử đổi từ khóa hoặc danh mục trong tập kết quả đã tải.'
        : 'Chưa có kết quả chặn trong phạm vi đã chọn. Thử đổi thiết bị hoặc khoảng thời gian; thiết bị cần kết nối Agent hỗ trợ chặn ứng dụng để gửi kết quả.'}</div>`}</section>`;
}

function activityTabs() {
  return `<nav class="tabs activity-tabs" role="tablist" aria-label="Loại hoạt động">${[
    ['apps', 'Ứng dụng'], ['web', 'Website'], ['screenshots', 'Giám sát màn hình'],
  ].map(([key, label]) => `<button id="activity-tab-${key}" role="tab" aria-controls="activity-panel-${key}" aria-selected="${state.activityTab === key}" tabindex="${state.activityTab === key ? 0 : -1}" class="tab ${state.activityTab === key ? 'active' : ''}" data-action="activity-tab" data-tab="${key}" ${state.activityTab === key ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav>`;
}

function screenshotDataUrl(value) {
  const base64 = typeof value === 'string' ? value.replace(/\s/g, '') : '';
  return base64 && /^[A-Za-z0-9+/]+={0,2}$/.test(base64) ? `data:image/jpeg;base64,${base64}` : '';
}

function screenshotQuery(metadata = false) {
  const filter = state.activityFilter || {};
  const date = (value) => value ? new Date(value).toISOString() : undefined;
  return queryString({ device_id: filter.device_id, start: date(filter.start), end: date(filter.end),
    limit: 12, offset: state.activityOffset, metadata: metadata ? '1' : undefined });
}

function screenshotSignature(result) {
  return JSON.stringify([result.total, result.latest_id, result.scope_total, result.scope_latest_id, result.devices]);
}

function screenshotInteractionActive(content) {
  if (document.hidden || modalRoot.firstElementChild || state.screenshotControlOperation
      || (content.contains(document.activeElement)
        && document.activeElement?.matches('input, select, textarea, button:focus-visible, a:focus-visible'))) return true;
  // Keep unapplied edits even after focus leaves the form. Pointer-focused
  // buttons can refresh; keyboard-focused controls keep their place in the DOM.
  const form = content.querySelector?.('#activity-filter');
  return Boolean(form && ['device_id', 'start', 'end'].some((name) =>
    String(form.elements.namedItem(name)?.value || '') !== String(state.activityFilter?.[name] || '')));
}

function scheduleScreenshotRefresh(content, renderVersion) {
  stopScreenshotPolling();
  const pending = (state.screenshotDevices || []).some((device) => device.pending_request_id);
  screenshotRefreshTimer = setTimeout(async () => {
    if (state.page !== 'activity' || state.activityTab !== 'screenshots' || !state.accessToken
        || renderVersion !== activityRenderVersion || !content.isConnected) return;
    if (screenshotInteractionActive(content)) {
      scheduleScreenshotRefresh(content, renderVersion);
      return;
    }
    try {
      // Check IDs/status first; download JPEG thumbnails only when the gallery changes.
      const result = await api('/logs/screenshots' + screenshotQuery(true), { cache: 'no-store' });
      if (renderVersion !== activityRenderVersion || !content.isConnected) return;
      if (!screenshotInteractionActive(content)
          && (state.screenshotPollError || screenshotSignature(result) !== state.screenshotSignature)) {
        return await renderScreenshotActivity(content, renderVersion, true);
      }
    } catch (error) {
      if (renderVersion !== activityRenderVersion || !content.isConnected) return;
      state.screenshotPollError = true;
      const status = document.querySelector('#screenshot-capture-status');
      if (status) status.textContent = 'Kết nối đang gián đoạn. Ảnh đã tải vẫn được giữ; trang sẽ tự thử lại.';
    }
    scheduleScreenshotRefresh(content, renderVersion);
  }, state.screenshotPollError ? 30_000 : pending ? 2_000 : 15_000);
}

async function renderScreenshotActivity(content, renderVersion, background = false) {
  const filter = state.activityFilter || {};
  const session = state.accessToken;
  let result;
  try {
    result = await api('/logs/screenshots' + screenshotQuery(), { cache: 'no-store' });
  } catch (error) {
    if (!activityRequestCurrent(content, renderVersion, session)) return;
    state.screenshotPollError = true;
    if (background) {
      scheduleScreenshotRefresh(content, renderVersion);
      return;
    }
    activityFeedback(content, 'error');
    scheduleScreenshotRefresh(content, renderVersion);
    return;
  }
  if (!activityRequestCurrent(content, renderVersion, session) || state.activityTab !== 'screenshots') return;
  if (background && screenshotInteractionActive(content)) {
    scheduleScreenshotRefresh(content, renderVersion);
    return;
  }
  const rows = result.data || [];
  const total = Number(result.total) || 0;
  if (!rows.length && total > 0 && state.activityOffset > 0) {
    state.activityOffset = Math.floor((total - 1) / 12) * 12;
    return renderScreenshotActivity(content, renderVersion, background);
  }
  state.activityViewRows = [];
  state.screenshotRows = rows;
  state.screenshotSignature = screenshotSignature(result);
  state.screenshotPollError = false;
  state.screenshotDevices = result.devices || [];
  const monitor = state.screenshotDevices.find((device) => String(device.device_id) === String(filter.device_id))
    || (!filter.device_id && state.screenshotDevices.length === 1 ? state.screenshotDevices[0] : null);
  const pending = Boolean(monitor?.enabled && monitor.pending_request_id);
  const keepPanelFocus = background && document.activeElement === content.querySelector('#activity-panel-screenshots');
  activitySurface(content).innerHTML = `
    ${pageHead('activity', `<div class="activity-head-actions">${activityTabs()}<button class="btn btn-secondary" data-action="refresh-screenshots">${icons.refresh} Làm mới</button><button class="btn btn-secondary" data-action="clear-screenshots" ${!state.screenshotDevices.length ? 'disabled' : ''}>Xóa tất cả ảnh</button></div>`)}
    ${activityPanelStart()}
    <section class="screen-monitor-intro"><div><h2>Giám sát màn hình</h2><p>Ảnh chụp màn hình chính từ thiết bị của con, mới nhất ở đầu danh sách.</p></div><p class="screen-monitor-policy">Khi bật: chụp mỗi ${Math.round(Number(result.capture_interval_seconds || 300) / 60)} phút · Lưu ${Number(result.retention_days) || 7} ngày</p></section>
    <form id="activity-filter" class="filters screenshot-filters">
      <div class="field"><label for="screen-device">Thiết bị</label><select id="screen-device" class="select" name="device_id"><option value="">Tất cả thiết bị</option>${state.devices.map((device) => `<option value="${device.device_id}" ${String(filter.device_id) === String(device.device_id) ? 'selected' : ''}>${escapeHtml(device.device_name)}</option>`).join('')}</select></div>
      <div class="field"><label for="screen-start">Từ thời điểm</label><input id="screen-start" class="input" type="datetime-local" name="start" value="${escapeHtml(filter.start || '')}"></div>
      <div class="field"><label for="screen-end">Đến thời điểm</label><input id="screen-end" class="input" type="datetime-local" name="end" value="${escapeHtml(filter.end || '')}"></div>
      <div class="filter-actions"><button class="btn btn-ghost" type="button" data-action="clear-activity-filter">Xóa lọc</button><button class="btn" type="submit">Áp dụng</button></div>
    </form>
    <p class="activity-note">Nhấn Áp dụng để cập nhật danh sách ảnh theo thiết bị và thời gian đã chọn. Yêu cầu chụp ngay dùng thiết bị đang chọn, không cần nhấn Áp dụng.</p>
    <section id="screenshot-capture-controls" tabindex="-1" aria-label="Điều khiển chụp ảnh">${screenshotCaptureControls(monitor)}</section>
    <div class="screen-monitor-summary"><span>${total} ảnh phù hợp</span><span>${pending ? 'Kiểm tra ảnh mới mỗi 2 giây' : 'Tự cập nhật ảnh mới'}</span></div>
    ${rows.length ? `<section class="screenshot-grid" aria-label="Ảnh màn hình thiết bị">${rows.map((item) => `<figure class="screenshot-card">
      <button class="screenshot-preview" data-action="view-screenshot" data-id="${escapeHtml(item.screenshot_id)}" aria-label="Xem ảnh ${escapeHtml(deviceName(item.device_id))}, ${escapeHtml(formatDate(item.captured_at))}"><img src="${screenshotDataUrl(item.thumbnail_base64)}" alt="Ảnh màn hình ${escapeHtml(deviceName(item.device_id))}" width="${Number(item.width)}" height="${Number(item.height)}" loading="lazy" decoding="async"><span>Xem ảnh lớn</span></button>
      <figcaption><div><strong>${escapeHtml(deviceName(item.device_id))}</strong><time datetime="${escapeHtml(item.captured_at)}">${formatDate(item.captured_at)}</time></div><button class="btn btn-ghost btn-sm screenshot-delete" data-action="delete-screenshot" data-id="${escapeHtml(item.screenshot_id)}" aria-label="Xóa ảnh ${escapeHtml(deviceName(item.device_id))} lúc ${escapeHtml(formatDate(item.captured_at))}">Xóa ảnh</button></figcaption></figure>`).join('')}</section>
      <nav class="screenshot-pagination" aria-label="Phân trang ảnh màn hình"><span>${state.activityOffset + 1}–${state.activityOffset + rows.length} / ${total} ảnh</span><div><button class="btn btn-secondary btn-sm" data-action="activity-page" data-offset="${Math.max(0, state.activityOffset - 12)}" ${state.activityOffset === 0 ? 'disabled' : ''}>Trước</button><button class="btn btn-secondary btn-sm" data-action="activity-page" data-offset="${state.activityOffset + 12}" ${state.activityOffset + rows.length >= total ? 'disabled' : ''}>Sau</button></div></nav>`
      : emptyState(icons.device, filter.start || filter.end ? 'Không có ảnh phù hợp bộ lọc' : 'Chưa có ảnh màn hình', 'Khi bật chụp ảnh, ảnh mới sẽ xuất hiện tại đây sau khi Agent gửi lên. Máy của con cần kết nối mạng và Windows đang mở khóa.')}</section>`;
  activityStatus(content, `Đã tải ${rows.length} ảnh. Trang ${Math.floor(state.activityOffset / 12) + 1}.`);
  if (keepPanelFocus) content.querySelector('#activity-panel-screenshots')?.focus({ preventScroll: true });
  scheduleScreenshotRefresh(content, renderVersion);
}

function confirmScreenshotDelete(id) {
  const item = (state.screenshotRows || []).find((row) => String(row.screenshot_id) === String(id));
  if (!item) return;
  const previousModal = modalRoot.firstElementChild;
  showModal('Xóa ảnh màn hình này?',
    `Ảnh của ${deviceName(item.device_id)} lúc ${formatDate(item.captured_at)} sẽ bị xóa vĩnh viễn. Không thể hoàn tác.`,
    `<div class="form-actions"><button class="btn btn-secondary" data-action="close-modal">Hủy</button><button class="btn btn-danger" data-action="confirm-delete-screenshot" data-id="${escapeHtml(id)}">Xóa ảnh</button></div>`);
  const createdModal = modalRoot.firstElementChild;
  if (createdModal && createdModal !== previousModal) {
    createdModal.querySelector('.modal')?.classList.add('activity-screenshot-dialog');
  }
}

async function confirmClearScreenshots() {
  function showScreenshotDialog(...args) {
    const previousModal = modalRoot.firstElementChild;
    const result = showModal(...args);
    const createdModal = modalRoot.firstElementChild;
    if (createdModal && createdModal !== previousModal) {
      createdModal.querySelector('.modal')?.classList.add('activity-screenshot-dialog');
    }
    return result;
  }
  const deviceId = document.querySelector('#screen-device')?.value || '';
  const version = activityRenderVersion;
  showScreenshotDialog('Xóa tất cả ảnh?', 'Đang kiểm tra dữ liệu ảnh…', '<p role="status">Đang tải phạm vi xóa.</p>');
  const modal = modalRoot.firstElementChild;
  try {
    const result = await api('/logs/screenshots' + queryString({ device_id: deviceId || undefined, metadata: '1' }), { cache: 'no-store' });
    if (version !== activityRenderVersion || modalRoot.firstElementChild !== modal) return;
    if (!result.scope_latest_id) {
      return showScreenshotDialog('Không có ảnh để xóa', 'Thiết bị đã chọn chưa có ảnh được lưu.',
        '<div class="form-actions"><button class="btn btn-secondary" data-action="close-modal">Đóng</button></div>');
    }
    const scope = deviceId ? `thiết bị ${deviceName(deviceId)}` : 'tất cả thiết bị thuộc tài khoản của bạn';
    showScreenshotDialog('Xóa tất cả ảnh?',
      `Xóa ${Number(result.scope_total)} ảnh của ${scope}, kể cả ảnh ngoài bộ lọc thời gian. Không thể hoàn tác. Ảnh mới chụp sau lúc mở hộp thoại này vẫn được giữ; thao tác xóa không thay đổi cài đặt chụp tự động.`,
      `<div class="form-actions"><button class="btn btn-secondary" data-action="close-modal">Hủy</button><button class="btn btn-danger" data-action="confirm-clear-screenshots" data-device-id="${escapeHtml(deviceId)}" data-through-id="${escapeHtml(result.scope_latest_id)}">Xóa tất cả ảnh</button></div>`);
  } catch (error) {
    if (version !== activityRenderVersion || modalRoot.firstElementChild !== modal) return;
    showScreenshotDialog('Chưa tải được phạm vi xóa', 'Kiểm tra kết nối rồi thử lại.',
      '<div class="form-actions"><button class="btn btn-secondary" data-action="close-modal">Đóng</button><button class="btn" data-action="clear-screenshots">Thử lại</button></div>');
  }
}

async function deleteScreenshots(button, all = false) {
  const version = activityRenderVersion;
  const modal = modalRoot.firstElementChild;
  const endpoint = all ? '/logs/screenshots' + queryString({ device_id: button.dataset.deviceId || undefined })
    : '/logs/screenshots/' + encodeURIComponent(button.dataset.id);
  const result = await api(endpoint, { method: 'DELETE', ...(all ? {
    body: { confirm_all: true, through_id: button.dataset.throughId },
  } : {}) });
  if (version !== activityRenderVersion) return;
  if (modalRoot.firstElementChild === modal) closeModal();
  state.activityOffset = 0;
  toast('Đã xóa ảnh', `Đã xóa ${Number(result.deleted)} ảnh.`);
  await renderActivity(document.querySelector('#page-content'));
}

function screenshotCaptureTarget() {
  // Read the visible selection even before Apply, so the action always targets
  // the device the parent sees in the filter, never another child's device.
  const selected = document.querySelector('#screen-device')?.value ?? state.activityFilter?.device_id ?? '';
  const monitors = state.screenshotDevices || [];
  return monitors.find((device) => String(device.device_id) === String(selected))
    || (!selected && monitors.length === 1 ? monitors[0] : null);
}

function screenshotCaptureControls(monitor) {
  const operation = state.screenshotControlOperation;
  const pending = Boolean(monitor?.enabled && monitor.pending_request_id);
  const captureStatus = operation ? (operation.enabled ? 'Đang gửi yêu cầu chụp ảnh…' : 'Đang gửi yêu cầu dừng chụp ảnh…')
    : !(state.screenshotDevices || []).length ? 'Chưa có thiết bị để chụp ảnh.'
      : !monitor ? 'Chọn một thiết bị ở bộ lọc để bắt đầu hoặc dừng chụp ảnh.'
        : !monitor.enabled ? 'Chụp định kỳ đang tắt. Agent dừng khi nhận cấu hình này; ảnh đã lưu vẫn được giữ. Nhấn Bắt đầu chụp ảnh để bật lại.'
          : pending ? (monitor.online ? 'Đã gửi yêu cầu. Đang chờ Agent chụp và gửi ảnh; trang kiểm tra mỗi 2 giây.'
            : 'Đã gửi yêu cầu. Thiết bị đang ngoại tuyến; Agent cần kết nối lại trong 3 phút để nhận yêu cầu chụp ngay.')
            : monitor.request_expired ? 'Chưa nhận được ảnh từ yêu cầu trước. Kiểm tra kết nối Agent hoặc nhấn Dừng chụp ảnh để tắt lịch chụp.'
              : 'Giám sát đang bật. Agent tự chụp định kỳ; nhấn Dừng chụp ảnh để ngừng chụp và gửi ảnh mới.';
  const scope = monitor ? `Chụp ngay: ${deviceName(monitor.device_id)}. Bắt đầu cũng bật chụp định kỳ nếu đang tắt. Bật/dừng chụp định kỳ áp dụng cho tất cả thiết bị cùng hồ sơ trẻ khi Agent nhận cấu hình; ảnh đã lưu vẫn được giữ. Gửi yêu cầu thành công sẽ chuyển danh sách sang thiết bị này và bỏ lọc thời gian để xem ảnh mới.`
    : 'Chọn một thiết bị để gửi yêu cầu chụp ngay và xem phạm vi bật/dừng chụp định kỳ.';
  return `<div class="form-actions form-actions-start" role="group" aria-label="Bật hoặc dừng chụp ảnh" aria-describedby="screenshot-capture-scope">
    <button class="btn" data-action="start-screenshot" ${operation || pending || !monitor ? 'disabled' : ''}>${operation?.enabled ? 'Đang gửi yêu cầu…' : pending ? 'Đang chờ ảnh…' : 'Bắt đầu chụp ảnh'}</button>
    <button class="btn btn-secondary" data-action="stop-screenshot" ${operation || !monitor?.enabled ? 'disabled' : ''}>${operation && !operation.enabled ? 'Đang dừng…' : 'Dừng chụp ảnh'}</button>
    </div><p id="screenshot-capture-status" role="status">${captureStatus}</p><p id="screenshot-capture-scope">${escapeHtml(scope)}</p>`;
}

function updateScreenshotCaptureControls() {
  const controls = document.querySelector('#screenshot-capture-controls');
  if (!controls) return;
  const focusedAction = document.activeElement?.dataset?.action;
  const keepFocus = controls.contains?.(document.activeElement);
  controls.innerHTML = screenshotCaptureControls(screenshotCaptureTarget());
  if (keepFocus) {
    const previous = ['start-screenshot', 'stop-screenshot'].includes(focusedAction)
      ? controls.querySelector(`[data-action="${focusedAction}"]:not(:disabled)`) : null;
    (previous || controls.querySelector('button:not(:disabled)') || controls).focus({ preventScroll: true });
  }
}

function updateScreenshotCapturePolicy(childId, enabled) {
  for (const monitor of state.screenshotDevices || []) {
    const device = state.devices.find((item) => String(item.device_id) === String(monitor.device_id));
    if (String(device?.child_id) === String(childId)) {
      monitor.enabled = enabled;
      monitor.pending_request_id = null;
      monitor.request_expired = false;
    }
  }
}

async function startScreenshotCapture(button) {
  return setScreenshotCapture(button, true);
}

async function stopScreenshotCapture(button) {
  return setScreenshotCapture(button, false);
}

async function setScreenshotCapture(button, enabled) {
  if (state.screenshotControlOperation) return;
  const target = screenshotCaptureTarget();
  if (!target) {
    document.querySelector('#screen-device')?.focus();
    return toast('Chọn thiết bị', 'Chọn một thiết bị trong bộ lọc để bắt đầu hoặc dừng chụp ảnh.', 'error');
  }
  const device = state.devices.find((item) => String(item.device_id) === String(target.device_id));
  if (!device?.child_id) return toast('Chưa xác định được hồ sơ con', 'Hãy tải lại trang rồi thử lại.', 'error');
  const version = ++activityRenderVersion;
  const operation = { enabled };
  state.screenshotControlOperation = operation;
  stopScreenshotPolling();
  updateScreenshotCaptureControls();
  const ownsOperation = () => state.screenshotControlOperation === operation;
  const onScreenshotPage = () => state.page === 'activity' && state.activityTab === 'screenshots';
  let resumed = false;
  try {
    if (!enabled || target.enabled !== true) {
      await api(`/settings/${encodeURIComponent(device.child_id)}`, { method: 'PUT', body: { enable_screenshot_review: enabled } });
      if (!ownsOperation()) return;
      updateScreenshotCapturePolicy(device.child_id, enabled);
      resumed = enabled;
    }
    if (!ownsOperation() || !onScreenshotPage()) return;
    if (!enabled) {
      toast('Đã tắt chụp định kỳ', 'Agent sẽ dừng khi nhận cấu hình mới. Ảnh đã lưu vẫn được giữ.');
      return;
    }
    const result = await api('/logs/screenshots/request', { method: 'POST', body: { device_id: target.device_id } });
    if (!ownsOperation() || !onScreenshotPage()) return;
    const requested = state.screenshotDevices.find((monitor) => String(monitor.device_id) === String(target.device_id));
    if (requested) requested.pending_request_id = result.request_id || null;
    // A manual refresh or filter change must not strand disabled controls or
    // let this completion reset the parent's newer selection.
    if (version !== activityRenderVersion) return;
    // Clear date restrictions so the requested fresh image cannot be hidden.
    state.activityFilter = { device_id: String(target.device_id) };
    state.activityOffset = 0;
    const controls = document.querySelector('#screenshot-capture-controls');
    const keepFocus = controls?.contains(document.activeElement);
    button.blur?.();
    toast('Đã gửi yêu cầu chụp ảnh', result.online ? 'Đang chờ Agent gửi ảnh lên.' : 'Thiết bị đang ngoại tuyến. Yêu cầu có hiệu lực 3 phút.');
    state.screenshotControlOperation = null;
    await renderActivity(document.querySelector('#page-content'));
    if (keepFocus && onScreenshotPage() && activityRenderVersion === version + 1
        && document.activeElement === document.body) {
      document.querySelector('#screenshot-capture-controls button:not(:disabled)')?.focus({ preventScroll: true });
    }
  } catch (error) {
    if (!ownsOperation() || !onScreenshotPage()) return;
    button.disabled = false;
    button.textContent = enabled ? 'Bắt đầu chụp ảnh' : 'Dừng chụp ảnh';
    toast(resumed ? 'Đã bật chụp định kỳ, chưa yêu cầu được ảnh ngay' : enabled ? 'Chưa bắt đầu chụp ảnh' : 'Chưa dừng được chụp ảnh', error.message, 'error');
  } finally {
    if (ownsOperation()) {
      state.screenshotControlOperation = null;
      if (onScreenshotPage()) {
        updateScreenshotCaptureControls();
        const content = document.querySelector('#page-content');
        if (content) scheduleScreenshotRefresh(content, activityRenderVersion);
      }
    }
  }
}

async function viewScreenshot(id) {
  const previousModal = modalRoot.firstElementChild;
  showModal('Ảnh màn hình', 'Đang tải ảnh…', '<p role="status">Đang tải ảnh màn hình.</p>');
  const requestModal = modalRoot.firstElementChild;
  if (requestModal && requestModal !== previousModal) {
    requestModal.querySelector('.modal')?.classList.add('screenshot-modal', 'activity-screenshot-dialog');
  }
  try {
    const result = await api(`/logs/screenshots/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (modalRoot.firstElementChild !== requestModal) return;
    modalRoot.querySelector('#modal-description').textContent = `${deviceName(result.device_id)} · ${formatDate(result.captured_at)}`;
    modalRoot.querySelector('.modal-body').innerHTML = `<img class="screenshot-full" src="${screenshotDataUrl(result.image_base64)}" alt="Ảnh màn hình ${escapeHtml(deviceName(result.device_id))} lúc ${escapeHtml(formatDate(result.captured_at))}">`;
  } catch (error) {
    if (modalRoot.firstElementChild !== requestModal) return;
    modalRoot.querySelector('#modal-description').textContent = error.status === 404 ? 'Ảnh đã hết hạn hoặc không còn tồn tại.' : 'Không thể tải ảnh. Hãy đóng cửa sổ và thử lại.';
    modalRoot.querySelector('.modal-body').innerHTML = '';
  }
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportActivityCsv() {
  const isApps = state.activityTab === 'apps';
  const headers = isApps
    ? ['Ứng dụng', 'Danh mục', 'Chính sách hiện tại', 'Thiết bị', 'Bắt đầu', 'Kết thúc', 'Thời lượng (giây)']
    : ['Tiêu đề', 'Tên miền', 'URL', 'Danh mục', 'Trạng thái hiện tại', 'Thiết bị', 'Truy cập', 'Thời lượng (giây)'];
  const records = state.activityViewRows.map((item) => isApps
    ? [item.app_name, categoryLabel(item.category), accessStatusLabel(item.access_status, 'app'), deviceName(item.device_id), item.start_time, item.end_time, item.duration_seconds]
    : [websiteActivityTitle(item), item.domain, item.url, categoryLabel(item.category), accessStatusLabel(item.access_status), deviceName(item.device_id), item.visit_time, item.duration_seconds]);
  const csv = `\uFEFF${[headers, ...records].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `safenest-${state.activityTab}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function renderAlerts(content, { background = false, markIds = null, reset = false, focusTarget = null } = {}) {
  // State belongs to this mounted page, never to a new route or session.
  let view = content.alertsView;
  if (!view || view.session !== state.accessToken) {
    view = content.alertsView = { session: state.accessToken, pending: null, valid: false, filterKey: null, outcome: '' };
  }
  if (background && view.pending) return { status: 'ignored' };
  if (markIds && (view.pending || !view.valid)) return { status: 'ignored' };
  const version = state.alertRenderVersion = (state.alertRenderVersion || 0) + 1;
  const session = state.accessToken;
  const filter = { ...state.alertFilter };
  const filterKey = queryString(filter);
  const token = {};
  const contextCurrent = () => content.alertsView === view && session === state.accessToken
    && state.role === 'parent' && state.page === 'alerts' && content.isConnected
    && queryString(state.alertFilter || {}) === filterKey;
  const current = () => contextCurrent() && version === state.alertRenderVersion;
  if (!current()) return { status: 'ignored' };
  if (!background) {
    if (view.pending) {
      // Detach an older mutation's busy controls before its shared finally runs.
      // That cleanup must not unlock the next request's controls.
      for (const button of content.querySelectorAll?.('[data-action="mark-alert"], [data-action="mark-all-read"]') || []) {
        if (button.dataset.busy !== 'true') continue;
        const replacement = button.cloneNode(true);
        delete replacement.dataset.busy;
        replacement.removeAttribute('aria-busy');
        button.replaceWith(replacement);
      }
    }
    view.pending = token;
  }
  const find = selector => content.querySelector?.(selector);
  const doc = typeof document === 'undefined' ? null : document;
  const origin = doc?.activeElement === doc?.body && focusTarget ? focusTarget : doc?.activeElement;
  let focusMoved = false;
  const trackFocus = event => { if (event.target !== origin && event.target !== doc?.body) focusMoved = true; };
  if (!background) doc?.addEventListener?.('focusin', trackFocus);

  function status(message, retry = false) {
    const region = find('#alerts-load-status');
    if (!region) return;
    const html = `${message ? `<p>${escapeHtml(message)}</p>` : ''}${retry ? '<button type="button" class="btn btn-secondary" data-action="retry-alerts">Tải lại danh sách</button>' : ''}`;
    if (region.innerHTML !== html) region.innerHTML = html;
  }
  function busy(value) {
    find('#alerts-results')?.setAttribute('aria-busy', String(value));
    for (const button of content.querySelectorAll?.('[data-action="mark-alert"], [data-action="mark-all-read"]') || []) {
      button.disabled = value || !view.valid || (button.dataset.action === 'mark-all-read' && !state.alerts.some(item => !item.is_read));
      // The shared click handler releases its original button in finally. Keep an
      // invalid result locked without changing that handler for other pages.
      if (!value && button.disabled && button.dataset.busy === 'true') {
        const replacement = button.cloneNode(true);
        delete replacement.dataset.busy;
        replacement.removeAttribute('aria-busy');
        button.replaceWith(replacement);
      }
    }
  }
  function restoreFocus(previous) {
    if (!current() || !previous || !content.contains?.(find('#alerts-results'))) return;
    if (!background && focusMoved && previous === origin) return;
    const active = doc?.activeElement;
    if (active && active !== previous && active !== doc?.body) return;
    if (content.contains(previous) && !previous.disabled) return;
    const action = previous.dataset?.action;
    const id = previous.dataset?.id;
    const controls = Array.from(content.querySelectorAll('[data-action]'));
    const matching = controls.find(button => button.dataset.action === action && button.dataset.id === id && !button.disabled);
    const row = id && Array.from(content.querySelectorAll('[data-alert-id]')).find(item => item.dataset.alertId === id);
    (matching || row || find('#alerts-results'))?.focus({ preventScroll: true });
  }
  function template(rows) {
    const unreadCount = rows.filter(item => !item.is_read).length;
    const postureCount = rows.filter(item => item.alert_type === 'posture_warning').length;
    const distanceCount = rows.filter(item => item.alert_type === 'eye_distance_warning').length;
    return `<div id="alerts-surface">
    ${pageHead('alerts', `<span data-alert-unread-count class="badge ${unreadCount ? 'coral' : 'neutral'}">${unreadCount} chưa đọc</span><button class="btn btn-secondary" data-action="mark-all-read" aria-describedby="alerts-read-help" ${unreadCount ? '' : 'disabled'}>Đánh dấu các mục đang hiển thị là đã đọc</button>`)}
    <section class="page-summary-strip alert-summary" aria-label="Tóm tắt cảnh báo"><div><span><small>Trong danh sách</small><strong>${rows.length} cảnh báo</strong></span></div><div><span><small>Chưa đọc</small><strong>${unreadCount} cảnh báo</strong></span></div><div><span><small>Tư thế</small><strong>${postureCount} cảnh báo</strong></span></div><div><span><small>Khoảng cách mắt</small><strong>${distanceCount} cảnh báo</strong></span></div></section>
    <p id="alerts-scope-note">Tối đa 200 cảnh báo mới nhất theo bộ lọc đã áp dụng. Bốn chỉ số chỉ tính các cảnh báo trong danh sách này.</p>
    <p id="alerts-filter-help">Chọn Áp dụng để cập nhật danh sách theo lựa chọn bên dưới.</p>
    <form id="alert-filter" class="filters filters-alerts">
      <div class="field"><label>Thiết bị</label><select class="select" name="device_id"><option value="">Tất cả thiết bị</option>${state.devices.map((d) => `<option value="${d.device_id}" ${String(filter.device_id) === String(d.device_id) ? 'selected' : ''}>${escapeHtml(d.device_name)}</option>`).join('')}</select></div>
      <div class="field"><label>Trạng thái đọc</label><select class="select" name="is_read"><option value="">Tất cả</option><option value="false" ${filter.is_read === 'false' ? 'selected' : ''}>Chưa đọc</option><option value="true" ${filter.is_read === 'true' ? 'selected' : ''}>Đã đọc</option></select></div><div class="filter-actions"><button class="btn btn-ghost" type="button" data-action="clear-alert-filter">Đặt lại</button><button class="btn" type="submit">Áp dụng</button></div>
    </form>
    <p id="alerts-read-help">“Chưa đọc” là chưa được đánh dấu. “Đã đọc” là đã được đánh dấu, không có nghĩa sự việc đã được giải quyết. Khi lọc “Chưa đọc”, cảnh báo vừa đánh dấu sẽ rời danh sách sau khi tải lại.</p>
    <div id="alerts-load-status" role="status" aria-live="polite" aria-atomic="true"></div><section id="alerts-results" class="card alerts-card" aria-busy="false" tabindex="-1">${rows.map((item) => {
      const presentation = alertPresentation(item.alert_type);
      return `<article class="alert-row ${item.is_read ? '' : 'unread'}" data-alert-id="${escapeHtml(String(item.alert_id))}" tabindex="-1"><div class="alert-symbol ${presentation.tone}">${presentation.symbol}</div><div class="alert-copy"><strong>${escapeHtml(presentation.label)}</strong><p>${escapeHtml(item.message)}</p><small>${escapeHtml(deviceName(item.device_id))} · ${formatDate(item.created_at)}</small></div>${item.is_read ? '<span class="badge neutral">Đã đọc</span>' : `<button class="btn btn-secondary btn-sm" data-action="mark-alert" data-id="${escapeHtml(String(item.alert_id))}">Đánh dấu đã đọc</button>`}</article>`;
    }).join('') || emptyState('✓', filterKey ? 'Không có cảnh báo theo bộ lọc này' : 'Chưa có cảnh báo để hiển thị', filterKey ? 'Bạn có thể đổi thiết bị hoặc trạng thái đọc rồi chọn Áp dụng.' : 'Danh sách vừa tải không có cảnh báo.')}</section></div>`;
  }
  function clearResults() {
    const summary = find('.alert-summary');
    if (summary) summary.innerHTML = '';
    const count = find('[data-alert-unread-count]');
    if (count) count.textContent = 'Chưa cập nhật';
    const results = find('#alerts-results');
    if (results) results.innerHTML = '';
    view.valid = false;
  }
  function commit(rows) {
    const markup = template(rows);
    if (!find('#alerts-surface')) {
      content.innerHTML = markup;
      return;
    }
    const next = doc.createElement('div');
    next.innerHTML = markup;
    // Preserve the form, live region and results focus target across requests.
    for (const selector of ['.alert-summary', '#alerts-results']) {
      const previous = find(selector);
      const replacement = next.querySelector(selector);
      if (previous && replacement && previous.innerHTML !== replacement.innerHTML) previous.innerHTML = replacement.innerHTML;
    }
    const count = find('[data-alert-unread-count]');
    const nextCount = next.querySelector('[data-alert-unread-count]');
    if (count && nextCount && count.outerHTML !== nextCount.outerHTML) count.replaceWith(nextCount);
  }

  try {
    if (!background) {
      // Mount controls once, even when the first request fails. Do not show fake zeroes.
      if (!find('#alerts-surface')) {
        content.innerHTML = template([]);
        clearResults();
      }
      if (reset) {
        for (const control of find('#alert-filter')?.querySelectorAll('select') || []) control.value = '';
      }
      if (view.filterKey !== filterKey) {
        view.outcome = '';
        clearResults();
      }
      view.filterKey = filterKey;
      busy(true);
      status(markIds ? 'Đang đánh dấu cảnh báo đã đọc…' : 'Đang tải cảnh báo…');
    }
    if (markIds) {
      const ids = [...markIds];
      const settled = await Promise.allSettled(ids.map(async id => api(`/alerts/${id}/read`, { method: 'PUT' })));
      if (!contextCurrent() || view.pending !== token) return { status: 'ignored' };
      const confirmed = settled.filter(result => result.status === 'fulfilled').length;
      const uncertain = ids.length - confirmed;
      view.outcome = uncertain
        ? (confirmed
          ? `Đã đánh dấu ${confirmed} cảnh báo là đã đọc. Chưa xác nhận được việc đánh dấu ${uncertain} cảnh báo còn lại.`
          : `Chưa xác nhận được việc đánh dấu đã đọc cho ${uncertain} cảnh báo.`)
        : `Đã đánh dấu ${confirmed} cảnh báo là đã đọc.`;
      view.valid = false;
      status(`${view.outcome} Đang tải lại danh sách…`);
    }
    if (!state.devices.length) {
      const devices = await api('/devices?limit=200');
      if (!current()) return { status: 'ignored' };
      state.devices = devices.data || [];
      // Only populate an initially empty select; never overwrite an edited selection.
      const select = find('#alert-filter [name="device_id"]');
      if (select && select.options.length === 1) {
        select.innerHTML = '<option value="">Tất cả thiết bị</option>' + state.devices.map(d => `<option value="${escapeHtml(String(d.device_id))}" ${String(filter.device_id) === String(d.device_id) ? 'selected' : ''}>${escapeHtml(d.device_name)}</option>`).join('');
      }
    }
    // Indicator failures (or a slow indicator) must not block the page's list.
    if (!background) void refreshUnreadAlertCount({ force: true }).catch(() => {});
    const result = await api('/alerts' + queryString({ ...filter, limit: 200 }));
    if (!current()) return { status: 'ignored' };
    const active = doc?.activeElement;
    const previous = content.contains?.(active) ? active : (!background && !focusMoved ? origin : null);
    state.alerts = result.data || [];
    view.valid = true;
    view.filterKey = filterKey;
    commit(state.alerts);
    busy(false);
    status(view.outcome ? `${view.outcome} Danh sách đã được cập nhật.` : (background ? '' : 'Đã tải cảnh báo.'));
    restoreFocus(previous);
    return { status: 'success' };
  } catch (error) {
    if (!current()) return { status: 'ignored' };
    const active = doc?.activeElement;
    const previous = content.contains?.(active) ? active : (!background && !focusMoved ? origin : null);
    if (!background) view.valid = false;
    busy(false);
    status(background && view.valid
      ? `${view.outcome ? view.outcome + ' ' : ''}Chưa cập nhật được cảnh báo. Danh sách đang hiển thị có thể đã cũ.`
      : `${view.outcome ? view.outcome + ' Chưa tải lại được danh sách.' : 'Chưa tải được cảnh báo theo bộ lọc đã chọn.'}`, true);
    restoreFocus(previous);
    return { status: 'error' };
  } finally {
    if (!background) doc?.removeEventListener?.('focusin', trackFocus);
    if (view.pending === token) view.pending = null;
  }
}

function alertType(type) {
  return alertPresentation(type).label;
}

function alertPresentation(type) {
  return {
    posture_warning: { label: 'Cảnh báo tư thế', symbol: '↗', tone: 'warning' },
    stranger_detected: { label: 'Phát hiện người lạ', symbol: '◎', tone: 'danger' },
    eye_distance_warning: { label: 'Cảnh báo khoảng cách nhìn', symbol: '◉', tone: 'warning' },
    time_exceeded: { label: 'Vượt giới hạn thời gian', symbol: '◷', tone: 'danger' },
    unsafe_website: { label: 'Website không an toàn', symbol: '!', tone: 'danger' },
    app_overuse: { label: 'Ứng dụng dùng quá lâu', symbol: 'A', tone: 'warning' },
    night_usage: { label: 'Sử dụng thiết bị ban đêm', symbol: '☾', tone: 'info' },
    text_self_harm: { label: 'Dấu hiệu tự hại', symbol: '!', tone: 'danger' },
    text_harassment: { label: 'Bắt nạt hoặc đe dọa', symbol: '!', tone: 'danger' },
    text_violence: { label: 'Bé có dấu hiệu bị bạo lực', symbol: '!', tone: 'danger' },
    text_risk: { label: 'Cần quan sát bé trong thời gian này', symbol: '!', tone: 'warning' },
  }[type] || { label: 'Cảnh báo thiết bị', symbol: '!', tone: 'info' };
}

function riskLevelLabel(level) {
  return {
    low: 'Rủi ro thấp',
    medium: 'Cần lưu ý',
    high: 'Rủi ro cao',
    critical: 'Nghiêm trọng',
  }[String(level || '').toLowerCase()] || 'Chưa xác định';
}

function aiSession() {
  let session = aiSessions.get(state.chat);
  if (!session || session.userId !== state.userId) {
    session = { history: state.chat, userId: state.userId, view: null, draft: '',
      chatOperation: null, chatStatus: '', runs: new Map() };
    aiSessions.set(state.chat, session);
  }
  return session;
}

function aiSessionCurrent(session) {
  return state.chat === session.history && state.userId === session.userId
    && state.role === 'parent' && Boolean(state.accessToken);
}

function aiViewCurrent(view) {
  return Boolean(view && aiSessionCurrent(view.session) && state.page === 'ai'
    && view.session.view === view && view.content.aiView === view && view.content.isConnected
    && document.querySelector('#page-content') === view.content
    && view.content.querySelector('#ai-surface') === view.surface);
}

function aiViewFrom(node) {
  const view = node?.closest('#ai-surface')?.aiView;
  return aiViewCurrent(view) && view.surface.contains(node) ? view : null;
}

function aiStatus(view, id, message) {
  if (!aiViewCurrent(view)) return;
  const region = view.surface.querySelector(id);
  if (region.textContent !== message) region.textContent = message;
}

function aiFocus(view, origin) {
  const scope = view.scope;
  let moved = !origin || (document.activeElement !== origin && document.activeElement !== document.body);
  const focus = event => { if (event.target !== origin && event.target !== document.body) moved = true; };
  const pointer = event => { if (event.target !== origin && !origin?.contains(event.target)) moved = true; };
  document.addEventListener('focusin', focus);
  document.addEventListener('pointerdown', pointer);
  const owned = () => !moved && aiViewCurrent(view) && scope === view.scope
    && !modalRoot.firstElementChild && document.hasFocus?.() !== false;
  return {
    owned,
    restore(target) { if (owned() && target?.isConnected && view.surface.contains(target)) target.focus({ preventScroll: true }); },
    dispose() { document.removeEventListener('focusin', focus); document.removeEventListener('pointerdown', pointer); },
  };
}

function aiControls(view) {
  if (!aiViewCurrent(view)) return;
  const ready = view.deviceReady && Boolean(view.deviceId);
  const run = view.session.runs.get(view.deviceId);
  view.run = run;
  const running = run && ['posting', 'refreshing'].includes(run.phase);
  const button = view.surface.querySelector('[data-action="run-analysis"]');
  button.disabled = !ready || Boolean(running);
  button.setAttribute('aria-busy', String(Boolean(running)));
  button.textContent = run?.phase === 'posting' ? 'Đang phân tích…'
    : run?.phase === 'refreshing' ? 'Đang tải kết quả…' : '✦ Chạy phân tích mới';
  view.surface.querySelector('[data-action="latest-analysis"]').disabled = !ready || view.latest?.status === 'pending';
  for (const control of view.surface.querySelectorAll('[data-action="summary"]')) {
    control.disabled = !ready || (view.summary?.status === 'pending' && view.summary.period === control.dataset.period);
  }
  const message = !run ? '' : run.phase === 'posting' ? 'Đang phân tích thiết bị đang chọn…'
    : run.phase === 'refreshing' ? 'Phân tích đã hoàn thành. Đang tải lại kết quả…'
    : run.phase === 'refresh-error' ? 'Phân tích đã hoàn thành, nhưng chưa tải lại được kết quả.'
    : run.phase === 'unconfirmed' ? `Chưa xác nhận được kết quả phân tích. ${run.error} Bạn có thể tải lại lịch sử để kiểm tra.`
    : 'Phân tích đã hoàn thành.';
  aiStatus(view, '#ai-analysis-status', message);
  const retry = view.surface.querySelector('#ai-analysis-retry');
  const retryNeeded = run && ['refresh-error', 'unconfirmed'].includes(run.phase);
  // Do not replace an unchanged retry button while it owns keyboard focus.
  if (retryNeeded && !retry.firstElementChild) retry.innerHTML = '<button class="btn btn-secondary" data-action="retry-ai-analysis">Tải lại kết quả</button>';
  else if (!retryNeeded && retry.firstElementChild) retry.innerHTML = '';
}

function aiChangeScope(view, deviceId) {
  if (!aiViewCurrent(view)) return;
  view.scope += 1;
  view.deviceId = String(deviceId || '');
  view.deviceReady = false;
  view.summary = null;
  view.summaryRequests = new Map();
  view.latest = null;
  state.selectedDeviceId = deviceId || null;
  state.analyses = [];
  view.surface.querySelector('#summary-result').innerHTML = '';
  view.surface.querySelector('#summary-result').setAttribute('aria-busy', 'false');
  aiStatus(view, '#ai-summary-status', '');
  aiStatus(view, '#ai-latest-status', '');
  aiControls(view);
}

async function loadAIHistory(view, origin = null) {
  if (!aiViewCurrent(view)) return { status: 'ignored' };
  const version = ++view.historyVersion;
  let scope = view.scope;
  const requestedDevice = view.deviceId;
  const current = () => aiViewCurrent(view) && version === view.historyVersion && scope === view.scope;
  const focus = aiFocus(view, origin);
  const history = view.surface.querySelector('#ai-history');
  state.analyses = [];
  view.historyPending = true;
  history.innerHTML = '';
  history.setAttribute('aria-busy', 'true');
  aiStatus(view, '#ai-history-status', requestedDevice
    ? `Đang tải phân tích của ${view.devices.find(d => String(d.device_id) === requestedDevice)?.device_name || 'thiết bị đang chọn'}…`
    : 'Đang tải thiết bị và phân tích…');
  try {
    const devices = (await api('/devices?limit=200')).data || [];
    if (!current()) return { status: 'ignored' };
    const selected = reconcileSelectedId(requestedDevice, devices, 'device_id');
    if (String(selected || '') !== view.deviceId) { aiChangeScope(view, selected); scope = view.scope; }
    view.devices = devices;
    state.devices = devices;
    state.selectedDeviceId = selected;
    view.deviceId = String(selected || '');
    view.deviceReady = true;
    const picker = view.surface.querySelector('#ai-device');
    picker.innerHTML = '<option value="">Chọn thiết bị</option>' + devices.map(d => `<option value="${escapeHtml(d.device_id)}" ${String(d.device_id) === view.deviceId ? 'selected' : ''}>${escapeHtml(d.device_name)}</option>`).join('');
    picker.value = view.deviceId;
    aiControls(view);
    const rows = selected ? (await api(`/ai-analysis${queryString({ device_id: selected, limit: 50 })}`)).data || [] : [];
    if (!current()) return { status: 'ignored' };
    state.analyses = rows;
    history.innerHTML = rows.map(item => `<article class="analysis-card"><span class="badge ${escapeHtml(String(item.risk_level).toLowerCase())}">${escapeHtml(riskLevelLabel(item.risk_level))}</span><h4>${escapeHtml(item.behavior_type)}</h4><p>${escapeHtml(item.suggestion)}</p><time>${escapeHtml(deviceName(item.device_id))} · ${formatDate(item.analyzed_at)}</time></article>`).join('') || emptyState('✦', 'Chưa có phân tích', 'Chọn thiết bị và chạy phân tích AI đầu tiên.');
    const run = view.session.runs.get(view.deviceId);
    if (run && ['refreshing', 'refresh-error'].includes(run.phase)) run.phase = 'complete';
    aiStatus(view, '#ai-history-status', rows.length ? `Đã tải ${rows.length} kết quả phân tích.` : 'Chưa có phân tích.');
    return { status: 'loaded' };
  } catch (error) {
    if (!current()) return { status: 'ignored' };
    const run = view.session.runs.get(view.deviceId);
    if (run?.phase === 'refreshing') run.phase = 'refresh-error';
    aiStatus(view, '#ai-history-status', `Chưa tải được phân tích của thiết bị đang chọn. ${localizeError(error.message)}`);
    history.innerHTML = '<button class="btn btn-secondary" data-action="retry-ai-history">Thử lại</button>';
    return { status: 'error' };
  } finally {
    if (current()) {
      view.historyPending = false;
      history.setAttribute('aria-busy', 'false');
      aiControls(view);
      focus.restore(history.querySelector('[data-action="retry-ai-history"]') || history);
    }
    focus.dispose();
  }
}

async function runAIAnalysis(view, button) {
  if (!aiViewCurrent(view) || !view.deviceReady || !view.deviceId) return;
  const session = view.session, deviceId = view.deviceId;
  if (['posting', 'refreshing'].includes(session.runs.get(deviceId)?.phase)) return;
  const operation = { deviceId, phase: 'posting' };
  session.runs.set(deviceId, operation);
  const current = () => aiSessionCurrent(session) && session.runs.get(deviceId) === operation;
  const focus = aiFocus(view, button);
  let postCompleted = false;
  aiControls(view);
  try {
    await api(`/ai-analysis/analyze/${deviceId}`, { method: 'POST' });
    postCompleted = true;
    if (!current()) return;
    // A new mount may explicitly adopt this same pending operation; never use a route's main blindly.
    const target = session.view;
    if (aiViewCurrent(target) && target.deviceId === deviceId && target.run === operation) {
      operation.phase = 'refreshing';
      aiControls(target);
      await loadAIHistory(target);
    } else operation.phase = 'complete';
  } catch (error) {
    if (!current()) return;
    operation.phase = postCompleted ? 'refresh-error' : 'unconfirmed';
    operation.error = localizeError(error.message);
  } finally {
    if (current()) {
      aiControls(session.view);
      focus.restore(button);
    }
    focus.dispose();
  }
}

async function requestAISummary(view, period, button) {
  if (!aiViewCurrent(view) || !view.deviceReady || !view.deviceId || !['daily', 'weekly'].includes(period)) return;
  if (view.summary?.status === 'pending' && view.summary.period === period) return;
  const scope = view.scope, deviceId = view.deviceId;
  const operation = view.summary = { period, deviceId, status: 'pending' };
  const current = () => aiViewCurrent(view) && view.scope === scope && view.summary === operation;
  const focus = aiFocus(view, button);
  const target = view.surface.querySelector('#summary-result');
  const label = `${period === 'daily' ? 'Báo cáo ngày' : 'Báo cáo tuần'} — ${deviceName(deviceId)}`;
  target.innerHTML = '';
  target.setAttribute('aria-busy', 'true');
  aiStatus(view, '#ai-summary-status', `Đang tạo ${label}…`);
  aiControls(view);
  try {
    // Switching daily -> weekly -> daily reuses the still-running daily GET,
    // but only the newest UI operation is allowed to display its response.
    let request = view.summaryRequests.get(period);
    if (!request) {
      request = {};
      view.summaryRequests.set(period, request);
      request.promise = (async () => {
        try { return await api(`/ai-analysis/summary/${deviceId}?period=${period}`); }
        finally { if (view.summaryRequests.get(period) === request) view.summaryRequests.delete(period); }
      })();
    }
    const result = await request.promise;
    if (!current()) return;
    operation.status = 'complete';
    target.innerHTML = `<div class="summary-box">${escapeHtml(result.summary)}</div>`;
    aiStatus(view, '#ai-summary-status', `Đã tải ${label}.`);
  } catch (error) {
    if (!current()) return;
    operation.status = 'error';
    aiStatus(view, '#ai-summary-status', `Chưa tạo được ${label}. ${localizeError(error.message)}`);
    target.innerHTML = `<p class="muted">${escapeHtml(label)}: chưa tải được báo cáo. ${escapeHtml(localizeError(error.message))}</p><button class="btn btn-secondary" data-action="retry-ai-summary" data-period="${period}">Thử lại báo cáo</button>`;
  } finally {
    if (current()) {
      target.setAttribute('aria-busy', 'false');
      aiControls(view);
      focus.restore(target.querySelector('[data-action="retry-ai-summary"]') || view.surface.querySelector(`[data-period="${period}"]`));
    }
    focus.dispose();
  }
}

function openAILatest(view, result) {
  if (!aiViewCurrent(view) || modalRoot.firstElementChild) return;
  showModal('Phân tích mới nhất', `${deviceName(result.device_id)} · ${formatDate(result.analyzed_at)}`, `<span class="badge ${escapeHtml(String(result.risk_level).toLowerCase())}">${escapeHtml(riskLevelLabel(result.risk_level))}</span><h3>${escapeHtml(result.behavior_type)}</h3><p class="muted analysis-suggestion">${escapeHtml(result.suggestion)}</p>`);
}

async function requestAILatest(view, button) {
  if (!aiViewCurrent(view) || !view.deviceReady || !view.deviceId || modalRoot.firstElementChild || view.latest?.status === 'pending') return;
  if (view.latest?.status === 'ready') {
    aiStatus(view, '#ai-latest-status', '');
    openAILatest(view, view.latest.result);
    view.latest = null;
    return;
  }
  const scope = view.scope, deviceId = view.deviceId;
  const operation = view.latest = { status: 'pending' };
  const current = () => aiViewCurrent(view) && scope === view.scope && view.latest === operation;
  const focus = aiFocus(view, button);
  aiStatus(view, '#ai-latest-status', 'Đang tải kết quả mới nhất…');
  aiControls(view);
  try {
    const result = await api(`/ai-analysis/latest/${deviceId}`);
    if (!current()) return;
    operation.result = result;
    operation.status = 'ready';
    // Re-enable before opening: the shared modal can then return focus to its trigger.
    aiControls(view);
    if (focus.owned()) {
      focus.restore(button);
      aiStatus(view, '#ai-latest-status', '');
      openAILatest(view, result);
      view.latest = null;
    } else aiStatus(view, '#ai-latest-status', 'Đã tải kết quả. Chọn “Kết quả mới nhất” để xem.');
  } catch (error) {
    if (!current()) return;
    operation.status = 'error';
    aiStatus(view, '#ai-latest-status', `Chưa tải được kết quả mới nhất. ${localizeError(error.message)} Chọn lại nút để thử lại.`);
  } finally {
    if (current()) { aiControls(view); focus.restore(button); }
    focus.dispose();
  }
}

function syncAIChat(view, messages = false) {
  if (!aiViewCurrent(view)) return;
  const session = view.session;
  view.chatOperation = session.chatOperation;
  const form = view.surface.querySelector('#chat-form');
  const input = form.querySelector('[name="message"]');
  input.value = session.draft;
  input.readOnly = Boolean(session.chatOperation);
  form.querySelector('[type="submit"]').disabled = Boolean(session.chatOperation);
  form.setAttribute('aria-busy', String(Boolean(session.chatOperation)));
  aiStatus(view, '#ai-chat-status', session.chatOperation ? 'Đang chờ phản hồi…' : session.chatStatus);
  if (messages) {
    const log = view.surface.querySelector('#chat-messages');
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = session.history.map(msg => `<div class="chat-bubble ${msg.role === 'user' ? 'user' : ''}">${escapeHtml(msg.content)}</div>`).join('');
    if (atEnd) log.scrollTop = log.scrollHeight;
  }
}

function captureAIChatDraft(input) {
  const view = aiViewFrom(input);
  if (view && input === view.surface.querySelector('#chat-form [name="message"]') && !view.session.chatOperation) view.session.draft = input.value;
}

async function submitAIChat(form) {
  const view = aiViewFrom(form);
  if (!view || view.session.chatOperation) return;
  const session = view.session, input = form.querySelector('[name="message"]');
  const text = input.value;
  if (!text || text.length > 2000) return;
  session.draft = text;
  const operation = session.chatOperation = { text };
  const current = () => aiSessionCurrent(session) && session.chatOperation === operation;
  const focus = aiFocus(view, document.activeElement);
  const messages = [...session.history, { role: 'user', content: text }].slice(-20).map(msg => ({ role: msg.role, content: msg.content }));
  syncAIChat(view);
  try {
    const result = await api('/ai-analysis/chat', { method: 'POST', body: { messages } });
    if (!current()) return;
    session.history.push({ role: 'user', content: text }, { role: 'model', content: result.reply });
    if (session.draft === text) session.draft = '';
    session.chatStatus = 'Đã nhận phản hồi.';
  } catch (error) {
    if (!current()) return;
    session.chatStatus = `Chưa nhận được phản hồi. ${localizeError(error.message)} Câu hỏi được giữ lại; bạn có thể gửi lại.`;
  } finally {
    if (current()) {
      session.chatOperation = null;
      const target = session.view;
      if (aiViewCurrent(target) && target.chatOperation === operation) syncAIChat(target, true);
      focus.restore(input);
    }
    focus.dispose();
  }
}

async function handleAIAction(button) {
  const view = aiViewFrom(button);
  if (!view) return;
  const action = button.dataset.action;
  if (action === 'run-analysis') return await runAIAnalysis(view, button);
  if (action === 'latest-analysis') return await requestAILatest(view, button);
  if (action === 'summary') return await requestAISummary(view, button.dataset.period, button);
  if (action === 'retry-ai-summary' && view.summary?.status === 'error' && view.summary.period === button.dataset.period) return await requestAISummary(view, view.summary.period, button);
  if (action === 'retry-ai-history' || action === 'retry-ai-analysis') {
    if (view.historyPending) return;
    const run = view.session.runs.get(view.deviceId);
    if (action === 'retry-ai-analysis' && run?.phase === 'refresh-error') run.phase = 'refreshing';
    aiControls(view);
    return await loadAIHistory(view, button);
  }
}

function changeAIDevice(picker) {
  const view = aiViewFrom(picker);
  if (!view) return;
  aiChangeScope(view, picker.value);
  view.historyTask = loadAIHistory(view);
  return view.historyTask;
}

async function renderAI(content) {
  if (state.page !== 'ai' || !content.isConnected || document.querySelector('#page-content') !== content) return;
  const session = aiSession();
  if (!aiSessionCurrent(session)) return;
  const view = { content, session, scope: 0, historyVersion: 0, devices: state.devices.slice(),
    deviceId: String(state.selectedDeviceId || ''), deviceReady: false, summary: null, summaryRequests: new Map(), latest: null };
  content.aiView = session.view = view;
  content.innerHTML = `
    <div id="ai-surface">
    ${pageHead('ai', `<select class="select ai-device-select" id="ai-device"><option value="">Chọn thiết bị</option>${state.devices.map((d) => `<option value="${d.device_id}" ${String(d.device_id) === String(state.selectedDeviceId) ? 'selected' : ''}>${escapeHtml(d.device_name)}</option>`).join('')}</select>`)}
    <section class="ai-layout">
      ${sectionVisual('ai', '<button class="btn" data-action="run-analysis" disabled>✦ Chạy phân tích mới</button><div><div id="ai-analysis-status" class="muted" role="status" aria-atomic="true"></div><div id="ai-analysis-retry"></div></div>')}
      <div class="stack">
        <article class="card"><div class="card-head"><div><h2>Phân tích gần đây</h2><p>Kết quả của riêng thiết bị đang chọn.</p></div><div><button class="btn btn-secondary btn-sm" data-action="latest-analysis" disabled>Kết quả mới nhất</button></div></div><div id="ai-latest-status" class="muted" role="status" aria-atomic="true"></div><div id="ai-history-status" class="muted" role="status" aria-atomic="true"></div><div id="ai-history" tabindex="-1" aria-busy="false"></div></article>
        <article class="card card-pad"><div class="card-head card-head-flush"><div><h2>Báo cáo tóm tắt</h2><p>Tạo báo cáo ngày hoặc tuần bằng Gemini.</p></div></div><div class="form-actions form-actions-start"><button class="btn btn-secondary" data-action="summary" data-period="daily" disabled>Báo cáo ngày</button><button class="btn btn-secondary" data-action="summary" data-period="weekly" disabled>Báo cáo tuần</button></div><div id="ai-summary-status" class="muted" role="status" aria-atomic="true"></div><div id="summary-result" aria-busy="false"></div></article>
      </div>
      <aside class="card chat-card"><div class="chat-header"><strong>Cố vấn AI SafeNest</strong><small>Không thay thế tư vấn y khoa hoặc tâm lý.</small></div><div class="chat-messages" id="chat-messages"></div><div id="ai-chat-status" class="muted" role="status" aria-atomic="true"></div><form id="chat-form" class="chat-form"><input class="input" name="message" maxlength="2000" required placeholder="Hỏi về thói quen số..."><button class="btn btn-icon" type="submit" aria-label="Gửi câu hỏi">↑</button></form></aside>
    </section></div>`;
  view.surface = content.querySelector('#ai-surface');
  view.surface.aiView = view;
  syncAIChat(view, true);
  const messages = view.surface.querySelector('#chat-messages');
  messages.scrollTop = messages.scrollHeight;
  aiControls(view);
  // Mount resolves immediately; navigation's focus cleanup must not wait for network responses.
  view.historyTask = loadAIHistory(view);
  return view;
}

function pushPlatformOptions(provider, selected = '') {
  const platforms = provider === 'expo'
    ? [['android', 'Android'], ['ios', 'iOS']]
    : [['android', 'Android'], ['ios', 'iOS'], ['web', 'Web']];
  const selectedValue = platforms.some(([value]) => value === selected) ? selected : platforms[0][0];
  return platforms.map(([value, label]) => `<option value="${value}" ${value === selectedValue ? 'selected' : ''}>${label}</option>`).join('');
}

function syncPushPlatforms(form) {
  const provider = form?.elements.provider?.value;
  const platform = form?.elements.platform;
  if (!provider || !platform) return;
  platform.innerHTML = pushPlatformOptions(provider, platform.value);
}

async function renderAccount(content) {
  if (state.role === 'parent') {
    const result = await api('/notifications/tokens');
    state.pushTokens = result.data || [];
  } else {
    state.pushTokens = [];
  }
  content.innerHTML = `
    ${pageHead('account')}
    <section class="account-grid">
      <div class="stack">
        <article class="card profile-card"><figure class="profile-cover"><img src="/assets/section-account-security.jpg" alt="Tài khoản gia đình được bảo vệ bằng mật khẩu và thiết bị tin cậy" width="1200" height="800" loading="lazy" decoding="async"></figure><div class="profile-body"><div class="profile-avatar">${state.role === 'admin' ? 'QT' : 'PH'}</div><h2>${state.role === 'admin' ? 'Tài khoản quản trị viên' : 'Tài khoản phụ huynh'}</h2><p class="muted">Mã người dùng #${escapeHtml(state.userId || '—')} · JWT 15 phút và refresh token luân phiên.</p></div></article>
        ${state.role === 'parent' ? `<article class="card card-pad push-settings">
          <div class="card-head card-head-flush"><div><h2>Thiết bị nhận thông báo</h2><p>Đăng ký Expo hoặc FCM token để nhận cảnh báo AI và cảnh báo từ Agent theo thời gian thực.</p></div><button class="btn btn-secondary btn-sm" data-action="test-push" ${state.pushTokens.some((item) => item.is_active) ? '' : 'disabled'}>Gửi thử</button></div>
          <div class="push-token-list">${state.pushTokens.map((item) => `<div class="push-token-row"><div class="list-icon">${item.provider === 'expo' ? 'EX' : 'FC'}</div><div class="list-copy"><strong>${escapeHtml(item.device_name || 'Thiết bị không tên')}</strong><small>${escapeHtml(item.provider.toUpperCase())} · ${escapeHtml(item.platform)} · ${escapeHtml(item.token_hint)}</small>${item.last_error ? `<small class="text-danger">${escapeHtml(item.last_error)}</small>` : ''}</div><span class="badge ${item.is_active ? '' : 'red'}">${item.is_active ? 'Đang nhận' : 'Đã tắt'}</span><button class="kebab danger" data-action="delete-push-token" data-id="${item.push_token_id}" title="Gỡ thiết bị">×</button></div>`).join('') || '<p class="muted">Chưa có thiết bị nhận thông báo.</p>'}</div>
          <form id="push-token-form" class="form-grid push-token-form">
            <div class="field"><label>Nhà cung cấp</label><select class="select" name="provider"><option value="expo">Expo</option><option value="fcm">Firebase FCM</option></select></div>
            <div class="field"><label>Nền tảng</label><select class="select" name="platform">${pushPlatformOptions('expo')}</select><small>Expo hỗ trợ Android/iOS; FCM hỗ trợ thêm Web.</small></div>
            <div class="field full"><label>Tên thiết bị</label><input class="input" name="device_name" maxlength="100" placeholder="Ví dụ: Điện thoại của mẹ"></div>
            <div class="field full"><label>Push token</label><textarea class="textarea" name="token" maxlength="4096" required autocomplete="off" placeholder="ExponentPushToken[...] hoặc FCM registration token"></textarea><small>Token chỉ được gửi đến backend qua HTTPS và không hiển thị lại đầy đủ.</small></div>
            <div class="form-actions field full"><button class="btn" type="submit">Đăng ký thiết bị nhận thông báo</button></div>
          </form>
        </article>` : ''}
        <article class="card card-pad"><div class="card-head card-head-flush"><div><h2>Đổi mật khẩu</h2><p>Thao tác này thu hồi toàn bộ phiên đăng nhập cũ.</p></div></div><form id="change-password-form" class="form-grid"><div class="field full"><label>Mật khẩu hiện tại</label><input class="input" type="password" name="oldPassword" required></div><div class="field full"><label>Mật khẩu mới</label><input class="input" type="password" name="newPassword" required minlength="8"><small>Cần chữ hoa, số và ký tự đặc biệt.</small></div><div class="form-actions field full"><button class="btn" type="submit">Cập nhật mật khẩu</button></div></form></article>
      </div>
      <aside class="stack">
        <article class="card card-pad"><p class="eyebrow">Phiên đăng nhập</p><h3>Phiên trình diễn an toàn</h3><p class="muted">Token chỉ được lưu trong sessionStorage và xóa khi đóng tab.</p><button class="btn btn-secondary" data-action="logout">Đăng xuất phiên này</button></article>
        <article class="card danger-zone"><div class="card-head"><div><h3>Vùng nguy hiểm</h3><p>Xóa tài khoản và toàn bộ dữ liệu liên quan.</p></div></div><div class="card-body"><button class="btn btn-danger" data-action="delete-account">Xóa tài khoản</button></div></article>
      </aside>
    </section>`;
}

async function renderAdminOverview(content) {
  state.adminStats = await api('/admin/stats');
  const s = state.adminStats;
  const onlinePercent = s.total_devices ? Math.round((s.devices_online / s.total_devices) * 100) : 0;
  const offlineDevices = Math.max(0, s.total_devices - s.devices_online);
  content.innerHTML = `
    ${pageHead('admin-overview', '<button class="btn btn-secondary" data-action="reload-page">' + icons.refresh + ' Làm mới</button>')}
    <section class="dashboard-hero admin-dashboard-hero">
      <div class="dashboard-hero-copy">
        <span class="hero-status"><i></i>Trung tâm vận hành SafeNest</span>
        <p class="eyebrow">Quản trị chủ động</p>
        <h2>Một góc nhìn rõ ràng<br>cho toàn bộ hệ thống.</h2>
        <p>Theo dõi quy mô, trạng thái thiết bị và các hành động nhạy cảm để giữ nền tảng ổn định, minh bạch và an toàn.</p>
        <div class="admin-hero-flags"><span>${icons.policy} JWT & RLS</span><span>${icons.activity} Audit log</span><span>${icons.device} Agent heartbeat</span></div>
        <div class="hero-actions"><button class="btn" data-page="users">Quản lý tài khoản</button><button class="btn btn-secondary" data-page="audit">Xem nhật ký</button></div>
      </div>
      <figure class="dashboard-hero-media"><img src="/assets/admin-system-operations.jpg" alt="Quản trị viên theo dõi hoạt động và sức khỏe hệ thống" width="1200" height="800" decoding="async" fetchpriority="high"><figcaption class="hero-media-insight"><span class="hero-insight-icon">${icons.device}</span><span><small>Sức khỏe thiết bị</small><strong>${onlinePercent}% trực tuyến</strong><em>${s.devices_online} / ${s.total_devices} thiết bị có kết nối</em></span></figcaption></figure>
    </section>
    <section class="metrics admin-kpi-grid" aria-label="Chỉ số vận hành hệ thống">${metric('Người dùng', s.total_users, 'tài khoản', 'child', true)}${metric('Trẻ em', s.total_children, 'hồ sơ', 'child')}${metric('Thiết bị trực tuyến', s.devices_online, `/ ${s.total_devices} thiết bị`, 'device')}${metric('Cảnh báo hôm nay', s.alerts_today, 'tín hiệu', 'alert')}</section>
    <section class="dashboard-grid admin-operations-grid">
      <div class="stack">
        <article class="card card-pad admin-health-card"><div class="admin-card-heading"><span class="admin-card-icon">${icons.device}</span><div><p class="eyebrow">Sức khỏe thiết bị</p><h2>${s.total_devices} thiết bị đang được quản lý</h2><p class="muted">Heartbeat trong 5 phút gần nhất được tính là trực tuyến.</p></div></div><div class="donut-row admin-health-chart"><div class="donut" role="img" aria-label="${onlinePercent}% thiết bị đang trực tuyến" style="--value:${onlinePercent}"><strong>${onlinePercent}%</strong></div><div class="legend"><div class="legend-row"><i class="legend-dot"></i><span>Trực tuyến</span><b>${s.devices_online}</b></div><div class="legend-row"><i class="legend-dot"></i><span>Ngoại tuyến</span><b>${offlineDevices}</b></div><div class="legend-row"><i class="legend-dot"></i><span>Cảnh báo hôm nay</span><b>${s.alerts_today}</b></div></div></div></article>
        <article class="card admin-shortcuts-card"><div class="card-head"><div><p class="eyebrow">Điều hành nhanh</p><h2>Lối tắt quản trị</h2><p>Đi thẳng đến các khu vực được sử dụng thường xuyên.</p></div></div><div class="card-body list quick-link-list"><button class="list-item" type="button" data-page="users"><span class="list-icon">TK</span><span class="list-copy"><strong>Tài khoản người dùng</strong><small>Xem, khóa, xác minh hoặc thu hồi phiên</small></span><span class="list-arrow">→</span></button><button class="list-item" type="button" data-page="blacklist"><span class="list-icon">BL</span><span class="list-copy"><strong>Danh sách chặn toàn cục</strong><small>${s.blacklist_count} tên miền đang được đồng bộ</small></span><span class="list-arrow">→</span></button><button class="list-item" type="button" data-page="audit"><span class="list-icon">AU</span><span class="list-copy"><strong>Nhật ký kiểm toán</strong><small>Kiểm tra các thao tác nhạy cảm</small></span><span class="list-arrow">→</span></button></div></article>
      </div>
      <aside class="stack">
        <article class="metric-card admin-blacklist-card"><div class="metric-icon">${icons.policy}</div><p class="metric-label">DANH SÁCH CHẶN TOÀN CỤC</p><div class="metric-value">${s.blacklist_count}<small>tên miền</small></div><button class="admin-card-link" data-page="blacklist">Quản lý danh sách <span>→</span></button></article>
        <article class="card card-pad admin-status-card"><div class="admin-card-heading"><span class="admin-card-icon">${icons.activity}</span><div><p class="eyebrow">Trạng thái vận hành</p><h3>Các lớp bảo vệ cốt lõi</h3></div></div><div class="list"><div class="list-item"><div class="list-icon">API</div><div class="list-copy"><strong>Backend API</strong><small>${state.connectionStatus === 'online' ? 'Đã kết nối và phản hồi' : 'Cần kiểm tra kết nối'}</small></div><span class="badge ${state.connectionStatus === 'online' ? '' : 'coral'}">${state.connectionStatus === 'online' ? 'Ổn định' : 'Chú ý'}</span></div><div class="list-item"><div class="list-icon">RL</div><div class="list-copy"><strong>Phân tách dữ liệu gia đình</strong><small>Parent API được bảo vệ bằng JWT và RLS</small></div><span class="badge blue">Đã cấu hình</span></div><div class="list-item"><div class="list-icon">AL</div><div class="list-copy"><strong>Audit log</strong><small>Ghi nhận thao tác quản trị nhạy cảm</small></div><span class="badge blue">Đã cấu hình</span></div></div></article>
      </aside>
    </section>`;
}

async function renderUsers(content) {
  const filter = state.adminUserFilter || {};
  const result = await api('/admin/users' + queryString({
    ...filter,
    limit: state.adminUserLimit,
    offset: state.adminUserOffset,
  }));
  if (!(result.data || []).length && state.adminUserOffset > 0) {
    state.adminUserOffset = Math.max(0, state.adminUserOffset - state.adminUserLimit);
    return renderUsers(content);
  }
  state.adminUsers = result.data || [];
  const activeOnPage = state.adminUsers.filter((user) => user.is_active).length;
  const adminsOnPage = state.adminUsers.filter((user) => user.role === 'admin').length;
  content.innerHTML = `
    ${pageHead('users', '<button class="btn btn-secondary" data-action="refresh-users">' + icons.refresh + ' Làm mới</button>')}
    ${adminSectionIntro('users', [{ value: Number(result.total) || 0, label: 'Tài khoản' }, { value: activeOnPage, label: 'Đang hoạt động' }, { value: adminsOnPage, label: 'Quản trị viên' }])}
    <form id="admin-user-filter" class="filters filters-users">
      <div class="field"><label>Tìm kiếm</label><input class="input" name="search" value="${escapeHtml(filter.search || '')}" placeholder="Tên hoặc email"></div>
      <div class="field"><label>Vai trò</label><select class="select" name="role"><option value="">Tất cả vai trò</option><option value="parent" ${filter.role === 'parent' ? 'selected' : ''}>Phụ huynh</option><option value="admin" ${filter.role === 'admin' ? 'selected' : ''}>Quản trị viên</option></select></div>
      <div class="field"><label>Trạng thái</label><select class="select" name="status"><option value="">Tất cả trạng thái</option><option value="active" ${filter.status === 'active' ? 'selected' : ''}>Đang hoạt động</option><option value="disabled" ${filter.status === 'disabled' ? 'selected' : ''}>Đã khóa</option></select></div>
      <div class="filter-actions"><button class="btn btn-ghost" type="button" data-action="clear-admin-user-filter">Đặt lại</button><button class="btn" type="submit">Áp dụng</button></div>
    </form>
    <section class="table-card admin-table-card"><div class="table-scroll"><table><thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Trạng thái</th><th>Dữ liệu</th><th>Ngày tạo</th><th>Thao tác</th></tr></thead><tbody>${state.adminUsers.map((u) => {
      const isSelf = String(u.user_id) === String(state.userId);
      return `<tr>
        <td><div class="admin-user-cell"><span class="admin-user-avatar">${escapeHtml(initials(u.name))}</span><span class="cell-title"><strong>${escapeHtml(u.name)} ${isSelf ? '<span class="badge blue">Bạn</span>' : ''}</strong><small>#${u.user_id} · ${escapeHtml(u.email)}</small></span></div></td>
        <td><span class="badge ${u.role === 'admin' ? 'coral' : ''}">${u.role === 'admin' ? 'Quản trị viên' : 'Phụ huynh'}</span></td>
        <td><span class="badge ${u.is_active ? '' : 'red'}">${u.is_active ? 'Đang hoạt động' : 'Đã khóa'}</span><small class="status-sub">${u.is_verified ? 'Đã xác minh email' : 'Chưa xác minh email'}</small></td>
        <td><strong>${u.child_count}</strong> trẻ · <strong>${u.device_count}</strong> thiết bị</td>
        <td>${formatDate(u.created_at)}</td>
        <td><div class="row-actions"><button class="btn btn-secondary btn-sm" data-action="view-user" data-id="${u.user_id}">Chi tiết</button><button class="kebab" aria-label="Chỉnh sửa ${escapeHtml(u.name)}" title="Chỉnh sửa" data-action="edit-user" data-id="${u.user_id}">✎</button><button class="kebab" aria-label="Thu hồi phiên của ${escapeHtml(u.name)}" title="Thu hồi phiên" data-action="revoke-user-sessions" data-id="${u.user_id}">↻</button><button class="kebab danger" aria-label="${isSelf ? 'Không thể xóa tài khoản của chính mình' : `Xóa ${escapeHtml(u.name)}`}" title="${isSelf ? 'Không thể xóa chính mình' : 'Xóa tài khoản'}" data-action="delete-user" data-id="${u.user_id}" ${isSelf ? 'disabled' : ''}>×</button></div></td>
      </tr>`;
    }).join('')}</tbody></table></div>${state.adminUsers.length ? `<div class="table-footer"><span>Thao tác quản trị được ghi vào audit log</span>${paginationMarkup('users', result, 'tài khoản')}</div>` : emptyState('◎', 'Không tìm thấy tài khoản', 'Hãy thay đổi bộ lọc để xem kết quả khác.')}</section>`;
}

async function renderBlacklist(content) {
  const search = state.blacklistSearch || '';
  const result = await api('/admin/blacklist' + queryString({
    search,
    limit: state.blacklistLimit,
    offset: state.blacklistOffset,
  }));
  if (!(result.data || []).length && state.blacklistOffset > 0) {
    state.blacklistOffset = Math.max(0, state.blacklistOffset - state.blacklistLimit);
    return renderBlacklist(content);
  }
  content.innerHTML = `
    ${pageHead('blacklist', '<button class="btn" data-action="add-blacklist">' + icons.plus + ' Thêm tên miền</button>')}
    ${adminSectionIntro('blacklist', [{ value: Number(result.total) || result.data.length, label: 'Tên miền phù hợp' }, { value: 'Backend', label: 'Lớp kiểm tra' }, { value: 'Agent', label: 'Nơi đồng bộ' }])}
    <form id="blacklist-search" class="filters filters-search"><div class="field"><label>Tìm tên miền</label><input class="input" name="search" value="${escapeHtml(search)}" placeholder="example.com"></div><div class="filter-actions"><button class="btn btn-ghost" type="button" data-action="clear-blacklist-filter">Đặt lại</button><button class="btn btn-secondary" type="submit">Tìm kiếm</button></div></form>
    <section class="table-card admin-table-card"><div class="table-scroll"><table><thead><tr><th>Tên miền</th><th>Lý do</th><th>Người thêm</th><th>Ngày thêm</th><th><span class="visually-hidden">Thao tác</span></th></tr></thead><tbody>${result.data.map((item) => `<tr><td><div class="admin-domain-cell"><span>⊘</span><strong>${escapeHtml(item.domain)}</strong></div></td><td>${escapeHtml(item.reason || '—')}</td><td>${escapeHtml(item.added_by_name || 'Hệ thống')}</td><td>${formatDate(item.created_at)}</td><td><button class="btn btn-danger btn-sm" aria-label="Xóa ${escapeHtml(item.domain)} khỏi danh sách chặn" data-action="delete-blacklist" data-id="${item.blacklist_id}" data-name="${escapeHtml(item.domain)}">Xóa</button></td></tr>`).join('')}</tbody></table></div>${result.data.length ? `<div class="table-footer">${paginationMarkup('blacklist', result, 'danh sách chặn')}</div>` : emptyState('⊘', search ? 'Không tìm thấy tên miền' : 'Danh sách chặn đang trống', search ? 'Không có mục nào phù hợp với từ khóa tìm kiếm.' : 'Thêm tên miền đầu tiên để Agent bắt đầu bảo vệ.', search ? '' : '<button class="btn" data-action="add-blacklist">Thêm tên miền</button>')}</section>`;
}

function auditMetadataPreview(metadata) {
  const serialized = JSON.stringify(metadata || {});
  return serialized.length > 92 ? `${serialized.slice(0, 89)}…` : serialized;
}

async function renderAudit(content) {
  const filter = state.auditFilter || {};
  const result = await api('/admin/audit-logs' + queryString({
    ...filter,
    limit: state.auditLimit,
    offset: state.auditOffset,
  }));
  if (!(result.data || []).length && state.auditOffset > 0) {
    state.auditOffset = Math.max(0, state.auditOffset - state.auditLimit);
    return renderAudit(content);
  }
  state.adminAuditLogs = result.data || [];
  content.innerHTML = `
    ${pageHead('audit')}
    ${adminSectionIntro('audit', [{ value: Number(result.total) || result.data.length, label: 'Sự kiện phù hợp' }, { value: 'IP', label: 'Nguồn truy cập' }, { value: 'JSON', label: 'Metadata chi tiết' }])}
    <form id="audit-filter" class="filters filters-audit"><div class="field"><label>Hành động</label><input class="input" name="action" list="audit-action-options" value="${escapeHtml(filter.action || '')}" placeholder="Ví dụ: settings.update"><datalist id="audit-action-options"><option value="settings.update"><option value="user.update"><option value="user.delete"><option value="blacklist.create"><option value="blacklist.delete"><option value="device.delete"><option value="device.rotate_secret"></datalist></div><div class="field"><label>Mã người thực hiện</label><input class="input" type="number" min="1" name="actor_user_id" value="${escapeHtml(filter.actor_user_id || '')}" placeholder="Ví dụ: 1"></div><div class="filter-actions"><button class="btn btn-ghost" type="button" data-action="clear-audit-filter">Đặt lại</button><button class="btn" type="submit">Áp dụng</button></div></form>
    <section class="table-card admin-table-card audit-table-card"><div class="table-scroll"><table><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>IP</th><th>Chi tiết</th></tr></thead><tbody>${state.adminAuditLogs.map((item) => `<tr><td>${formatDate(item.created_at)}</td><td><div class="admin-actor-cell"><span>#${item.actor_user_id ?? '—'}</span><span class="badge neutral">${escapeHtml(item.actor_role || '—')}</span></div></td><td><span class="audit-action-badge">${escapeHtml(item.action)}</span></td><td>${escapeHtml(item.target_type || '—')} <strong>#${escapeHtml(item.target_id || '—')}</strong></td><td><code class="audit-ip">${escapeHtml(item.ip_address || '—')}</code></td><td><button class="metadata-preview" aria-label="Xem chi tiết sự kiện ${escapeHtml(item.action)}" data-action="view-audit" data-id="${item.audit_id}"><code>${escapeHtml(auditMetadataPreview(item.metadata))}</code><span>Xem</span></button></td></tr>`).join('')}</tbody></table></div>${state.adminAuditLogs.length ? `<div class="table-footer">${paginationMarkup('audit', result, 'nhật ký kiểm toán')}</div>` : emptyState('⌁', 'Không có nhật ký', Object.values(filter).some(Boolean) ? 'Không có sự kiện nào phù hợp với bộ lọc.' : 'Chưa ghi nhận thao tác quản trị nhạy cảm nào.')}</section>`;
}

const agentEndpoints = {
  heartbeat: { method: 'POST', path: '/agent/heartbeat', label: 'Heartbeat', body: {} },
  config: { method: 'GET', path: '/agent/config', label: 'Cấu hình hiện tại' },
  'web-fallback': { method: 'POST', path: '/agent/classification/web/fallback', label: 'Phân loại tên miền bằng Gemini', body: { domain: 'example.com' } },
  'unknown-domains': { method: 'GET', path: '/agent/classification/web/unknown-domains', label: 'Tên miền chờ phân loại', query: { limit: 25 } },
  'web-backfill': { method: 'POST', path: '/agent/classification/web/backfill', label: 'Cập nhật nhãn tên miền', body: { domain: 'example.com', category: 'education', classification_source: 'trained_model', classification_confidence: 0.92 } },
  vision: { method: 'POST', path: '/agent/vision-alert', label: 'Cảnh báo thị giác', body: { alert_type: 'posture_warning', message: 'Trình diễn: trẻ đang ngồi sai tư thế.' } },
  app: { method: 'POST', path: '/logs/app', label: 'Hoạt động ứng dụng', body: { app_name: 'Visual Studio Code', category: 'learning', start_time: new Date().toISOString(), duration_seconds: 30 } },
  web: { method: 'POST', path: '/logs/web', label: 'Lượt truy cập website', body: { url: 'https://khanacademy.org', domain: 'khanacademy.org', category: 'education', visit_time: new Date().toISOString(), duration_seconds: 180, page_title: 'Khan Academy' } },
  'app-batch': { method: 'POST', path: '/logs/app/batch', label: 'Lô ứng dụng', body: { records: [{ client_record_id: crypto.randomUUID(), app_name: 'Demo App', category: 'unknown', start_time: new Date().toISOString(), duration_seconds: 60 }] } },
  'web-batch': { method: 'POST', path: '/logs/web/batch', label: 'Lô website', body: { records: [{ client_record_id: crypto.randomUUID(), url: 'https://example.com', domain: 'example.com', category: 'unknown', visit_time: new Date().toISOString(), duration_seconds: 60 }] } },
};

function renderApiLab(content) {
  const selected = agentEndpoints[state.agentEndpoint];
  const requestData = selected.method === 'GET' ? selected.query : selected.body;
  const requestLabel = selected.method === 'GET' ? 'Tham số query JSON' : 'Nội dung JSON';
  content.innerHTML = `
    ${pageHead('api-lab')}
    ${adminSectionIntro('api-lab', [{ value: Object.keys(agentEndpoints).length, label: 'Endpoint mẫu' }, { value: selected.method, label: 'Phương thức đã chọn' }, { value: state.agentSecret ? 'Sẵn sàng' : 'Chưa có', label: 'Device Secret' }])}
    <div class="secret-box api-secret-box"><span class="api-secret-icon">${icons.policy}</span><span class="api-secret-copy"><small>Thông tin xác thực phiên thử nghiệm</small><strong>X-Device-Secret tạm thời</strong><code>${state.agentSecret ? '••••••••' + state.agentSecret.slice(-6) : 'Chưa nhập secret'}</code></span><span class="api-secret-actions"><button class="btn btn-secondary btn-sm" data-action="set-agent-secret">${state.agentSecret ? 'Thay secret' : 'Nhập secret'}</button><button class="btn btn-ghost btn-sm" data-action="clear-agent-secret" ${state.agentSecret ? '' : 'disabled'}>Xóa khỏi bộ nhớ</button></span></div>
    <section class="api-lab-grid">
      <aside class="card endpoint-list"><div class="endpoint-list-head"><p class="eyebrow">Danh mục endpoint</p><strong>${Object.keys(agentEndpoints).length} tình huống thử</strong></div>${Object.entries(agentEndpoints).map(([key, endpoint]) => `<button class="endpoint-button ${state.agentEndpoint === key ? 'active' : ''}" data-action="select-agent-endpoint" data-endpoint="${key}"><span class="method ${endpoint.method.toLowerCase()}">${endpoint.method}</span><span><strong>${escapeHtml(endpoint.label)}</strong><small>/api${escapeHtml(endpoint.path)}</small></span><span class="endpoint-arrow">→</span></button>`).join('')}</aside>
      <article class="card card-pad api-request-card">
        <div class="api-request-heading"><span class="method ${selected.method.toLowerCase()}">${selected.method}</span><div><p class="eyebrow">Trình tạo request</p><h2>${escapeHtml(selected.label)}</h2><p class="muted">/api${escapeHtml(selected.path)}</p></div></div>
        <form id="agent-request-form"><div class="field"><label>${requestLabel}</label><textarea class="textarea agent-request-data" name="request_data" ${requestData === undefined ? 'disabled' : ''}>${requestData === undefined ? '' : escapeHtml(JSON.stringify(requestData, null, 2))}</textarea>${selected.method === 'GET' && requestData !== undefined ? '<small>Giá trị sẽ được mã hóa an toàn vào query string.</small>' : ''}</div><div class="form-actions"><button class="btn" type="submit" ${state.agentSecret ? '' : 'disabled'}>Gửi request</button></div></form>
        <div id="agent-response"></div>
      </article>
    </section>`;
}

function childForm(child = {}) {
  return `<form id="child-form" class="form-grid" data-id="${child.child_id || ''}"><div class="field full"><label>Tên trẻ</label><input class="input" name="name" maxlength="100" required value="${escapeHtml(child.name || '')}"></div><div class="field full"><label>Tuổi</label><input class="input" type="number" name="age" min="0" max="18" value="${child.age ?? ''}"></div><div class="form-actions field full"><button class="btn btn-secondary" type="button" data-action="close-modal">Hủy</button><button class="btn" type="submit">Lưu hồ sơ</button></div></form>`;
}

function deviceForm() {
  return `<form id="device-form" class="form-grid"><div class="field full"><label>Hồ sơ trẻ</label><select class="select" name="child_id" required><option value="">Chọn hồ sơ</option>${state.children.map((c) => `<option value="${c.child_id}">${escapeHtml(c.name)}</option>`).join('')}</select></div><div class="field full"><label>Tên thiết bị</label><input class="input" name="device_name" maxlength="100" required placeholder="Laptop học tập"></div><div class="field full"><label>Mã định danh thiết bị (Device UID)</label><input class="input" name="device_uid" maxlength="150" pattern="[A-Za-z0-9_:\\-]+" required placeholder="DESKTOP-ABC123"><small>Mã bạn tự nhập để phân biệt máy này, không trùng thiết bị đã đăng ký. Đây không phải mã kết nối (Device Secret). Chỉ dùng chữ, số, dấu gạch ngang, gạch dưới và dấu hai chấm.</small></div><p class="device-modal-status field full" role="status" aria-live="polite" aria-atomic="true" tabindex="-1"></p><div class="form-actions field full"><button class="btn btn-secondary" type="button" data-action="close-modal">Hủy</button><button class="btn" type="submit">Đăng ký</button></div></form>`;
}

function agentGuide(deviceOnboarding = false) {
  const serviceCommand = 'Get-Service ChildMonitorService';
  const companionCommand = "Get-CimInstance Win32_Process -Filter \"Name='ChildMonitorCompanion.exe'\"";
  if (deviceOnboarding) {
    return `<div class="agent-guide device-setup-guide">
      <ol>
        <li><strong>Tạo hồ sơ trẻ</strong><p>Nếu chưa có hồ sơ, tạo hồ sơ rồi quay lại mục Thiết bị.</p></li>
        <li><strong>Chuẩn bị phần mềm trên máy của trẻ</strong><p>Chuẩn bị bộ cài Agent cho Windows. Cài sau khi có mã kết nối ở bước 5.</p></li>
        <li><strong>Chuẩn bị mã định danh thiết bị</strong><p>Tự nhập một Device UID riêng, chưa đăng ký cho máy khác. Agent không cung cấp sẵn mã này.</p></li>
        <li><strong>Đăng ký thiết bị</strong><p>Chọn hồ sơ trẻ, nhập tên máy dễ nhận biết và mã định danh đã chuẩn bị.</p></li>
        <li><strong>Lưu mã kết nối và cài phần mềm</strong><p>Lưu Device Secret chỉ hiển thị một lần, rồi nhập mã khi cài Agent trên đúng máy. Thông số cài đặt ở phần kỹ thuật bên dưới.</p></li>
      </ol>
      <p class="device-setup-next">Sau khi cài, tải lại danh sách Thiết bị và kiểm tra “Lần liên lạc gần nhất”.</p>
      <details class="device-setup-technical">
        <summary>Hướng dẫn kỹ thuật: cài đặt và kiểm tra kết nối</summary>
        <h3>Cài đặt trên Windows</h3>
        <p>Chạy bộ cài Agent bằng quyền quản trị (Run as administrator), nhập Device Secret đã lưu và địa chỉ máy chủ (Backend URL):</p>
        <div class="copy-row"><code>${DEFAULT_BACKEND_URL}</code><button class="btn btn-secondary btn-sm" type="button" data-action="copy-value" data-value="${DEFAULT_BACKEND_URL}">Sao chép địa chỉ</button></div>
        <h3>Kiểm tra sau cài đặt</h3>
        <p>Mở PowerShell với quyền Administrator và chạy các lệnh kiểm tra dịch vụ, tiến trình:</p>
        <div class="copy-row"><code>${escapeHtml(serviceCommand)}</code><button class="btn btn-secondary btn-sm" type="button" data-action="copy-value" data-value="${escapeHtml(serviceCommand)}" aria-label="Sao chép lệnh kiểm tra dịch vụ">Sao chép lệnh</button></div>
        <div class="copy-row"><code>${escapeHtml(companionCommand)}</code><button class="btn btn-secondary btn-sm" type="button" data-action="copy-value" data-value="${escapeHtml(companionCommand)}" aria-label="Sao chép lệnh kiểm tra tiến trình">Sao chép lệnh</button></div>
        <p>Nếu dùng máy ảo VMware Windows, cài Agent trong máy ảo. Backend và Cloudflare Named Tunnel cần hoạt động để Agent liên lạc với địa chỉ máy chủ ở trên.</p>
        <p>Để kiểm tra dữ liệu hoạt động, mở một ứng dụng và một trang web mới trên máy đã cài Agent, chờ 1–2 phút rồi xem mục Hoạt động. Khi đổi mã kết nối, cần cập nhật mã mới cho Agent.</p>
      </details>
      <div class="form-actions"><button class="btn btn-secondary" type="button" data-action="close-modal">Đóng</button>${deviceRegistrationAction()}</div>
    </div>`;
  }
  return `<div class="agent-guide"><ol><li><strong>Đăng ký thiết bị</strong><p>Tạo thiết bị trên Dashboard và lưu Device Secret được hiển thị một lần.</p></li><li><strong>Cài Agent 1.0.14 trên VMware</strong><p>Chạy file cài đặt bằng quyền Administrator. Backend URL dùng địa chỉ cố định bên dưới.</p><div class="copy-row"><code>${DEFAULT_BACKEND_URL}</code><button class="btn btn-secondary btn-sm" data-action="copy-value" data-value="${DEFAULT_BACKEND_URL}">Sao chép</button></div></li><li><strong>Kiểm tra sau cài đặt</strong><p>Mở PowerShell Administrator và chạy hai lệnh:</p><div class="copy-row"><code>${escapeHtml(serviceCommand)}</code><button class="btn btn-secondary btn-sm" data-action="copy-value" data-value="${escapeHtml(serviceCommand)}">Sao chép</button></div><div class="copy-row"><code>${escapeHtml(companionCommand)}</code><button class="btn btn-secondary btn-sm" data-action="copy-value" data-value="${escapeHtml(companionCommand)}">Sao chép</button></div></li><li><strong>Xác nhận dữ liệu</strong><p>Mở một ứng dụng và một trang web mới trong Edge, Chrome hoặc Cốc Cốc, chờ 1–2 phút rồi xem trang Hoạt động.</p></li></ol><div class="guide-note">Cloudflare Named Tunnel và Backend vẫn phải đang chạy để Agent kết nối được tới ${DEFAULT_BACKEND_URL}.</div></div>`;
}

function confirmModal(title, text, action, id, extra = '') {
  showModal(title, text, `<div class="form-actions"><button class="btn btn-secondary" data-action="close-modal">Hủy</button><button class="btn btn-danger" data-action="${action}" data-id="${id}" ${extra}>Xác nhận</button></div>`);
}

async function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === 'chat-form') return await submitAIChat(form);
  if (form.id === 'device-form' && form.closest('.modal')?.dataset.devicePending === 'true') return;
  if (form.id === 'device-control-form' && (!isCurrentControlForm(form)
    || form.dataset.controlPending === 'true' || modalRoot.firstElementChild)) return;
  if (form.id === 'policy-form') {
    const childId = String(form.dataset.childId);
    if (!isCurrentPolicyForm(form) || state.policyPendingByChild[childId]) return;
  }
  const data = Object.fromEntries(new FormData(form));
  if (form.id === 'edit-device-form') return renameDeviceFromModal(form, data);
  const submit = form.querySelector('[type="submit"]');
  if (submit && form.id !== 'device-control-form') submit.disabled = true;
  try {
    if (form.id === 'login-form') {
      const result = await api('/auth/login', { method: 'POST', body: data, noAuth: true });
      if (result.requiresFaceVerification) {
        await renderAdminFaceVerification(result);
        return;
      }
      await completeLogin(result);
    } else if (form.id === 'register-form') {
      const result = await api('/auth/register', { method: 'POST', body: data, noAuth: true });
      toast('Đã gửi yêu cầu đăng ký', localizeMessage(result.message));
      renderAuth('verify');
    } else if (form.id === 'forgot-form') {
      const result = await api('/auth/forgot-password', { method: 'POST', body: data, noAuth: true });
      toast('Đã tiếp nhận yêu cầu', localizeMessage(result.message));
      renderAuth('login');
    } else if (form.id === 'verify-form') {
      const result = await api('/auth/verify', { method: 'POST', body: data, noAuth: true });
      toast('Email đã được xác minh', localizeMessage(result.message));
      history.replaceState({}, '', '/');
      renderAuth('login');
    } else if (form.id === 'resend-form') {
      const result = await api('/auth/resend-verification', { method: 'POST', body: data, noAuth: true });
      toast('Đã gửi lại email xác minh', localizeMessage(result.message));
      renderAuth('verify');
    } else if (form.id === 'reset-form') {
      const result = await api('/auth/reset-password', { method: 'POST', body: data, noAuth: true });
      toast('Đã đặt lại mật khẩu', localizeMessage(result.message));
      history.replaceState({}, '', '/');
      renderAuth('login');
    } else if (form.id === 'child-form') {
      const id = form.dataset.id;
      const body = { name: data.name, age: data.age === '' ? null : Number(data.age) };
      await api(id ? `/children/${id}` : '/children', { method: id ? 'PUT' : 'POST', body });
      closeModal(); toast(id ? 'Đã cập nhật hồ sơ' : 'Đã thêm hồ sơ'); await navigate('children');
    } else if (form.id === 'device-form') {
      await registerDeviceFromModal(form, data);
    } else if (form.id === 'device-control-form') {
      const controlFields = [
        'is_locked',
        'enable_posture_monitoring',
        'enable_eye_distance_monitoring',
        'enable_screenshot_review',
        'enable_break_reminders',
      ];
      controlFields.forEach((name) => { data[name] = form.elements[name].checked; });
      data.vision_session_minutes = Number(form.elements.vision_session_minutes.value);
      if (!Number.isInteger(data.vision_session_minutes) || data.vision_session_minutes < 1 || data.vision_session_minutes > 60) {
        throw new Error('Thời lượng phiên camera phải từ 1 đến 60 phút.');
      }
      if (event.submitter?.dataset.startVisionSession === 'true') {
        if (!data.enable_posture_monitoring && !data.enable_eye_distance_monitoring) {
          throw new Error('Hãy chọn Theo dõi tư thế hoặc Cảnh báo khoảng cách mắt để bắt đầu phiên.');
        }
        data.start_vision_session = true;
      }
      data.daily_limit_minutes = Number(data.daily_limit_minutes);
      if (data.enable_break_reminders) {
        data.break_interval_minutes = Number(form.elements.break_interval_minutes.value);
        data.break_duration_minutes = Number(form.elements.break_duration_minutes.value);
      } else {
        delete data.break_interval_minutes;
        delete data.break_duration_minutes;
      }
      if (data.is_locked && form.dataset.savedLocked !== 'true') showControlLockConfirmation(form, data);
      else await saveDeviceControls(form, data);
    } else if (form.id === 'policy-form') {
      await savePolicyForm(form);
    } else if (form.id === 'activity-filter') {
      state.activityFilter = data;
      state.activityOffset = 0;
      await renderActivity(document.querySelector('#page-content'), 'activity-filter');
    } else if (form.id === 'alert-filter') {
      state.alertFilter = data;
      await renderAlerts(document.querySelector('#page-content'));
    } else if (form.id === 'change-password-form') {
      const result = await api('/auth/change-password', { method: 'POST', body: data });
      toast('Đã đổi mật khẩu', localizeMessage(result.message));
      await logout(false);
    } else if (form.id === 'push-token-form') {
      if (data.provider === 'expo' && data.platform === 'web') {
        throw new Error('Expo chỉ hỗ trợ thông báo trên Android hoặc iOS');
      }
      await api('/notifications/tokens', { method: 'POST', body: data });
      form.reset();
      toast('Đã đăng ký thiết bị nhận thông báo');
      await renderAccount(document.querySelector('#page-content'));
    } else if (form.id === 'admin-user-filter') {
      state.adminUserFilter = data;
      state.adminUserOffset = 0;
      await renderUsers(document.querySelector('#page-content'));
    } else if (form.id === 'admin-user-form') {
      const currentUser = state.adminUsers.find((item) => String(item.user_id) === String(form.dataset.id));
      const body = {
        role: data.role,
        is_active: form.elements.is_active.checked,
        is_verified: form.elements.is_verified.checked,
      };
      const promotingToAdmin = currentUser?.role === 'parent' && body.role === 'admin';
      if (promotingToAdmin && !form.elements.confirm_face_enrollment?.checked) {
        throw new Error('Hãy xác nhận đã chuẩn bị quy trình đăng ký khuôn mặt cho quản trị viên mới');
      }
      await api(`/admin/users/${form.dataset.id}`, { method: 'PATCH', body });
      closeModal();
      toast('Đã cập nhật tài khoản', 'Các thay đổi quyền hoặc trạng thái đã được áp dụng.');
      await renderUsers(document.querySelector('#page-content'));
    } else if (form.id === 'blacklist-search') {
      state.blacklistSearch = data.search;
      state.blacklistOffset = 0;
      await renderBlacklist(document.querySelector('#page-content'));
    } else if (form.id === 'blacklist-form') {
      await api('/admin/blacklist', { method: 'POST', body: data });
      state.blacklistOffset = 0;
      closeModal(); toast('Đã thêm tên miền', `${data.domain} sẽ được đồng bộ xuống Agent.`); await navigate('blacklist');
    } else if (form.id === 'audit-filter') {
      state.auditFilter = data;
      state.auditOffset = 0;
      await renderAudit(document.querySelector('#page-content'));
    } else if (form.id === 'agent-request-form') {
      const endpoint = agentEndpoints[state.agentEndpoint];
      let requestPath = endpoint.path;
      let body;
      const rawRequestData = String(data.request_data || '').trim();
      if (endpoint.method === 'GET') {
        if (rawRequestData) {
          const query = JSON.parse(rawRequestData);
          if (!query || typeof query !== 'object' || Array.isArray(query)) {
            throw new Error('Tham số query phải là một JSON object');
          }
          requestPath += queryString(query);
        }
      } else {
        body = rawRequestData ? JSON.parse(rawRequestData) : {};
      }
      const started = performance.now();
      const result = await api(requestPath, { method: endpoint.method, headers: { 'X-Device-Secret': state.agentSecret }, body, noAuth: true });
      const target = document.querySelector('#agent-response');
      target.innerHTML = `<p class="eyebrow api-response-status">200 OK · ${Math.round(performance.now() - started)}ms</p><pre class="code-box">${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
      toast('Request thành công', endpoint.label);
    }
  } catch (error) {
    toast('Không thể hoàn tất', localizeError(error.message), 'error');
    if (form.id === 'agent-request-form') {
      const target = document.querySelector('#agent-response');
      if (target) target.innerHTML = `<p class="eyebrow api-response-status">Request thất bại</p><pre class="code-box">${escapeHtml(JSON.stringify(error.payload || { message: error.message }, null, 2))}</pre>`;
    }
  } finally {
    if (submit && form.id !== 'device-control-form') {
      if (form.id === 'policy-form') syncPolicyFormState(String(form.dataset.childId));
      else submit.disabled = false;
    }
  }
}

async function renameDeviceFromModal(form, data) {
  const modal = form.closest('.modal');
  const deviceId = form.dataset.id;
  const pageAtSubmit = state.page;
  // A reopened dialog for the same device is still a different editing session.
  const isCurrent = () => form.isConnected && modal === modalRoot.querySelector('.modal')
    && modal?.querySelector('#edit-device-form') === form
    && form.dataset.id === deviceId && state.page === pageAtSubmit;
  if (!isCurrent() || form.dataset.renamePending === 'true') return;
  form.dataset.renamePending = 'true';
  const submit = form.querySelector('[type="submit"]');
  if (submit) submit.disabled = true;
  try {
    await api(`/devices/${deviceId}`, { method: 'PUT', body: { device_name: data.device_name } });
    if (!isCurrent()) return;
    closeModal(); toast('Đã đổi tên thiết bị'); await navigate('devices');
  } catch (error) {
    if (isCurrent()) toast('Không thể hoàn tất', localizeError(error.message), 'error');
  } finally {
    delete form.dataset.renamePending;
    if (submit) submit.disabled = false;
  }
}

function deviceModalDismissBlocked() {
  const modal = modalRoot.querySelector('.modal');
  if (modal?.dataset.devicePending === 'true') {
    modal.querySelector('.device-modal-status')?.focus();
    return true;
  }
  const saved = modal?.querySelector('#device-secret-saved');
  if (saved && !saved.checked) {
    modal.querySelector('#device-secret-status').textContent = 'Mã vẫn được giữ ở đây. Hãy lưu mã rồi đánh dấu xác nhận trước khi đóng.';
    saved.focus();
    return true;
  }
  return false;
}

function protectDeviceModalOnUnload(event) {
  const modal = modalRoot.querySelector('.modal');
  const saved = modal?.querySelector('#device-secret-saved');
  if (modal?.dataset.devicePending === 'true' || (saved && !saved.checked)) {
    event.preventDefault();
    event.returnValue = '';
  }
}

function beginDeviceModalRequest(modal, message) {
  if (!modal || modal !== modalRoot.querySelector('.modal') || modal.dataset.devicePending === 'true') return null;
  modal.dataset.devicePending = 'true';
  const controls = [...modal.querySelectorAll('button')].map((button) => [button, button.disabled]);
  controls.forEach(([button]) => { button.disabled = true; });
  const status = modal.querySelector('.device-modal-status');
  status.textContent = message;
  status.focus();
  let finished = false;
  // This timer only explains the delay; it never retries or cancels the request.
  const slowNoticeTimer = setTimeout(() => {
    if (finished || !modal.isConnected || modal !== modalRoot.querySelector('.modal')
      || modal.dataset.devicePending !== 'true') return;
    status.textContent = `${message} Thao tác đang mất nhiều thời gian hơn bình thường. Vui lòng tiếp tục chờ hoặc kiểm tra kết nối.`;
  }, 10_000);
  return () => {
    if (finished) return;
    finished = true;
    clearTimeout(slowNoticeTimer);
    delete modal.dataset.devicePending;
    controls.forEach(([button, disabled]) => { button.disabled = disabled; });
  };
}

async function registerDeviceFromModal(form, data) {
  const finish = beginDeviceModalRequest(form.closest('.modal'), 'Đang đăng ký thiết bị. Các trường tạm khóa; vui lòng chờ để nhận mã kết nối.');
  if (!finish) return;
  // FormData has already been captured by handleSubmit before disabling fields.
  const fields = [...form.querySelectorAll('input, select')].map((field) => [field, field.disabled]);
  fields.forEach(([field]) => { field.disabled = true; });
  try {
    const result = await api('/devices', { method: 'POST', body: { child_id: Number(data.child_id), device_name: data.device_name, device_uid: data.device_uid } });
    finish();
    // Replace the form directly so focus stays in the dialog until the code is saved.
    showSecret(result);
    await renderDevices(document.querySelector('#page-content'));
  } catch (error) {
    if (form.isConnected) {
      form.querySelector('.device-modal-status').textContent = 'Chưa nhận được mã kết nối. Hãy kiểm tra kết nối và danh sách thiết bị trước khi thử lại.';
    }
    throw error;
  } finally {
    fields.forEach(([field, disabled]) => { field.disabled = disabled; });
    finish();
  }
}

function showDeviceConfirmation(action, id) {
  const device = state.devices.find((item) => String(item.device_id) === String(id));
  if (!device) return toast('Không tìm thấy thiết bị', 'Hãy tải lại danh sách thiết bị rồi thử lại.', 'error');
  const deleting = action === 'delete-device';
  const label = deleting ? 'Xóa thiết bị' : 'Đổi mã kết nối';
  const confirmAction = deleting ? 'confirm-delete-device' : 'confirm-rotate-secret';
  const child = state.children.find((item) => String(item.child_id) === String(device.child_id));
  showModal(
    `${label}${deleting ? '' : ' cho'} “${device.device_name || `Thiết bị #${device.device_id}`}”?`,
    deleting
      ? 'Thiết bị cùng lịch sử hoạt động, ảnh chụp màn hình, cảnh báo và kết quả phân tích liên quan sẽ bị xóa. Agent sẽ không thể gửi dữ liệu bằng mã kết nối hiện tại.'
      : 'Mã kết nối cũ (Device Secret) sẽ mất hiệu lực ngay khi đổi. Bạn cần cập nhật mã mới cho Agent (phần mềm trên máy của trẻ) để tiếp tục gửi dữ liệu.',
    `<div class="device-confirmation" data-device-id="${escapeHtml(device.device_id)}" data-confirm-action="${confirmAction}">
      <p class="device-confirmation-identity">${child ? `Hồ sơ trẻ: <strong>${escapeHtml(child.name)}</strong><br>` : ''}Mã định danh (Device UID): <span>${escapeHtml(device.device_uid)}</span></p>
      <p class="device-modal-status" role="status" aria-live="polite" aria-atomic="true" tabindex="-1"></p>
      <div class="form-actions"><button class="btn btn-secondary" type="button" data-action="close-modal">Hủy</button><button class="btn btn-danger" type="button" data-action="${confirmAction}" data-id="${escapeHtml(device.device_id)}">${label}</button></div>
    </div>`,
    { initialFocus: '.device-confirmation [data-action="close-modal"]' },
  );
}

async function confirmDeviceAction(button) {
  const modal = modalRoot.querySelector('.modal');
  const target = button.closest('.device-confirmation');
  const { action, id } = button.dataset;
  // Bind the request to the identity shown in this dialog, not a selection elsewhere.
  if (!modal?.contains(button) || !target || target.dataset.deviceId !== id || target.dataset.confirmAction !== action) return;
  const deleting = action === 'confirm-delete-device';
  const finish = beginDeviceModalRequest(modal, deleting ? 'Đang xóa thiết bị…' : 'Đang đổi mã kết nối. Vui lòng chờ để lưu mã mới.');
  if (!finish) return;
  try {
    if (deleting) {
      await api(`/devices/${id}`, { method: 'DELETE' });
      if (String(state.selectedDeviceId) === String(id)) state.selectedDeviceId = null;
      finish();
      closeModal(); toast('Đã xóa thiết bị'); return navigate('devices');
    }
    const result = await api(`/devices/${id}/rotate-secret`, { method: 'POST' });
    finish();
    showSecret(result);
  } catch (error) {
    if (modal.isConnected) {
      modal.querySelector('.device-modal-status').textContent = deleting
        ? 'Chưa xác nhận được việc xóa. Hãy kiểm tra kết nối và danh sách thiết bị trước khi thử lại.'
        : 'Chưa nhận được mã kết nối mới. Hãy kiểm tra kết nối trước khi thử lại.';
    }
    throw error;
  } finally {
    finish();
  }
}

function showSecret(result) {
  state.agentSecret = result.device_secret;
  showModal('Lưu mã kết nối trước khi đóng', 'Mã kết nối (Device Secret) chỉ hiển thị một lần. Hãy sao chép và lưu mã để cài đặt hoặc cập nhật Agent (phần mềm trên máy của trẻ).',
    `<div class="secret-box"><strong>${escapeHtml(result.device_name)}</strong><code id="secret-value" tabindex="0" aria-label="Mã kết nối (Device Secret)">${escapeHtml(result.device_secret)}</code><button class="btn btn-secondary btn-sm" type="button" data-action="copy-secret">Sao chép mã kết nối</button></div>
    <p id="device-secret-status" class="device-modal-status" role="status" aria-live="polite" aria-atomic="true"></p>
    <label class="device-secret-ack"><input id="device-secret-saved" type="checkbox" aria-describedby="device-secret-hint"><span>Tôi đã lưu mã kết nối ở nơi an toàn.</span></label>
    <p id="device-secret-hint" class="device-secret-hint">Sao chép chưa đồng nghĩa với đã lưu. Hãy lưu mã trước khi xác nhận; X, phím Escape và nhấp bên ngoài chỉ đóng sau bước này.</p>
    <div class="form-actions"><button class="btn" type="button" data-action="close-modal" id="device-secret-close" disabled>Đã lưu mã, đóng</button></div>`,
    { initialFocus: '[data-action="copy-secret"]' });
  const saved = modalRoot.querySelector('#device-secret-saved');
  saved.addEventListener('change', () => {
    modalRoot.querySelector('#device-secret-close').disabled = !saved.checked;
  });
}

async function copyDeviceSecret(button) {
  const modal = button.closest('.modal');
  const secret = modal?.querySelector('#secret-value');
  if (!secret || button.disabled) return;
  const hadFocus = document.activeElement === button;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try {
    await navigator.clipboard.writeText(secret.textContent);
    if (modal.isConnected) modal.querySelector('#device-secret-status').textContent = 'Đã sao chép mã. Hãy lưu mã ở nơi an toàn trước khi đóng.';
  } catch {
    if (modal.isConnected) {
      modal.querySelector('#device-secret-status').textContent = 'Không thể sao chép tự động. Hãy chọn mã phía trên và sao chép thủ công, rồi lưu ở nơi an toàn.';
      secret.focus();
    }
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (hadFocus && modal.isConnected && document.activeElement === document.body) button.focus();
  }
}

async function logout(callApi = true) {
  if (callApi) {
    try { await api('/auth/logout', { method: 'POST', body: { refreshToken: state.refreshToken } }); } catch { /* local logout continues */ }
  }
  clearSession();
  renderAuth('login');
}

async function handleClick(event) {
  if (state.userMenuOpen && !event.target.closest('.user-menu')) {
    state.userMenuOpen = false;
    document.querySelector('.user-popover')?.classList.add('hidden');
    document.querySelector('[data-action="toggle-user-menu"]')?.setAttribute('aria-expanded', 'false');
  }
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) return navigate(pageButton.dataset.page);
  const authButton = event.target.closest('[data-auth-mode]');
  if (authButton) return renderAuth(authButton.dataset.authMode);
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (['run-analysis', 'latest-analysis', 'summary', 'retry-ai-history', 'retry-ai-analysis', 'retry-ai-summary'].includes(action)) return await handleAIAction(button);
  const mutationActions = new Set([
    'confirm-delete-screenshot',
    'confirm-clear-screenshots',
    'confirm-delete-child',
    'confirm-delete-device',
    'confirm-rotate-secret',
    'mark-alert',
    'mark-all-read',
    'confirm-delete-push-token',
    'confirm-revoke-user-sessions',
    'confirm-delete-user',
    'confirm-delete-blacklist',
  ]);
  const isMutationAction = mutationActions.has(action);
  if (isMutationAction) {
    if (button.dataset.busy === 'true') return;
    button.dataset.busy = 'true';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    if (action === 'close-modal') return closeModal();
    if (action === 'retry-initialize') {
      button.disabled = true;
      button.textContent = 'Đang kết nối…';
      return initialize();
    }
    if (action === 'toggle-sidebar') {
      state.sidebarOpen = !state.sidebarOpen;
      document.querySelector('.sidebar')?.classList.toggle('open', state.sidebarOpen);
      const menuToggle = document.querySelector('.menu-toggle');
      menuToggle?.setAttribute('aria-expanded', String(state.sidebarOpen));
      menuToggle?.setAttribute('aria-label', state.sidebarOpen ? 'Đóng menu' : 'Mở menu');
      const existingOverlay = document.querySelector('.mobile-overlay');
      if (state.sidebarOpen && !existingOverlay) {
        const overlay = document.createElement('button');
        overlay.type = 'button';
        overlay.className = 'mobile-overlay';
        overlay.dataset.action = 'toggle-sidebar';
        overlay.setAttribute('aria-label', 'Đóng menu điều hướng');
        document.querySelector('.app-shell')?.appendChild(overlay);
      } else if (!state.sidebarOpen) {
        existingOverlay?.remove();
      }
      return;
    }
    if (action === 'toggle-user-menu') {
      state.userMenuOpen = !state.userMenuOpen;
      document.querySelector('.user-popover')?.classList.toggle('hidden', !state.userMenuOpen);
      button.setAttribute('aria-expanded', String(state.userMenuOpen));
      return;
    }
    if (action === 'reload-page' || action === 'refresh-overview') return navigate(state.page);
    if (action === 'refresh-users') return renderUsers(document.querySelector('#page-content'));
    if (action === 'clear-alert-filter') {
      state.alertFilter = {};
      return await renderAlerts(document.querySelector('#page-content'), { reset: true });
    }
    if (action === 'retry-alerts') {
      return await renderAlerts(document.querySelector('#page-content'));
    }
    if (action === 'clear-admin-user-filter') {
      state.adminUserFilter = {};
      state.adminUserOffset = 0;
      return renderUsers(document.querySelector('#page-content'));
    }
    if (action === 'clear-blacklist-filter') {
      state.blacklistSearch = '';
      state.blacklistOffset = 0;
      return renderBlacklist(document.querySelector('#page-content'));
    }
    if (action === 'clear-audit-filter') {
      state.auditFilter = {};
      state.auditOffset = 0;
      return renderAudit(document.querySelector('#page-content'));
    }
    if (action === 'server-page') {
      const offset = Math.max(0, Number(button.dataset.offset) || 0);
      if (button.dataset.scope === 'users') {
        state.adminUserOffset = offset;
        return renderUsers(document.querySelector('#page-content'));
      }
      if (button.dataset.scope === 'blacklist') {
        state.blacklistOffset = offset;
        return renderBlacklist(document.querySelector('#page-content'));
      }
      if (button.dataset.scope === 'audit') {
        state.auditOffset = offset;
        return renderAudit(document.querySelector('#page-content'));
      }
      return;
    }
    if (action === 'logout') return logout();
    if (action === 'agent-guide') {
      if (state.page === 'devices') return showModal('Kết nối máy của trẻ', 'Chuẩn bị hồ sơ, đăng ký máy và cài phần mềm theo thứ tự dưới đây.', agentGuide(true));
      return showModal('Cài đặt và kiểm tra Agent', 'Hướng dẫn nhanh cho máy ảo VMware Windows.', agentGuide());
    }
    if (action === 'copy-value') {
      await navigator.clipboard.writeText(button.dataset.value || '');
      return toast('Đã sao chép vào clipboard');
    }
    if (action === 'cancel-face-auth') {
      stopFaceCamera();
      state.faceChallenge = '';
      return renderAuth('login');
    }
    if (action === 'verify-admin-face') {
      button.disabled = true;
      const status = document.querySelector('#face-camera-status');
      status.textContent = 'Đang chụp và xác minh…';
      const frames = await captureAdminFaceFrames();
      const result = await api('/auth/admin-face', {
        method: 'POST',
        body: { challenge: state.faceChallenge, frames },
        noAuth: true,
      });
      if (result.faceLabel !== 'admin') throw new Error('Face verification failed');
      stopFaceCamera();
      state.faceChallenge = '';
      await completeLogin(result);
      return;
    }
    if (action === 'test-push') {
      const result = await api('/notifications/test', { method: 'POST' });
      const delivery = result.delivery || {};
      toast('Đã gửi thông báo thử', `${delivery.sent || 0} thiết bị đã được nhà cung cấp tiếp nhận.`);
      return;
    }
    if (action === 'delete-push-token') return confirmModal('Gỡ thiết bị nhận thông báo?', 'Thiết bị này sẽ không còn nhận cảnh báo SafeNest.', 'confirm-delete-push-token', id);
    if (action === 'confirm-delete-push-token') {
      await api(`/notifications/tokens/${id}`, { method: 'DELETE' });
      closeModal();
      toast('Đã gỡ thiết bị nhận thông báo');
      return renderAccount(document.querySelector('#page-content'));
    }
    if (action === 'add-child') return showModal('Thêm hồ sơ trẻ', 'Thông tin cơ bản để nhóm dữ liệu theo từng trẻ.', childForm());
    if (action === 'edit-child') return showModal('Chỉnh sửa hồ sơ trẻ', 'Cập nhật tên và độ tuổi.', childForm(state.children.find((x) => String(x.child_id) === String(id))));
    if (action === 'delete-child') return confirmModal('Xóa hồ sơ trẻ?', 'Thiết bị và dữ liệu liên quan cũng có thể bị xóa.', 'confirm-delete-child', id);
    if (action === 'confirm-delete-child') {
      await api(`/children/${id}`, { method: 'DELETE' });
      if (String(state.selectedChildId) === String(id)) state.selectedChildId = null;
      state.selectedDeviceId = null;
      closeModal(); toast('Đã xóa hồ sơ'); return navigate('children');
    }
    if (action === 'child-policy') { state.selectedChildId = id; return navigate('policies'); }
    if (action === 'add-device') {
      if (!state.children.length) return toast('Chưa có hồ sơ trẻ', 'Hãy tạo hồ sơ trước khi đăng ký thiết bị.', 'error');
      return showModal('Đăng ký thiết bị', 'Sau khi đăng ký, bạn sẽ nhận mã kết nối (Device Secret) để cấu hình Agent trên máy của trẻ.', deviceForm());
    }
    if (action === 'edit-device') {
      const d = state.devices.find((x) => String(x.device_id) === String(id));
      return showModal('Đổi tên thiết bị', `Mã định danh (Device UID): ${d.device_uid}`, `<form id="edit-device-form" data-id="${id}"><div class="field"><label>Tên thiết bị</label><input class="input" name="device_name" maxlength="100" required value="${escapeHtml(d.device_name)}"></div><div class="form-actions"><button class="btn btn-secondary" type="button" data-action="close-modal">Hủy</button><button class="btn" type="submit">Lưu tên thiết bị</button></div></form>`);
    }
    if (action === 'delete-device' || action === 'rotate-secret') return showDeviceConfirmation(action, id);
    if (action === 'confirm-delete-device' || action === 'confirm-rotate-secret') return await confirmDeviceAction(button);
    if (action === 'copy-secret') return copyDeviceSecret(button);
    if (action === 'select-control-child') {
      if (String(state.selectedChildId) === String(id)) return;
      state.selectedChildId = id;
      return renderDeviceControls(document.querySelector('#page-content'));
    }
    if (action === 'select-policy-child') {
      if (String(state.selectedChildId) === String(id)) return;
      capturePolicyDraft(document.querySelector('#policy-form'));
      state.selectedChildId = id;
      return renderPolicies(document.querySelector('#page-content'), { focusChildId: id });
    }
    if (action === 'refresh-policy-state') {
      if (state.page !== 'policies' || String(state.selectedChildId) !== String(id)
        || !policySaveRequiresRefresh(id)) return;
      capturePolicyDraft(document.querySelector('#policy-form'));
      return renderPolicies(document.querySelector('#page-content'), { focusChildId: id });
    }
    if (action === 'activity-tab') {
      if (!['apps', 'web', 'screenshots'].includes(button.dataset.tab)) return;
      state.activityTab = button.dataset.tab;
      state.activityOffset = 0;
      state.activityFilter = { ...(state.activityFilter || {}), category: '' };
      return await renderActivity(document.querySelector('#page-content'), action);
    }
    if (action === 'activity-page') {
      state.activityOffset = Math.max(0, Number(button.dataset.offset) || 0);
      return await renderActivity(document.querySelector('#page-content'), action);
    }
    if (action === 'refresh-screenshots' || action === 'refresh-app-enforcement') return await renderActivity(document.querySelector('#page-content'), action);
    if (action === 'retry-activity') return await renderActivity(document.querySelector('#page-content'), action);
    if (action === 'delete-screenshot') return confirmScreenshotDelete(id);
    if (action === 'clear-screenshots') return confirmClearScreenshots();
    if (action === 'confirm-delete-screenshot') return await deleteScreenshots(button);
    if (action === 'confirm-clear-screenshots') return await deleteScreenshots(button, true);
    if (action === 'start-screenshot') return startScreenshotCapture(button);
    if (action === 'stop-screenshot') return stopScreenshotCapture(button);
    if (action === 'view-screenshot') return viewScreenshot(id);
    if (action === 'clear-activity-filter') {
      state.activityFilter = {};
      state.activityOffset = 0;
      return await renderActivity(document.querySelector('#page-content'), action);
    }
    if (action === 'export-activity') {
      exportActivityCsv();
      return toast('Đã xuất dữ liệu CSV', `${state.activityViewRows.length} bản ghi đã được đưa vào tệp.`);
    }
    if (action === 'mark-alert') {
      const item = state.alerts.find(item => String(item.alert_id) === String(id) && !item.is_read);
      if (!item) return;
      return await renderAlerts(document.querySelector('#page-content'), { markIds: [item.alert_id], focusTarget: button });
    }
    if (action === 'mark-all-read') {
      const ids = state.alerts.filter(item => !item.is_read).map(item => item.alert_id);
      if (!ids.length) return;
      return await renderAlerts(document.querySelector('#page-content'), { markIds: ids, focusTarget: button });
    }
    if (action === 'view-user') {
      const detail = await api(`/admin/users/${id}`);
      const u = detail.user;
      return showModal('Chi tiết tài khoản', `${u.name} · ${u.email}`, `<div class="user-detail-summary"><div><small>Vai trò</small><strong>${u.role === 'admin' ? 'Quản trị viên' : 'Phụ huynh'}</strong></div><div><small>Trạng thái</small><strong>${u.is_active ? 'Đang hoạt động' : 'Đã khóa'}</strong></div><div><small>Email</small><strong>${u.is_verified ? 'Đã xác minh' : 'Chưa xác minh'}</strong></div></div><h3>Hồ sơ trẻ (${detail.children.length})</h3><div class="list">${detail.children.map((child) => `<div class="list-item"><div class="list-icon">${escapeHtml(initials(child.name))}</div><div class="list-copy"><strong>${escapeHtml(child.name)}</strong><small>${child.age ?? '—'} tuổi · ${child.device_count} thiết bị</small></div></div>`).join('') || '<p class="muted">Chưa có hồ sơ trẻ.</p>'}</div><h3>Thiết bị (${detail.devices.length})</h3><div class="list">${detail.devices.map((device) => `<div class="list-item"><div class="list-icon">PC</div><div class="list-copy"><strong>${escapeHtml(device.device_name)}</strong><small>${escapeHtml(device.device_uid)} · ${device.last_seen_at ? relativeTime(device.last_seen_at) : 'Chưa kết nối'}</small></div></div>`).join('') || '<p class="muted">Chưa có thiết bị.</p>'}</div>`);
    }
    if (action === 'view-audit') {
      const entry = state.adminAuditLogs.find((item) => String(item.audit_id) === String(id));
      if (!entry) throw new Error('Không tìm thấy sự kiện kiểm toán');
      return showModal(
        'Chi tiết sự kiện kiểm toán',
        `${entry.action} · ${formatDate(entry.created_at)}`,
        `<div class="user-detail-summary"><div><small>Người thực hiện</small><strong>#${entry.actor_user_id ?? '—'} · ${escapeHtml(entry.actor_role || '—')}</strong></div><div><small>Đối tượng</small><strong>${escapeHtml(entry.target_type || '—')} #${escapeHtml(entry.target_id || '—')}</strong></div><div><small>Địa chỉ IP</small><strong>${escapeHtml(entry.ip_address || '—')}</strong></div></div><h3>Metadata</h3><pre class="code-box">${escapeHtml(JSON.stringify(entry.metadata || {}, null, 2))}</pre>${entry.user_agent ? `<h3>User agent</h3><p class="muted audit-user-agent">${escapeHtml(entry.user_agent)}</p>` : ''}`
      );
    }
    if (action === 'edit-user') {
      const u = state.adminUsers.find((item) => String(item.user_id) === String(id));
      if (!u) throw new Error('Không tìm thấy tài khoản');
      const isSelf = String(u.user_id) === String(state.userId);
      const roleControl = isSelf
        ? '<input type="hidden" name="role" value="admin"><input class="input" value="Quản trị viên" disabled>'
        : `<select class="select" name="role"><option value="parent" ${u.role === 'parent' ? 'selected' : ''}>Phụ huynh</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Quản trị viên</option></select>`;
      const enrollmentWarning = !isSelf && u.role === 'parent'
        ? `<div class="field full" data-face-enrollment-warning hidden><div class="guide-note" role="note"><strong>Cần đăng ký khuôn mặt trước khi cấp quyền quản trị.</strong><p>Tài khoản admin phải được mô hình nhận diện đúng nhãn “admin”. Nếu chưa enroll khuôn mặt, người dùng này sẽ không thể hoàn tất đăng nhập.</p><label><input type="checkbox" name="confirm_face_enrollment"> Tôi xác nhận đã chuẩn bị quy trình đăng ký khuôn mặt cho tài khoản này.</label></div></div>`
        : '';
      showModal('Chỉnh sửa tài khoản', `${u.name} · ${u.email}`, `<form id="admin-user-form" data-id="${u.user_id}" data-original-role="${u.role}" class="form-grid"><div class="field full"><label>Vai trò</label>${roleControl}</div>${enrollmentWarning}<div class="field full">${switchRow('is_active', 'Tài khoản đang hoạt động', isSelf ? 'Không thể tự khóa tài khoản quản trị.' : 'Tắt để chặn đăng nhập và thu hồi toàn bộ phiên.', u.is_active).replace('name="is_active"', `name="is_active" ${isSelf ? 'disabled' : ''}`)}${switchRow('is_verified', 'Email đã xác minh', 'Cho phép quản trị viên xác nhận email thủ công.', u.is_verified)}</div><div class="form-actions field full"><button class="btn btn-secondary" type="button" data-action="close-modal">Hủy</button><button class="btn" type="submit">Lưu thay đổi</button></div></form>`);
      syncAdminRoleEnrollment(document.querySelector('#admin-user-form'));
      return;
    }
    if (action === 'revoke-user-sessions') return confirmModal('Thu hồi mọi phiên đăng nhập?', 'Tất cả access token và refresh token của tài khoản sẽ mất hiệu lực.', 'confirm-revoke-user-sessions', id);
    if (action === 'confirm-revoke-user-sessions') { await api(`/admin/users/${id}/revoke-sessions`, { method: 'POST' }); closeModal(); toast('Đã thu hồi toàn bộ phiên'); if (String(id) === String(state.userId)) return logout(false); return renderUsers(document.querySelector('#page-content')); }
    if (action === 'delete-user') return confirmModal('Xóa vĩnh viễn tài khoản?', 'Toàn bộ hồ sơ trẻ, thiết bị, nhật ký và dữ liệu liên quan sẽ bị xóa. Không thể hoàn tác.', 'confirm-delete-user', id);
    if (action === 'confirm-delete-user') { await api(`/admin/users/${id}`, { method: 'DELETE' }); closeModal(); toast('Đã xóa tài khoản và dữ liệu liên quan'); return renderUsers(document.querySelector('#page-content')); }
    if (action === 'delete-account') return showModal('Xóa vĩnh viễn tài khoản?', 'Nhập mật khẩu để xác nhận. Thao tác này không thể hoàn tác.', `<form id="delete-account-form"><div class="field"><label>Mật khẩu</label><input class="input" type="password" name="password" required></div><div class="form-actions"><button class="btn btn-secondary" type="button" data-action="close-modal">Hủy</button><button class="btn btn-danger" type="submit">Xóa vĩnh viễn</button></div></form>`);
    if (action === 'add-blacklist') return showModal('Thêm tên miền vào danh sách chặn', 'Backend sẽ chuẩn hóa và kiểm tra tên miền trước khi lưu.', `<form id="blacklist-form" class="form-grid"><div class="field full"><label>Tên miền</label><input class="input" name="domain" required placeholder="example.com"></div><div class="field full"><label>Lý do</label><textarea class="textarea" name="reason" maxlength="500"></textarea></div><div class="form-actions field full"><button class="btn btn-secondary" type="button" data-action="close-modal">Hủy</button><button class="btn" type="submit">Thêm tên miền</button></div></form>`);
    if (action === 'delete-blacklist') return confirmModal(`Xóa ${button.dataset.name}?`, 'Tên miền sẽ không còn được gửi xuống Agent ở lần đồng bộ tiếp theo.', 'confirm-delete-blacklist', id);
    if (action === 'confirm-delete-blacklist') { await api(`/admin/blacklist/${id}`, { method: 'DELETE' }); closeModal(); toast('Đã xóa tên miền'); return navigate('blacklist'); }
    if (action === 'set-agent-secret') return showModal('Nhập khóa bí mật của thiết bị', 'Khóa chỉ được giữ trong bộ nhớ của tab và không được lưu lâu dài.', `<form id="agent-secret-form"><div class="field"><label>X-Device-Secret</label><input class="input" name="secret" required autocomplete="off"></div><div class="form-actions"><button class="btn" type="submit">Sử dụng khóa</button></div></form>`);
    if (action === 'clear-agent-secret') { state.agentSecret = ''; toast('Đã xóa secret khỏi bộ nhớ'); return renderApiLab(document.querySelector('#page-content')); }
    if (action === 'select-agent-endpoint') { state.agentEndpoint = button.dataset.endpoint; return renderApiLab(document.querySelector('#page-content')); }
  } catch (error) {
    if (action === 'verify-admin-face') {
      const status = document.querySelector('#face-camera-status');
      if (status) status.textContent = localizeError(error.message);
    }
    toast('Không thể hoàn tất', localizeError(error.message), 'error');
  } finally {
    if (button && isMutationAction && document.body.contains(button)) {
      button.disabled = false;
      button.dataset.busy = 'false';
      button.removeAttribute('aria-busy');
    }
    if (button && action === 'verify-admin-face' && document.body.contains(button)) button.disabled = false;
  }
}

document.addEventListener('submit', async (event) => {
  if (event.target.id === 'delete-account-form') {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    try {
      await api('/auth/account', { method: 'DELETE', body: data });
      closeModal(); clearSession(); renderAuth('login'); toast('Tài khoản đã được xóa');
    } catch (error) { toast('Không thể xóa tài khoản', localizeError(error.message), 'error'); }
    return;
  }
  if (event.target.id === 'agent-secret-form') {
    event.preventDefault();
    state.agentSecret = new FormData(event.target).get('secret').trim();
    closeModal(); toast('Đã nạp secret tạm thời'); renderApiLab(document.querySelector('#page-content'));
    return;
  }
  await handleSubmit(event);
});
document.addEventListener('click', handleClick);
document.addEventListener('change', (event) => {
  const policyForm = event.target.closest?.('#policy-form');
  if (policyForm && event.target.matches('input, select')) capturePolicyDraft(policyForm);
  if (event.target.id === 'screen-device') {
    updateScreenshotCaptureControls();
  } else if (event.target.id === 'overview-child') {
    state.overviewChildId = event.target.value;
    renderOverview(document.querySelector('#page-content')).catch((error) => toast('Không thể đổi phạm vi thống kê', localizeError(error.message), 'error'));
  } else if (event.target.id === 'ai-device') {
    changeAIDevice(event.target);
  } else if (event.target.matches('.policy-action')) {
    event.target.classList.toggle('allow', event.target.value === 'allow');
    event.target.classList.toggle('block', event.target.value === 'block');
  } else if (['enable_app_classification', 'enable_web_classification'].includes(event.target.name)) {
    const resourceType = event.target.name.startsWith('enable_app') ? 'app' : 'web';
    const group = document.querySelector(`.policy-group[data-resource="${resourceType}"]`);
    if (group) group.classList.toggle('classification-off', !event.target.checked);
  } else if (event.target.name === 'provider' && event.target.closest('#push-token-form')) {
    syncPushPlatforms(event.target.closest('form'));
  } else if (event.target.name === 'role' && event.target.closest('#admin-user-form')) {
    syncAdminRoleEnrollment(event.target.closest('form'));
  }
});
document.addEventListener('keydown', (event) => {
  if (event.target.matches('.tab') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    const tabs = [...event.target.closest('.tabs').querySelectorAll('.tab')];
    const current = tabs.indexOf(event.target);
    const next = event.key === 'Home'
      ? tabs[0]
      : event.key === 'End'
        ? tabs[tabs.length - 1]
        : tabs[(current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    event.preventDefault();
    next.focus();
    next.click();
    return;
  }
  const modal = modalRoot.querySelector('.modal');
  if (!modal) {
    if (event.key === 'Escape' && (state.sidebarOpen || state.userMenuOpen)) {
      state.sidebarOpen = false;
      state.userMenuOpen = false;
      document.querySelector('.sidebar')?.classList.remove('open');
      document.querySelector('.mobile-overlay')?.remove();
      document.querySelector('.user-popover')?.classList.add('hidden');
      document.querySelector('.menu-toggle')?.setAttribute('aria-expanded', 'false');
      document.querySelector('[data-action="toggle-user-menu"]')?.setAttribute('aria-expanded', 'false');
    }
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusable = [...modal.querySelectorAll('a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((element) => !element.closest('[hidden]'));
  if (!focusable.length) {
    event.preventDefault();
    modal.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});
document.addEventListener('input', event => {
  if (event.target.matches('#chat-form [name="message"]')) captureAIChatDraft(event.target);
});

document.addEventListener('visibilitychange', refreshAlertIndicatorInBackground);
window.addEventListener('focus', refreshAlertIndicatorInBackground);
window.addEventListener('online', refreshAlertIndicatorInBackground);
window.addEventListener('beforeunload', protectDeviceModalOnUnload);
document.addEventListener('visibilitychange', () => refreshBreakReminderHistory({ background: true }));
window.addEventListener('online', () => refreshBreakReminderHistory({ background: true }));

window.addEventListener('hashchange', () => {
  const page = location.hash.slice(1);
  if (state.accessToken && page && page !== state.page) navigate(page);
});

const accessibilityObserver = new MutationObserver(() => {
  enhanceFormAccessibility(app);
  enhanceFormAccessibility(modalRoot);
});
accessibilityObserver.observe(app, { childList: true, subtree: true });
accessibilityObserver.observe(modalRoot, { childList: true, subtree: true });

initialize();

document.addEventListener('change', (event) => {
  if (event.target.matches('#device-control-form [name="enable_break_reminders"]')) {
    document.querySelector('#break-reminder-options').disabled = !event.target.checked;
  }
});
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="refresh-break-reminders"]')) refreshBreakReminderHistory();
});
