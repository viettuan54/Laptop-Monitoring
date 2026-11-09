const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./queryAlertRenderer');
const { activityDOM, activityHelpers } = require('./appEnforcementRenderer');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

test('screenshot typography keeps readable roles without changing the gallery or capture layout', () => {
  const rule = selector => Object.fromEntries([...styles.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some(value => value.trim() === selector))
    .flatMap(([, , body]) => body.split(';').filter(value => value.includes(':')).map(value => {
      const colon = value.indexOf(':'); return [value.slice(0, colon).trim(), value.slice(colon + 1).trim()];
    })));
  const roles = [
    ['.screen-monitor-intro h2', '1.125rem', '600', '1.4'],
    ['.screen-monitor-intro p', '1rem', '400', '1.6'],
    ['#screenshot-capture-status', '1rem', '400', '1.6'],
    ['#screenshot-capture-scope', '1rem', '400', '1.6'],
    ['.screen-monitor-intro .screen-monitor-policy', '0.875rem', '400', '1.5'],
    ['.screen-monitor-summary', '0.875rem', '400', '1.5'],
    ['.screenshot-pagination', '0.875rem', '400', '1.5'],
    ['.screenshot-card time', '0.875rem', '400', '1.5'],
    ['.screenshot-card figcaption strong', '1rem', '600', '1.45'],
    ['.screenshot-preview span', '0.875rem', '600', '1.5'],
  ];
  for (const [selector, size, weight, leading] of roles) {
    const declarations = rule(`#activity-surface ${selector}`);
    assert.equal(declarations['font-size'], size, selector);
    assert.equal(declarations['font-weight'], weight, selector);
    assert.equal(declarations['line-height'], leading, selector);
  }
  // The policy class selector includes its parent so it beats the intro paragraph rule.
  assert.equal(rule('#activity-surface .screen-monitor-policy')['font-size'], undefined);
  assert.equal(rule('#activity-surface #screenshot-capture-controls .form-actions')['margin-top'], '12px');
  assert.equal(rule('#activity-surface .screenshot-pagination')['flex-wrap'], 'wrap');
  assert.equal(rule('.screenshot-preview img')['aspect-ratio'], '16 / 10');
  assert.deepEqual(rule('#activity-surface .screenshot-preview img'), {});
  assert.deepEqual(rule('#activity-surface .screenshot-grid'), {});
  assert.deepEqual(rule('#activity-surface .btn-sm'), { 'min-height': '44px' });
  assert.equal(rule('#activity-surface .activity-tabs .tab')['min-height'], '44px');
  assert.equal(rule('#activity-surface .screenshot-pagination > div')['flex-wrap'], 'wrap');
  assert.equal(rule('#activity-surface .screenshot-pagination > div > button')['flex-shrink'], '0');
  assert.equal(rule('.screenshot-delete')['flex-shrink'], '0');
});

test('screenshot focus retains its outline and capture disabled states remain state-driven', () => {
  assert.match(styles, /\.screenshot-preview:focus-visible\s*\{\s*outline: 3px solid var\(--primary-ring\);\s*outline-offset: 3px;\s*\}/);
  assert.match(styles, /#activity-surface :is\(button, a, \.input, \.select, \[tabindex\]\):focus-visible\s*\{\s*outline-color: var\(--forest\);\s*\}/);
  const page = dashboard(async () => ({ data: [] }));
  const monitor = { device_id: 7, enabled: true };
  page.state.screenshotDevices = [monitor];
  for (const [target, operation, disabled] of [
    [null, null, true],
    [{ ...monitor, enabled: false }, null, false],
    [monitor, null, false],
    [{ ...monitor, pending_request_id: 'pending' }, null, true],
    [monitor, { enabled: true }, true],
    [monitor, { enabled: false }, true],
  ]) {
    page.state.screenshotControlOperation = operation;
    const html = page.context.screenshotCaptureControls(target);
    const start = html.match(/<button\b[^>]*data-action="start-screenshot"[^>]*>/)[0];
    assert.match(start, /class="btn"/);
    assert.equal(/\bdisabled\b/.test(start), disabled);
    assert.match(html, /class="btn btn-secondary" data-action="stop-screenshot"/);
    assert.match(html, /aria-describedby="screenshot-capture-scope"/);
    assert.match(html, /id="screenshot-capture-status" role="status"/);
  }
  assert.equal(page.calls.length, 0, 'presentation checks must not send capture requests');
});

test('long photo device names and capture scope remain complete with existing image actions', async () => {
  const device = 'Máy học tập của Nguyễn Thị Minh Anh & gia đình '.repeat(12);
  const page = dashboard(async () => ({ data: [{ screenshot_id: '55', device_id: 7, width: 960, height: 540,
    captured_at: '2026-10-08T05:00:00Z' }], total: 1, devices: [{ device_id: 7, enabled: true }] }));
  page.state.devices[0].device_name = device;
  await page.context.renderScreenshotActivity(page.content, 1);
  const html = page.content.innerHTML;
  assert.ok(html.includes(`<strong>${page.context.escapeHtml(device)}</strong>`));
  assert.ok(html.includes(`Chụp ngay: ${page.context.escapeHtml(device)}`));
  assert.match(html, /width="960" height="540"/);
  assert.match(html, /<time datetime="2026-10-08T05:00:00Z">/);
  assert.match(html, /data-action="view-screenshot" data-id="55"/);
  assert.match(html, /data-action="delete-screenshot" data-id="55"/);
  assert.match(html, /id="screenshot-capture-status" role="status"/);
  assert.match(html, /aria-describedby="screenshot-capture-scope"/);
  const smallButtons = [...html.matchAll(/<button\b[^>]*class="[^"]*\bbtn-sm\b[^"]*"[^>]*>/g)]
    .map(([tag]) => tag.match(/data-action="([^"]+)"/)[1]);
  assert.deepEqual(smallButtons, ['delete-screenshot', 'activity-page', 'activity-page']);
});

function dashboard(api) {
  const calls = [];
  const timers = [];
  const timerDelays = [];
  const state = { page: 'activity', activityTab: 'screenshots', activityFilter: {}, activityOffset: 0,
    accessToken: 'test-token', activityViewRows: [], devices: [{ device_id: 7, child_id: 3, device_name: 'Máy <test>' }] };
  const { content, document } = activityDOM();
  // Existing interaction tests supply their own focused controls and dirty form.
  content.contains = () => true;
  const query = content.querySelector.bind(content);
  content.querySelector = selector => selector === '#activity-filter' ? null : query(selector);
  const context = vm.createContext({ state, URLSearchParams, activityRenderVersion: 1,
    screenshotRefreshTimer: null, modalRoot: {}, icons: { refresh: '', device: '' },
    document,
    setTimeout: (callback, delay) => { timers.push(callback); timerDelays.push(delay); return timers.length; }, clearTimeout: () => {},
    pageHead: (_page, actions) => actions,
    emptyState: (_icon, title, text, action = '') => `<div>${title}${text}${action}</div>`,
    api: async (...args) => { calls.push(args); return api(...args); }, toast: (...args) => calls.push(['toast', ...args]),
  });
  vm.runInContext([...activityHelpers, 'escapeHtml', 'formatDate', 'deviceName', 'queryString', 'activityTabs', 'isDeviceOnline',
    'screenshotDataUrl', 'screenshotQuery', 'screenshotSignature', 'screenshotInteractionActive',
    'stopScreenshotPolling', 'scheduleScreenshotRefresh', 'renderScreenshotActivity', 'startScreenshotCapture',
    'stopScreenshotCapture', 'setScreenshotCapture', 'screenshotCaptureTarget', 'screenshotCaptureControls',
    'updateScreenshotCaptureControls', 'updateScreenshotCapturePolicy',
    'confirmScreenshotDelete', 'confirmClearScreenshots', 'deleteScreenshots', 'viewScreenshot']
    .map(name => functionSource(source, name)).join('\n'), context);
  context.modalRoot.querySelector = selector => context.modalRoot.firstElementChild?.querySelector(selector) || null;
  context.showModal = (...args) => {
    calls.push(['modal', ...args]);
    context.modalRoot.firstElementChild = screenshotModalDOM('', context.document);
  };
  context.closeModal = () => { context.modalRoot.firstElementChild = null; };
  return { context, state, content, calls, timers, timerDelays };
}

// Minimal identity/focus model; no browser geometry or layout is simulated.
function screenshotModalDOM(html, document) {
  const classes = new Set(['modal']);
  const controls = [...html.matchAll(/<button\b([^>]*)>/g)].map(([, attrs]) => ({
    isConnected: true, disabled: /\bdisabled\b/.test(attrs),
    dataset: { action: attrs.match(/data-action="([^"]+)"/)?.[1] },
    matches: () => false,
    closest(selector) { return selector === '[data-action]' ? this : null; },
    focus() { document.activeElement = this; },
  }));
  const description = { textContent: '' }, body = { innerHTML: '' };
  const modal = {
    classList: { add: (...names) => names.forEach(name => classes.add(name)), contains: name => classes.has(name) },
    querySelector: () => controls.find(control => !control.disabled) || null,
    querySelectorAll: () => controls.filter(control => !control.disabled),
    focus() { document.activeElement = this; },
  };
  const backdrop = {
    modal, controls, listeners: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    querySelector(selector) {
      return selector === '.modal' ? modal : selector === '.modal-backdrop' ? this
        : selector === '#modal-description' ? description : selector === '.modal-body' ? body : null;
    },
  };
  return backdrop;
}

function realScreenshotDialogs(api) {
  const page = dashboard(api);
  const { context } = page;
  const frames = [], opened = [], listeners = {};
  let html = '';
  Object.defineProperty(context.modalRoot, 'innerHTML', {
    get: () => html,
    set(value) {
      const previous = context.modalRoot.firstElementChild;
      for (const control of previous?.controls || []) control.isConnected = false;
      html = value;
      context.modalRoot.firstElementChild = value ? screenshotModalDOM(value, context.document) : null;
      if (value) opened.push(context.modalRoot.firstElementChild);
    },
  });
  context.app = { inert: false };
  context.modalReturnFocus = null;
  context.deviceModalDismissBlocked = () => false;
  context.requestAnimationFrame = callback => frames.push(callback);
  context.document.addEventListener = (type, callback) => { listeners[type] = callback; };
  vm.runInContext(['showModal', 'closeModal'].map(name => functionSource(source, name)).join('\n'), context);
  vm.runInContext(source.slice(source.indexOf('async function handleClick(event)'),
    source.indexOf("\ndocument.addEventListener('submit'", source.indexOf('async function handleClick(event)'))), context);
  vm.runInContext(source.slice(source.indexOf("document.addEventListener('keydown', (event) => {"),
    source.indexOf("document.addEventListener('visibilitychange', refreshAlertIndicatorInBackground)")), context);
  return { ...page, opened,
    flush() { while (frames.length) frames.shift()(); },
    key(key, shiftKey = false) { listeners.keydown({ key, shiftKey, target: context.document.activeElement,
      preventDefault() {} }); },
  };
}

test('image dialog close target is scoped and leaves shared dimensions and focus unchanged', () => {
  const rules = [...styles.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const specific = rules.filter(([, selector]) => selector.includes('activity-screenshot-dialog'));
  assert.equal(specific.length, 1);
  assert.equal(specific[0][1].trim(), '#modal-root .activity-screenshot-dialog .modal-close');
  assert.equal(specific[0][2].trim().replaceAll('\r\n', '\n'), 'min-width: 44px;\n  min-height: 44px;\n  flex-shrink: 0;');
  assert.match(styles, /\.modal-close\s*\{\s*width: 36px;\s*height: 36px;/);
  assert.match(styles, /\.modal\.screenshot-modal\s*\{\s*width: min\(1200px, 100%\);/);
  assert.match(styles, /\[tabindex\]:focus-visible\s*\{\s*outline: 3px solid var\(--primary-ring\);\s*outline-offset: 3px;/);
});

for (const fails of [false, true]) {
  test(`image viewer marks only its new modal and retains it on ${fails ? 'failure' : 'success'}`, async () => {
    let resolve, reject;
    const request = new Promise((yes, no) => { resolve = yes; reject = no; });
    const page = realScreenshotDialogs(() => request);
    const pending = page.context.viewScreenshot('9');
    const backdrop = page.context.modalRoot.firstElementChild;
    for (const name of ['screenshot-modal', 'activity-screenshot-dialog']) assert.ok(backdrop.modal.classList.contains(name));
    assert.match(page.context.modalRoot.innerHTML, /role="dialog" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description"/);
    assert.equal(page.calls[0][0], '/logs/screenshots/9');
    if (fails) reject(Object.assign(Error('missing'), { status: 404 }));
    else resolve({ device_id: 7, captured_at: '2026-10-09T02:00:00Z', image_base64: '/9j/' });
    await pending;
    assert.equal(page.context.modalRoot.firstElementChild, backdrop);
    assert.equal(page.opened.length, 1);
    assert.ok(backdrop.modal.classList.contains('activity-screenshot-dialog'));
    if (fails) assert.match(backdrop.querySelector('#modal-description').textContent, /Ảnh đã hết hạn/);
    else assert.match(backdrop.querySelector('.modal-body').innerHTML, /class="screenshot-full"/);
  });
}

for (const branch of ['empty', 'confirm', 'error']) {
  test(`clear images tags fresh loading and ${branch} dialogs without changing request scope`, async () => {
    let resolve, reject;
    const page = realScreenshotDialogs(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    page.context.document.querySelector = () => ({ value: '7' });
    const pending = page.context.confirmClearScreenshots();
    const loading = page.context.modalRoot.firstElementChild;
    assert.ok(loading.modal.classList.contains('activity-screenshot-dialog'));
    if (branch === 'error') reject(Error('offline'));
    else resolve(branch === 'empty' ? {} : { scope_total: 5, scope_latest_id: '42' });
    await pending;
    const final = page.context.modalRoot.firstElementChild;
    assert.notEqual(final, loading);
    assert.equal(page.opened.length, 2);
    for (const backdrop of page.opened) {
      assert.ok(backdrop.modal.classList.contains('activity-screenshot-dialog'));
      assert.equal(backdrop.modal.classList.contains('screenshot-modal'), false);
    }
    assert.equal(page.calls.length, 1);
    assert.match(page.calls[0][0], /device_id=7/);
    assert.match(page.calls[0][0], /metadata=1/);
    assert.match(page.context.modalRoot.innerHTML, branch === 'empty' ? /Không có ảnh để xóa/
      : branch === 'error' ? /Chưa tải được phạm vi xóa/ : /data-through-id="42"/);
  });
}

test('pending and failed deletion retain the marked dialog; success closes it without creating another', async () => {
  for (const all of [false, true]) {
    for (const fails of [false, true]) {
      let resolve, reject;
      const page = realScreenshotDialogs((_endpoint, options) => options?.method === 'DELETE'
        ? new Promise((yes, no) => { resolve = yes; reject = no; })
        : Promise.resolve({ scope_latest_id: '42', scope_total: 1 }));
      page.context.renderActivity = async () => {};
      page.state.screenshotRows = [{ screenshot_id: '9', device_id: 7 }];
      if (all) await page.context.confirmClearScreenshots();
      else page.context.confirmScreenshotDelete('9');
      const modal = page.context.modalRoot.firstElementChild;
      const count = page.opened.length;
      const pending = page.context.deleteScreenshots({ dataset: { id: '9', deviceId: '7', throughId: '42' } }, all);
      assert.equal(page.context.modalRoot.firstElementChild, modal);
      assert.ok(modal.modal.classList.contains('activity-screenshot-dialog'));
      if (fails) {
        reject(Error('offline'));
        await assert.rejects(pending, /offline/);
        assert.equal(page.context.modalRoot.firstElementChild, modal);
        assert.ok(modal.modal.classList.contains('activity-screenshot-dialog'));
      } else {
        resolve({ deleted: 1 });
        await pending;
        assert.equal(page.context.modalRoot.firstElementChild, null);
      }
      assert.equal(page.opened.length, count);
    }
  }
});

test('image marking does not leak to unrelated, blocked or late replacement dialogs', async () => {
  for (const operation of ['view', 'single', 'clear']) {
    const page = realScreenshotDialogs(async () => ({ scope_latest_id: '42', scope_total: 1 }));
    page.context.showModal('Unrelated dialog', '', '');
    const unrelated = page.context.modalRoot.firstElementChild;
    page.context.deviceModalDismissBlocked = () => true;
    page.state.screenshotRows = [{ screenshot_id: '9', device_id: 7 }];
    if (operation === 'view') await page.context.viewScreenshot('9');
    else if (operation === 'single') page.context.confirmScreenshotDelete('9');
    else await page.context.confirmClearScreenshots();
    assert.equal(page.context.modalRoot.firstElementChild, unrelated);
    assert.equal(unrelated.modal.classList.contains('activity-screenshot-dialog'), false);
    assert.equal(unrelated.modal.classList.contains('screenshot-modal'), false);
  }
  for (const fails of [false, true]) {
    let resolve, reject;
    const page = realScreenshotDialogs(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    const pending = page.context.confirmClearScreenshots();
    page.context.showModal('Unrelated replacement', '', '');
    const replacement = page.context.modalRoot.firstElementChild;
    if (fails) reject(Error('offline')); else resolve({ scope_latest_id: '42' });
    await pending;
    assert.equal(page.context.modalRoot.firstElementChild, replacement);
    assert.equal(replacement.modal.classList.contains('activity-screenshot-dialog'), false);
    assert.equal(page.opened.length, 2);
  }
});

for (const method of ['button', 'Escape', 'backdrop']) {
  test(`single-image dialog retains focus trap and closes through ${method}`, async () => {
    const page = realScreenshotDialogs(async () => ({}));
    const opener = { isConnected: true, focus() { page.context.document.activeElement = this; } };
    page.context.document.activeElement = opener;
    page.state.screenshotRows = [{ screenshot_id: '9', device_id: 7 }];
    page.context.confirmScreenshotDelete('9');
    const backdrop = page.context.modalRoot.firstElementChild;
    assert.ok(backdrop.modal.classList.contains('activity-screenshot-dialog'));
    assert.equal(backdrop.modal.classList.contains('screenshot-modal'), false);
    page.flush();
    const first = backdrop.controls[0], last = backdrop.controls.at(-1);
    assert.equal(page.context.document.activeElement, first);
    page.key('Tab', true);
    assert.equal(page.context.document.activeElement, last);
    page.key('Tab');
    assert.equal(page.context.document.activeElement, first);
    if (method === 'button') await page.context.handleClick({ target: first });
    else if (method === 'Escape') page.key('Escape');
    else backdrop.listeners.click({ target: backdrop });
    page.flush();
    assert.equal(page.context.modalRoot.firstElementChild, null);
    assert.equal(page.context.app.inert, false);
    assert.equal(page.context.document.activeElement, opener);
    assert.equal(page.calls.length, 0, 'closing a confirmation sends no delete request');
  });
}

test('scoped screenshot layout wraps pagination and spaces the actual nested capture action group', async () => {
  const rule = selector => [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some(value => value.trim() === selector))
    .map(([, , declarations]) => declarations).join('\n');
  for (const selector of ['#activity-surface .screenshot-pagination', '#activity-surface .screenshot-pagination > div']) {
    assert.match(rule(selector), /flex-wrap: wrap/);
    assert.doesNotMatch(rule(selector), /\border\s*:|flex-direction/);
  }
  assert.match(rule('#activity-surface .screenshot-pagination > div > button'), /flex-shrink: 0/);
  assert.match(rule('#activity-surface #screenshot-capture-controls .form-actions'), /margin-top: 12px/);
  const page = dashboard(async () => ({ data: [{ screenshot_id: '21', device_id: 7, width: 960, height: 540 }],
    total: 100001, devices: [{ device_id: 7, enabled: true }] }));
  page.state.activityOffset = 99996;
  await page.context.renderScreenshotActivity(page.content, 1);
  const html = page.content.innerHTML;
  assert.match(html, /<section id="screenshot-capture-controls"[^>]*><div class="form-actions form-actions-start"/);
  assert.match(html, /aria-describedby="screenshot-capture-scope"/);
  assert.match(html, /id="screenshot-capture-scope"/);
  const pagination = html.match(/<nav class="screenshot-pagination"[^>]*>([\s\S]*?)<\/nav>/)[1];
  assert.match(pagination, /^<span>99997–99997 \/ 100001 ảnh<\/span><div>/);
  assert.ok(pagination.indexOf('>Trước</button>') < pagination.indexOf('>Sau</button>'));
  assert.equal((pagination.match(/data-action="activity-page"/g) || []).length, 2);
  assert.equal(page.state.activityOffset, 99996);
});

test('screenshot history renders beside app/web tabs with protected thumbnails and pagination', async () => {
  const page = dashboard(async () => ({ data: [{ screenshot_id: '9', device_id: 7,
    captured_at: '2026-10-08T05:00:00Z', width: 960, height: 540, thumbnail_base64: '/9j/\n/9k=' }],
    total: 13, capture_interval_seconds: 300, retention_days: 7 }));
  page.state.activityFilter = { device_id: '7', start: '2026-10-08T10:00', end: '2026-10-08T12:00' };
  await page.context.renderScreenshotActivity(page.content, 1);
  assert.match(page.content.innerHTML, /Ứng dụng/);
  assert.match(page.content.innerHTML, /Website/);
  assert.match(page.content.innerHTML, /Giám sát màn hình/);
  assert.match(page.content.innerHTML, /Khi bật: chụp mỗi 5 phút/);
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

test('screen history retains its gallery, action order and explanations after visual simplification', async () => {
  const page = dashboard(async () => ({ data: [{ screenshot_id: '21', device_id: 7, width: 960, height: 540,
    thumbnail_base64: '/9j/', captured_at: '2026-10-08T05:00:00Z' }], total: 13,
    devices: [{ device_id: 7, enabled: true }] }));
  await page.context.renderScreenshotActivity(page.content, 1);
  const html = page.content.innerHTML;
  const sequence = ['class="screen-monitor-intro"', 'id="activity-filter"', 'class="activity-note"',
    'id="screenshot-capture-controls"', 'class="screen-monitor-summary"', 'class="screenshot-grid"', 'class="screenshot-pagination"'];
  let previous = -1;
  for (const marker of sequence) { const index = html.indexOf(marker); assert.ok(index > previous, marker); previous = index; }
  assert.match(html, /Yêu cầu chụp ngay dùng thiết bị đang chọn, không cần nhấn Áp dụng/);
  assert.match(html, /tất cả thiết bị cùng hồ sơ trẻ khi Agent nhận cấu hình/);
  assert.match(html, /width="960" height="540" loading="lazy" decoding="async"/);
  assert.match(html, /class="screenshot-preview"[^>]*aria-label="Xem ảnh/);
  for (const action of ['refresh-screenshots', 'clear-screenshots', 'start-screenshot', 'stop-screenshot', 'view-screenshot', 'delete-screenshot', 'activity-page']) {
    assert.ok(html.includes(`data-action="${action}"`), action);
  }
  assert.doesNotMatch(html, /section-visual|page-summary-strip|activity-enforcement/);
  assert.match(html, /aria-describedby="screenshot-capture-scope"/);
  assert.match(html, /id="screenshot-capture-scope"/);
});

test('manual Activity loading awaits screenshot errors, keeps retry scope and stable ARIA status', async () => {
  let reject, fail = true;
  const request = new Promise((_resolve, no) => { reject = no; });
  const page = dashboard(() => fail ? request : Promise.resolve({ data: [], total: 13 }));
  vm.runInContext(functionSource(source, 'renderActivity'), page.context);
  page.state.activityOffset = 12;
  page.state.activityFilter = { device_id: '7', start: '2026-10-08T10:00' };
  const filter = JSON.stringify(page.state.activityFilter);
  const pending = page.context.renderActivity(page.content);
  const status = page.content.querySelector('#activity-load-status');
  assert.match(status.textContent, /Đang tải ảnh màn hình/);
  assert.match(page.content.innerHTML, /aria-busy="true"/);
  reject(Error('offline'));
  await pending;
  assert.match(status.textContent, /Chưa tải được ảnh màn hình/);
  assert.match(page.content.innerHTML, /data-action="retry-activity"/);
  assert.match(page.content.innerHTML, /aria-busy="false"/);
  assert.equal(page.state.activityOffset, 12);
  assert.equal(JSON.stringify(page.state.activityFilter), filter);
  fail = false;
  // One row on the second page, as returned by a real paginated response.
  page.context.api = async () => ({ data: [{ screenshot_id: '13', device_id: 7 }], total: 13 });
  await page.context.renderActivity(page.content);
  assert.equal(page.content.querySelector('#activity-load-status'), status);
  assert.match(status.textContent, /Đã tải 1 ảnh. Trang 2/);
  const ids = [...page.content.innerHTML.matchAll(/(?<![\w-])id="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const match of page.content.innerHTML.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g)) {
    assert.ok(ids.includes(match[1]), `missing ${match[1]}`);
  }
});

test('background image updates preserve the focused results panel and never show manual loading', async () => {
  const page = dashboard(async () => ({ data: [], total: 0 }));
  await page.context.renderScreenshotActivity(page.content, 1);
  page.content.querySelector('#activity-panel-screenshots').focus();
  const oldPanel = page.context.document.activeElement;
  const status = page.content.querySelector('#activity-load-status');
  await page.context.renderScreenshotActivity(page.content, 1, true);
  assert.notEqual(page.context.document.activeElement, oldPanel);
  assert.equal(page.context.document.activeElement.id, 'activity-panel-screenshots');
  assert.equal(page.context.document.activeElement.isConnected, true);
  assert.equal(page.content.querySelector('#activity-load-status'), status);
  assert.doesNotMatch(page.content.innerHTML, /aria-busy="true"|Đang tải ảnh/);
});

test('late screenshot success and failure cannot update a different session', async () => {
  for (const fails of [false, true]) {
    let resolve, reject;
    const request = new Promise((yes, no) => { resolve = yes; reject = no; });
    const page = dashboard(() => request);
    const pending = page.context.renderScreenshotActivity(page.content, 1);
    page.state.accessToken = 'different-session';
    if (fails) reject(Error('offline')); else resolve({ data: [], total: 0 });
    await pending;
    assert.equal(page.content.innerHTML, '');
    assert.equal(page.timers.length, 0);
    assert.equal(page.state.screenshotRows, undefined);
  }
});

test('screenshot copy separates applied image filters, immediate target and child-wide capture', async () => {
  const page = dashboard(async () => ({ data: [], total: 0,
    devices: [{ device_id: 7, enabled: true }, { device_id: 8, enabled: false }] }));
  page.state.devices.push({ device_id: 8, child_id: 4, device_name: 'Máy <khác>' });
  page.state.activityFilter = { device_id: '7', start: '2026-10-01T10:00' };
  await page.context.renderScreenshotActivity(page.content, 1);
  assert.match(page.content.innerHTML, /Nhấn Áp dụng để cập nhật danh sách ảnh theo thiết bị và thời gian đã chọn/);
  assert.match(page.content.innerHTML, /Yêu cầu chụp ngay dùng thiết bị đang chọn, không cần nhấn Áp dụng/);
  assert.match(page.content.innerHTML, /Chụp ngay: Máy &lt;test&gt;/);
  assert.doesNotMatch(page.content.innerHTML, /200 bản ghi|Xuất kết quả CSV/);
  const params = new URL(page.calls[0][0], 'https://fixture').searchParams;
  assert.equal(params.get('limit'), '12');
  assert.equal(params.get('device_id'), '7');
  const controls = { innerHTML: '' };
  page.context.document.querySelector = selector => selector === '#screen-device' ? { value: '8' }
    : selector === '#screenshot-capture-controls' ? controls : null;
  const filterBefore = JSON.stringify(page.state.activityFilter);
  page.context.updateScreenshotCaptureControls();
  assert.match(controls.innerHTML, /Chụp ngay: Máy &lt;khác&gt;/);
  assert.doesNotMatch(controls.innerHTML, /<khác>/);
  assert.match(controls.innerHTML, /Bắt đầu cũng bật chụp định kỳ nếu đang tắt/);
  assert.match(controls.innerHTML, /tất cả thiết bị cùng hồ sơ trẻ khi Agent nhận cấu hình/);
  assert.match(controls.innerHTML, /ảnh đã lưu vẫn được giữ/);
  assert.match(controls.innerHTML, /chuyển danh sách sang thiết bị này và bỏ lọc thời gian/);
  assert.match(controls.innerHTML, /aria-describedby="screenshot-capture-scope"/);
  assert.match(controls.innerHTML, /id="screenshot-capture-scope">/);
  assert.equal(JSON.stringify(page.state.activityFilter), filterBefore, 'choosing a target does not apply the image filter');
  assert.equal(page.calls.length, 1, 'updating explanatory text sends no requests');
});

test('capture guidance handles one automatic target and an ambiguous multi-device selection', async () => {
  const page = dashboard(async () => ({ data: [], total: 0, devices: [{ device_id: 7, enabled: true }] }));
  await page.context.renderScreenshotActivity(page.content, 1);
  assert.match(page.content.innerHTML, /Chụp ngay: Máy &lt;test&gt;/);
  assert.equal(page.context.screenshotCaptureTarget().device_id, 7);
  page.state.screenshotDevices.push({ device_id: 8, enabled: true });
  const target = page.context.screenshotCaptureTarget();
  assert.equal(target, null);
  const html = page.context.screenshotCaptureControls(target);
  assert.match(html, /Chọn một thiết bị để gửi yêu cầu chụp ngay và xem phạm vi bật\/dừng chụp định kỳ/);
  assert.match(html, /data-action="start-screenshot" disabled/);
  assert.match(html, /data-action="stop-screenshot" disabled/);
  assert.doesNotMatch(html, /Chụp ngay: Máy/);
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
  assert.match(failed.content.innerHTML, /data-action="retry-activity"/);
});

test('pending capture can be stopped and disabled monitoring can be resumed from the gallery', async () => {
  for (const device of [{ enabled: false }, { enabled: true, pending_request_id: 'request' }]) {
    const page = dashboard(async () => ({ data: [], total: 0, devices: [{ device_id: 7, ...device }] }));
    await page.context.renderScreenshotActivity(page.content, 1);
    assert.match(page.content.innerHTML, device.enabled ? /data-action="start-screenshot" disabled/ : /data-action="start-screenshot" >Bắt đầu chụp ảnh/);
    assert.match(page.content.innerHTML, device.enabled ? /data-action="stop-screenshot" >Dừng chụp ảnh/ : /data-action="stop-screenshot" disabled/);
    assert.match(page.content.innerHTML, device.enabled ? /Đang chờ ảnh/ : /Chụp định kỳ đang tắt/);
    assert.match(page.content.innerHTML, /tất cả thiết bị cùng hồ sơ trẻ/);
  }
});

test('capture targets visible device selection and clears dates that would hide new images', async () => {
  const page = dashboard(async () => ({ online: true }));
  page.state.screenshotDevices = [{ device_id: 7, enabled: true }, { device_id: 8, enabled: true }];
  page.state.devices.push({ device_id: 8, child_id: 4 });
  page.state.activityFilter = { device_id: '7', start: '2026-10-01T00:00' };
  page.context.document.querySelector = selector => selector === '#screen-device' ? { value: '8' }
    : selector === '#page-content' ? page.content : null;
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
  page.state.screenshotDevices = [{ device_id: 7, enabled: true }, { device_id: 8, enabled: true }];
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

test('stop revokes only screenshot consent for the visible child and keeps images and filters', async () => {
  const page = dashboard(async () => ({ enable_screenshot_review: false }));
  page.state.devices.push({ device_id: 8, child_id: 4 }, { device_id: 9, child_id: 4 });
  page.state.screenshotDevices = [7, 8, 9].map(device_id => ({ device_id, enabled: true, pending_request_id: 'request' }));
  page.state.screenshotRows = [{ screenshot_id: '10' }];
  page.state.activityFilter = { device_id: '7', start: '2026-10-01T00:00' };
  page.state.activityOffset = 12;
  const controls = { innerHTML: '' };
  page.context.document.querySelector = selector => selector === '#screen-device' ? { value: '8' }
    : selector === '#screenshot-capture-controls' ? controls : page.content;
  await page.context.stopScreenshotCapture({ disabled: false });
  const requests = page.calls.filter(call => call[0].startsWith('/'));
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/settings/4');
  assert.equal(requests[0][1].method, 'PUT');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0][1].body)), { enable_screenshot_review: false });
  assert.equal(page.state.screenshotDevices[0].enabled, true);
  for (const monitor of page.state.screenshotDevices.slice(1)) {
    assert.equal(monitor.enabled, false);
    assert.equal(monitor.pending_request_id, null);
  }
  assert.equal(page.state.screenshotRows[0].screenshot_id, '10');
  assert.equal(page.state.activityFilter.device_id, '7');
  assert.equal(page.state.activityFilter.start, '2026-10-01T00:00');
  assert.equal(page.state.activityOffset, 12);
  assert.match(controls.innerHTML, /Chụp định kỳ đang tắt/);
  assert.match(controls.innerHTML, /data-action="start-screenshot" >Bắt đầu chụp ảnh/);
});

test('resume enables recurring capture before requesting a fresh image', async () => {
  const page = dashboard(async () => ({ online: true }));
  page.state.screenshotDevices = [{ device_id: 7, enabled: false }];
  page.context.renderActivity = async () => {};
  await page.context.startScreenshotCapture({ disabled: false });
  const requests = page.calls.filter(call => call[0].startsWith('/'));
  assert.equal(requests[0][0], '/settings/3');
  assert.equal(requests[0][1].body.enable_screenshot_review, true);
  assert.equal(requests[1][0], '/logs/screenshots/request');
  assert.equal(page.state.screenshotDevices[0].enabled, true);
});

test('failed stop stays enabled and can be retried; failed resume never requests a screenshot', async () => {
  const page = dashboard(async () => { throw new Error('offline'); });
  page.state.screenshotDevices = [{ device_id: 7, enabled: true, pending_request_id: 'r' }];
  const button = { disabled: false };
  await page.context.stopScreenshotCapture(button);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Dừng chụp ảnh');
  assert.equal(page.state.screenshotDevices[0].enabled, true);
  assert.equal(page.state.screenshotDevices[0].pending_request_id, 'r');
  assert.equal(page.calls.at(-1)[1], 'Chưa dừng được chụp ảnh');
  page.state.screenshotDevices[0].enabled = false;
  await page.context.startScreenshotCapture(button);
  assert.equal(page.state.screenshotDevices[0].enabled, false);
  assert.equal(page.calls.some(call => call[0] === '/logs/screenshots/request'), false);
});

test('manual capture failure after enabling keeps stop available and reports partial success', async () => {
  const page = dashboard(async endpoint => {
    if (endpoint === '/logs/screenshots/request') throw new Error('offline');
    return {};
  });
  page.state.screenshotDevices = [{ device_id: 7, enabled: false }];
  await page.context.startScreenshotCapture({ disabled: false });
  assert.equal(page.state.screenshotDevices[0].enabled, true);
  assert.equal(page.calls.at(-1)[1], 'Đã bật chụp định kỳ, chưa yêu cầu được ảnh ngay');
  assert.match(page.context.screenshotCaptureControls(page.state.screenshotDevices[0]), /data-action="stop-screenshot" >Dừng chụp ảnh/);
});

test('device selection updates capture controls without applying or losing date drafts', () => {
  const page = dashboard(async () => ({}));
  page.state.screenshotDevices = [{ device_id: 7, enabled: false }, { device_id: 8, enabled: true }];
  page.state.activityFilter = { device_id: '7' };
  const select = { value: '8' }, controls = { innerHTML: '' };
  page.context.document.querySelector = selector => selector === '#screen-device' ? select : controls;
  page.context.updateScreenshotCaptureControls();
  assert.match(controls.innerHTML, /data-action="stop-screenshot" >Dừng chụp ảnh/);
  assert.equal(page.state.activityFilter.device_id, '7');
  select.value = '';
  page.context.updateScreenshotCaptureControls();
  assert.match(controls.innerHTML, /data-action="start-screenshot" disabled/);
  assert.match(controls.innerHTML, /data-action="stop-screenshot" disabled/);
});

test('stop rejects ambiguous targets and concurrent actions; late completion cannot modify a new page', async () => {
  let resolve;
  const page = dashboard(() => new Promise(done => { resolve = done; }));
  page.state.screenshotDevices = [{ device_id: 7, enabled: true }, { device_id: 8, enabled: true }];
  await page.context.stopScreenshotCapture({});
  assert.equal(page.calls[0][0], 'toast');
  page.state.screenshotDevices.pop();
  const stopping = page.context.stopScreenshotCapture({});
  const calls = page.calls.length;
  await page.context.startScreenshotCapture({});
  assert.equal(page.calls.length, calls);
  assert.equal(page.context.screenshotInteractionActive(page.content), true);
  page.context.activityRenderVersion += 1;
  page.state.page = 'overview';
  resolve({});
  await stopping;
  assert.equal(page.calls.length, calls);
  assert.equal(page.state.screenshotControlOperation, null);
  assert.equal(page.timers.length, 0);
});

test('a failed stop after Refresh restores the current controls even when metadata is unchanged', async () => {
  let rejectStop;
  const result = { data: [], total: 0, devices: [{ device_id: 7, enabled: true }] };
  const page = dashboard(endpoint => endpoint.startsWith('/settings/')
    ? new Promise((_resolve, reject) => { rejectStop = reject; }) : Promise.resolve(result));
  const controls = { innerHTML: '' };
  page.context.document.querySelector = selector => selector === '#screenshot-capture-controls' ? controls
    : selector === '#page-content' ? page.content : null;
  await page.context.renderScreenshotActivity(page.content, 1);
  const stopping = page.context.stopScreenshotCapture({});
  const refreshedVersion = ++page.context.activityRenderVersion;
  await page.context.renderScreenshotActivity(page.content, refreshedVersion);
  assert.match(page.content.innerHTML, /data-action="stop-screenshot" disabled/);
  rejectStop(new Error('offline'));
  await stopping;
  assert.equal(page.state.screenshotControlOperation, null);
  assert.match(controls.innerHTML, /data-action="stop-screenshot" >Dừng chụp ảnh/);
  assert.equal(page.calls.at(-1)[1], 'Chưa dừng được chụp ảnh');
  await page.timers.pop()();
  assert.match(controls.innerHTML, /data-action="stop-screenshot" >Dừng chụp ảnh/);
});

test('stop completion from a cleared session cannot modify the next session', async () => {
  let resolve;
  const page = dashboard(() => new Promise(done => { resolve = done; }));
  page.state.screenshotDevices = [{ device_id: 7, enabled: true }];
  const stopping = page.context.stopScreenshotCapture({});
  page.state.screenshotControlOperation = null;
  const nextSessionDevices = [{ device_id: 7, enabled: true }];
  page.state.screenshotDevices = nextSessionDevices;
  page.context.activityRenderVersion += 1;
  resolve({});
  await stopping;
  assert.equal(nextSessionDevices[0].enabled, true);
  assert.equal(page.calls.length, 1);
  assert.equal(page.timers.length, 0);
});

test('control updates keep action focus and do not steal focus from the device filter', () => {
  const page = dashboard(async () => ({}));
  const focused = { dataset: { action: 'stop-screenshot' } };
  let nextFocus = '';
  const enabledButton = { focus: () => { nextFocus = 'start'; } };
  const controls = { innerHTML: '', contains: element => element === focused,
    querySelector: selector => selector === 'button:not(:disabled)' ? enabledButton : null };
  page.context.document.activeElement = focused;
  page.context.document.querySelector = selector => selector === '#screenshot-capture-controls' ? controls : null;
  page.state.screenshotDevices = [{ device_id: 7, enabled: false }];
  page.context.updateScreenshotCaptureControls();
  assert.equal(nextFocus, 'start');
  nextFocus = '';
  page.context.document.activeElement = {};
  page.context.updateScreenshotCaptureControls();
  assert.equal(nextFocus, '');
});

test('successful start restores focus after reloading the gallery', async () => {
  const page = dashboard(async () => ({ online: true, request_id: 'request' }));
  page.state.screenshotDevices = [{ device_id: 7, enabled: true }];
  const startButton = { dataset: { action: 'start-screenshot' } };
  const stopButton = { focus: () => { page.context.document.activeElement = stopButton; } };
  const controls = { innerHTML: '', contains: element => element === startButton || element === controls,
    querySelector: () => null, focus: () => { page.context.document.activeElement = controls; } };
  page.context.document.body = {};
  page.context.document.activeElement = startButton;
  page.context.document.querySelector = selector => selector === '#screenshot-capture-controls' ? controls
    : selector === '#screenshot-capture-controls button:not(:disabled)' ? stopButton
      : selector === '#page-content' ? page.content : null;
  page.context.renderActivity = async () => {
    page.context.activityRenderVersion += 1;
    page.context.document.activeElement = page.context.document.body;
  };
  await page.context.startScreenshotCapture(startButton);
  assert.equal(page.context.document.activeElement, stopButton);
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
