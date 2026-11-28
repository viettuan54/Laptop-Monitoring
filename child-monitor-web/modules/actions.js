import { renderAccount } from './account.js';
import {
  confirmClearScreenshots,
  confirmScreenshotDelete,
  deleteScreenshots,
  exportActivityCsv,
  renderActivity,
  startScreenshotCapture,
  viewScreenshot,
} from './activity.js';
import {
  agentEndpoints,
  renderApiLab,
  renderAudit,
  renderBlacklist,
  renderUsers,
} from './admin.js';
import { handleAIAction, submitAIChat } from './ai.js';
import { renderAlerts } from './alerts.js';
import { api } from './api.js';
import {
  captureAdminFaceFrames,
  completeLogin,
  logout,
  renderAdminFaceVerification,
  renderAuth,
  sendLoginVerification,
  showLoginVerification,
  stopFaceCamera,
} from './auth.js';
import {
  isCurrentControlForm,
  renderDeviceControls,
  saveDeviceControls,
  showControlLockConfirmation,
} from './controls.js';
import { formatDate } from './dates.js';
import {
  agentGuide,
  childForm,
  confirmDeviceAction,
  copyDeviceSecret,
  deviceForm,
  registerDeviceFromModal,
  renameDeviceFromModal,
  showDeviceConfirmation,
} from './devices.js';
import {
  escapeHtml,
  initials,
  localizeError,
  localizeMessage,
  queryString,
  relativeTime,
} from './format.js';
import { initialize, navigate } from './navigation.js';
import {
  capturePolicyDraft,
  isCurrentPolicyForm,
  policySaveRequiresRefresh,
  renderPolicies,
  savePolicyForm,
  switchRow,
  syncPolicyFormState,
} from './policy.js';
import { state } from './state.js';
import { closeModal, confirmModal, modalRoot, showModal, toast } from './ui.js';

async function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (['admin-create-user-form', 'admin-reset-face-form'].includes(form.id)) {
    if (form.dataset.pending === 'true') return;
    form.dataset.pending = 'true';
  }
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
      form.querySelector('#login-verification')?.classList.add('hidden');
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
      data.screenshot_interval_minutes = Number(form.elements.screenshot_interval_minutes.value);
      if (!Number.isInteger(data.screenshot_interval_minutes) || data.screenshot_interval_minutes < 1 || data.screenshot_interval_minutes > 60) {
        throw new Error('Chu kỳ chụp phải là số nguyên từ 1 đến 60 phút.');
      }
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
    } else if (form.id === 'admin-reset-face-form') {
      await api(`/admin/users/${form.dataset.id}/reset-face`, { method: 'POST', body: { password: data.password } });
      form.reset();
      closeModal();
      toast('Đã đặt lại khuôn mặt', 'Các phiên cũ đã bị thu hồi. Người dùng cần đăng ký khuôn mặt ở lần đăng nhập tiếp theo.');
      await renderUsers(document.querySelector('#page-content'));
    } else if (form.id === 'admin-create-user-form') {
      if (data.password !== data.confirm_password) throw new Error('Mật khẩu xác nhận không khớp');
      const created = await api('/admin/users', { method: 'POST', body: {
        name: data.name, email: data.email, password: data.password,
        role: data.role, is_verified: form.elements.is_verified.checked,
      } });
      form.reset();
      closeModal();
      state.adminUserFilter = {};
      state.adminUserOffset = 0;
      toast('Đã tạo tài khoản', !created.is_verified ? 'Cần xác minh email trước khi đăng nhập.' : created.role === 'admin' ? 'Tài khoản quản trị cần xác thực khuôn mặt khi đăng nhập.' : 'Tài khoản phụ huynh đã sẵn sàng đăng nhập.');
      await renderUsers(document.querySelector('#page-content'));
    } else if (form.id === 'admin-user-form') {
      const body = {
        is_active: form.elements.is_active.checked,
        is_verified: form.elements.is_verified.checked,
      };
      await api(`/admin/users/${form.dataset.id}`, { method: 'PATCH', body });
      closeModal();
      toast('Đã cập nhật tài khoản', 'Các thay đổi quyền hoặc trạng thái đã được áp dụng.');
      await renderUsers(document.querySelector('#page-content'));
    } else if (form.id === 'blacklist-search') {
      state.blacklistSearch = data.search;
      state.blacklistOffset = 0;
      await renderBlacklist(document.querySelector('#page-content'));
    } else if (form.id === 'blacklist-form') {
      const created = await api('/admin/blacklist', { method: 'POST', body: data });
      state.blacklistOffset = 0;
      closeModal(); toast('Đã thêm tên miền', `${created?.domain || data.domain} sẽ được đồng bộ xuống Agent (chu kỳ tối đa 10 phút).`); await navigate('blacklist');
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
    if (form.id === 'login-form' && error.status === 403
        && error.message === 'Email not verified. Please verify your email first.') {
      showLoginVerification(form, data.email);
    }
    toast('Không thể hoàn tất', localizeError(error.message), 'error');
    if (form.id === 'agent-request-form') {
      const target = document.querySelector('#agent-response');
      if (target) target.innerHTML = `<p class="eyebrow api-response-status">Request thất bại</p><pre class="code-box">${escapeHtml(JSON.stringify(error.payload || { message: error.message }, null, 2))}</pre>`;
    }
  } finally {
    if (['admin-create-user-form', 'admin-reset-face-form'].includes(form.id)) delete form.dataset.pending;
    if (submit && form.id !== 'device-control-form') {
      if (form.id === 'policy-form') syncPolicyFormState(String(form.dataset.childId));
      else submit.disabled = false;
    }
  }
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
    if (action === 'verify-login-email') return await sendLoginVerification(button.closest('#login-form'));
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
      if (button.dataset.busy === 'true') return;
      button.dataset.busy = 'true';
      button.disabled = true;
      const activeChallenge = state.faceChallenge;
      const status = document.querySelector('#face-camera-status');
      status.textContent = 'Đang chụp và xác minh…';
      const frames = await captureAdminFaceFrames();
      if (state.faceChallenge !== activeChallenge) return;
      const result = await api('/auth/admin-face', {
        method: 'POST',
        body: { challenge: activeChallenge, frames },
        noAuth: true,
      });
      if (state.faceChallenge !== activeChallenge) return;
      if (result.faceVerified !== true) throw new Error('Face verification failed');
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
    if (action === 'delete-push-token') return confirmModal('Gỡ thiết bị nhận thông báo?', 'Thiết bị này sẽ không còn nhận cảnh báo LaptopChildren.', 'confirm-delete-push-token', id);
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
      const faceSummary = u.role === 'admin' ? `<div><small>Khuôn mặt</small><strong>${u.face_enrolled ? 'Đã đăng ký' : 'Chưa đăng ký'}</strong></div>` : '';
      return showModal('Chi tiết tài khoản', `${u.name} · ${u.email}`, `<div class="user-detail-summary"><div><small>Vai trò</small><strong>${u.role === 'admin' ? 'Quản trị viên' : 'Phụ huynh'}</strong></div><div><small>Trạng thái</small><strong>${u.is_active ? 'Đang hoạt động' : 'Đã khóa'}</strong></div><div><small>Email</small><strong>${u.is_verified ? 'Đã xác minh' : 'Chưa xác minh'}</strong></div>${faceSummary}</div><h3>Hồ sơ trẻ (${detail.children.length})</h3><div class="list">${detail.children.map((child) => `<div class="list-item"><div class="list-icon">${escapeHtml(initials(child.name))}</div><div class="list-copy"><strong>${escapeHtml(child.name)}</strong><small>${child.age ?? '—'} tuổi · ${child.device_count} thiết bị</small></div></div>`).join('') || '<p class="muted">Chưa có hồ sơ trẻ.</p>'}</div><h3>Thiết bị (${detail.devices.length})</h3><div class="list">${detail.devices.map((device) => `<div class="list-item"><div class="list-icon">PC</div><div class="list-copy"><strong>${escapeHtml(device.device_name)}</strong><small>${escapeHtml(device.device_uid)} · ${device.last_seen_at ? relativeTime(device.last_seen_at) : 'Chưa kết nối'}</small></div></div>`).join('') || '<p class="muted">Chưa có thiết bị.</p>'}</div>`);
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
    if (action === 'reset-user-face') {
      const user = state.adminUsers.find(item => String(item.user_id) === String(id));
      if (!user || user.role !== 'admin' || String(id) === String(state.userId)) return;
      return showModal('Đặt lại dữ liệu khuôn mặt?', `${user.name} · ${user.email}`, `
        <p>Dữ liệu khuôn mặt và các phiên đăng nhập của tài khoản này sẽ bị thu hồi. Người dùng sẽ phải nhập đúng mật khẩu, có email đã xác minh và chụp khuôn mặt mới ở lần đăng nhập tiếp theo.</p>
        <form id="admin-reset-face-form" data-id="${user.user_id}">
          <div class="field"><label for="face-reset-password">Mật khẩu của bạn (người thực hiện)</label><input id="face-reset-password" class="input" type="password" name="password" required autocomplete="current-password"></div>
          <div class="form-actions"><button class="btn btn-secondary" type="button" data-action="close-modal">Hủy</button><button class="btn btn-danger" type="submit">Đặt lại khuôn mặt</button></div>
        </form>`);
    }
    if (action === 'add-admin-user') {
      return showModal('Thêm tài khoản', 'Tạo tài khoản riêng cho quản trị viên hoặc phụ huynh. Vai trò không thể đổi sau khi tạo.', `
        <form id="admin-create-user-form" class="form-grid">
          <div class="field full"><label for="new-user-name">Họ tên</label><input id="new-user-name" class="input" name="name" required maxlength="100" autocomplete="name"></div>
          <div class="field full"><label for="new-user-email">Email</label><input id="new-user-email" class="input" name="email" type="email" required maxlength="150" autocomplete="off"></div>
          <div class="field full"><label for="new-user-role">Vai trò</label><select id="new-user-role" class="select" name="role"><option value="admin">Quản trị viên</option><option value="parent">Phụ huynh</option></select></div>
          <div class="field full"><label for="new-user-password">Mật khẩu</label><input id="new-user-password" class="input" name="password" type="password" required minlength="8" maxlength="72" autocomplete="new-password"><small>Ít nhất 8 ký tự, gồm chữ hoa, số và ký tự đặc biệt; tối đa 72 byte.</small></div>
          <div class="field full"><label for="new-user-confirm">Xác nhận mật khẩu</label><input id="new-user-confirm" class="input" name="confirm_password" type="password" required autocomplete="new-password"></div>
          <div class="field full"><label><input type="checkbox" name="is_verified"> Tôi đã xác minh email của người dùng này</label><small>Nếu chưa chọn, tài khoản chưa thể đăng nhập. Bạn có thể xác minh email sau trong Chỉnh sửa tài khoản.</small></div>
          <p class="muted field full">Admin mới sẽ tự đăng ký khuôn mặt ở lần đăng nhập đầu tiên, sau khi xác minh email và nhập đúng mật khẩu. Không cần chụp khuôn mặt ở máy đang tạo tài khoản.</p>
          <div class="form-actions field full"><button class="btn btn-secondary" type="button" data-action="close-modal">Hủy</button><button class="btn" type="submit">Tạo tài khoản</button></div>
        </form>`);
    }
    if (action === 'edit-user') {
      const u = state.adminUsers.find((item) => String(item.user_id) === String(id));
      if (!u) throw new Error('Không tìm thấy tài khoản');
      const isSelf = String(u.user_id) === String(state.userId);
      const roleControl = `<input class="input" value="${u.role === 'admin' ? 'Quản trị viên' : 'Phụ huynh'}" disabled><small>Vai trò cố định. Để dùng vai trò khác, hãy tạo tài khoản riêng.</small>`;
      const enrollmentWarning = '';
      showModal('Chỉnh sửa tài khoản', `${u.name} · ${u.email}`, `<form id="admin-user-form" data-id="${u.user_id}" data-original-role="${u.role}" class="form-grid"><div class="field full"><label>Vai trò</label>${roleControl}</div>${enrollmentWarning}<div class="field full">${switchRow('is_active', 'Tài khoản đang hoạt động', isSelf ? 'Không thể tự khóa tài khoản quản trị.' : 'Tắt để chặn đăng nhập và thu hồi toàn bộ phiên web/mobile (Agent trên máy trẻ vẫn duy trì bảo vệ theo cấu hình đã lưu).', u.is_active).replace('name="is_active"', `name="is_active" ${isSelf ? 'disabled' : ''}`)}${switchRow('is_verified', 'Email đã xác minh', 'Cho phép quản trị viên xác nhận email thủ công.', u.is_verified)}</div><div class="form-actions field full"><button class="btn btn-secondary" type="button" data-action="close-modal">Hủy</button><button class="btn" type="submit">Lưu thay đổi</button></div></form>`);
      if (isSelf) {
        const verifiedInput = document.querySelector('#admin-user-form [name="is_verified"]');
        verifiedInput.disabled = true;
        verifiedInput.closest('label')?.setAttribute('title', 'Không thể tự bỏ xác minh email của tài khoản quản trị.');
      }
      return;
    }
    if (action === 'revoke-user-sessions') {
      const targetUser = state.adminUsers.find((item) => String(item.user_id) === String(id));
      const userLabel = targetUser ? `${targetUser.name} (${targetUser.email})` : `tài khoản #${id}`;
      return confirmModal(`Thu hồi phiên của ${targetUser ? targetUser.name : '#' + id}?`, `Tất cả access token và refresh token của ${userLabel} sẽ mất hiệu lực ngay lập tức.`, 'confirm-revoke-user-sessions', id);
    }
    if (action === 'confirm-revoke-user-sessions') { await api(`/admin/users/${id}/revoke-sessions`, { method: 'POST' }); closeModal(); toast('Đã thu hồi toàn bộ phiên'); if (String(id) === String(state.userId)) return logout(false); return renderUsers(document.querySelector('#page-content')); }
    if (action === 'delete-user') {
      const targetUser = state.adminUsers.find((item) => String(item.user_id) === String(id));
      const userLabel = targetUser ? `${targetUser.name} (${targetUser.email})` : `tài khoản #${id}`;
      const dataScope = targetUser ? ` (${Number(targetUser.child_count) || 0} hồ sơ trẻ, ${Number(targetUser.device_count) || 0} thiết bị)` : '';
      return confirmModal(`Xóa vĩnh viễn ${targetUser ? targetUser.name : '#' + id}?`, `Toàn bộ hồ sơ trẻ, thiết bị, nhật ký và dữ liệu liên quan của ${userLabel}${dataScope} sẽ bị xóa. Không thể hoàn tác.`, 'confirm-delete-user', id);
    }
    if (action === 'confirm-delete-user') { await api(`/admin/users/${id}`, { method: 'DELETE' }); closeModal(); toast('Đã xóa tài khoản và dữ liệu liên quan'); return renderUsers(document.querySelector('#page-content')); }
    if (action === 'delete-account') return showModal('Xóa vĩnh viễn tài khoản?', 'Nhập mật khẩu để xác nhận. Thao tác này không thể hoàn tác.', `<form id="delete-account-form"><div class="field"><label>Mật khẩu</label><input class="input" type="password" name="password" required autocomplete="current-password" placeholder="Nhập mật khẩu hiện tại"></div><div class="form-actions"><button class="btn btn-secondary" type="button" data-action="close-modal">Hủy</button><button class="btn btn-danger" type="submit">Xóa vĩnh viễn</button></div></form>`);
    if (action === 'add-blacklist') return showModal('Thêm tên miền vào danh sách chặn', 'Backend sẽ chuẩn hóa tên miền (bỏ http/https, www, đường dẫn) và chặn toàn bộ tên miền đó trên Agent ở chu kỳ đồng bộ tiếp theo (tối đa 10 phút).', `<form id="blacklist-form" class="form-grid"><div class="field full"><label>Tên miền</label><input class="input" name="domain" required placeholder="example.com"></div><div class="field full"><label>Lý do</label><textarea class="textarea" name="reason" maxlength="500"></textarea></div><div class="form-actions field full"><button class="btn btn-secondary" type="button" data-action="close-modal">Hủy</button><button class="btn" type="submit">Thêm tên miền</button></div></form>`);
    if (action === 'delete-blacklist') return confirmModal(`Xóa ${button.dataset.name}?`, 'Tên miền sẽ không còn được gửi xuống Agent ở lần đồng bộ tiếp theo.', 'confirm-delete-blacklist', id);
    if (action === 'confirm-delete-blacklist') { await api(`/admin/blacklist/${id}`, { method: 'DELETE' }); closeModal(); toast('Đã xóa tên miền'); return navigate('blacklist'); }
    if (action === 'set-agent-secret') return showModal('Nhập khóa bí mật của thiết bị', 'Khóa chỉ được giữ trong bộ nhớ của tab và không được lưu lâu dài.', `<form id="agent-secret-form"><div class="field"><label>X-Device-Secret</label><input class="input" name="secret" required autocomplete="off"></div><div class="form-actions"><button class="btn" type="submit">Sử dụng khóa</button></div></form>`);
    if (action === 'clear-agent-secret') { state.agentSecret = ''; toast('Đã xóa secret khỏi bộ nhớ'); return renderApiLab(document.querySelector('#page-content')); }
    if (action === 'select-agent-endpoint') { state.agentEndpoint = button.dataset.endpoint; return renderApiLab(document.querySelector('#page-content')); }
  } catch (error) {
    if (action === 'verify-admin-face') {
      const status = document.querySelector('#face-camera-status');
      if (status) status.textContent = localizeError(error.message);
      if (error.payload?.code === 'FACE_ALREADY_ENROLLED') {
        button.textContent = 'Chụp lại khuôn mặt';
      }
      if (error.payload?.attemptsRemaining === 0) {
        button.dataset.exhausted = 'true';
        if (status) status.textContent += ' Đã hết lượt thử. Hãy chọn “Hủy và đăng nhập lại” để bắt đầu lại.';
      }
    }
    toast('Không thể hoàn tất', localizeError(error.message), 'error');
  } finally {
    if (button && isMutationAction && document.body.contains(button)) {
      button.disabled = false;
      button.dataset.busy = 'false';
      button.removeAttribute('aria-busy');
    }
    if (button && action === 'verify-admin-face') {
      delete button.dataset.busy;
      if (document.body.contains(button)) button.disabled = button.dataset.exhausted === 'true';
    }
  }
}

export { handleClick, handleSubmit };
