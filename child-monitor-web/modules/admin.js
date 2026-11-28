import { api } from './api.js';
import { formatDate } from './dates.js';
import { escapeHtml, initials, queryString } from './format.js';
import { state } from './state.js';
import { emptyState, icons, pageHead, paginationMarkup } from './ui.js';

function adminLoadingSkeleton(page) {
  if (page === 'admin-overview') {
    return `<div class="admin-skeleton" role="status" aria-label="Đang tải tổng quan hệ thống">
      <div class="admin-skeleton-head"><div class="skeleton-line w-lg"></div><div class="skeleton-line w-sm"></div></div>
      <div class="admin-overview-grid">
        <div class="skeleton-card h-md"></div>
        <div class="skeleton-card h-md"></div>
      </div>
      <div class="skeleton-card h-lg"></div>
    </div>`;
  }
  return `<div class="admin-skeleton" role="status" aria-label="Đang tải dữ liệu quản trị">
    <div class="admin-skeleton-head"><div class="skeleton-line w-lg"></div><div class="skeleton-line w-sm"></div></div>
    <div class="skeleton-bar"></div>
    <div class="skeleton-card h-lg"></div>
  </div>`;
}

function auditActionTone(action = '') {
  if (action.includes('delete') || action.includes('revoke')) return 'danger';
  if (action.includes('update') || action.includes('rotate') || action.includes('reset')) return 'warn';
  return 'info';
}

function adminStatsStrip(items) {
  return `<section class="admin-stats-strip" aria-label="Tóm tắt số liệu">${items.map((item) => `<div class="admin-stat-chip"><small>${escapeHtml(item.label)}</small><strong>${escapeHtml(item.value)}</strong>${item.note ? `<span>${escapeHtml(item.note)}</span>` : ''}</div>`).join('')}</section>`;
}

async function renderAdminOverview(content) {
  const [statsRes, auditRes] = await Promise.allSettled([
    api('/admin/stats'),
    api('/admin/audit-logs?limit=5'),
  ]);
  if (statsRes.status !== 'fulfilled') throw statsRes.reason;
  state.adminStats = statsRes.value;
  const s = state.adminStats;
  const recentAudits = auditRes.status === 'fulfilled' ? (auditRes.value.data || []) : [];
  state.adminAuditLogs = recentAudits;
  const onlinePercent = s.total_devices ? Math.round((s.devices_online / s.total_devices) * 100) : 0;
  const offlineDevices = Math.max(0, s.total_devices - s.devices_online);
  const summaryTotalUsers = Math.max(s.total_users || 0, 1);
  const summaryTotalDevices = Math.max(s.total_devices || 0, 1);
  const childrenRatio = Math.min(100, Math.round(((s.total_children || 0) / summaryTotalUsers) * 50));
  const alertBar = Math.min(100, Math.round(((s.alerts_today || 0) / summaryTotalDevices) * 25));
  const blacklistBar = Math.min(100, Math.max(s.blacklist_count ? 24 : 0, Math.min(100, (s.blacklist_count || 0) * 4)));
  content.innerHTML = `
    ${pageHead('admin-overview', '<button class="btn btn-secondary btn-sm" data-action="reload-page">' + icons.refresh + ' Làm mới</button><button class="btn btn-sm" data-page="users">' + icons.users + ' Tài khoản</button>')}
    <section class="admin-overview-grid">
      <article class="card admin-card admin-health-card">
        <div class="admin-card-head">
          <div>
            <h2>Sức khỏe thiết bị</h2>
            <p class="muted">Thiết bị có heartbeat trong 5 phút gần nhất được tính là trực tuyến.</p>
          </div>
          <span class="badge ${onlinePercent >= 50 || s.total_devices === 0 ? 'blue' : 'warn'}">${onlinePercent}% trực tuyến</span>
        </div>
        <div class="admin-health-body">
          <div class="donut" role="img" aria-label="${onlinePercent}% thiết bị đang trực tuyến" style="--value:${onlinePercent}"><strong>${onlinePercent}%</strong></div>
          <div class="legend admin-health-legend">
            <div class="legend-row"><i class="legend-dot online"></i><span>Trực tuyến</span><b>${s.devices_online}</b></div>
            <div class="legend-row"><i class="legend-dot offline"></i><span>Ngoại tuyến</span><b>${offlineDevices}</b></div>
            <div class="legend-row"><i class="legend-dot total"></i><span>Tổng thiết bị</span><b>${s.total_devices}</b></div>
          </div>
        </div>
        <div class="admin-runtime-strip">
          <div class="runtime-item"><span>${icons.server} Backend API</span><strong class="${state.connectionStatus === 'online' ? 'ok' : 'warn'}">${state.connectionStatus === 'online' ? 'Ổn định' : 'Kiểm tra kết nối'}</strong></div>
          <div class="runtime-item"><span>${icons.policy} Cơ chế bảo vệ</span><strong class="ok">JWT, Face 1:1 &amp; RLS</strong></div>
          <div class="runtime-item"><span>${icons.audit} Nhật ký kiểm toán</span><strong class="${auditRes.status === 'fulfilled' ? 'ok' : 'warn'}">${auditRes.status === 'fulfilled' ? 'Đang hoạt động' : 'Không tải được'}</strong></div>
        </div>
      </article>
      <article class="card admin-card admin-summary-card">
        <div class="admin-card-head">
          <div>
            <h2>Chỉ số hệ thống</h2>
            <p class="muted">Tổng hợp quy mô tài khoản, trẻ em và lớp bảo vệ.</p>
          </div>
          <button class="btn btn-ghost btn-sm" data-page="blacklist">Danh sách chặn →</button>
        </div>
        <div class="admin-summary-grid">
          <button class="summary-tile" type="button" data-page="users">
            <div class="summary-tile-top"><span class="summary-icon indigo">${icons.users}</span><span class="summary-label">Người dùng</span></div>
            <strong class="summary-value">${s.total_users}</strong>
            <div class="summary-bar"><span style="width:100%"></span></div>
            <small>Tài khoản đã đăng ký</small>
          </button>
          <button class="summary-tile" type="button" data-page="users">
            <div class="summary-tile-top"><span class="summary-icon blue">${icons.child}</span><span class="summary-label">Hồ sơ trẻ em</span></div>
            <strong class="summary-value">${s.total_children}</strong>
            <div class="summary-bar"><span style="width:${childrenRatio}%"></span></div>
            <small>Hồ sơ đang giám sát</small>
          </button>
          <div class="summary-tile">
            <div class="summary-tile-top"><span class="summary-icon ${s.alerts_today > 0 ? 'amber' : 'slate'}">${icons.alert}</span><span class="summary-label">Cảnh báo hôm nay</span></div>
            <strong class="summary-value">${s.alerts_today}</strong>
            <div class="summary-bar warn"><span style="width:${alertBar}%"></span></div>
            <small>Tín hiệu từ thiết bị</small>
          </div>
          <button class="summary-tile" type="button" data-page="blacklist">
            <div class="summary-tile-top"><span class="summary-icon emerald">${icons.shieldBan}</span><span class="summary-label">Danh sách chặn</span></div>
            <strong class="summary-value">${s.blacklist_count}</strong>
            <div class="summary-bar emerald"><span style="width:${blacklistBar}%"></span></div>
            <small>Tên miền toàn cục →</small>
          </button>
        </div>
      </article>
    </section>
    <section class="table-card admin-table-card admin-recent-audit-card">
      <div class="admin-table-head">
        <div>
          <h2>Nhật ký kiểm toán gần đây</h2>
          <p class="muted">5 thao tác quản trị hoặc bảo mật gần nhất được ghi nhận.</p>
        </div>
        <button class="btn btn-secondary btn-sm" data-page="audit">Xem tất cả →</button>
      </div>
      ${recentAudits.length ? `<div class="table-scroll"><table><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>Thao tác</th></tr></thead><tbody>${recentAudits.map((item) => `<tr>
        <td>${formatDate(item.created_at)}</td>
        <td><div class="admin-actor-cell"><span>#${item.actor_user_id ?? '—'}</span><span class="badge neutral">${escapeHtml(item.actor_role || '—')}</span></div></td>
        <td><span class="audit-action-badge ${auditActionTone(item.action)}">${escapeHtml(item.action)}</span></td>
        <td>${escapeHtml(item.target_type || '—')} <strong>#${escapeHtml(item.target_id || '—')}</strong></td>
        <td><button class="btn btn-secondary btn-sm" data-action="view-audit" data-id="${item.audit_id}">${icons.eye} Chi tiết</button></td>
      </tr>`).join('')}</tbody></table></div>` : `<div class="admin-inline-empty">${auditRes.status === 'fulfilled' ? 'Chưa ghi nhận thao tác quản trị nhạy cảm nào.' : 'Không thể tải danh sách nhật ký gần đây.'}</div>`}
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
  const totalUsers = Number(result.total) || 0;
  const activeOnPage = state.adminUsers.filter((user) => user.is_active).length;
  const adminsOnPage = state.adminUsers.filter((user) => user.role === 'admin').length;
  content.innerHTML = `
    ${pageHead('users', '<button class="btn btn-secondary btn-sm" data-action="refresh-users">' + icons.refresh + ' Làm mới</button><button class="btn btn-sm" data-action="add-admin-user">' + icons.plus + ' Thêm tài khoản</button>')}
    ${adminStatsStrip([
      { label: 'Tổng tài khoản', value: totalUsers },
      { label: 'Đang hiển thị', value: state.adminUsers.length, note: 'trang hiện tại' },
      { label: 'Đang hoạt động', value: activeOnPage, note: 'trang hiện tại' },
      { label: 'Quản trị viên', value: adminsOnPage, note: 'trang hiện tại' },
    ])}
    <form id="admin-user-filter" class="filters filters-users admin-filter-bar">
      <div class="field"><label>Tìm kiếm</label><input class="input" name="search" value="${escapeHtml(filter.search || '')}" placeholder="Tên hoặc email"></div>
      <div class="field"><label>Vai trò</label><select class="select" name="role"><option value="">Tất cả vai trò</option><option value="parent" ${filter.role === 'parent' ? 'selected' : ''}>Phụ huynh</option><option value="admin" ${filter.role === 'admin' ? 'selected' : ''}>Quản trị viên</option></select></div>
      <div class="field"><label>Trạng thái</label><select class="select" name="status"><option value="">Tất cả trạng thái</option><option value="active" ${filter.status === 'active' ? 'selected' : ''}>Đang hoạt động</option><option value="disabled" ${filter.status === 'disabled' ? 'selected' : ''}>Đã khóa</option></select></div>
      <div class="filter-actions"><button class="btn btn-ghost btn-sm" type="button" data-action="clear-admin-user-filter">Đặt lại</button><button class="btn btn-sm" type="submit">${icons.search} Áp dụng</button></div>
    </form>
    <section class="table-card admin-table-card"><div class="table-scroll"><table><thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Trạng thái</th><th>Dữ liệu</th><th>Ngày tạo</th><th>Thao tác</th></tr></thead><tbody>${state.adminUsers.map((u) => {
      const isSelf = String(u.user_id) === String(state.userId);
      return `<tr>
        <td><div class="admin-user-cell"><span class="admin-user-avatar">${escapeHtml(initials(u.name))}</span><span class="cell-title"><strong>${escapeHtml(u.name)} ${isSelf ? '<span class="badge blue">Bạn</span>' : ''}</strong><small>#${u.user_id} · ${escapeHtml(u.email)}</small></span></div></td>
        <td><span class="badge ${u.role === 'admin' ? 'blue' : 'neutral'}">${u.role === 'admin' ? 'Quản trị viên' : 'Phụ huynh'}</span></td>
        <td><span class="badge ${u.is_active ? '' : 'red'}">${u.is_active ? 'Đang hoạt động' : 'Đã khóa'}</span><small class="status-sub">${u.is_verified ? 'Đã xác minh email' : 'Chưa xác minh email'}</small>${u.role === 'admin' ? `<small class="status-sub">${u.face_enrolled ? 'Đã đăng ký khuôn mặt' : 'Chưa đăng ký khuôn mặt'}</small>${!isSelf ? `<button class="link-button" data-action="reset-user-face" data-id="${u.user_id}">Đặt lại dữ liệu khuôn mặt</button>` : ''}` : ''}</td>
        <td><strong>${u.child_count}</strong> trẻ · <strong>${u.device_count}</strong> thiết bị</td>
        <td>${formatDate(u.created_at)}</td>
        <td><div class="row-actions"><button class="btn btn-secondary btn-sm" data-action="view-user" data-id="${u.user_id}">${icons.eye} Chi tiết</button><button class="btn-icon-action" aria-label="Chỉnh sửa ${escapeHtml(u.name)}" title="Chỉnh sửa" data-action="edit-user" data-id="${u.user_id}">${icons.edit}</button><button class="btn-icon-action" aria-label="Thu hồi phiên của ${escapeHtml(u.name)}" title="Thu hồi phiên" data-action="revoke-user-sessions" data-id="${u.user_id}">${icons.revoke}</button><button class="btn-icon-action danger" aria-label="${isSelf ? 'Không thể xóa tài khoản của chính mình' : `Xóa ${escapeHtml(u.name)}`}" title="${isSelf ? 'Không thể xóa chính mình' : 'Xóa tài khoản'}" data-action="delete-user" data-id="${u.user_id}" ${isSelf ? 'disabled' : ''}>${icons.trash}</button></div></td>
      </tr>`;
    }).join('')}</tbody></table></div>${state.adminUsers.length ? `<div class="table-footer"><span>Mọi thay đổi được ghi vào nhật ký kiểm toán</span>${paginationMarkup('users', result, 'tài khoản')}</div>` : emptyState(icons.users, 'Không tìm thấy tài khoản', 'Hãy thay đổi từ khóa hoặc bộ lọc để xem kết quả khác.')}</section>`;
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
  const totalDomains = Number(result.total) || result.data.length;
  content.innerHTML = `
    ${pageHead('blacklist', '<button class="btn btn-sm" data-action="add-blacklist">' + icons.plus + ' Thêm tên miền</button>')}
    ${adminStatsStrip([
      { label: 'Tổng tên miền chặn', value: totalDomains },
      { label: 'Trang hiện tại', value: result.data.length },
      { label: 'Đồng bộ', value: 'Backend → Agent', note: 'chu kỳ 10 phút / khi khởi động' },
    ])}
    <form id="blacklist-search" class="filters filters-search admin-filter-bar"><div class="field"><label>Tìm tên miền</label><input class="input" name="search" value="${escapeHtml(search)}" placeholder="example.com"></div><div class="filter-actions"><button class="btn btn-ghost btn-sm" type="button" data-action="clear-blacklist-filter">Đặt lại</button><button class="btn btn-secondary btn-sm" type="submit">${icons.search} Tìm kiếm</button></div></form>
    <section class="table-card admin-table-card"><div class="table-scroll"><table><thead><tr><th>Tên miền</th><th>Lý do chặn</th><th>Người thêm</th><th>Ngày thêm</th><th><span class="visually-hidden">Thao tác</span></th></tr></thead><tbody>${result.data.map((item) => `<tr><td><div class="admin-domain-cell"><span class="domain-icon">${icons.shieldBan}</span><strong>${escapeHtml(item.domain)}</strong></div></td><td>${escapeHtml(item.reason || '—')}</td><td>${escapeHtml(item.added_by_name || 'Hệ thống')}</td><td>${formatDate(item.created_at)}</td><td><button class="btn btn-danger btn-sm" aria-label="Xóa ${escapeHtml(item.domain)} khỏi danh sách chặn" data-action="delete-blacklist" data-id="${item.blacklist_id}" data-name="${escapeHtml(item.domain)}">${icons.trash} Xóa</button></td></tr>`).join('')}</tbody></table></div>${result.data.length ? `<div class="table-footer">${paginationMarkup('blacklist', result, 'danh sách chặn')}</div>` : emptyState(icons.shieldBan, search ? 'Không tìm thấy tên miền' : 'Danh sách chặn đang trống', search ? 'Không có mục nào phù hợp với từ khóa tìm kiếm.' : 'Thêm tên miền đầu tiên để Agent bắt đầu bảo vệ.', search ? '' : '<button class="btn" data-action="add-blacklist">' + icons.plus + ' Thêm tên miền</button>')}</section>`;
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
  const totalEvents = Number(result.total) || state.adminAuditLogs.length;
  content.innerHTML = `
    ${pageHead('audit', '<button class="btn btn-secondary btn-sm" data-action="reload-page">' + icons.refresh + ' Làm mới</button>')}
    ${adminStatsStrip([
      { label: 'Sự kiện phù hợp', value: totalEvents },
      { label: 'Đang hiển thị', value: state.adminAuditLogs.length, note: 'trang hiện tại' },
      { label: 'Dữ liệu ghi nhận', value: 'IP & JSON' },
    ])}
    <form id="audit-filter" class="filters filters-audit admin-filter-bar"><div class="field"><label>Hành động</label><input class="input" name="action" list="audit-action-options" value="${escapeHtml(filter.action || '')}" placeholder="Ví dụ: user.update"><datalist id="audit-action-options"><option value="blacklist.add"><option value="blacklist.delete"><option value="user.create"><option value="user.update"><option value="user.revoke_sessions"><option value="user.face_reset"><option value="user.delete"><option value="account.change_password"><option value="account.reset_password"><option value="account.delete"><option value="device.delete"><option value="device.rotate_secret"><option value="settings.update"><option value="classification_policy.update"><option value="auth.admin_face_verified"><option value="auth.admin_face_enrolled"></datalist></div><div class="field"><label>Mã người thực hiện</label><input class="input" type="number" min="1" name="actor_user_id" value="${escapeHtml(filter.actor_user_id || '')}" placeholder="Ví dụ: 1"></div><div class="filter-actions"><button class="btn btn-ghost btn-sm" type="button" data-action="clear-audit-filter">Đặt lại</button><button class="btn btn-sm" type="submit">${icons.search} Áp dụng</button></div></form>
    <section class="table-card admin-table-card audit-table-card"><div class="table-scroll"><table><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>IP</th><th>Chi tiết</th></tr></thead><tbody>${state.adminAuditLogs.map((item) => `<tr><td>${formatDate(item.created_at)}</td><td><div class="admin-actor-cell"><span>#${item.actor_user_id ?? '—'}</span><span class="badge neutral">${escapeHtml(item.actor_role || '—')}</span></div></td><td><span class="audit-action-badge ${auditActionTone(item.action)}">${escapeHtml(item.action)}</span></td><td>${escapeHtml(item.target_type || '—')} <strong>#${escapeHtml(item.target_id || '—')}</strong></td><td><code class="audit-ip">${escapeHtml(item.ip_address || '—')}</code></td><td><button class="metadata-preview" aria-label="Xem chi tiết sự kiện ${escapeHtml(item.action)}" data-action="view-audit" data-id="${item.audit_id}"><code>${escapeHtml(auditMetadataPreview(item.metadata))}</code><span>Xem</span></button></td></tr>`).join('')}</tbody></table></div>${state.adminAuditLogs.length ? `<div class="table-footer">${paginationMarkup('audit', result, 'nhật ký kiểm toán')}</div>` : emptyState(icons.audit, 'Không có nhật ký', Object.values(filter).some(Boolean) ? 'Không có sự kiện nào phù hợp với bộ lọc.' : 'Chưa ghi nhận thao tác quản trị nhạy cảm nào.')}</section>`;
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
  if (state.role !== 'admin') throw new Error('Trang này chỉ dành cho quản trị viên.');
  const selected = agentEndpoints[state.agentEndpoint];
  const requestData = selected.method === 'GET' ? selected.query : selected.body;
  const requestLabel = selected.method === 'GET' ? 'Tham số query JSON' : 'Nội dung JSON';
  content.innerHTML = `
    ${pageHead('api-lab')}
    ${adminStatsStrip([
      { label: 'Endpoint mẫu', value: Object.keys(agentEndpoints).length },
      { label: 'Phương thức', value: selected.method },
      { label: 'X-Device-Secret', value: state.agentSecret ? 'Sẵn sàng' : 'Chưa nhập' },
    ])}
    <div class="secret-box api-secret-box"><span class="api-secret-icon">${icons.key}</span><span class="api-secret-copy"><small>Thông tin xác thực phiên thử nghiệm</small><strong>X-Device-Secret tạm thời</strong><code>${state.agentSecret ? '••••••••' + state.agentSecret.slice(-6) : 'Chưa nhập secret'}</code></span><span class="api-secret-actions"><button class="btn btn-secondary btn-sm" data-action="set-agent-secret">${state.agentSecret ? 'Thay secret' : 'Nhập secret'}</button><button class="btn btn-ghost btn-sm" data-action="clear-agent-secret" ${state.agentSecret ? '' : 'disabled'}>Xóa khỏi bộ nhớ</button></span></div>
    <section class="api-lab-grid">
      <aside class="card endpoint-list"><div class="endpoint-list-head"><p class="eyebrow">Danh mục endpoint</p><strong>${Object.keys(agentEndpoints).length} tình huống thử</strong></div>${Object.entries(agentEndpoints).map(([key, endpoint]) => `<button class="endpoint-button ${state.agentEndpoint === key ? 'active' : ''}" data-action="select-agent-endpoint" data-endpoint="${key}"><span class="method ${endpoint.method.toLowerCase()}">${endpoint.method}</span><span><strong>${escapeHtml(endpoint.label)}</strong><small>/api${escapeHtml(endpoint.path)}</small></span><span class="endpoint-arrow">→</span></button>`).join('')}</aside>
      <article class="card card-pad api-request-card">
        <div class="api-request-heading"><span class="method ${selected.method.toLowerCase()}">${selected.method}</span><div><p class="eyebrow">Trình tạo request</p><h2>${escapeHtml(selected.label)}</h2><p class="muted">/api${escapeHtml(selected.path)}</p></div></div>
        <form id="agent-request-form"><div class="field"><label>${requestLabel}</label><textarea class="textarea agent-request-data" name="request_data" ${requestData === undefined ? 'disabled' : ''}>${requestData === undefined ? '' : escapeHtml(JSON.stringify(requestData, null, 2))}</textarea>${selected.method === 'GET' && requestData !== undefined ? '<small>Giá trị sẽ được mã hóa an toàn vào query string.</small>' : '<small>Lưu ý: Request gửi bằng X-Device-Secret thật sẽ ghi nhật ký hoặc tạo cảnh báo trực tiếp trên thiết bị tương ứng.</small>'}</div><div class="form-actions">${state.agentSecret ? '' : '<small class="muted">Cần nhập X-Device-Secret ở trên trước khi gửi.</small>'}<button class="btn" type="submit" ${state.agentSecret ? '' : 'disabled'}>Gửi request</button></div></form>
        <div id="agent-response"></div>
      </article>
    </section>`;
}

export {
  adminLoadingSkeleton,
  agentEndpoints,
  renderAdminOverview,
  renderApiLab,
  renderAudit,
  renderBlacklist,
  renderUsers,
};
