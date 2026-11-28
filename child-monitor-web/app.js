import { syncPushPlatforms } from './modules/account.js';
import { handleClick, handleSubmit } from './modules/actions.js';
import { updateScreenshotCaptureControls } from './modules/activity.js';
import { renderApiLab } from './modules/admin.js';
import { captureAIChatDraft, changeAIDevice } from './modules/ai.js';
import { refreshAlertIndicatorInBackground } from './modules/alerts.js';
import { api } from './modules/api.js';
import { clearSession, renderAuth } from './modules/auth.js';
import { refreshBreakReminderHistory } from './modules/controls.js';
import { protectDeviceModalOnUnload } from './modules/devices.js';
import { localizeError } from './modules/format.js';
import { initialize, navigate } from './modules/navigation.js';
import { renderOverview } from './modules/overview.js';
import { capturePolicyDraft } from './modules/policy.js';
import { state } from './modules/state.js';
import { app, closeModal, enhanceFormAccessibility, modalRoot, toast } from './modules/ui.js';

document.addEventListener('submit', async (event) => {
  if (event.target.id === 'delete-account-form') {
    event.preventDefault();
    if (event.target.dataset.pending === 'true') return;
    event.target.dataset.pending = 'true';
    const submit = event.target.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    const data = Object.fromEntries(new FormData(event.target));
    try {
      await api('/auth/account', { method: 'DELETE', body: data });
      closeModal(); clearSession(); renderAuth('login'); toast('Tài khoản đã được xóa');
    } catch (error) {
      toast('Không thể xóa tài khoản', localizeError(error.message), 'error');
    } finally {
      delete event.target.dataset.pending;
      if (submit && document.body.contains(submit)) submit.disabled = false;
    }
    return;
  }
  if (event.target.id === 'agent-secret-form') {
    event.preventDefault();
    if (state.role !== 'admin') {
      return toast('Không có quyền truy cập', 'Trang này chỉ dành cho quản trị viên.', 'error');
    }
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
  }
});

document.addEventListener('keydown', (event) => {
  if (event.target.matches('.tab, .auth-tab') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    const tabs = [...event.target.closest('.tabs, .auth-tabs').querySelectorAll('.tab, .auth-tab')];
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
  if (event.target.matches('#login-form [name="email"]')) {
    event.target.closest('form').querySelector('#login-verification')?.classList.add('hidden');
  }
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
