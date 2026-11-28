import { renderAccount } from './account.js';
import { invalidateActivityRender, renderActivity, stopScreenshotPolling } from './activity.js';
import {
  adminLoadingSkeleton,
  renderAdminOverview,
  renderApiLab,
  renderAudit,
  renderBlacklist,
  renderUsers,
} from './admin.js';
import { renderAI } from './ai.js';
import {
  alertCountLabel,
  renderAlerts,
  startAlertPolling,
  updateAlertIndicator,
} from './alerts.js';
import { clearSession, decodeJwt, detectRole, renderAuth } from './auth.js';
import { renderDeviceControls, stopBreakReminderPolling } from './controls.js';
import { renderChildren, renderDevices } from './devices.js';
import { escapeHtml, localizeError } from './format.js';
import { renderOverview } from './overview.js';
import { renderPolicies } from './policy.js';
import { state } from './state.js';
import { app, brandMarkup, emptyState, icons, loading, pageHead, pageTitles } from './ui.js';

function renderStartupError(error) {
  document.title = 'Không thể kết nối — LaptopChildren';
  app.innerHTML = `<main class="startup-error-shell" id="page-content" tabindex="-1"><section class="startup-error-card">${brandMarkup()}<div class="startup-error-icon">!</div><p class="eyebrow">Kết nối tạm thời gián đoạn</p><h1>Chưa thể mở Dashboard</h1><p>LaptopChildren không thể xác định không gian tài khoản lúc này. Quyền của bạn không bị thay đổi; hãy kiểm tra Backend rồi thử lại.</p><div class="startup-error-detail">${escapeHtml(localizeError(error?.message || 'Máy chủ không phản hồi'))}</div><div class="form-actions"><button class="btn btn-secondary" data-action="logout">Đăng xuất</button><button class="btn" data-action="retry-initialize">Thử kết nối lại</button></div></section></main>`;
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

function renderShell() {
  const isAdmin = state.role === 'admin';
  document.body?.classList?.toggle('admin-surface', isAdmin);
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
    ['users', 'Quản lý tài khoản', 'users'],
    ['blacklist', 'Danh sách chặn', 'shieldBan'],
    ['audit', 'Nhật ký kiểm toán', 'audit'],
  ];
  const nav = isAdmin ? adminNav : parentNav;
  const mobileNav = isAdmin
    ? [
        ['admin-overview', 'Tổng quan', 'admin'],
        ['users', 'Tài khoản', 'users'],
        ['blacklist', 'DS chặn', 'shieldBan'],
        ['audit', 'Kiểm toán', 'audit'],
        ['account', 'Cá nhân', 'account'],
      ]
    : ['overview', 'activity', 'alerts', 'controls'].map((page) => {
      const item = parentNav.find(([itemPage]) => itemPage === page);
      return page === 'controls' ? [item[0], 'Điều khiển', item[2]] : item;
    });
  const systemPages = isAdmin ? ['account', 'api-lab'] : ['account'];
  const unreadAlerts = state.unreadAlertCount;
  const connectionLabel = state.connectionStatus === 'online'
    ? 'Backend đã kết nối'
    : state.connectionStatus === 'offline'
      ? 'Mất kết nối Backend'
      : 'Đang kiểm tra';
  if (isAdmin && !adminNav.some(([page]) => page === state.page) && !systemPages.includes(state.page)) state.page = 'admin-overview';
  if (state.role === 'parent' && !parentNav.some(([page]) => page === state.page) && !systemPages.includes(state.page)) state.page = 'overview';

  if (isAdmin) {
    app.innerHTML = `
      <div class="app-shell is-admin">
        <aside class="sidebar ${state.sidebarOpen ? 'open' : ''}" id="sidebar-navigation">
          <div class="sidebar-brand">${brandMarkup(true)}</div>
          <p class="side-section">Điều hành</p>
          <nav aria-label="Điều hướng quản trị"><ul class="nav-list">${adminNav.map((item) => navItem(...item)).join('')}</ul></nav>
          <p class="side-section">Hệ thống & công cụ</p>
          <nav aria-label="Hệ thống và công cụ"><ul class="nav-list">
            ${navItem('account', 'Tài khoản & bảo mật', 'account')}
            ${navItem('api-lab', 'Công cụ Agent API', 'lab')}
          </ul></nav>
          <div class="sidebar-footer">
            <button class="sidebar-profile" data-page="account">
              <span class="sidebar-avatar">AD</span>
              <span><strong>Quản trị viên</strong><small>${escapeHtml(state.userName || 'Chưa cập nhật họ tên')} · Bảo mật</small></span>
              <span class="sidebar-profile-arrow" aria-hidden="true">${icons.chevronRight}</span>
            </button>
          </div>
        </aside>
        ${state.sidebarOpen ? '<button type="button" class="mobile-overlay" data-action="toggle-sidebar" aria-label="Đóng menu điều hướng"></button>' : ''}
        <div class="main-shell">
          <header class="topbar">
            <button class="btn btn-secondary btn-icon menu-toggle" data-action="toggle-sidebar" aria-label="${state.sidebarOpen ? 'Đóng menu' : 'Mở menu'}" aria-controls="sidebar-navigation" aria-expanded="${state.sidebarOpen}">${icons.menu}</button>
            <div class="topbar-context"><p>Quản trị Laptop Monitor</p><strong id="topbar-title">${escapeHtml(pageTitles[state.page]?.[0] || 'Điều hành hệ thống')}</strong></div>
            <div class="topbar-actions">
              <button class="topbar-shortcut" data-page="api-lab" title="Phòng thử nghiệm Agent API">${icons.lab}<span>Agent API</span></button>
              <span id="connection-pill" class="connection-pill ${state.connectionStatus}" title="Trạng thái kết nối API"><i></i><span>${connectionLabel}</span></span>
              <div class="user-menu">
                <button class="avatar" data-action="toggle-user-menu" aria-label="Mở menu tài khoản" aria-controls="user-popover" aria-expanded="${state.userMenuOpen}">AD<i class="avatar-status" aria-hidden="true"></i></button>
                <div class="user-popover ${state.userMenuOpen ? '' : 'hidden'}" id="user-popover">
                  <div class="identity"><strong>Quản trị viên</strong><small>${escapeHtml(state.userName || 'Chưa cập nhật họ tên')}</small></div>
                  <button class="popover-button" data-page="account">Tài khoản & bảo mật</button>
                  <button class="popover-button danger" data-action="logout">Đăng xuất</button>
                </div>
              </div>
            </div>
          </header>
          <main id="page-content" class="content" tabindex="-1"></main>
          <footer class="admin-footer"><span>Laptop Monitor Admin Console</span><span>Phiên quản trị được bảo vệ bằng JWT &amp; Audit Log</span></footer>
          <nav class="mobile-quick-nav is-admin-mobile-nav" aria-label="Điều hướng nhanh">${mobileNav.map((item) => mobileNavItem(...item)).join('')}</nav>
        </div>
      </div>`;
    updateAlertIndicator();
    return;
  }

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar ${state.sidebarOpen ? 'open' : ''}" id="sidebar-navigation">
        <div class="sidebar-brand">${brandMarkup()}</div>
        <div class="workspace-card">
          <span class="workspace-icon">${icons.home}</span>
          <span><small>Không gian hiện tại</small><strong>Gia đình của bạn</strong></span>
        </div>
        <p class="side-section">Gia đình</p>
        <nav aria-label="Điều hướng chính"><ul class="nav-list">${nav.map((item) => navItem(...item, item[0] === 'alerts' ? unreadAlerts : 0)).join('')}</ul></nav>
        <p class="side-section">Công cụ & bảo mật</p>
        <nav aria-label="Công cụ và bảo mật"><ul class="nav-list">
          ${navItem('account', 'Tài khoản', 'account')}
        </ul></nav>
        <div class="sidebar-footer">
          <div class="security-note"><span class="security-note-icon">${icons.policy}</span><span><strong>Kết nối được bảo vệ</strong><small>Phiên đăng nhập và Device Secret chỉ được giữ tạm thời.</small></span></div>
          <button class="sidebar-profile" data-page="account"><span class="sidebar-avatar">PH</span><span><strong>Phụ huynh</strong><small>Tài khoản & bảo mật</small></span><span aria-hidden="true">›</span></button>
        </div>
      </aside>
      ${state.sidebarOpen ? '<button type="button" class="mobile-overlay" data-action="toggle-sidebar" aria-label="Đóng menu điều hướng"></button>' : ''}
      <div class="main-shell">
        <header class="topbar">
          <button class="btn btn-secondary btn-icon menu-toggle" data-action="toggle-sidebar" aria-label="${state.sidebarOpen ? 'Đóng menu' : 'Mở menu'}" aria-controls="sidebar-navigation" aria-expanded="${state.sidebarOpen}">☰</button>
          <div class="topbar-context"><p>Không gian gia đình</p><strong id="topbar-title">${escapeHtml(pageTitles[state.page]?.[0] || 'LaptopChildren')}</strong></div>
          <div class="topbar-actions">
            <button class="topbar-shortcut" data-action="agent-guide">${icons.lab}<span>Cài Agent</span></button>
            <span id="connection-pill" class="connection-pill ${state.connectionStatus}" title="Trạng thái kết nối API"><i></i><span>${connectionLabel}</span></span>
            ${state.role === 'parent' ? `<button class="notification-button" data-page="alerts" aria-label="Mở cảnh báo" title="Cảnh báo chưa đọc">${icons.alert}${unreadAlerts ? `<b>${alertCountLabel(unreadAlerts)}</b>` : ''}</button>` : ''}
            <div class="user-menu">
              <button class="avatar" data-action="toggle-user-menu" aria-label="Mở menu tài khoản" aria-controls="user-popover" aria-expanded="${state.userMenuOpen}">PH</button>
              <div class="user-popover ${state.userMenuOpen ? '' : 'hidden'}" id="user-popover">
                <div class="identity"><strong>Phụ huynh</strong><small>${escapeHtml(state.userName || 'Chưa cập nhật họ tên')}</small></div>
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
  invalidateActivityRender();
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
        : state.role === 'admin'
          ? adminLoadingSkeleton(page)
          : loading();
  content.setAttribute('aria-busy', 'true');
  document.querySelector('#topbar-title').textContent = pageTitles[page]?.[0] || 'LaptopChildren';
  document.title = state.role === 'admin'
    ? `${pageTitles[page]?.[0] || 'Quản trị'} — Laptop Monitor Admin`
    : `${pageTitles[page]?.[0] || 'Dashboard'} — LaptopChildren`;
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
    if (state.role === 'admin' && pageTitles[page]) {
      content.innerHTML = `${pageHead(page)}<section class="card admin-error-card" role="alert">${emptyState('!', 'Không thể tải dữ liệu', localizeError(error.message), '<button class="btn" data-action="reload-page">Thử lại</button>')}</section>`;
    } else {
      content.innerHTML = emptyState('!', 'Không thể tải dữ liệu', localizeError(error.message), '<button class="btn" data-action="reload-page">Thử lại</button>');
    }
  } finally {
    if (document.body.contains(content)) {
      content.removeAttribute('aria-busy');
      window.scrollTo({ top: 0, behavior: 'auto' });
      requestAnimationFrame(() => content.focus({ preventScroll: true }));
    }
  }
}

export { initialize, navigate, renderShell };
