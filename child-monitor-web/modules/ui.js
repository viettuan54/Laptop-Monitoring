import { deviceModalDismissBlocked } from './devices.js';
import { escapeHtml } from './format.js';
import { currentDateLabel } from './dates.js';
import { state } from './state.js';

const app = document.querySelector('#app');

const modalRoot = document.querySelector('#modal-root');

const toastRoot = document.querySelector('#toast-root');

let modalReturnFocus = null;
let accessibleControlSequence = 0;

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
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  shieldBan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9.5 9.5 5 5"/><path d="m14.5 9.5-5 5"/></svg>',
  audit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',
  menu: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  eye: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  revoke: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
  key: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  server: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
};

const pageTitles = {
  overview: ['Tổng quan gia đình', 'Góc nhìn rõ ràng, không phán xét về thói quen số của con.'],
  children: ['Hồ sơ trẻ', 'Quản lý hồ sơ và liên kết thiết bị theo từng trẻ.'],
  devices: ['Thiết bị', 'Quản lý thiết bị của trẻ, trạng thái kết nối và mã kết nối.'],
  controls: ['Điều khiển thiết bị', 'Giới hạn thời gian, yêu cầu khóa và cài đặt giám sát theo hồ sơ trẻ.'],
  policies: ['Chính sách sử dụng', 'Thiết lập phân loại AI và quyền truy cập nội dung cho từng hồ sơ.'],
  activity: ['Hoạt động số', 'Theo dõi ứng dụng và website theo thiết bị, thời gian.'],
  alerts: ['Cảnh báo', 'Những tín hiệu phụ huynh cần xem xét và phản hồi.'],
  ai: ['Trung tâm AI', 'Xem phân tích theo thiết bị, tạo báo cáo và trò chuyện với trợ lý AI.'],
  account: ['Tài khoản & bảo mật', 'Quản lý phiên đăng nhập và các thao tác bảo mật.'],
  'admin-overview': ['Điều hành hệ thống', 'Sức khỏe, quy mô và hoạt động trên toàn hệ thống.'],
  users: ['Quản lý tài khoản', 'Theo dõi và quản trị tài khoản phụ huynh, quản trị viên.'],
  blacklist: ['Danh sách chặn tên miền', 'Danh sách chặn toàn cục được đồng bộ xuống Agent.'],
  audit: ['Nhật ký kiểm toán', 'Theo dõi các thao tác nhạy cảm trong hệ thống.'],
  'api-lab': ['Phòng thử nghiệm Agent API', 'Môi trường trình diễn các endpoint dành cho Agent.'],
};

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
    <span class="pagination-info">Hiển thị <strong>${start}–${end}</strong> / ${total} · Trang ${page}/${pages}</span>
    <div class="pagination-controls">
      <button class="btn btn-secondary btn-sm pagination-btn" data-action="server-page" data-scope="${scope}" data-offset="${Math.max(0, offset - limit)}" aria-label="Trang trước" ${offset === 0 ? 'disabled' : ''}>${icons.chevronLeft}<span>Trước</span></button>
      <button class="btn btn-secondary btn-sm pagination-btn" data-action="server-page" data-scope="${scope}" data-offset="${offset + limit}" aria-label="Trang sau" ${end >= total ? 'disabled' : ''}><span>Sau</span>${icons.chevronRight}</button>
    </div>
  </nav>`;
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
      table.setAttribute('aria-label', pageTitles[state.page]?.[0] || 'Bảng dữ liệu LaptopChildren');
    }
    table.querySelectorAll('th:not([scope])').forEach((heading) => heading.setAttribute('scope', 'col'));
  });
  root.querySelectorAll('.tabs, .auth-tabs').forEach((tabList) => {
    tabList.setAttribute('role', 'tablist');
    tabList.querySelectorAll('.tab, .auth-tab').forEach((tab) => {
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

function brandMarkup(adminMode = false) {
  if (adminMode) {
    return `<div class="brand admin-brand"><span class="brand-mark">${icons.policy}</span><span class="brand-copy">Laptop Monitor<small>Admin Console</small></span></div>`;
  }
  return `<div class="brand"><span class="brand-mark">${icons.policy}</span><span class="brand-copy">LaptopChildren<small>Laptop Monitor</small></span></div>`;
}

function pageHead(page, actions = '') {
  const [title, subtitle] = pageTitles[page];
  if (state.role === 'admin') {
    return `<header class="page-head admin-page-head"><div class="page-head-copy"><h1>${title}</h1><p>${subtitle}</p></div><div class="head-actions">${actions}</div></header>`;
  }
  const pageClass = page === 'policies' ? ' page-head-policies' : '';
  const context = page === 'policies' ? '' : `<div class="page-context"><p class="eyebrow">Đồng hành cùng gia đình</p><span>${escapeHtml(currentDateLabel())}</span></div>`;
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
    eyebrow: 'Cố vấn LaptopChildren',
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

function confirmModal(title, text, action, id, extra = '') {
  showModal(title, text, `<div class="form-actions"><button class="btn btn-secondary" data-action="close-modal">Hủy</button><button class="btn btn-danger" data-action="${action}" data-id="${id}" ${extra}>Xác nhận</button></div>`);
}

function resetModalFocus() {
  modalReturnFocus = null;
}

export {
  app,
  brandMarkup,
  closeModal,
  confirmModal,
  emptyState,
  enhanceFormAccessibility,
  icons,
  loading,
  modalRoot,
  pageHead,
  pageTitles,
  paginationMarkup,
  resetModalFocus,
  sectionVisual,
  showModal,
  toast,
  toastRoot,
};
