import { invalidateActivityRender, stopScreenshotPolling } from './activity.js';
import { startAlertPolling, stopAlertPolling } from './alerts.js';
import { api } from './api.js';
import { stopBreakReminderPolling } from './controls.js';
import { emptyUsageSummary } from './dates.js';
import { escapeHtml, localizeError } from './format.js';
import { navigate, renderShell } from './navigation.js';
import { INITIAL_CHAT, state } from './state.js';
import { app, brandMarkup, modalRoot, resetModalFocus, toast, toastRoot } from './ui.js';

function decodeJwt(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

function saveSession(tokens) {
  state.accessToken = tokens.accessToken;
  state.refreshToken = tokens.refreshToken;
  state.userId = decodeJwt(tokens.accessToken).user_id || null;
  sessionStorage.setItem('lm_access_token', state.accessToken);
  sessionStorage.setItem('lm_refresh_token', state.refreshToken);
}

function clearSession() {
  stopScreenshotPolling();
  stopBreakReminderPolling();
  invalidateActivityRender();
  stopAlertPolling();
  stopFaceCamera();
  document.body?.classList?.remove('admin-surface');
  modalRoot.innerHTML = '';
  app.inert = false;
  toastRoot.innerHTML = '';
  resetModalFocus();
  state.policyRenderVersion = (state.policyRenderVersion || 0) + 1;
  Object.assign(state, {
    accessToken: '',
    refreshToken: '',
    role: '',
    userId: null,
    userName: '',
    children: [],
    devices: [],
    alerts: [],
    unreadAlertCount: 0,
    analyses: [],
    appLogs: [],
    webLogs: [],
    screenshotRows: [],
    screenshotDevices: [],
    screenshotSignature: null,
    screenshotPollError: false,
    screenshotControlOperation: null,
    usageSummary: emptyUsageSummary(),
    adminStats: null,
    adminUsers: [],
    adminAuditLogs: [],
    pushTokens: [],
    faceChallenge: '',
    faceRequiredFrames: 5,
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
    policyDrafts: {},
    policyBaselinesByChild: {},
    policyPendingByChild: {},
    policyDataVersions: {},
    policySaveErrors: {},
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

function renderAuth(mode = 'login') {
  stopFaceCamera();
  state.faceChallenge = '';
  document.body?.classList?.remove('admin-surface');
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
        <div id="login-verification" class="field full hidden" role="status" aria-live="polite">
          <p data-verification-message>Email chưa được xác minh. Bạn có thể yêu cầu gửi email xác minh ngay.</p>
          <button class="btn btn-secondary" type="button" data-action="verify-login-email">Xác minh email ngay</button>
        </div>
        <div class="form-actions between field full"><button class="link-button" type="button" data-auth-mode="forgot">Quên mật khẩu?</button><button class="btn" type="submit">Đăng nhập an toàn</button></div>
      </form>`,
    register: `
      <form id="register-form" class="form-grid">
        <div class="field full"><label>Họ và tên</label><input class="input" name="name" maxlength="100" required autocomplete="name" placeholder="Nguyễn Minh Anh"></div>
        <div class="field full"><label>Email</label><input class="input" type="email" name="email" required autocomplete="email" placeholder="parent@example.com"></div>
        <div class="field full"><label>Mật khẩu</label><input class="input" type="password" name="password" required minlength="8" autocomplete="new-password" placeholder="Tối thiểu 8 ký tự"><small>Cần chữ hoa, số và ký tự đặc biệt.</small></div>
        <div class="form-actions field full"><button class="btn" type="submit">Tạo tài khoản</button></div>
      </form>`,
    forgot: `
      <form id="forgot-form" class="form-grid">
        <div class="field full"><label>Email đã đăng ký</label><input class="input" type="email" name="email" required autocomplete="email" placeholder="parent@example.com"></div>
        <div class="form-actions between field full"><button class="link-button" type="button" data-auth-mode="login">Quay lại</button><button class="btn" type="submit">Gửi liên kết đặt lại</button></div>
      </form>`,
    verify: `
      <form id="verify-form" class="form-grid">
        <div class="field full"><label>Mã xác minh</label><textarea class="textarea" name="token" required placeholder="Dán mã nhận được từ email">${escapeHtml(params.get('token') || '')}</textarea></div>
        <div class="form-actions between field full"><div class="auth-secondary-links"><button class="link-button" type="button" data-auth-mode="login">Quay lại</button><button class="link-button" type="button" data-auth-mode="resend">Gửi lại email</button></div><button class="btn" type="submit">Xác minh email</button></div>
      </form>`,
    resend: `
      <form id="resend-form" class="form-grid">
        <div class="field full"><label>Email</label><input class="input" type="email" name="email" required autocomplete="email" placeholder="parent@example.com"></div>
        <div class="field full"><label>Mật khẩu</label><input class="input" type="password" name="password" required autocomplete="current-password" placeholder="••••••••••"></div>
        <div class="form-actions between field full"><button class="link-button" type="button" data-auth-mode="login">Quay lại</button><button class="btn" type="submit">Gửi lại xác minh</button></div>
      </form>`,
    reset: `
      <form id="reset-form" class="form-grid">
        <input type="hidden" name="token" value="${escapeHtml(params.get('token') || '')}">
        <div class="field full"><label>Mật khẩu mới</label><input class="input" type="password" name="newPassword" required minlength="8" autocomplete="new-password" placeholder="Tối thiểu 8 ký tự"><small>Cần chữ hoa, số và ký tự đặc biệt.</small></div>
        <div class="form-actions between field full"><button class="link-button" type="button" data-auth-mode="login">Quay lại</button><button class="btn" type="submit">Đặt lại mật khẩu</button></div>
      </form>`,
  };
  const heading = {
    login: ['Chào mừng bạn trở lại', 'Đăng nhập để theo dõi nhịp sống số của gia đình.'],
    register: ['Bắt đầu cùng LaptopChildren', 'Tạo một không gian số lành mạnh hơn cho gia đình.'],
    forgot: ['Khôi phục quyền truy cập', 'Hệ thống sẽ gửi liên kết nếu email tồn tại.'],
    verify: ['Xác minh email', 'Hoàn tất bước cuối để bảo vệ tài khoản.'],
    resend: ['Gửi lại mã xác minh', 'Xác nhận thông tin để nhận email mới.'],
    reset: ['Tạo mật khẩu mới', 'Mọi phiên đăng nhập cũ sẽ được thu hồi.'],
  }[mode];
  document.title = `${heading[0]} — LaptopChildren`;

  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-story">
        ${brandMarkup()}
        <div class="auth-message">
          <p class="eyebrow">Nuôi dưỡng thói quen số lành mạnh</p>
          <h1>Thấu hiểu để <em>đồng hành.</em></h1>
          <p>LaptopChildren chuyển hoạt động trên thiết bị thành những tín hiệu rõ ràng, giúp phụ huynh trò chuyện đúng lúc và thiết lập giới hạn có chủ đích.</p>
        </div>
        <div class="trust-row"><span><i class="trust-dot" aria-hidden="true"></i>Dữ liệu riêng biệt từng gia đình</span><span><i class="trust-dot" aria-hidden="true"></i>Mã kết nối thiết bị dùng một lần</span><span><i class="trust-dot" aria-hidden="true"></i>Cảnh báo &amp; phân loại minh bạch</span></div>
      </section>
      <section class="auth-panel" id="page-content" tabindex="-1">
        <div class="auth-card">
          <p class="eyebrow">Bảng điều khiển phụ huynh</p>
          <h2>${heading[0]}</h2><p>${heading[1]}</p>
          ${
            ['login', 'register'].includes(mode)
              ? `<div class="auth-tabs" aria-label="Chế độ tài khoản"><button class="auth-tab ${
                  mode === 'login' ? 'active' : ''
                }" type="button" data-auth-mode="login">Đăng nhập</button><button class="auth-tab ${
                  mode === 'register' ? 'active' : ''
                }" type="button" data-auth-mode="register">Đăng ký</button></div>`
              : ''
          }
          ${forms[mode]}
        </div>
      </section>
    </main>`;
}

async function renderAdminFaceVerification(challengeResult) {
  stopFaceCamera();
  const enrolling = challengeResult.faceMode === 'enroll';
  const faceTitle = enrolling ? 'Đăng ký khuôn mặt lần đầu' : 'Xác thực khuôn mặt';
  document.title = `${faceTitle} — LaptopChildren`;
  state.faceChallenge = challengeResult.faceChallenge;
  state.faceRequiredFrames = challengeResult.requiredFrames || 5;
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-story">
        ${brandMarkup()}
        <div class="auth-message">
          <p class="eyebrow">Bảo vệ quyền quản trị</p>
          <h1>Mật khẩu đúng.<br><em>${faceTitle}.</em></h1>
          <p>${enrolling ? 'Tài khoản này chưa có dữ liệu khuôn mặt. Hãy tự chụp 5 ảnh để đăng ký cho tài khoản của bạn. Các lần đăng nhập sau sẽ đối chiếu với dữ liệu này.' : 'Hệ thống đối chiếu khuôn mặt với dữ liệu đã đăng ký riêng cho tài khoản đang đăng nhập.'}</p>
        </div>
        <div class="trust-row"><span><i class="trust-dot" aria-hidden="true"></i>Mã xác thực dùng một lần</span><span><i class="trust-dot" aria-hidden="true"></i>Không lưu ảnh khuôn mặt</span><span><i class="trust-dot" aria-hidden="true"></i>Chỉ cấp phiên khi khớp khuôn mặt</span></div>
      </section>
      <section class="auth-panel" id="page-content" tabindex="-1">
        <div class="auth-card face-auth-card">
          <p class="eyebrow">Xác thực quản trị viên</p>
          <h2>${faceTitle}</h2>
          <p>Giữ khuôn mặt thẳng, đủ sáng và không có người khác trong ảnh. Hệ thống sẽ chụp ${state.faceRequiredFrames} khung hình liên tiếp.</p>
          <div class="face-camera">
            <video id="face-video" autoplay muted playsinline></video>
            <div class="face-guide" aria-hidden="true"></div>
            <div class="face-camera-status" id="face-camera-status">Đang yêu cầu quyền camera…</div>
          </div>
          <canvas id="face-canvas" class="hidden"></canvas>
          <div class="form-actions between">
            <button class="link-button" type="button" data-action="cancel-face-auth">Hủy và đăng nhập lại</button>
            <button class="btn" type="button" data-action="verify-admin-face" disabled>${enrolling ? 'Đăng ký và đăng nhập' : 'Xác thực và đăng nhập'}</button>
          </div>
          <p class="face-privacy">Ảnh được xử lý tạm thời và xóa sau khi suy luận. Hệ thống lưu vector đặc trưng khuôn mặt gắn với tài khoản, không lưu ảnh gốc. Muốn đăng ký lại, hãy nhờ quản trị viên khác đặt lại dữ liệu khuôn mặt.</p>
        </div>
      </section>
    </main>`;

  const status = document.querySelector('#face-camera-status');
  const verifyButton = document.querySelector('[data-action="verify-admin-face"]');
  const activeChallenge = state.faceChallenge;
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
    if (state.faceChallenge !== activeChallenge || !status.isConnected) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
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
  startAlertPolling();
  await navigate(state.page);
  toast('Đăng nhập thành công', 'Chào mừng bạn trở lại LaptopChildren.');
}

async function detectRole() {
  const profile = await api('/auth/me');
  try {
    state.adminStats = await api('/admin/stats');
    state.role = 'admin';
  } catch (error) {
    if (error.status !== 403) throw error;
    state.role = 'parent';
  }
  state.userName = profile.name || '';
  sessionStorage.setItem('lm_role', state.role);
}

function showLoginVerification(form, email) {
  const notice = form.querySelector('#login-verification');
  if (!notice || !form.isConnected || form.elements.email.value.trim() !== email.trim()) return;
  notice.dataset.email = email.trim();
  notice.querySelector('[data-verification-message]').textContent = 'Email chưa được xác minh. Bạn có thể yêu cầu gửi email xác minh ngay.';
  notice.querySelector('button').textContent = 'Xác minh email ngay';
  notice.classList.remove('hidden');
}

async function sendLoginVerification(form) {
  if (!form || form.dataset.verificationPending === 'true' || !form.reportValidity()) return;
  const notice = form.querySelector('#login-verification');
  const email = form.elements.email.value.trim();
  if (!notice || notice.dataset.email !== email) return;
  const button = notice.querySelector('button');
  const message = notice.querySelector('[data-verification-message]');
  form.dataset.verificationPending = 'true';
  button.disabled = true;
  button.textContent = 'Đang gửi…';
  try {
    await api('/auth/resend-verification', { method: 'POST', noAuth: true,
      body: { email, password: form.elements.password.value } });
    if (form.isConnected && form.elements.email.value.trim() === email) {
      message.textContent = 'Đã tiếp nhận yêu cầu gửi email xác minh. Hãy kiểm tra hộp thư và thư rác, mở liên kết trong email để xác minh, rồi đăng nhập lại.';
      button.textContent = 'Gửi lại email xác minh';
    }
  } catch (error) {
    if (form.isConnected && form.elements.email.value.trim() === email) {
      message.textContent = localizeError(error.message);
      button.textContent = 'Thử gửi lại email xác minh';
    }
  } finally {
    delete form.dataset.verificationPending;
    button.disabled = false;
  }
}

async function logout(callApi = true) {
  if (callApi) {
    try { await api('/auth/logout', { method: 'POST', body: { refreshToken: state.refreshToken } }); } catch { /* local logout continues */ }
  }
  clearSession();
  renderAuth('login');
}

export {
  captureAdminFaceFrames,
  clearSession,
  completeLogin,
  decodeJwt,
  detectRole,
  logout,
  renderAdminFaceVerification,
  renderAuth,
  saveSession,
  sendLoginVerification,
  showLoginVerification,
  stopFaceCamera,
};
