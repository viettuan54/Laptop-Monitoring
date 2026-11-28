import { api } from './api.js';
import { formatDate } from './dates.js';
import { escapeHtml, initials, localizeError } from './format.js';
import { navigate } from './navigation.js';
import { state } from './state.js';
import {
  closeModal,
  emptyState,
  icons,
  modalRoot,
  pageHead,
  sectionVisual,
  showModal,
  toast,
} from './ui.js';

const DEFAULT_BACKEND_URL = 'https://api.tuansosad.id.vn';

function isDeviceOnline(device) {
  // Backend presence uses the database clock, shared with screenshot requests.
  // Only older API versions need the timestamp fallback.
  if (typeof device?.online === 'boolean') return device.online;
  if (!device?.last_seen_at) return false;
  const lastSeen = new Date(device.last_seen_at).getTime();
  return Number.isFinite(lastSeen) && Date.now() - lastSeen <= 5 * 60 * 1000;
}

function childName(id) {
  return state.children.find((item) => String(item.child_id) === String(id))?.name || `Trẻ #${id}`;
}

function deviceName(id) {
  return state.devices.find((item) => String(item.device_id) === String(id))?.device_name || `Thiết bị #${id}`;
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

export {
  agentGuide,
  childForm,
  childName,
  confirmDeviceAction,
  copyDeviceSecret,
  deviceForm,
  deviceModalDismissBlocked,
  deviceName,
  isDeviceOnline,
  protectDeviceModalOnUnload,
  registerDeviceFromModal,
  renameDeviceFromModal,
  renderChildren,
  renderDevices,
  showDeviceConfirmation,
};
