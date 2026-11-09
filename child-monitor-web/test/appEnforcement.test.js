const test = require('node:test');
const assert = require('node:assert/strict');
const { renderApplications } = require('./appEnforcementRenderer');

const log = { app_name: 'game.exe', category: 'entertainment', access_status: 'blocked', device_id: 7 };
const receipt = { ...log, occurred_at: '2026-10-10T01:00:00Z' };

test('application history and pagination precede visible enforcement receipts and their refresh action', async () => {
  const page = await renderApplications(async url => ({ data: url.includes('enforcement')
    ? [{ ...receipt, outcome: 'failed', reason: 'access_denied' }] : [log] }));
  const history = page.html.indexOf('class="table-card activity-history"');
  const pagination = page.html.indexOf('data-action="activity-page"');
  const enforcement = page.html.indexOf('class="card activity-enforcement"');
  const refresh = page.html.indexOf('data-action="refresh-app-enforcement"');
  assert.ok(history >= 0 && history < pagination && pagination < enforcement && enforcement < refresh);
  const section = page.html.slice(enforcement);
  assert.match(section, /aria-labelledby="app-enforcement-title"/);
  assert.match(section, /id="app-enforcement-title"/);
  assert.match(section, /Chặn thất bại/);
  assert.match(section, /Không đủ quyền đóng ứng dụng/);
  assert.match(section, /Chính sách yêu cầu chặn chưa xác nhận ứng dụng đã đóng/);
  assert.doesNotMatch(section, /<details|<summary|\bhidden\b/);
  assert.equal((page.html.match(/<strong>game\.exe<\/strong>/g) || []).length, 2);
});

test('enforcement outage remains visible after usable activity history with its existing retry', async () => {
  const page = await renderApplications(async url => {
    if (url.includes('enforcement')) throw Error('offline');
    return { data: [log] };
  });
  assert.ok(page.html.indexOf('activity-history') < page.html.indexOf('activity-enforcement'));
  assert.match(page.html, /role="status">Chưa tải được kết quả chặn. Nhấn Làm mới để thử lại/);
  assert.match(page.html, /data-action="refresh-app-enforcement"/);
  assert.match(page.html, /<strong>game\.exe<\/strong>/);
});
test('application policy never claims closure without an Agent receipt', async () => {
  const page = await renderApplications(async url => ({ data: url.includes('enforcement') ? [] : [log] }));
  assert.match(page.html, /Yêu cầu chặn/);
  assert.match(page.html, /Chưa có kết quả chặn trong phạm vi đã chọn/);
  assert.doesNotMatch(page.html, />Đã chặn<|>Đã đóng ứng dụng</);
});

test('receipt guidance distinguishes filtered results from missing receipts without applying policy status', async () => {
  const events = Array.from({ length: 12 }, (_, index) => ({ ...receipt, app_name: `Game ${index}`, outcome: 'closed' }));
  const api = async url => ({ data: url.includes('enforcement') ? events : [log] });
  const filtered = await renderApplications(api, { search: 'missing' });
  assert.match(filtered.html, /Không có kết quả chặn phù hợp/);
  assert.doesNotMatch(filtered.html, /Chưa có kết quả chặn trong phạm vi đã chọn|Chưa có kết quả chặn được gửi lên/);
  const categoryFiltered = await renderApplications(api, { category: 'learning' });
  assert.match(categoryFiltered.html, /Không có kết quả chặn phù hợp/);
  const policyFiltered = await renderApplications(api, { access_status: 'open' });
  assert.match(policyFiltered.html, /Tối đa 10 kết quả phù hợp trong 200 kết quả chặn gần nhất đã tải theo thiết bị và thời gian/);
  assert.match(policyFiltered.html, /Lọc thêm theo tìm kiếm và danh mục; không áp dụng bộ lọc Chính sách hiện tại/);
  assert.match(policyFiltered.html, /Chính sách yêu cầu chặn chưa xác nhận ứng dụng đã đóng/);
  assert.equal((policyFiltered.html.match(/<strong>Game \d+<\/strong>/g) || []).length, 10);
  assert.match(policyFiltered.html, /Game 9/);
  assert.doesNotMatch(policyFiltered.html, /Game 10/);
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
