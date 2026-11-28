import { switchRow } from './policy.js';
import { api } from './api.js';
import { formatDate } from './dates.js';
import { isDeviceOnline } from './devices.js';
import { escapeHtml, initials, localizeError, reconcileSelectedId } from './format.js';
import { state } from './state.js';
import {
  closeModal,
  emptyState,
  icons,
  modalRoot,
  pageHead,
  showModal,
  toast,
} from './ui.js';

let controlRenderVersion = 0;
let breakReminderRefreshTimer = null;
let breakReminderRefreshVersion = 0;

const breakReminderHistoryState = new WeakMap();

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
            <label class="field"><span>Chu kỳ chụp định kỳ (phút)</span><input class="input" name="screenshot_interval_minutes" type="number" min="1" max="60" step="1" required value="${Number(settings.screenshot_interval_minutes) || 5}" aria-describedby="screenshot-interval-help"></label>
            <p id="screenshot-interval-help" class="muted">Từ 1–60 phút, áp dụng cho tất cả laptop của hồ sơ trẻ này. Nhấn Lưu điều khiển để áp dụng. Chụp ngay tại trang Hoạt động chỉ lấy một ảnh và không bật lịch định kỳ.</p>
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

export {
  isCurrentControlForm,
  refreshBreakReminderHistory,
  renderDeviceControls,
  saveDeviceControls,
  showControlLockConfirmation,
  stopBreakReminderPolling,
};
