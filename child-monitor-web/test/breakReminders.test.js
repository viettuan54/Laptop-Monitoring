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
    AbortSignal, document: { querySelector: () => null },
    stopBreakReminderPolling: () => {}, startBreakReminderPolling: () => {},
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

function historyView(api, initial = { data: [] }) {
  const timers = new Map();
  let timerId = 0;
  const button = { disabled: false, focus() {} };
  const panel = { dataset: { childId: '7' }, innerHTML: '', attributes: {},
    querySelector: () => button,
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; } };
  const form = { interval: 45, duration: 10 }; // Unsaved edits must survive polling.
  const sandbox = vm.createContext({
    api, AbortSignal, encodeURIComponent,
    state: { page: 'controls', accessToken: 'fixture', selectedChildId: 7 },
    breakReminderRefreshTimer: null, breakReminderRefreshVersion: 0,
    breakReminderHistoryState: new WeakMap(),
    document: { hidden: false, querySelector: selector => selector === '#break-reminder-history' ? panel : form },
    setTimeout: (callback, ms) => { timers.set(++timerId, { callback, ms }); return timerId; },
    clearTimeout: id => timers.delete(id),
  });
  vm.runInContext(['escapeHtml', 'formatDate', 'breakReminderHistoryMarkup', 'stopBreakReminderPolling',
    'startBreakReminderPolling', 'refreshBreakReminderHistory'].map(name => functionSource(source, name)).join('\n'), sandbox);
  panel.innerHTML = sandbox.breakReminderHistoryMarkup(initial);
  sandbox.startBreakReminderPolling(panel, initial);
  return { sandbox, panel, button, form, timers, async tick() {
    const [id, timer] = timers.entries().next().value;
    timers.delete(id);
    assert.equal(timer.ms, 15_000);
    await timer.callback();
  } };
}

const snooze = { device_name: 'Laptop', event_type: 'snoozed', duration_minutes: 5,
  occurred_at: '2026-10-14T04:24:22Z' };

test('late Agent sync appears automatically without navigation or losing unsaved settings', async () => {
  let rows = [];
  const view = historyView(async () => ({ data: rows }));
  await view.tick();
  assert.match(view.panel.innerHTML, /hãy chờ đồng bộ/);
  rows = [snooze];
  await view.tick();
  assert.match(view.panel.innerHTML, /Nhắc lại sau 5 phút/);
  assert.deepEqual(view.form, { interval: 45, duration: 10 });
  assert.equal(view.timers.size, 1);
});

test('outage preserves last history and a later successful poll clears the error', async () => {
  let offline = true;
  const view = historyView(async () => {
    if (offline) throw new Error('backend unavailable');
    return { data: [snooze, { ...snooze, event_type: 'shown' }] };
  }, { data: [snooze] });
  await view.tick();
  assert.match(view.panel.innerHTML, /Nhắc lại sau 5 phút/);
  assert.match(view.panel.innerHTML, /Đang giữ dữ liệu/);
  assert.doesNotMatch(view.panel.innerHTML, /Chưa nhận được lịch sử/);
  assert.equal(view.button.disabled, false);
  offline = false;
  await view.tick();
  assert.match(view.panel.innerHTML, /Đã hiển thị lời nhắc/);
  assert.doesNotMatch(view.panel.innerHTML, /Đang giữ dữ liệu/);
});

test('history refresh pauses in hidden tabs and stops when leaving controls', async () => {
  let calls = 0;
  const view = historyView(async () => { calls++; return { data: [snooze] }; });
  view.sandbox.document.hidden = true;
  await view.tick();
  assert.equal(calls, 0);
  view.sandbox.document.hidden = false;
  await view.sandbox.refreshBreakReminderHistory({ background: true });
  assert.equal(calls, 1);
  view.sandbox.state.page = 'devices';
  await view.tick();
  assert.equal(calls, 1);
  assert.equal(view.timers.size, 0);
});

test('concurrent manual and scheduled refresh share one request and ignore a late child response', async () => {
  let finish;
  let calls = 0;
  const view = historyView((url, options) => {
    calls++;
    assert.equal(typeof options.signal.addEventListener, 'function');
    return new Promise(resolve => { finish = resolve; });
  });
  const first = view.sandbox.refreshBreakReminderHistory();
  const second = view.sandbox.refreshBreakReminderHistory();
  assert.equal(calls, 1);
  view.sandbox.state.selectedChildId = 8;
  view.panel.innerHTML = 'new child';
  finish({ data: [snooze] });
  await Promise.all([first, second]);
  assert.equal(view.panel.innerHTML, 'new child');
  assert.equal(view.panel.attributes['aria-busy'], undefined);
});

test('stopping history polling discards an in-flight response after logout', async () => {
  let finish;
  const view = historyView(() => new Promise(resolve => { finish = resolve; }));
  const pending = view.sandbox.refreshBreakReminderHistory();
  view.sandbox.stopBreakReminderPolling();
  view.sandbox.state.accessToken = '';
  view.panel.innerHTML = 'signed out';
  finish({ data: [snooze] });
  await pending;
  assert.equal(view.panel.innerHTML, 'signed out');
  assert.equal(view.timers.size, 0);
});

test('gateway outages show disconnected while successful requests restore the indicator', async () => {
  const statuses = [];
  let status = 502;
  const sandbox = vm.createContext({
    API: '/api', state: { accessToken: 'fixture' }, FormData,
    updateConnectionIndicator: value => statuses.push(value),
    fetch: async () => new Response(JSON.stringify({ message: 'fixture' }), {
      status, headers: { 'content-type': 'application/json' },
    }),
  });
  vm.runInContext(functionSource(source, 'api'), sandbox);
  for (status of [502, 503, 504]) await assert.rejects(sandbox.api('/logs/break-reminders'));
  status = 200;
  await sandbox.api('/logs/break-reminders');
  assert.deepEqual(statuses, ['offline', 'offline', 'offline', 'online']);
});
