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
let modalReturnFocus = null;
let accessibleControlSequence = 0;
let overviewRenderSequence = 0;

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
  devices: ['Thiết bị', 'Đăng ký laptop, quản lý định danh và secret cài đặt.'],
  controls: ['Điều khiển thiết bị', 'Khóa máy và quản lý các khả năng giám sát của Agent.'],
  policies: ['Chính sách sử dụng', 'Thiết lập thời gian và quyền truy cập nội dung cho từng hồ sơ.'],
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

function accessStatusLabel(value) {
  return accessStatusLabels[String(value || 'open').toLowerCase()] || accessStatusLabels.open;
}

function accessStatusBadge(value) {
  const normalized = String(value || 'open').toLowerCase();
  const tone = normalized === 'blocked' ? 'red' : '';
  return `<span class="badge access-status-badge ${tone}">${escapeHtml(accessStatusLabel(normalized))}</span>`;
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

function updateAlertIndicator() {
  const button = document.querySelector('.notification-button');
  const unread = state.unreadAlertCount;
  if (button) {
    let badge = button.querySelector('b');
    if (!unread) {
      badge?.remove();
    } else {
      if (!badge) {
        badge = document.createElement('b');
        button.appendChild(badge);
      }
      badge.textContent = Math.min(unread, 99);
    }
  }
  document.querySelectorAll('.nav-link[data-page="alerts"], .mobile-nav-link[data-page="alerts"]').forEach((link) => {
    let badge = link.querySelector('b');
    if (!unread) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('b');
      badge.className = link.classList.contains('nav-link') ? 'nav-count' : '';
      link.appendChild(badge);
    }
    badge.textContent = Math.min(unread, 99);
    badge.setAttribute('aria-label', `${unread} mục mới`);
  });
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
    updateConnectionIndicator('online');
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

function clearSession() {
  stopFaceCamera();
  modalRoot.innerHTML = '';
  app.inert = false;
  toastRoot.innerHTML = '';
  modalReturnFocus = null;
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

function showModal(title, subtitle, body) {
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
    const firstControl = modal?.querySelector('[autofocus], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
    (firstControl || modal)?.focus();
  });
}

function closeModal() {
  const returnTarget = modalReturnFocus;
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
      control.setAttribute('aria-describedby', hint.id);
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
  }<span>${label}</span>${count ? `<b class="nav-count" aria-label="${count} mục mới">${Math.min(count, 99)}</b>` : ''}</button></li>`;
}

function mobileNavItem(page, label, icon, count = 0) {
  const active = state.page === page;
  return `<button class="mobile-nav-link ${active ? 'active' : ''}" data-page="${page}" ${active ? 'aria-current="page"' : ''}>${icons[icon]}<span>${label}</span>${count ? `<b>${Math.min(count, 99)}</b>` : ''}</button>`;
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
            ${state.role === 'parent' ? `<button class="notification-button" data-page="alerts" aria-label="Mở cảnh báo" title="Cảnh báo chưa đọc">${icons.alert}${unreadAlerts ? `<b>${Math.min(unreadAlerts, 99)}</b>` : ''}</button>` : ''}
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
}

async function navigate(page) {
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
  content.innerHTML = loading();
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
  return `<header class="page-head"><div class="page-head-copy"><div class="page-context"><p class="eyebrow">${state.role === 'admin' ? 'Điều hành hệ thống' : 'Đồng hành cùng gia đình'}</p><span>${escapeHtml(currentDateLabel())}</span></div><h1>${title}</h1><p>${subtitle}</p></div><div class="head-actions">${actions}</div></header>`;
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
    text: 'Theo dõi trạng thái Agent, lần kết nối gần nhất và thông tin cấp quyền của từng thiết bị.',
  },
  policies: {
    src: '/assets/section-usage-policies.jpg',
    alt: 'Lịch, đồng hồ và thiết bị minh họa thời gian sử dụng cân bằng',
    eyebrow: 'Thói quen lành mạnh',
    title: 'Giới hạn rõ ràng, đồng hành nhẹ nhàng.',
    text: 'Thiết lập thời lượng, khung giờ và quyền truy cập phù hợp với nhịp sinh hoạt của từng trẻ.',
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
  const results = await Promise.allSettled(resources.map((resource) => resource.request));
  state.parentLoadErrors = [];
  results.forEach((result, index) => {
    const resource = resources[index];
    if (result.status === 'fulfilled') {
      if (resource.key === 'usageSummary' && String(state.overviewChildId) !== String(usageChildId)) return;
      state[resource.key] = resource.pick(result.value);
    } else {
      state.parentLoadErrors.push(resource.label);
    }
  });
  if (!state.parentLoadErrors.includes('cảnh báo')) {
    state.unreadAlertCount = state.alerts.filter((item) => !item.is_read).length;
  }
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
  // Danh mục chỉ minh họa phân bổ của các bản ghi gần đây. Metric và hai biểu đồ
  // thời gian bên dưới luôn dùng endpoint aggregate, không phụ thuộc giới hạn log.
  const categories = state.appLogs.reduce((map, item) => {
    const key = item.category || 'unknown';
    map[key] = (map[key] || 0) + (Number(item.duration_seconds) || 0);
    return map;
  }, {});
  const categorySampleSeconds = Object.values(categories).reduce((sum, seconds) => sum + seconds, 0);
  const sortedCategories = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const partialNotice = state.parentLoadErrors.length
    ? `<section class="card card-pad" role="status"><strong>Một phần dữ liệu chưa tải được</strong><p class="muted">Dashboard vẫn hiển thị dữ liệu khả dụng. Hãy thử làm mới: ${escapeHtml(state.parentLoadErrors.join(', '))}.</p></section>`
    : '';
  const usageQualityNotice = usageSummary.ignored_segment_count > 0
    ? `<aside class="usage-quality-note" role="note"><span aria-hidden="true">i</span><div><strong>Đã bỏ qua ${usageSummary.ignored_segment_count} đoạn thời gian bất thường khi tính thống kê</strong><p>Các đoạn có thể phát sinh khi máy khóa hoặc ngủ${usageSummary.max_valid_agent_segment_seconds ? ` và dài hơn ${duration(usageSummary.max_valid_agent_segment_seconds)}` : ''}. Bản ghi gốc vẫn được giữ nguyên để kiểm tra và đối chiếu.</p></div></aside>`
    : '';
  content.innerHTML = `
    ${pageHead('overview', `<label class="overview-scope-control"><span>Thời gian sử dụng của</span><select class="select" id="overview-child"><option value="">Toàn gia đình</option>${state.children.map((child) => `<option value="${child.child_id}" ${String(child.child_id) === String(state.overviewChildId) ? 'selected' : ''}>${escapeHtml(child.name)}</option>`).join('')}</select></label><button class="btn btn-secondary" data-action="refresh-overview">${icons.refresh} Làm mới</button><button class="btn" data-page="ai">✦ Phân tích AI</button>`)}
    <section class="dashboard-hero family-dashboard-hero">
      <div class="dashboard-hero-copy">
        <span class="hero-status"><i></i>${onlineDevices ? `${onlineDevices} thiết bị đang kết nối` : 'Sẵn sàng đồng hành cùng gia đình'}</span>
        <p class="eyebrow">Không gian số lành mạnh</p>
        <h2>Hiểu thói quen hôm nay,<br>cùng con tiến bộ ngày mai.</h2>
        <p>Theo dõi tín hiệu quan trọng, đặt giới hạn phù hợp và bắt đầu những cuộc trò chuyện tích cực từ một nơi duy nhất.</p>
        <div class="hero-actions"><button class="btn" data-page="activity">Xem hoạt động</button><button class="btn btn-secondary" data-page="policies">Điều chỉnh chính sách</button></div>
      </div>
      <figure class="dashboard-hero-media"><img src="/assets/family-digital-wellbeing.jpg" alt="Gia đình cùng xây dựng thói quen sử dụng thiết bị lành mạnh" width="1200" height="800" decoding="async" fetchpriority="high"><figcaption class="hero-media-insight"><span class="hero-insight-icon">${icons.activity}</span><span><small>Thời gian hôm nay</small><strong>${duration(usageSummary.today_seconds)}</strong><em>${onlineDevices} thiết bị đang trực tuyến</em></span></figcaption></figure>
    </section>
    ${partialNotice}
    ${usageQualityNotice}
    <section class="metrics usage-metrics" aria-label="Chỉ số gia đình nổi bật">
      ${metric(`${usageScopeName} hôm nay`, todayUsage.value, todayUsage.unit, 'activity', true)}
      ${metric('Tổng trong tháng', monthUsage.value, monthUsage.unit, 'activity')}
      ${metric('Hồ sơ trẻ', state.children.length, 'đang quản lý', 'child')}
      ${metric('Thiết bị', state.devices.length, `${onlineDevices} đang online`, 'device')}
      ${metric('Cảnh báo chưa đọc', unread, risky ? `${risky} rủi ro cao` : 'cần xem', 'alert')}
    </section>
    ${setupSteps.every((step) => step.done) ? '' : `<section class="setup-progress card"><div><p class="eyebrow">Thiết lập hệ thống</p><h2>Hoàn tất kết nối gia đình</h2><p>Thực hiện lần lượt để Dashboard nhận đầy đủ ứng dụng và website từ Agent.</p></div><div class="setup-steps">${setupSteps.map((step, index) => `<button class="setup-step ${step.done ? 'done' : ''}" data-page="${step.page}"><span>${step.done ? '✓' : index + 1}</span><strong>${step.label}</strong></button>`).join('')}</div></section>`}
    <section class="dashboard-grid">
      <div class="stack">
        <article class="card">
          <div class="card-head"><div><h2>Nhịp sử dụng trong 7 ngày</h2><p>${escapeHtml(usageScopeName)} · Dữ liệu tổng hợp đầy đủ từ Agent, không phụ thuộc số bản ghi đang hiển thị.</p></div><span class="badge">${duration(recentTotalSeconds)}</span></div>
          <div class="card-body"><div class="chart-wrap usage-week-chart" role="img" aria-label="Biểu đồ thời gian sử dụng ứng dụng trong bảy ngày gần nhất">${recentDays
            .map((day) => `<div class="bar-column"><span class="bar-value">${Math.round(day.seconds / 60)}p</span><div class="bar-track" title="${escapeHtml(day.date)}: ${duration(day.seconds)}"><div class="bar-fill ${day.seconds ? '' : 'is-empty'}" style="height:${day.seconds ? Math.max(4, Math.round((day.seconds / recentMaxSeconds) * 100)) : 0}%"></div></div><small>${escapeHtml(day.label)}</small></div>`)
            .join('')}</div></div>
        </article>
        <article class="card usage-month-card">
          <div class="card-head"><div><h2>Từng ngày trong ${escapeHtml(usageMonthLabel(usageSummary.month))}</h2><p>${usageSummary.timezone ? `Múi giờ tổng hợp: ${escapeHtml(usageSummary.timezone)}.` : 'Tổng hợp theo múi giờ của hệ thống.'} Ngày hôm nay được đánh dấu nổi bật.</p></div><span class="badge blue">${duration(usageSummary.month_total_seconds)}</span></div>
          <div class="card-body usage-month-scroll"><div class="usage-month-chart" style="--usage-day-count:${monthDays.length}" role="img" aria-label="Biểu đồ thời gian sử dụng theo từng ngày trong tháng">${monthDays
            .map((day) => `<div class="usage-month-day ${day.isToday ? 'is-today' : ''}"><span>${day.seconds ? `${Math.round(day.seconds / 60)}p` : ''}</span><div class="usage-month-track" title="Ngày ${day.label}: ${duration(day.seconds)}"><div class="usage-month-fill" style="height:${day.seconds ? Math.max(3, Math.round((day.seconds / monthMaxSeconds) * 100)) : 0}%"></div></div><small>${day.label}</small></div>`)
            .join('')}</div></div>
        </article>
        <article class="card">
          <div class="card-head"><div><h2>Hoạt động gần đây</h2><p>Các ứng dụng và website mới nhất.</p></div><button class="link-button" data-page="activity">Xem tất cả</button></div>
          <div class="card-body list">${[...state.appLogs.map((x) => ({ ...x, type: 'app', at: x.start_time, title: x.app_name })), ...state.webLogs.map((x) => ({ ...x, type: 'web', at: x.visit_time, title: websiteActivityTitle(x) }))].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 6).map(activityListItem).join('') || emptyState('↗', 'Chưa có hoạt động', 'Agent sẽ gửi dữ liệu sau khi được cài đặt.')}</div>
        </article>
      </div>
      <aside class="stack">
        <article class="card card-pad">
          <p class="eyebrow">Phân bổ bản ghi gần đây</p>
          <div class="donut-row">
            <div class="donut" role="img" aria-label="Tỷ lệ danh mục ứng dụng được sử dụng nhiều nhất trong các bản ghi gần đây" style="--value:${categorySampleSeconds ? Math.round(((sortedCategories[0]?.[1] || 0) / categorySampleSeconds) * 100) : 0}"><strong>${categorySampleSeconds ? Math.round(((sortedCategories[0]?.[1] || 0) / categorySampleSeconds) * 100) : 0}%</strong></div>
            <div class="legend">${sortedCategories.map(([name, seconds]) => `<div class="legend-row"><i class="legend-dot"></i><span>${escapeHtml(categoryLabel(name))}</span><b>${duration(seconds)}</b></div>`).join('') || '<span class="muted">Chưa đủ dữ liệu</span>'}</div>
          </div>
        </article>
        <article class="card">
          <div class="card-head"><div><h2>Cảnh báo mới</h2><p>Ưu tiên những tín hiệu chưa được đọc.</p></div><span class="badge coral">${unread} mới</span></div>
          <div class="card-body list">${state.alerts.filter((x) => !x.is_read).slice(0, 5).map(alertListItem).join('') || emptyState('✓', 'Mọi thứ ổn', 'Không có cảnh báo mới cần xử lý.')}</div>
        </article>
      </aside>
    </section>`;
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

async function renderDevices(content) {
  const [children, devices] = await Promise.all([api('/children?limit=200'), api('/devices?limit=200')]);
  state.children = children;
  state.devices = devices.data || [];
  const onlineCount = state.devices.filter(isDeviceOnline).length;
  content.innerHTML = `
    ${pageHead('devices', '<button class="btn btn-secondary" data-action="agent-guide">Hướng dẫn cài Agent</button><button class="btn" data-action="add-device">' + icons.plus + ' Đăng ký thiết bị</button>')}
    ${sectionVisual('devices', `<span class="section-visual-stat online"><b>${onlineCount}</b> trực tuyến</span><span class="section-visual-stat"><b>${Math.max(0, state.devices.length - onlineCount)}</b> ngoại tuyến</span>`)}
    <section class="entity-grid">${state.devices.map((device) => {
      const online = isDeviceOnline(device);
      return `<article class="entity-card device-card"><div class="entity-top"><div class="entity-avatar">${icons.device}</div><div class="device-badges"><span class="badge ${online ? '' : 'neutral'}"><i class="status-dot ${online ? 'online' : ''}"></i>${online ? 'Đang online' : 'Ngoại tuyến'}</span><span class="badge blue">ID #${device.device_id}</span></div></div><h3>${escapeHtml(device.device_name)}</h3><p class="entity-subtitle">${escapeHtml(childName(device.child_id))}<span>UID ${escapeHtml(device.device_uid)}</span></p><div class="device-last-seen"><strong>${online ? 'Agent đang kết nối' : device.last_seen_at ? `Lần cuối ${relativeTime(device.last_seen_at)}` : 'Agent chưa kết nối lần nào'}</strong><small>${device.last_seen_at ? formatDate(device.last_seen_at) : 'Cài Agent bằng Device Secret để bắt đầu.'}</small></div><div class="entity-meta"><small>Thêm ngày ${formatDate(device.created_at, false)}</small><div class="entity-actions"><button class="kebab" aria-label="Xoay secret của ${escapeHtml(device.device_name)}" title="Xoay secret" data-action="rotate-secret" data-id="${device.device_id}">↻</button><button class="kebab" aria-label="Đổi tên ${escapeHtml(device.device_name)}" title="Đổi tên" data-action="edit-device" data-id="${device.device_id}">✎</button><button class="kebab danger" aria-label="Xóa ${escapeHtml(device.device_name)}" title="Xóa" data-action="delete-device" data-id="${device.device_id}">×</button></div></div></article>`;
    }).join('') || emptyState('▣', 'Chưa có thiết bị', 'Đăng ký laptop và lưu secret để cài đặt Agent.', '<button class="btn" data-action="add-device">Đăng ký thiết bị</button>')}</section>`;
}

async function renderDeviceControls(content) {
  state.children = await api('/children?limit=200');
  state.selectedChildId = reconcileSelectedId(state.selectedChildId, state.children, 'child_id');
  if (!state.selectedChildId) {
    content.innerHTML = pageHead('controls') + emptyState('⌁', 'Cần có hồ sơ trẻ', 'Hãy tạo hồ sơ trước khi điều khiển các thiết bị liên kết.', '<button class="btn" data-page="children">Đến trang hồ sơ trẻ</button>');
    return;
  }

  const [settings, deviceResult] = await Promise.all([
    api(`/settings/${state.selectedChildId}`),
    api('/devices?limit=200'),
  ]);
  state.devices = deviceResult.data || [];
  const selectedChild = state.children.find((child) => String(child.child_id) === String(state.selectedChildId));
  const linkedDevices = state.devices.filter((device) => String(device.child_id) === String(state.selectedChildId));
  const onlineDevices = linkedDevices.filter(isDeviceOnline).length;
  const enabledControlCount = [
    settings.is_locked,
    settings.enable_webcam_monitoring,
    settings.enable_screenshot_review,
    settings.enable_keylog,
  ].filter(Boolean).length;

  content.innerHTML = `
    ${pageHead('controls', '<button class="btn btn-secondary" data-page="devices">' + icons.device + ' Quản lý thiết bị</button>')}
    <section class="control-command-hero" aria-labelledby="control-command-title">
      <div class="control-command-copy">
        <p class="eyebrow">Trung tâm điều khiển Agent</p>
        <h2 id="control-command-title">Phản hồi nhanh, kiểm soát rõ ràng.</h2>
        <p>Các thay đổi được lưu riêng khỏi chính sách thời gian và nội dung. Agent nhận cấu hình mới tại lần heartbeat tiếp theo.</p>
        <div class="control-command-stats"><span><b>${linkedDevices.length}</b><small>Thiết bị liên kết</small></span><span><b>${onlineDevices}</b><small>Đang trực tuyến</small></span><span><b>${enabledControlCount}</b><small>Điều khiển đang bật</small></span></div>
      </div>
      <div class="control-command-visual" aria-hidden="true"><span class="control-device-orbit">${icons.device}</span><span class="control-shield-orbit">${icons.policy}</span><i class="control-signal signal-one"></i><i class="control-signal signal-two"></i></div>
    </section>
    <section class="policy-summary-banner control-summary-banner"><span class="policy-summary-avatar">${escapeHtml(initials(selectedChild?.name || 'Trẻ'))}</span><div><small>Đang điều khiển thiết bị của</small><strong>${escapeHtml(selectedChild?.name || 'Hồ sơ đã chọn')}</strong><p>${linkedDevices.length ? `${linkedDevices.length} thiết bị đã liên kết · ${onlineDevices} thiết bị đang trực tuyến` : 'Chưa có thiết bị nào liên kết với hồ sơ này.'}</p></div><span class="badge ${settings.is_locked ? 'red' : 'blue'}">${settings.is_locked ? 'Đang khóa thiết bị' : 'Cho phép sử dụng'}</span></section>
    <section class="policy-layout control-layout">
      <aside class="card child-picker" aria-label="Chọn hồ sơ cần điều khiển">${state.children.map((child) => `<button class="child-pick ${String(child.child_id) === String(state.selectedChildId) ? 'active' : ''}" data-action="select-control-child" data-id="${child.child_id}"><span class="mini-avatar">${escapeHtml(initials(child.name))}</span><span><strong>${escapeHtml(child.name)}</strong><small>${child.age ?? '—'} tuổi</small></span></button>`).join('')}</aside>
      <article class="card card-pad control-panel-card">
        <form id="device-control-form" class="form-grid" data-child-id="${settings.child_id}">
          <header class="control-panel-heading field full"><span>${icons.control}</span><div><p class="eyebrow">Cấu hình thiết bị</p><h3>Chọn những khả năng Agent được phép thực hiện</h3><p>Mỗi công tắc được lưu độc lập và không thay đổi giới hạn thời gian hoặc quy tắc truy cập nội dung.</p></div></header>
          <div class="control-switch-grid field full">
            <section class="control-switch-card control-lock-card">${switchRow('is_locked', 'Khóa thiết bị ngay', 'Chặn phiên sử dụng tiếp theo của tất cả thiết bị thuộc hồ sơ.', settings.is_locked)}</section>
            <section class="control-switch-card">${switchRow('enable_webcam_monitoring', 'Giám sát webcam', 'Bật tín hiệu Edge AI về tư thế và khoảng cách nhìn.', settings.enable_webcam_monitoring)}</section>
            <section class="control-switch-card">${switchRow('enable_screenshot_review', 'Xem xét ảnh chụp màn hình', 'Cho phép quy trình đánh giá hình ảnh khi cần thiết.', settings.enable_screenshot_review)}</section>
            <section class="control-switch-card control-sensitive-card">${switchRow('enable_keylog', 'Ghi nhận phím bấm', 'Tính năng nhạy cảm; chỉ bật khi thật sự cần và đã thông báo phù hợp.', settings.enable_keylog)}</section>
          </div>
          <aside class="control-privacy-note field full"><span>${icons.policy}</span><div><strong>Ưu tiên quyền riêng tư</strong><p>Webcam, ảnh chụp màn hình và phím bấm đều mặc định tắt. Hãy chỉ kích hoạt trong phạm vi giám sát phù hợp với gia đình.</p></div></aside>
          <div class="form-actions policy-save-bar field full"><span><strong>Sẵn sàng cập nhật điều khiển</strong><small>Cấu hình sẽ được Agent nhận ở heartbeat tiếp theo.</small></span><button class="btn" type="submit">Lưu điều khiển</button></div>
        </form>
      </article>
    </section>`;
}

async function renderPolicies(content) {
  state.children = await api('/children?limit=200');
  state.selectedChildId = reconcileSelectedId(state.selectedChildId, state.children, 'child_id');
  if (!state.selectedChildId) {
    content.innerHTML = pageHead('policies') + sectionVisual('policies') + emptyState('⚙', 'Cần có hồ sơ trẻ', 'Hãy tạo hồ sơ trước khi cấu hình chính sách.', '<button class="btn" data-page="children">Đến trang hồ sơ trẻ</button>');
    return;
  }
  const [settings, policyResult] = await Promise.all([
    api(`/settings/${state.selectedChildId}`),
    api(`/settings/${state.selectedChildId}/policies`),
  ]);
  state.categoryPolicies = Object.fromEntries(
    (policyResult.policies || []).map((item) => [`${item.resource_type}:${item.category}`, item.action])
  );
  const startTime = String(settings.allowed_start_time).slice(0, 5);
  const endTime = String(settings.allowed_end_time).slice(0, 5);
  const crossesMidnight = startTime > endTime;
  const blockedPolicyCount = Object.values(state.categoryPolicies).filter((action) => action === 'block').length;
  const selectedChild = state.children.find((child) => String(child.child_id) === String(state.selectedChildId));
  content.innerHTML = `
    ${pageHead('policies')}
    ${sectionVisual('policies')}
    <section class="policy-summary-banner"><span class="policy-summary-avatar">${escapeHtml(initials(selectedChild?.name || 'Trẻ'))}</span><div><small>Chính sách đang áp dụng cho</small><strong>${escapeHtml(selectedChild?.name || 'Hồ sơ đã chọn')}</strong><p>${settings.daily_limit_minutes ? `${settings.daily_limit_minutes} phút mỗi ngày` : 'Không giới hạn thời gian'} · ${startTime}–${endTime}${crossesMidnight ? ' (qua ngày hôm sau)' : ''}</p></div><span class="badge blue">${blockedPolicyCount} nhóm đang chặn</span></section>
    <section class="policy-layout">
      <aside class="card child-picker">${state.children.map((child) => `<button class="child-pick ${String(child.child_id) === String(state.selectedChildId) ? 'active' : ''}" data-action="select-policy-child" data-id="${child.child_id}"><span class="mini-avatar">${escapeHtml(initials(child.name))}</span><span><strong>${escapeHtml(child.name)}</strong><small>${child.age ?? '—'} tuổi</small></span></button>`).join('')}</aside>
      <article class="card card-pad">
        <form id="policy-form" class="form-grid" data-child-id="${settings.child_id}">
          <section class="policy-form-section field full"><div class="policy-section-heading"><span>${icons.activity}</span><div><h3>Thời gian sử dụng</h3><p>Giới hạn được tính lại theo từng ngày tại múi giờ Việt Nam.</p></div></div><div class="policy-time-grid"><div class="field"><label>Giới hạn mỗi ngày (phút)</label><input class="input" type="number" name="daily_limit_minutes" min="0" max="1440" value="${settings.daily_limit_minutes}"><small>Nhập 0 nếu không giới hạn tổng thời gian.</small></div><div class="field"><label>Cho phép từ</label><input class="input" type="time" name="allowed_start_time" step="60" value="${startTime}"></div><div class="field"><label>Cho phép đến</label><input class="input" type="time" name="allowed_end_time" step="60" value="${endTime}"><small>Khung giờ qua đêm, ví dụ 20:00–06:00, được hỗ trợ.</small></div></div></section>
          <div class="field full">
            <section class="setting-section"><h3>Phân loại AI & truy cập</h3><p>Chỉ phân loại và áp dụng chính sách Cho phép/Chặn khi công tắc tương ứng được bật. Khi tắt, nội dung đó được truy cập bình thường.</p>
              ${switchRow('enable_app_classification', 'Phân loại ứng dụng', 'Gán một trong 4 nhãn ứng dụng rồi áp dụng chính sách truy cập.', settings.enable_app_classification)}
              ${switchRow('enable_web_classification', 'Phân loại website', 'Gán một trong 5 nhãn website rồi áp dụng chính sách truy cập.', settings.enable_web_classification)}
            </section>
            <section class="setting-section"><h3>Quyền truy cập theo danh mục</h3><p>Chọn Cho phép hoặc Chặn cho từng nhóm. Với website, Agent ghi nhớ tên miền đã được AI phân loại và chặn các lần truy cập tiếp theo khi nhóm tương ứng đang chọn Chặn.</p>
              <div class="policy-groups">
                ${categoryPolicyGroup('app', 'Ứng dụng', settings.enable_app_classification)}
                ${categoryPolicyGroup('web', 'Website', settings.enable_web_classification)}
              </div>
            </section>
          </div>
          <div class="form-actions policy-save-bar field full"><span><strong>Sẵn sàng cập nhật</strong><small>Agent nhận chính sách mới ở heartbeat tiếp theo.</small></span><button class="btn" type="submit">Lưu chính sách</button></div>
        </form>
      </article>
    </section>`;
}

function categoryPolicyGroup(resourceType, title, enabled) {
  return `<article class="policy-group ${enabled ? '' : 'classification-off'}" data-resource="${resourceType}"><div class="policy-group-head"><div><strong>${title}</strong><small>${enabled ? 'Phân loại đang bật' : 'Phân loại đang tắt — bảng sẽ được lưu nhưng chưa áp dụng'}</small></div><span class="badge ${enabled ? '' : 'neutral'}">${enabled ? 'Đang áp dụng' : 'Tạm dừng'}</span></div><div class="policy-rule-list">${policyCategoryGroups[resourceType].map(([category, label, description]) => {
    const key = `${resourceType}:${category}`;
    const action = state.categoryPolicies[key] || 'allow';
    return `<label class="policy-rule"><span><strong>${label}</strong><small>${description}</small></span><select class="select policy-action ${action}" name="policy_${resourceType}_${category}" aria-label="Quyền truy cập ${label}"><option value="allow" ${action === 'allow' ? 'selected' : ''}>Cho phép</option><option value="block" ${action === 'block' ? 'selected' : ''}>Chặn</option></select></label>`;
  }).join('')}</div></article>`;
}

function switchRow(name, label, text, checked) {
  return `<div class="switch-row"><div class="switch-copy"><strong>${label}</strong><small>${text}</small></div><label class="switch"><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}><span></span></label></div>`;
}

function syncAdminRoleEnrollment(form) {
  const notice = form?.querySelector('[data-face-enrollment-warning]');
  const confirmation = form?.elements.confirm_face_enrollment;
  const role = form?.elements.role?.value;
  const promoting = form?.dataset.originalRole === 'parent' && role === 'admin';
  if (notice) notice.hidden = !promoting;
  if (confirmation) confirmation.required = promoting;
}

async function renderActivity(content) {
  if (!state.devices.length) state.devices = (await api('/devices?limit=200')).data || [];
  const filter = state.activityFilter || {};
  const path = state.activityTab === 'apps' ? '/logs/app' : '/logs/web';
  const result = await api(path + queryString({
    device_id: filter.device_id,
    start: filter.start,
    end: filter.end,
    limit: 200,
  }));
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
  content.innerHTML = `
    ${pageHead('activity', `<div class="activity-head-actions"><div class="tabs"><button class="tab ${state.activityTab === 'apps' ? 'active' : ''}" data-action="activity-tab" data-tab="apps">Ứng dụng</button><button class="tab ${state.activityTab === 'web' ? 'active' : ''}" data-action="activity-tab" data-tab="web">Website</button></div><button class="btn btn-secondary" data-action="export-activity" ${filteredRows.length ? '' : 'disabled'}>Xuất CSV</button></div>`)}
    ${sectionVisual('activity')}
    <section class="page-summary-strip" aria-label="Tóm tắt dữ liệu đang hiển thị">
      <div><span class="summary-icon">${icons.activity}</span><span><small>Kết quả phù hợp</small><strong>${filteredRows.length} bản ghi</strong></span></div>
      <div><span class="summary-icon">◷</span><span><small>Tổng thời lượng</small><strong>${duration(filteredDuration)}</strong></span></div>
      <div><span class="summary-icon">${icons.policy}</span><span><small>Hiện đang bị chặn</small><strong>${blockedCount} lượt</strong></span></div>
      <div><span class="summary-icon">${icons.device}</span><span><small>Thiết bị có dữ liệu</small><strong>${activeDeviceCount} thiết bị</strong></span></div>
    </section>
    <form id="activity-filter" class="filters activity-filters">
      <div class="field"><label>Tìm kiếm</label><input class="input" name="search" value="${escapeHtml(filter.search || '')}" placeholder="${state.activityTab === 'apps' ? 'Tên ứng dụng' : 'YouTube, tên miền hoặc URL'}"></div>
      <div class="field"><label>Thiết bị</label><select class="select" name="device_id"><option value="">Tất cả thiết bị</option>${state.devices.map((d) => `<option value="${d.device_id}" ${String(filter.device_id) === String(d.device_id) ? 'selected' : ''}>${escapeHtml(d.device_name)}</option>`).join('')}</select></div>
      <div class="field"><label>Danh mục</label><select class="select" name="category"><option value="">Tất cả danh mục</option>${categories.map(([value, label]) => `<option value="${value}" ${filter.category === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      <div class="field"><label>Trạng thái hiện tại</label><select class="select" name="access_status"><option value="">Tất cả trạng thái</option><option value="blocked" ${filter.access_status === 'blocked' ? 'selected' : ''}>Đã chặn</option><option value="open" ${filter.access_status === 'open' ? 'selected' : ''}>Đang mở</option></select></div>
      <div class="field"><label>Từ thời điểm</label><input class="input" type="datetime-local" name="start" value="${escapeHtml(filter.start || '')}"></div>
      <div class="field"><label>Đến thời điểm</label><input class="input" type="datetime-local" name="end" value="${escapeHtml(filter.end || '')}"></div>
      <div class="filter-actions"><button class="btn btn-ghost" type="button" data-action="clear-activity-filter">Xóa lọc</button><button class="btn" type="submit">Áp dụng</button></div>
    </form>
    <section class="table-card"><div class="table-scroll"><table><thead><tr>${state.activityTab === 'apps' ? '<th>Ứng dụng</th><th>Danh mục</th><th>Trạng thái hiện tại</th><th>Bắt đầu</th><th>Kết thúc</th>' : '<th>Website</th><th>Danh mục</th><th>Trạng thái hiện tại</th><th>Truy cập</th><th>Thiết bị</th>'}<th>Thời lượng</th></tr></thead><tbody>${rows.map((item) => {
      if (state.activityTab === 'apps') {
        return `<tr><td class="cell-title"><strong>${escapeHtml(item.app_name)}</strong><small>${escapeHtml(deviceName(item.device_id))}</small></td><td>${categoryBadge(item.category)}</td><td>${accessStatusBadge(item.access_status)}</td><td>${formatDate(item.start_time)}</td><td>${formatDate(item.end_time)}</td><td>${duration(item.duration_seconds)}</td></tr>`;
      }
      const externalUrl = safeExternalUrl(item.url);
      const subtitle = websiteActivitySubtitle(item);
      return `<tr><td class="cell-title website-cell"><strong>${escapeHtml(websiteActivityTitle(item))}</strong>${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''}${externalUrl ? `<a href="${escapeHtml(externalUrl)}" target="_blank" rel="noopener noreferrer">Mở website ↗</a>` : ''}</td><td>${categoryBadge(item.category)}</td><td>${accessStatusBadge(item.access_status)}</td><td>${formatDate(item.visit_time)}</td><td>${escapeHtml(deviceName(item.device_id))}</td><td>${duration(item.duration_seconds)}</td></tr>`;
    }).join('')}</tbody></table></div>${rows.length ? `<div class="table-footer"><span>Hiển thị ${state.activityOffset + 1}–${state.activityOffset + rows.length} / ${filteredRows.length} bản ghi gần nhất</span><div class="pagination"><button class="btn btn-secondary btn-sm" data-action="activity-page" data-offset="${Math.max(0, state.activityOffset - state.activityLimit)}" ${state.activityOffset === 0 ? 'disabled' : ''}>Trước</button><span>Trang ${pageNumber}/${pageCount}</span><button class="btn btn-secondary btn-sm" data-action="activity-page" data-offset="${state.activityOffset + state.activityLimit}" ${state.activityOffset + state.activityLimit >= filteredRows.length ? 'disabled' : ''}>Sau</button></div><span>Tổng ${duration(filteredDuration)}</span></div>` : emptyState('↗', 'Chưa có dữ liệu', 'Hãy đổi bộ lọc hoặc kiểm tra Agent đang hoạt động.')}</section>`;
}

function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportActivityCsv() {
  const isApps = state.activityTab === 'apps';
  const headers = isApps
    ? ['Ứng dụng', 'Danh mục', 'Trạng thái hiện tại', 'Thiết bị', 'Bắt đầu', 'Kết thúc', 'Thời lượng (giây)']
    : ['Tiêu đề', 'Tên miền', 'URL', 'Danh mục', 'Trạng thái hiện tại', 'Thiết bị', 'Truy cập', 'Thời lượng (giây)'];
  const records = state.activityViewRows.map((item) => isApps
    ? [item.app_name, categoryLabel(item.category), accessStatusLabel(item.access_status), deviceName(item.device_id), item.start_time, item.end_time, item.duration_seconds]
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

async function renderAlerts(content) {
  if (!state.devices.length) state.devices = (await api('/devices?limit=200')).data || [];
  const filter = state.alertFilter || {};
  const [result, unreadResult] = await Promise.all([
    api('/alerts' + queryString({ ...filter, limit: 200 })),
    api('/alerts?is_read=false&limit=200'),
  ]);
  state.alerts = result.data || [];
  state.unreadAlertCount = (unreadResult.data || []).length;
  updateAlertIndicator();
  const unreadCount = state.alerts.filter((item) => !item.is_read).length;
  const postureCount = state.alerts.filter((item) => item.alert_type === 'posture_warning').length;
  const distanceCount = state.alerts.filter((item) => item.alert_type === 'eye_distance_warning').length;
  content.innerHTML = `
    ${pageHead('alerts', `<span class="badge ${unreadCount ? 'coral' : 'neutral'}">${unreadCount} chưa đọc</span><button class="btn btn-secondary" data-action="mark-all-read" ${unreadCount ? '' : 'disabled'}>Đánh dấu mục đang hiển thị</button>`)}
    ${sectionVisual('alerts')}
    <section class="page-summary-strip alert-summary" aria-label="Tóm tắt cảnh báo"><div><span class="summary-icon">${icons.alert}</span><span><small>Tổng cảnh báo</small><strong>${state.alerts.length} tín hiệu</strong></span></div><div><span class="summary-icon">!</span><span><small>Chưa đọc</small><strong>${unreadCount} cảnh báo</strong></span></div><div><span class="summary-icon">↗</span><span><small>Tư thế</small><strong>${postureCount} tín hiệu</strong></span></div><div><span class="summary-icon">◉</span><span><small>Khoảng cách mắt</small><strong>${distanceCount} tín hiệu</strong></span></div></section>
    <form id="alert-filter" class="filters filters-alerts">
      <div class="field"><label>Thiết bị</label><select class="select" name="device_id"><option value="">Tất cả thiết bị</option>${state.devices.map((d) => `<option value="${d.device_id}" ${String(filter.device_id) === String(d.device_id) ? 'selected' : ''}>${escapeHtml(d.device_name)}</option>`).join('')}</select></div>
      <div class="field"><label>Trạng thái</label><select class="select" name="is_read"><option value="">Tất cả</option><option value="false" ${filter.is_read === 'false' ? 'selected' : ''}>Chưa đọc</option><option value="true" ${filter.is_read === 'true' ? 'selected' : ''}>Đã đọc</option></select></div><div class="filter-actions"><button class="btn btn-ghost" type="button" data-action="clear-alert-filter">Đặt lại</button><button class="btn" type="submit">Áp dụng</button></div>
    </form>
    <section class="card alerts-card">${state.alerts.map((item) => {
      const presentation = alertPresentation(item.alert_type);
      return `<article class="alert-row ${item.is_read ? '' : 'unread'}"><div class="alert-symbol ${presentation.tone}">${presentation.symbol}</div><div class="alert-copy"><strong>${escapeHtml(presentation.label)}</strong><p>${escapeHtml(item.message)}</p><small>${escapeHtml(deviceName(item.device_id))} · ${formatDate(item.created_at)}</small></div>${item.is_read ? '<span class="badge neutral">Đã đọc</span>' : `<button class="btn btn-secondary btn-sm" data-action="mark-alert" data-id="${item.alert_id}">Đánh dấu đã đọc</button>`}</article>`;
    }).join('') || emptyState('✓', 'Không có cảnh báo', 'Không có cảnh báo phù hợp với bộ lọc hiện tại.')}</section>`;
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

async function renderAI(content) {
  state.devices = (await api('/devices?limit=200')).data || [];
  state.selectedDeviceId = reconcileSelectedId(state.selectedDeviceId, state.devices, 'device_id');
  state.analyses = state.selectedDeviceId
    ? (await api(`/ai-analysis${queryString({ device_id: state.selectedDeviceId, limit: 50 })}`)).data || []
    : [];
  content.innerHTML = `
    ${pageHead('ai', `<select class="select ai-device-select" id="ai-device"><option value="">Chọn thiết bị</option>${state.devices.map((d) => `<option value="${d.device_id}" ${String(d.device_id) === String(state.selectedDeviceId) ? 'selected' : ''}>${escapeHtml(d.device_name)}</option>`).join('')}</select>`)}
    <section class="ai-layout">
      ${sectionVisual('ai', `<button class="btn" data-action="run-analysis" ${state.selectedDeviceId ? '' : 'disabled'}>✦ Chạy phân tích mới</button>`)}
      <div class="stack">
        <article class="card"><div class="card-head"><div><h2>Phân tích gần đây</h2><p>Kết quả của riêng thiết bị đang chọn.</p></div><div><button class="btn btn-secondary btn-sm" data-action="latest-analysis" ${state.selectedDeviceId ? '' : 'disabled'}>Kết quả mới nhất</button></div></div><div>${state.analyses.map((item) => `<article class="analysis-card"><span class="badge ${escapeHtml(String(item.risk_level).toLowerCase())}">${escapeHtml(riskLevelLabel(item.risk_level))}</span><h4>${escapeHtml(item.behavior_type)}</h4><p>${escapeHtml(item.suggestion)}</p><time>${escapeHtml(deviceName(item.device_id))} · ${formatDate(item.analyzed_at)}</time></article>`).join('') || emptyState('✦', 'Chưa có phân tích', 'Chọn thiết bị và chạy phân tích AI đầu tiên.')}</div></article>
        <article class="card card-pad"><div class="card-head card-head-flush"><div><h2>Báo cáo tóm tắt</h2><p>Tạo báo cáo ngày hoặc tuần bằng Gemini.</p></div></div><div class="form-actions form-actions-start"><button class="btn btn-secondary" data-action="summary" data-period="daily" ${state.selectedDeviceId ? '' : 'disabled'}>Báo cáo ngày</button><button class="btn btn-secondary" data-action="summary" data-period="weekly" ${state.selectedDeviceId ? '' : 'disabled'}>Báo cáo tuần</button></div><div id="summary-result"></div></article>
      </div>
      <aside class="card chat-card"><div class="chat-header"><strong>Cố vấn AI SafeNest</strong><small>Không thay thế tư vấn y khoa hoặc tâm lý.</small></div><div class="chat-messages" id="chat-messages">${state.chat.map((msg) => `<div class="chat-bubble ${msg.role === 'user' ? 'user' : ''}">${escapeHtml(msg.content)}</div>`).join('')}</div><form id="chat-form" class="chat-form"><input class="input" name="message" maxlength="2000" required placeholder="Hỏi về thói quen số..."><button class="btn btn-icon" type="submit" aria-label="Gửi câu hỏi">↑</button></form></aside>
    </section>`;
  setTimeout(() => {
    const messages = document.querySelector('#chat-messages');
    if (messages) messages.scrollTop = messages.scrollHeight;
  });
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
  return `<form id="device-form" class="form-grid"><div class="field full"><label>Hồ sơ trẻ</label><select class="select" name="child_id" required><option value="">Chọn hồ sơ</option>${state.children.map((c) => `<option value="${c.child_id}">${escapeHtml(c.name)}</option>`).join('')}</select></div><div class="field full"><label>Tên thiết bị</label><input class="input" name="device_name" maxlength="100" required placeholder="Laptop học tập"></div><div class="field full"><label>Device UID</label><input class="input" name="device_uid" maxlength="150" pattern="[A-Za-z0-9_:\\-]+" required placeholder="DESKTOP-ABC123"><small>Chỉ dùng chữ, số, dấu gạch ngang, gạch dưới và dấu hai chấm.</small></div><div class="form-actions field full"><button class="btn btn-secondary" type="button" data-action="close-modal">Hủy</button><button class="btn" type="submit">Đăng ký</button></div></form>`;
}

function agentGuide() {
  const serviceCommand = 'Get-Service ChildMonitorService';
  const companionCommand = "Get-CimInstance Win32_Process -Filter \"Name='ChildMonitorCompanion.exe'\"";
  return `<div class="agent-guide"><ol><li><strong>Đăng ký thiết bị</strong><p>Tạo thiết bị trên Dashboard và lưu Device Secret được hiển thị một lần.</p></li><li><strong>Cài Agent 1.0.14 trên VMware</strong><p>Chạy file cài đặt bằng quyền Administrator. Backend URL dùng địa chỉ cố định bên dưới.</p><div class="copy-row"><code>${DEFAULT_BACKEND_URL}</code><button class="btn btn-secondary btn-sm" data-action="copy-value" data-value="${DEFAULT_BACKEND_URL}">Sao chép</button></div></li><li><strong>Kiểm tra sau cài đặt</strong><p>Mở PowerShell Administrator và chạy hai lệnh:</p><div class="copy-row"><code>${escapeHtml(serviceCommand)}</code><button class="btn btn-secondary btn-sm" data-action="copy-value" data-value="${escapeHtml(serviceCommand)}">Sao chép</button></div><div class="copy-row"><code>${escapeHtml(companionCommand)}</code><button class="btn btn-secondary btn-sm" data-action="copy-value" data-value="${escapeHtml(companionCommand)}">Sao chép</button></div></li><li><strong>Xác nhận dữ liệu</strong><p>Mở một ứng dụng và một trang web mới trong Edge, Chrome hoặc Cốc Cốc, chờ 1–2 phút rồi xem trang Hoạt động.</p></li></ol><div class="guide-note">Cloudflare Named Tunnel và Backend vẫn phải đang chạy để Agent kết nối được tới ${DEFAULT_BACKEND_URL}.</div></div>`;
}

function confirmModal(title, text, action, id, extra = '') {
  showModal(title, text, `<div class="form-actions"><button class="btn btn-secondary" data-action="close-modal">Hủy</button><button class="btn btn-danger" data-action="${action}" data-id="${id}" ${extra}>Xác nhận</button></div>`);
}

async function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type="submit"]');
  if (submit) submit.disabled = true;
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
      const result = await api('/devices', { method: 'POST', body: { child_id: Number(data.child_id), device_name: data.device_name, device_uid: data.device_uid } });
      closeModal(); showSecret(result); await renderDevices(document.querySelector('#page-content'));
    } else if (form.id === 'edit-device-form') {
      await api(`/devices/${form.dataset.id}`, { method: 'PUT', body: { device_name: data.device_name } });
      closeModal(); toast('Đã đổi tên thiết bị'); await navigate('devices');
    } else if (form.id === 'device-control-form') {
      const controlFields = [
        'is_locked',
        'enable_webcam_monitoring',
        'enable_screenshot_review',
        'enable_keylog',
      ];
      controlFields.forEach((name) => { data[name] = form.elements[name].checked; });
      await api(`/settings/${form.dataset.childId}`, { method: 'PUT', body: data });
      toast('Đã lưu điều khiển thiết bị', 'Agent sẽ nhận cấu hình mới ở heartbeat tiếp theo.');
      await renderDeviceControls(document.querySelector('#page-content'));
    } else if (form.id === 'policy-form') {
      const bools = [
        'enable_app_classification',
        'enable_web_classification',
      ];
      bools.forEach((name) => { data[name] = form.elements[name].checked; });
      data.daily_limit_minutes = Number(data.daily_limit_minutes);
      const settingsBody = Object.fromEntries(
        Object.entries(data).filter(([name]) => !name.startsWith('policy_'))
      );
      const policyUpdates = [];
      Object.entries(policyCategoryGroups).forEach(([resourceType, categories]) => {
        categories.forEach(([category]) => {
          const action = form.elements[`policy_${resourceType}_${category}`].value;
          const key = `${resourceType}:${category}`;
          if (action !== (state.categoryPolicies[key] || 'allow')) {
            policyUpdates.push(api(`/settings/${form.dataset.childId}/policies/${resourceType}/${category}`, {
              method: 'PUT',
              body: { action },
            }));
          }
        });
      });
      await Promise.all([
        api(`/settings/${form.dataset.childId}`, { method: 'PUT', body: settingsBody }),
        ...policyUpdates,
      ]);
      toast('Đã lưu chính sách', `${policyUpdates.length} quy tắc phân loại đã được cập nhật.`);
      await renderPolicies(document.querySelector('#page-content'));
    } else if (form.id === 'activity-filter') {
      state.activityFilter = data;
      state.activityOffset = 0;
      await renderActivity(document.querySelector('#page-content'));
    } else if (form.id === 'alert-filter') {
      state.alertFilter = data; await renderAlerts(document.querySelector('#page-content'));
    } else if (form.id === 'chat-form') {
      state.chat.push({ role: 'user', content: data.message });
      form.reset();
      const reply = await api('/ai-analysis/chat', { method: 'POST', body: { messages: state.chat.slice(-20) } });
      state.chat.push({ role: 'model', content: reply.reply });
      await renderAI(document.querySelector('#page-content'));
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
    if (submit) submit.disabled = false;
  }
}

function showSecret(result) {
  state.agentSecret = result.device_secret;
  showModal('Hãy lưu Device Secret ngay', 'Secret này chỉ được hiển thị một lần.', `<div class="secret-box"><strong>${escapeHtml(result.device_name)}</strong><code id="secret-value">${escapeHtml(result.device_secret)}</code><button class="btn btn-secondary btn-sm" data-action="copy-secret">Sao chép secret</button></div><div class="form-actions"><button class="btn" data-action="close-modal">Tôi đã lưu an toàn</button></div>`);
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
  const mutationActions = new Set([
    'confirm-delete-child',
    'confirm-delete-device',
    'confirm-rotate-secret',
    'mark-alert',
    'mark-all-read',
    'run-analysis',
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
      return renderAlerts(document.querySelector('#page-content'));
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
    if (action === 'agent-guide') return showModal('Cài đặt và kiểm tra Agent', 'Hướng dẫn nhanh cho máy ảo VMware Windows.', agentGuide());
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
      return showModal('Đăng ký thiết bị', 'Secret cài đặt sẽ chỉ được hiển thị một lần.', deviceForm());
    }
    if (action === 'edit-device') {
      const d = state.devices.find((x) => String(x.device_id) === String(id));
      return showModal('Đổi tên thiết bị', d.device_uid, `<form id="edit-device-form" data-id="${id}"><div class="field"><label>Tên thiết bị</label><input class="input" name="device_name" maxlength="100" required value="${escapeHtml(d.device_name)}"></div><div class="form-actions"><button class="btn btn-secondary" type="button" data-action="close-modal">Hủy</button><button class="btn" type="submit">Lưu</button></div></form>`);
    }
    if (action === 'delete-device') return confirmModal('Xóa thiết bị?', 'Agent đang dùng secret hiện tại sẽ mất quyền truy cập.', 'confirm-delete-device', id);
    if (action === 'confirm-delete-device') {
      await api(`/devices/${id}`, { method: 'DELETE' });
      if (String(state.selectedDeviceId) === String(id)) state.selectedDeviceId = null;
      closeModal(); toast('Đã xóa thiết bị'); return navigate('devices');
    }
    if (action === 'rotate-secret') return confirmModal('Xoay Device Secret?', 'Secret cũ bị vô hiệu ngay lập tức. Bạn phải cập nhật lại Agent.', 'confirm-rotate-secret', id);
    if (action === 'confirm-rotate-secret') { const result = await api(`/devices/${id}/rotate-secret`, { method: 'POST' }); closeModal(); return showSecret(result); }
    if (action === 'copy-secret') { await navigator.clipboard.writeText(document.querySelector('#secret-value').textContent); return toast('Đã sao chép secret'); }
    if (action === 'select-control-child') { state.selectedChildId = id; return renderDeviceControls(document.querySelector('#page-content')); }
    if (action === 'select-policy-child') { state.selectedChildId = id; return renderPolicies(document.querySelector('#page-content')); }
    if (action === 'activity-tab') {
      state.activityTab = button.dataset.tab;
      state.activityOffset = 0;
      state.activityFilter = { ...(state.activityFilter || {}), category: '' };
      return renderActivity(document.querySelector('#page-content'));
    }
    if (action === 'activity-page') {
      state.activityOffset = Math.max(0, Number(button.dataset.offset) || 0);
      return renderActivity(document.querySelector('#page-content'));
    }
    if (action === 'clear-activity-filter') {
      state.activityFilter = {};
      state.activityOffset = 0;
      return renderActivity(document.querySelector('#page-content'));
    }
    if (action === 'export-activity') {
      exportActivityCsv();
      return toast('Đã xuất dữ liệu CSV', `${state.activityViewRows.length} bản ghi đã được đưa vào tệp.`);
    }
    if (action === 'mark-alert') { await api(`/alerts/${id}/read`, { method: 'PUT' }); toast('Đã đánh dấu cảnh báo là đã đọc'); return renderAlerts(document.querySelector('#page-content')); }
    if (action === 'mark-all-read') {
      const unread = state.alerts.filter((x) => !x.is_read);
      await Promise.all(unread.map((x) => api(`/alerts/${x.alert_id}/read`, { method: 'PUT' })));
      toast('Đã cập nhật cảnh báo đang hiển thị', `${unread.length} cảnh báo đã được đánh dấu đã đọc.`);
      return renderAlerts(document.querySelector('#page-content'));
    }
    if (action === 'run-analysis') {
      if (!state.selectedDeviceId) throw new Error('Hãy chọn thiết bị trước');
      button.disabled = true; button.textContent = 'Đang phân tích…';
      await api(`/ai-analysis/analyze/${state.selectedDeviceId}`, { method: 'POST' });
      toast('Phân tích hoàn tất'); return renderAI(document.querySelector('#page-content'));
    }
    if (action === 'latest-analysis') {
      if (!state.selectedDeviceId) throw new Error('Hãy chọn thiết bị trước');
      const result = await api(`/ai-analysis/latest/${state.selectedDeviceId}`);
      showModal('Phân tích mới nhất', `${deviceName(result.device_id)} · ${formatDate(result.analyzed_at)}`, `<span class="badge ${escapeHtml(String(result.risk_level).toLowerCase())}">${escapeHtml(riskLevelLabel(result.risk_level))}</span><h3>${escapeHtml(result.behavior_type)}</h3><p class="muted analysis-suggestion">${escapeHtml(result.suggestion)}</p>`);
      return;
    }
    if (action === 'summary') {
      if (!state.selectedDeviceId) throw new Error('Hãy chọn thiết bị trước');
      const target = document.querySelector('#summary-result'); target.innerHTML = loading();
      const result = await api(`/ai-analysis/summary/${state.selectedDeviceId}?period=${button.dataset.period}`);
      target.innerHTML = `<div class="summary-box">${escapeHtml(result.summary)}</div>`;
      return;
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
    if (button && action === 'run-analysis' && document.body.contains(button)) button.innerHTML = '✦ Chạy phân tích mới';
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
  if (event.target.id === 'overview-child') {
    state.overviewChildId = event.target.value;
    renderOverview(document.querySelector('#page-content')).catch((error) => toast('Không thể đổi phạm vi thống kê', localizeError(error.message), 'error'));
  } else if (event.target.id === 'ai-device') {
    state.selectedDeviceId = event.target.value;
    renderAI(document.querySelector('#page-content')).catch((error) => toast('Không thể tải Trung tâm AI', localizeError(error.message), 'error'));
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
