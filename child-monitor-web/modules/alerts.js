import { api } from './api.js';
import { formatDate } from './dates.js';
import { deviceName } from './devices.js';
import { escapeHtml, queryString } from './format.js';
import { state } from './state.js';
import { emptyState, pageHead } from './ui.js';

let alertRefreshTimer = null;
let alertRefreshPromise = null;
let alertRefreshSequence = 0;
let alertListRefreshPromise = null;

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

export {
  alertCountLabel,
  alertPresentation,
  refreshAlertIndicatorInBackground,
  refreshUnreadAlertCount,
  renderAlerts,
  startAlertPolling,
  stopAlertPolling,
  updateAlertIndicator,
};
