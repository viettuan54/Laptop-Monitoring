const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./queryAlertRenderer');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function context(api, settings = {}) {
  const sandbox = vm.createContext({ api: url => url.startsWith('/children') ? Promise.resolve([{ child_id: 7, name: '<Con>' }]) : api(url), state: { page: 'controls', selectedChildId: 7, children: [{ child_id: 7, name: '<Con>' }], devices: [] },
    controlRenderVersion: 0, encodeURIComponent, icons: { device: '', control: '', policy: '', activity: '' },
    reconcileSelectedId: id => id, isDeviceOnline: () => true, initials: () => 'C',
    pageHead: () => '', emptyState: () => '', settings,
    switchRow: (name, label, help, checked) => `<label>${label}<input type="checkbox" name="${name}" ${checked ? 'checked' : ''}>${help}</label>`,
  });
  vm.runInContext(['escapeHtml', 'formatDate', 'breakReminderHistoryMarkup', 'renderDeviceControls'].map(name => functionSource(source, name)).join('\n'), sandbox);
  return sandbox;
}

test('controls replace key logging, retain timing values and show accurate escaped receipts', async () => {
  const config = { child_id: 7, daily_limit_minutes: 120, allowed_start_time: '07:00', allowed_end_time: '21:00',
    enable_break_reminders: true, break_interval_minutes: 45, break_duration_minutes: 10 };
  const sandbox = context(async url => url.startsWith('/settings') ? config : url.startsWith('/devices') ? { data: [] } : {
    data: [{ device_name: '<img src=x>', event_type: 'acknowledged', duration_minutes: 10, occurred_at: '2026-10-12T04:00:00Z' }],
  });
  const content = {};
  await sandbox.renderDeviceControls(content);
  assert.match(content.innerHTML, /Nhắc nghỉ giải lao/);
  assert.doesNotMatch(content.innerHTML, /enable_keylog|Ghi nhận phím bấm|<img/);
  assert.match(content.innerHTML, /name="break_interval_minutes"[^>]*value="45"/);
  assert.match(content.innerHTML, /Trẻ chọn nghỉ ngay/);
  assert.match(content.innerHTML, /không xác nhận trẻ đã nghỉ/);
  assert.match(content.innerHTML, /&lt;img/);
});

test('history API failure leaves configuration usable and offers retry', async () => {
  const sandbox = context(async url => {
    if (url.startsWith('/logs/')) throw new Error('offline');
    return url.startsWith('/settings') ? { child_id: 7, allowed_start_time: '07:00', allowed_end_time: '21:00' } : { data: [] };
  });
  const content = {};
  await sandbox.renderDeviceControls(content);
  assert.match(content.innerHTML, /id="device-control-form"/);
  assert.match(content.innerHTML, /Chưa tải được lịch sử/);
  assert.match(content.innerHTML, /id="break-reminder-options"[^>]*disabled/);
});

test('late child response cannot replace the newly selected child controls', async () => {
  let finish;
  const sandbox = context(url => url.startsWith('/settings') ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ data: [] }));
  const content = { innerHTML: 'new child' };
  const pending = sandbox.renderDeviceControls(content);
  await new Promise(resolve => setImmediate(resolve));
  sandbox.state.selectedChildId = 8;
  finish({ child_id: 7 });
  await pending;
  assert.equal(content.innerHTML, 'new child');
});
