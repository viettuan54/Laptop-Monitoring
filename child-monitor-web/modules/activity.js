import { api } from './api.js';
import { formatDate } from './dates.js';
import { deviceName } from './devices.js';
import {
  accessStatusLabels,
  categoryBadge,
  categoryLabel,
  duration,
  escapeHtml,
  queryString,
} from './format.js';
import { policyCategoryGroups } from './policy.js';
import { state } from './state.js';
import {
  closeModal,
  emptyState,
  icons,
  loading,
  modalRoot,
  pageHead,
  showModal,
  toast,
} from './ui.js';

let screenshotRefreshTimer = null;
let activityRenderVersion = 0;

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

function stopScreenshotPolling() {
  clearTimeout(screenshotRefreshTimer);
  screenshotRefreshTimer = null;
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
  const pending = Boolean(monitor?.pending_request_id);
  const keepPanelFocus = background && document.activeElement === content.querySelector('#activity-panel-screenshots');
  activitySurface(content).innerHTML = `
    ${pageHead('activity', `<div class="activity-head-actions">${activityTabs()}<button class="btn btn-secondary" data-action="refresh-screenshots">${icons.refresh} Làm mới</button><button class="btn btn-secondary" data-action="clear-screenshots" ${!state.screenshotDevices.length ? 'disabled' : ''}>Xóa tất cả ảnh</button></div>`)}
    ${activityPanelStart()}
    <section class="screen-monitor-intro"><div><h2>Giám sát màn hình</h2><p>Ảnh chụp màn hình chính từ thiết bị của con, mới nhất ở đầu danh sách.</p></div><p class="screen-monitor-policy">${monitor ? `Khi bật: chụp mỗi ${Number(monitor.screenshot_interval_minutes) || 5} phút` : 'Chu kỳ theo từng hồ sơ trẻ'} · Lưu ${Number(result.retention_days) || 7} ngày</p></section>
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
  const pending = Boolean(monitor?.pending_request_id);
  const status = operation ? 'Đang gửi yêu cầu…' : !monitor ? 'Chọn một thiết bị để chụp ngay.'
    : pending ? (monitor.online ? 'Đang chờ Agent gửi ảnh; tự kiểm tra mỗi 2 giây.' : 'Thiết bị ngoại tuyến. Yêu cầu có hiệu lực 3 phút.')
      : monitor.request_expired ? 'Yêu cầu trước đã hết hạn. Kiểm tra kết nối laptop rồi thử lại.'
        : `Chụp định kỳ đang ${monitor.enabled ? 'bật' : 'tắt'}. Chụp ngay chỉ lấy một ảnh.`;
  const scope = monitor ? `Chụp ngay: ${deviceName(monitor.device_id)}. Không thay đổi lịch chụp định kỳ. Sau khi gửi, danh sách sẽ chuyển sang thiết bị này và bỏ lọc thời gian để xem ảnh mới.`
    : 'Chọn thiết bị ở bộ lọc. Thiết lập chụp định kỳ và chu kỳ tại Điều khiển thiết bị.';
  return `<div class="form-actions form-actions-start" role="group" aria-label="Chụp ngay" aria-describedby="screenshot-capture-scope">
    <button class="btn" data-action="start-screenshot" ${operation || pending || !monitor ? 'disabled' : ''}>${operation ? 'Đang gửi yêu cầu…' : pending ? 'Đang chờ ảnh…' : 'Chụp ngay'}</button>
    </div><p id="screenshot-capture-status" role="status">${status}</p><p id="screenshot-capture-scope">${escapeHtml(scope)}</p>`;
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

async function startScreenshotCapture(button) {
  return setScreenshotCapture(button);
}

async function setScreenshotCapture(button) {
  if (state.screenshotControlOperation) return;
  const target = screenshotCaptureTarget();
  if (!target) {
    document.querySelector('#screen-device')?.focus();
    return toast('Chọn thiết bị', 'Chọn một thiết bị trong bộ lọc để chụp ngay.', 'error');
  }
  const device = state.devices.find((item) => String(item.device_id) === String(target.device_id));
  if (!device?.child_id) return toast('Chưa xác định được hồ sơ con', 'Hãy tải lại trang rồi thử lại.', 'error');
  const version = ++activityRenderVersion;
  const operation = {};
  state.screenshotControlOperation = operation;
  stopScreenshotPolling();
  updateScreenshotCaptureControls();
  const ownsOperation = () => state.screenshotControlOperation === operation;
  const onScreenshotPage = () => state.page === 'activity' && state.activityTab === 'screenshots';
  try {
    if (!ownsOperation() || !onScreenshotPage()) return;
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
    button.textContent = 'Chụp ngay';
    toast('Chưa gửi được yêu cầu chụp ngay', error.message, 'error');
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

function invalidateActivityRender() {
  activityRenderVersion += 1;
}

export {
  confirmClearScreenshots,
  confirmScreenshotDelete,
  deleteScreenshots,
  exportActivityCsv,
  invalidateActivityRender,
  renderActivity,
  startScreenshotCapture,
  stopScreenshotPolling,
  updateScreenshotCaptureControls,
  viewScreenshot,
  websiteActivityTitle,
};
