const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./queryAlertRenderer');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function dashboard(api) {
  const calls = [];
  const timers = [];
  const timerDelays = [];
  const state = { page: 'activity', activityTab: 'screenshots', activityFilter: {}, activityOffset: 0,
    accessToken: 'test-token', activityViewRows: [], devices: [{ device_id: 7, device_name: 'Máy <test>' }] };
  const content = { innerHTML: '', isConnected: true, contains: () => true };
  const context = vm.createContext({ state, URLSearchParams, activityRenderVersion: 1,
    screenshotRefreshTimer: null, modalRoot: {}, icons: { refresh: '', device: '' },
    document: { hidden: false, activeElement: { matches: () => false }, querySelector: () => null },
    setTimeout: (callback, delay) => { timers.push(callback); timerDelays.push(delay); return timers.length; }, clearTimeout: () => {},
    pageHead: (_page, actions) => actions,
    emptyState: (_icon, title, text, action = '') => `<div>${title}${text}${action}</div>`,
    api: async (...args) => { calls.push(args); return api(...args); }, toast: (...args) => calls.push(['toast', ...args]),
  });
  vm.runInContext(['escapeHtml', 'formatDate', 'deviceName', 'queryString', 'activityTabs', 'isDeviceOnline',
    'screenshotDataUrl', 'screenshotQuery', 'screenshotSignature', 'screenshotInteractionActive',
    'stopScreenshotPolling', 'scheduleScreenshotRefresh', 'renderScreenshotActivity', 'startScreenshotCapture',
    'confirmScreenshotDelete', 'confirmClearScreenshots', 'deleteScreenshots']
    .map(name => functionSource(source, name)).join('\n'), context);
  context.showModal = (...args) => { calls.push(['modal', ...args]); context.modalRoot.firstElementChild = {}; };
  context.closeModal = () => { context.modalRoot.firstElementChild = null; };
  return { context, state, content, calls, timers, timerDelays };
}

test('screenshot history renders beside app/web tabs with protected thumbnails and pagination', async () => {
  const page = dashboard(async () => ({ data: [{ screenshot_id: '9', device_id: 7,
    captured_at: '2026-10-08T05:00:00Z', width: 960, height: 540, thumbnail_base64: '/9j/\n/9k=' }],
    total: 13, capture_interval_seconds: 300, retention_days: 7 }));
  page.state.activityFilter = { device_id: '7', start: '2026-10-08T10:00', end: '2026-10-08T12:00' };
  await page.context.renderScreenshotActivity(page.content, 1);
  assert.match(page.content.innerHTML, /Ứng dụng/);
  assert.match(page.content.innerHTML, /Website/);
  assert.match(page.content.innerHTML, /Giám sát màn hình/);
  assert.match(page.content.innerHTML, /Chụp mỗi 5 phút/);
  assert.match(page.content.innerHTML, /Máy &lt;test&gt;/);
  assert.match(page.content.innerHTML, /data:image\/jpeg;base64,/);
  assert.match(page.content.innerHTML, /data-action="view-screenshot" data-id="9"/);
  assert.match(page.content.innerHTML, /data-action="delete-screenshot" data-id="9"/);
  assert.match(page.content.innerHTML, /data-action="clear-screenshots"/);
  assert.match(page.content.innerHTML, /data-offset="12"/);
  assert.equal(page.calls[0][1].cache, 'no-store');
  const params = new URL(page.calls[0][0], 'http://test').searchParams;
  assert.equal(params.get('device_id'), '7');
  assert.match(params.get('start'), /Z$/);
});

test('device badges trust the same backend presence as screenshots despite browser clock skew', async () => {
  const page = dashboard(async () => ({ data: [], total: 0,
    devices: [{ device_id: 7, enabled: true, online: true, pending_request_id: 'request' }] }));
  assert.equal(page.context.isDeviceOnline({ online: true, last_seen_at: '2000-01-01T00:00:00Z' }), true);
  assert.equal(page.context.isDeviceOnline({ online: false, last_seen_at: new Date().toISOString() }), false);
  assert.equal(page.context.isDeviceOnline({ last_seen_at: null }), false);
  await page.context.renderScreenshotActivity(page.content, 1);
  assert.match(page.content.innerHTML, /Đang chờ Agent chụp và gửi ảnh/);
  assert.doesNotMatch(page.content.innerHTML, /Thiết bị đang ngoại tuyến/);
});

test('enabled empty history starts capture instead of linking back to controls', async () => {
  const empty = dashboard(async () => ({ data: [], total: 0, devices: [{ device_id: 7, enabled: true, online: true }] }));
  await empty.context.renderScreenshotActivity(empty.content, 1);
  assert.match(empty.content.innerHTML, /Chưa có ảnh màn hình/);
  assert.match(empty.content.innerHTML, /data-action="start-screenshot" >Bắt đầu chụp ảnh/);
  assert.match(empty.content.innerHTML, /Giám sát đang bật/);
  assert.doesNotMatch(empty.content.innerHTML, /data-page="controls"/);
  const failed = dashboard(async () => { throw new Error('offline'); });
  await failed.context.renderScreenshotActivity(failed.content, 1);
  assert.match(failed.content.innerHTML, /data-action="refresh-screenshots"/);
});

test('pending and disabled monitoring are distinguished from an enabled empty gallery', async () => {
  for (const device of [{ enabled: false }, { enabled: true, pending_request_id: 'request' }]) {
    const page = dashboard(async () => ({ data: [], total: 0, devices: [{ device_id: 7, ...device }] }));
    await page.context.renderScreenshotActivity(page.content, 1);
    assert.match(page.content.innerHTML, /data-action="start-screenshot" disabled/);
    assert.match(page.content.innerHTML, device.enabled ? /Đang chờ ảnh/ : /Giám sát màn hình chưa bật/);
  }
});

test('capture targets visible device selection and clears dates that would hide new images', async () => {
  const page = dashboard(async () => ({ online: true }));
  page.state.screenshotDevices = [{ device_id: 7, enabled: true }, { device_id: 8, enabled: true }];
  page.state.activityFilter = { device_id: '7', start: '2026-10-01T00:00' };
  page.context.document.querySelector = selector => selector === '#screen-device' ? { value: '8' } : page.content;
  let rendered = false;
  page.context.renderActivity = async () => { rendered = true; };
  const button = { disabled: false, textContent: '', blur: () => {} };
  await page.context.startScreenshotCapture(button);
  assert.equal(page.calls[0][0], '/logs/screenshots/request');
  assert.equal(page.calls[0][1].body.device_id, 8);
  assert.equal(page.state.activityFilter.device_id, '8');
  assert.equal(page.state.activityFilter.start, undefined);
  assert.equal(rendered, true);
});

test('capture requires an explicit target with multiple devices and allows retry on failure', async () => {
  const page = dashboard(async () => { throw new Error('Agent unavailable'); });
  page.state.screenshotDevices = [{ device_id: 7 }, { device_id: 8 }];
  let focused = false;
  const select = { value: '', focus: () => { focused = true; } };
  page.context.document.querySelector = () => select;
  const button = { disabled: false, textContent: '' };
  await page.context.startScreenshotCapture(button);
  assert.equal(focused, true);
  assert.equal(page.calls[0][0], 'toast');
  select.value = '7';
  await page.context.startScreenshotCapture(button);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Bắt đầu chụp ảnh');
  assert.equal(page.calls.at(-1)[2], 'Agent unavailable');
});

test('late screenshot response cannot overwrite a new page or session', async () => {
  let resolve;
  const page = dashboard(() => new Promise(done => { resolve = done; }));
  const pending = page.context.renderScreenshotActivity(page.content, 1);
  page.context.activityRenderVersion = 2;
  resolve({ data: [], total: 0 });
  await pending;
  assert.equal(page.content.innerHTML, '');
  assert.equal(page.timers.length, 0);
});

test('automatic refresh allows main focus and pauses for hidden tabs or form interaction', async () => {
  const page = dashboard(async () => ({ data: [], total: 0 }));
  await page.context.renderScreenshotActivity(page.content, 1);
  await page.timers.pop()();
  assert.equal(page.calls.length, 2);
  page.context.document.hidden = true;
  await page.timers.pop()();
  assert.equal(page.calls.length, 2);
  page.context.document.hidden = false;
  page.context.document.activeElement.matches = () => true;
  await page.timers.pop()();
  assert.equal(page.calls.length, 2);
  assert.equal(page.context.screenshotDataUrl('javascript:alert(1)'), '');
});

test('pending capture checks metadata every two seconds without repeatedly fetching thumbnails', async () => {
  const result = { data: [], total: 0, latest_id: null, devices: [{ device_id: 7, enabled: true, pending_request_id: 'r' }] };
  const page = dashboard(async () => result);
  await page.context.renderScreenshotActivity(page.content, 1);
  assert.equal(page.timerDelays.at(-1), 2000);
  const html = page.content.innerHTML;
  // A previously clicked button must not pause updates indefinitely.
  page.context.document.activeElement.matches = selector => selector.split(',').some(item => item.trim() === 'button');
  await page.timers.pop()();
  assert.equal(page.calls.length, 2);
  assert.match(page.calls[1][0], /metadata=1/);
  assert.equal(page.content.innerHTML, html);
  result.total = 1;
  result.latest_id = '12';
  result.data = [{ screenshot_id: '12', device_id: 7, captured_at: new Date().toISOString(), thumbnail_base64: '/9j/AA==' }];
  result.devices[0].pending_request_id = null;
  await page.timers.pop()();
  assert.equal(page.calls.length, 4);
  assert.doesNotMatch(page.calls[3][0], /metadata=1/);
  assert.match(page.content.innerHTML, /data-id="12"/);
  assert.equal(page.timerDelays.at(-1), 15000);
});

test('poll failure keeps photos, backs off, and recovers without changing the filter', async () => {
  let fail = false;
  const page = dashboard(async () => { if (fail) throw new Error('offline'); return { data: [], total: 0 }; });
  await page.context.renderScreenshotActivity(page.content, 1);
  const html = page.content.innerHTML;
  fail = true;
  await page.timers.pop()();
  assert.equal(page.content.innerHTML, html);
  assert.equal(page.timerDelays.at(-1), 30000);
  fail = false;
  await page.timers.pop()();
  assert.equal(page.state.screenshotPollError, false);
  assert.equal(page.timerDelays.at(-1), 15000);
});

test('polling preserves dirty filters after blur and keyboard-focused controls', async () => {
  const page = dashboard(async () => ({ data: [], total: 0 }));
  await page.context.renderScreenshotActivity(page.content, 1);
  const values = { device_id: '7', start: '2026-10-09T10:00', end: '' };
  page.content.querySelector = () => ({ elements: { namedItem: name => ({ value: values[name] }) } });
  await page.timers.pop()();
  assert.equal(page.calls.length, 1, 'unapplied values survive even without input focus');
  page.state.activityFilter = { ...values };
  page.context.document.activeElement.matches = selector => selector.includes('button:focus-visible');
  await page.timers.pop()();
  assert.equal(page.calls.length, 1, 'keyboard-focused buttons must not be replaced');
  page.context.document.activeElement.matches = () => false;
  await page.timers.pop()();
  assert.equal(page.calls.length, 2);
});

test('deletion requires confirmation and uses the chosen image only', async () => {
  const page = dashboard(async () => ({ deleted: 1 }));
  page.state.screenshotRows = [{ screenshot_id: '9', device_id: 7, captured_at: '2026-10-09T02:00:00Z' }];
  page.context.confirmScreenshotDelete('9');
  assert.equal(page.calls[0][0], 'modal');
  assert.match(page.calls[0][3], /data-action="confirm-delete-screenshot" data-id="9"/);
  assert.equal(page.calls.some(call => call[0].startsWith('/logs/')), false);
  let rendered = false;
  page.context.renderActivity = async () => { rendered = true; };
  await page.context.deleteScreenshots({ dataset: { id: '9' } });
  assert.equal(page.calls[1][0], '/logs/screenshots/9');
  assert.equal(page.calls[1][1].method, 'DELETE');
  assert.equal(page.state.activityOffset, 0);
  assert.equal(rendered, true);
});

test('clear confirmation names the visible device and freezes its snapshot independent of date filters', async () => {
  const page = dashboard(async () => ({ scope_total: 5, scope_latest_id: '42' }));
  page.context.document.querySelector = () => ({ value: '7' });
  page.state.activityFilter = { device_id: '8', start: '2026-01-01' };
  await page.context.confirmClearScreenshots();
  const request = page.calls.find(call => call[0].startsWith('/logs/'));
  assert.match(request[0], /device_id=7/);
  assert.doesNotMatch(request[0], /start=/);
  const modal = page.calls.at(-1);
  assert.match(modal[2], /Máy <test>/);
  assert.match(modal[2], /ngoài bộ lọc thời gian/);
  assert.match(modal[3], /data-device-id="7" data-through-id="42"/);
  page.context.renderActivity = async () => {};
  await page.context.deleteScreenshots({ dataset: { deviceId: '7', throughId: '42' } }, true);
  const deletion = page.calls.find(call => call[1]?.method === 'DELETE');
  assert.equal(deletion[0], '/logs/screenshots?device_id=7');
  assert.equal(deletion[1].body.through_id, '42');
  assert.equal(deletion[1].body.confirm_all, true);
});

test('failed deletion preserves confirmation and stale deletion completion cannot replace another page', async () => {
  const page = dashboard(async () => { throw new Error('offline'); });
  const modal = {};
  page.context.modalRoot.firstElementChild = modal;
  await assert.rejects(page.context.deleteScreenshots({ dataset: { id: '9' } }), /offline/);
  assert.equal(page.context.modalRoot.firstElementChild, modal);
  let resolve;
  const late = dashboard(() => new Promise(done => { resolve = done; }));
  late.context.modalRoot.firstElementChild = modal;
  const deletion = late.context.deleteScreenshots({ dataset: { id: '9' } });
  late.context.activityRenderVersion = 2;
  resolve({ deleted: 1 });
  await deletion;
  assert.equal(late.context.modalRoot.firstElementChild, modal);
  assert.equal(late.calls.length, 1);
});
