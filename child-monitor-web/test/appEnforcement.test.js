const test = require('node:test');
const assert = require('node:assert/strict');
const { renderApplications } = require('./appEnforcementRenderer');

const log = { app_name: 'game.exe', category: 'entertainment', access_status: 'blocked', device_id: 7 };
const receipt = { ...log, occurred_at: '2026-10-10T01:00:00Z' };
test('application policy never claims closure without an Agent receipt', async () => {
  const page = await renderApplications(async url => ({ data: url.includes('enforcement') ? [] : [log] }));
  assert.match(page.html, /Yêu cầu chặn/);
  assert.match(page.html, /Chưa có kết quả chặn được gửi lên/);
  assert.doesNotMatch(page.html, />Đã chặn<|>Đã đóng ứng dụng</);
});
test('confirmed, failed and cancelled receipts remain distinct and escape application names', async () => {
  const events = [
    { ...receipt, outcome: 'closed', reason: 'terminated' },
    { ...receipt, app_name: '<img src=x onerror=alert(1)>', outcome: 'failed', reason: 'access_denied' },
    { ...receipt, outcome: 'cancelled', reason: 'policy_changed' },
  ];
  const page = await renderApplications(async url => ({ data: url.includes('enforcement') ? events : [log] }));
  for (const label of ['Đã đóng ứng dụng', 'Chặn thất bại', 'Đã hủy yêu cầu', 'Không đủ quyền đóng ứng dụng']) assert.ok(page.html.includes(label));
  assert.match(page.html, /&lt;img/);
  assert.doesNotMatch(page.html, /<img/);
});
test('receipt API failure preserves usage history and provides retry', async () => {
  const calls = [];
  const page = await renderApplications(async url => {
    calls.push(url);
    if (url.includes('enforcement')) throw new Error('offline');
    return { data: [log] };
  }, { device_id: '7', start: '2026-10-01T00:00', category: 'entertainment' });
  assert.match(page.html, /game.exe/);
  assert.match(page.html, /Chưa tải được kết quả chặn/);
  assert.match(page.html, /data-action="refresh-app-enforcement"/);
  assert.ok(calls.every(url => new URL(url, 'http://test').searchParams.get('device_id') === '7'));
});
