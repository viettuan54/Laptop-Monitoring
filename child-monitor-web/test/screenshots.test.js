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
  const state = { page: 'activity', activityTab: 'screenshots', activityFilter: {}, activityOffset: 0,
    accessToken: 'test-token', activityViewRows: [], devices: [{ device_id: 7, device_name: 'Máy <test>' }] };
  const content = { innerHTML: '', isConnected: true, contains: () => true };
  const context = vm.createContext({ state, URLSearchParams, activityRenderVersion: 1,
    screenshotRefreshTimer: null, modalRoot: {}, icons: { refresh: '', device: '' },
    document: { hidden: false, activeElement: { matches: () => false } },
    setTimeout: callback => { timers.push(callback); return timers.length; }, clearTimeout: () => {},
    pageHead: (_page, actions) => actions,
    emptyState: (_icon, title, text, action = '') => `<div>${title}${text}${action}</div>`,
    api: async (...args) => { calls.push(args); return api(...args); }, toast: (...args) => calls.push(['toast', ...args]),
  });
  vm.runInContext(['escapeHtml', 'formatDate', 'deviceName', 'queryString', 'activityTabs',
    'screenshotDataUrl', 'stopScreenshotPolling', 'scheduleScreenshotRefresh', 'renderScreenshotActivity', 'startScreenshotCapture']
    .map(name => functionSource(source, name)).join('\n'), context);
  return { context, state, content, calls, timers };
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
  assert.match(page.content.innerHTML, /data-offset="12"/);
  assert.equal(page.calls[0][1].cache, 'no-store');
  const params = new URL(page.calls[0][0], 'http://test').searchParams;
  assert.equal(params.get('device_id'), '7');
  assert.match(params.get('start'), /Z$/);
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
