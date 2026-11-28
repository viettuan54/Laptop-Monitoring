import { clearSession, renderAuth, saveSession } from './auth.js';
import { formatDate } from './dates.js';
import { state } from './state.js';

const API = '/api';

let refreshPromise = null;

function updateConnectionIndicator(status) {
  state.connectionStatus = status;
  if (status === 'online') state.lastApiAt = new Date();
  const pill = document.querySelector('#connection-pill');
  if (!pill) return;
  pill.className = `connection-pill ${status}`;
  pill.title = status === 'online' && state.lastApiAt
    ? `Kết nối API gần nhất lúc ${formatDate(state.lastApiAt)}`
    : 'Trạng thái kết nối API';
  const label = pill.querySelector('span');
  if (label) {
    label.textContent = status === 'online' ? 'Backend đã kết nối' : status === 'offline' ? 'Mất kết nối Backend' : 'Đang kiểm tra';
  }
}

async function api(path, options = {}, retry = true) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const requestAccessToken = !options.noAuth ? state.accessToken : '';
  if (requestAccessToken) {
    headers.Authorization = `Bearer ${requestAccessToken}`;
  }
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers,
      body:
        options.body !== undefined && !(options.body instanceof FormData)
          ? JSON.stringify(options.body)
          : options.body,
    });
    updateConnectionIndicator([502, 503, 504].includes(response.status) ? 'offline' : 'online');
  } catch (error) {
    updateConnectionIndicator('offline');
    const connectionError = new Error('Không thể kết nối tới Backend. Hãy kiểm tra Backend và Cloudflare Tunnel.');
    connectionError.cause = error;
    throw connectionError;
  }
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : { message: await response.text() };

  if (response.status === 401 && retry && !options.noAuth && state.refreshToken && !path.includes('/auth/refresh')) {
    // Một request khác có thể vừa xoay token trong lúc request này còn đang bay.
    // Khi đó chỉ cần thử lại bằng access token mới, không tiêu thụ refresh token lần nữa.
    if (requestAccessToken && requestAccessToken !== state.accessToken) {
      return api(path, options, false);
    }
    const refreshed = await refreshSession();
    if (refreshed) return api(path, options, false);
  }
  if (!response.ok) {
    const error = new Error(payload.message || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function refreshSession() {
  if (refreshPromise) return refreshPromise;
  const refreshTokenAtStart = state.refreshToken;
  if (!refreshTokenAtStart) return false;

  refreshPromise = (async () => {
    try {
      const result = await api(
        '/auth/refresh',
        { method: 'POST', body: { refreshToken: refreshTokenAtStart }, noAuth: true },
        false
      );
      // Không khôi phục một phiên đã bị người dùng chủ động đăng xuất trong lúc refresh.
      if (state.refreshToken !== refreshTokenAtStart) return false;
      saveSession(result);
      return true;
    } catch {
      if (state.refreshToken === refreshTokenAtStart) {
        clearSession();
        renderAuth('login');
      }
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export { api };
