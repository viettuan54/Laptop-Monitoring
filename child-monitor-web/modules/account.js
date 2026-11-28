import { api } from './api.js';
import { escapeHtml } from './format.js';
import { state } from './state.js';
import { pageHead } from './ui.js';

function pushPlatformOptions(provider, selected = '') {
  const platforms = provider === 'expo'
    ? [['android', 'Android'], ['ios', 'iOS']]
    : [['android', 'Android'], ['ios', 'iOS'], ['web', 'Web']];
  const selectedValue = platforms.some(([value]) => value === selected) ? selected : platforms[0][0];
  return platforms.map(([value, label]) => `<option value="${value}" ${value === selectedValue ? 'selected' : ''}>${label}</option>`).join('');
}

function syncPushPlatforms(form) {
  const provider = form?.elements.provider?.value;
  const platform = form?.elements.platform;
  if (!provider || !platform) return;
  platform.innerHTML = pushPlatformOptions(provider, platform.value);
}

async function renderAccount(content) {
  const profile = await api('/auth/me');
  const displayName = escapeHtml(profile.name || 'Chưa cập nhật họ tên');
  if (state.role === 'parent') {
    const result = await api('/notifications/tokens');
    state.pushTokens = result.data || [];
  } else {
    state.pushTokens = [];
  }
  if (state.role === 'admin') {
    content.innerHTML = `
      <div id="account-surface" class="is-admin-account">
      ${pageHead('account')}
      <section class="account-grid admin-account-grid">
        <div class="stack">
          <article class="card card-pad admin-profile-card">
            <div class="admin-profile-header">
              <div class="profile-avatar admin-profile-avatar">AD</div>
              <div class="admin-profile-copy">
                <h2>Tài khoản quản trị viên</h2>
                <p class="muted">Họ tên: ${displayName} · Quyền Admin Console (JWT + Face Verification).</p>
              </div>
              <span class="badge blue">Quản trị viên</span>
            </div>
            <div class="admin-profile-meta">
              <div><small>Phiên làm việc</small><strong>JWT 15 phút &amp; Refresh token luân phiên</strong></div>
              <div><small>Bảo mật bổ sung</small><strong>Xác thực khuôn mặt khi đăng nhập</strong></div>
            </div>
          </article>
          <article class="card card-pad account-password-card">
            <div class="card-head card-head-flush"><div><h2>Đổi mật khẩu</h2><p>Thao tác này thu hồi toàn bộ phiên đăng nhập cũ và đăng xuất tab hiện tại.</p></div></div>
            <form id="change-password-form" class="form-grid">
              <div class="field full"><label>Mật khẩu hiện tại</label><input class="input" type="password" name="oldPassword" required autocomplete="current-password" placeholder="Nhập mật khẩu hiện tại"></div>
              <div class="field full"><label>Mật khẩu mới</label><input class="input" type="password" name="newPassword" required minlength="8" maxlength="72" autocomplete="new-password" placeholder="Tối thiểu 8 ký tự"><small>Cần chữ hoa, số và ký tự đặc biệt (tối đa 72 byte).</small></div>
              <div class="form-actions field full"><button class="btn" type="submit">Cập nhật mật khẩu</button></div>
            </form>
          </article>
        </div>
        <aside class="stack account-aside">
          <article class="card card-pad account-session-card">
            <p class="eyebrow">Phiên làm việc</p>
            <h2>Phiên đăng nhập hiện tại</h2>
            <p class="muted">Thông tin phiên chỉ lưu tạm trong tab trình duyệt hiện tại và tự động xóa khi đóng trình duyệt.</p>
            <div class="account-aside-actions"><button class="btn btn-secondary" type="button" data-action="logout">Đăng xuất phiên này</button></div>
          </article>
          <article class="card danger-zone">
            <div class="card-head"><div><h2>Vùng nguy hiểm</h2><p>Chỉ có thể xóa khi còn quản trị viên khác đang hoạt động và đã xác minh email. Thao tác xóa là vĩnh viễn.</p></div></div>
            <div class="card-body"><button class="btn btn-danger" type="button" data-action="delete-account">Xóa tài khoản</button></div>
          </article>
        </aside>
      </section>
      </div>`;
    return;
  }
  content.innerHTML = `
    <div id="account-surface">
    ${pageHead('account')}
    <section class="account-grid">
      <div class="stack">
        <article class="card profile-card"><figure class="profile-cover"><img src="/assets/section-account-security.jpg" alt="Tài khoản gia đình được bảo vệ bằng mật khẩu và thiết bị tin cậy" width="1200" height="800" loading="lazy" decoding="async"></figure><div class="profile-body"><div class="profile-avatar">PH</div><div class="profile-copy"><p class="eyebrow">Hồ sơ gia đình</p><h2>Tài khoản phụ huynh</h2><p class="muted">Họ tên: ${displayName} · Phiên đăng nhập được bảo vệ bằng cơ chế làm mới định kỳ.</p></div></div></article>
        <article class="card card-pad account-password-card">
          <div class="card-head card-head-flush"><div><h2>Đổi mật khẩu</h2><p>Thao tác này thu hồi toàn bộ phiên đăng nhập cũ và đăng xuất tab hiện tại để bảo vệ tài khoản.</p></div></div>
          <form id="change-password-form" class="form-grid">
            <div class="field full"><label>Mật khẩu hiện tại</label><input class="input" type="password" name="oldPassword" required autocomplete="current-password" placeholder="Nhập mật khẩu hiện tại"></div>
            <div class="field full"><label>Mật khẩu mới</label><input class="input" type="password" name="newPassword" required minlength="8" maxlength="72" autocomplete="new-password" placeholder="Tối thiểu 8 ký tự"><small>Cần chữ hoa, số và ký tự đặc biệt (tối đa 72 byte).</small></div>
            <div class="form-actions field full"><button class="btn" type="submit">Cập nhật mật khẩu</button></div>
          </form>
        </article>
        <article class="card card-pad push-settings">
          <div class="card-head card-head-flush"><div><h2>Thiết bị nhận thông báo</h2><p>Quản lý thiết bị nhận cảnh báo an toàn từ AI và Windows Agent theo thời gian thực.</p></div><button class="btn btn-secondary btn-sm" type="button" data-action="test-push" ${state.pushTokens.some((item) => item.is_active) ? '' : 'disabled'}>Gửi thử</button></div>
          <div class="push-token-list">${state.pushTokens.map((item) => `<div class="push-token-row"><div class="list-icon" aria-hidden="true">${item.provider === 'expo' ? 'EX' : 'FC'}</div><div class="list-copy"><strong>${escapeHtml(item.device_name || 'Thiết bị không tên')}</strong><small>${escapeHtml(item.provider.toUpperCase())} · ${escapeHtml(item.platform)} · ${escapeHtml(item.token_hint)}</small>${item.last_error ? `<small class="text-danger">${escapeHtml(item.last_error)}</small>` : ''}</div><span class="badge ${item.is_active ? '' : 'red'}">${item.is_active ? 'Đang nhận' : 'Đã tắt'}</span><button class="kebab danger" type="button" data-action="delete-push-token" data-id="${item.push_token_id}" title="Gỡ thiết bị ${escapeHtml(item.device_name || 'không tên')}" aria-label="Gỡ thiết bị ${escapeHtml(item.device_name || 'không tên')}">×</button></div>`).join('') || '<p class="push-token-empty">Chưa có thiết bị nhận thông báo nào được đăng ký.</p>'}</div>
          <div class="push-form-section">
            <div class="push-form-head"><h3>Đăng ký thiết bị nhận thông báo mới</h3><p class="muted">Nhập mã thông báo (Expo hoặc Firebase FCM) nếu bạn muốn liên kết thủ công một thiết bị.</p></div>
            <form id="push-token-form" class="form-grid push-token-form">
              <div class="field"><label>Nhà cung cấp</label><select class="select" name="provider"><option value="expo">Expo</option><option value="fcm">Firebase FCM</option></select></div>
              <div class="field"><label>Nền tảng</label><select class="select" name="platform">${pushPlatformOptions('expo')}</select><small>Expo hỗ trợ Android/iOS; FCM hỗ trợ thêm Web.</small></div>
              <div class="field full"><label>Tên thiết bị</label><input class="input" name="device_name" maxlength="100" placeholder="Ví dụ: Điện thoại của mẹ"></div>
              <div class="field full"><label>Push token</label><textarea class="textarea" name="token" maxlength="4096" required autocomplete="off" placeholder="ExponentPushToken[...] hoặc FCM registration token"></textarea><small>Token chỉ được gửi đến backend qua HTTPS và không hiển thị lại đầy đủ.</small></div>
              <div class="form-actions field full"><button class="btn" type="submit">Đăng ký thiết bị nhận thông báo</button></div>
            </form>
          </div>
        </article>
      </div>
      <aside class="stack account-aside">
        <article class="card card-pad account-session-card">
          <p class="eyebrow">Phiên đăng nhập</p>
          <h2>Phiên đăng nhập hiện tại</h2>
          <p class="muted">Thông tin phiên chỉ lưu tạm trong tab trình duyệt này và tự động xóa khi bạn đóng tab.</p>
          <div class="account-aside-actions"><button class="btn btn-secondary" type="button" data-action="logout">Đăng xuất phiên này</button></div>
        </article>
        <article class="card danger-zone">
          <div class="card-head"><div><h2>Vùng nguy hiểm</h2><p>Xóa vĩnh viễn tài khoản cùng hồ sơ trẻ, thiết bị và toàn bộ dữ liệu liên quan.</p></div></div>
          <div class="card-body"><button class="btn btn-danger" type="button" data-action="delete-account">Xóa tài khoản</button></div>
        </article>
      </aside>
    </section>
    </div>`;
}

export { renderAccount, syncPushPlatforms };
