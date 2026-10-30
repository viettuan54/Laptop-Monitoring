const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./queryAlertRenderer');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const config = {
  child_id: 7, daily_limit_minutes: 120, allowed_start_time: '07:00', allowed_end_time: '21:00',
  is_locked: true, enable_webcam_monitoring: false, enable_screenshot_review: true,
  enable_break_reminders: true, break_interval_minutes: 45, break_duration_minutes: 10,
};

function controlView(devices, { deviceError, settings = config } = {}) {
  const sandbox = vm.createContext({
    api: async url => {
      if (url.startsWith('/children')) return [
        { child_id: 7, name: '<An & Bình>', age: null },
        { child_id: 8, name: 'Em', age: 0 },
      ];
      if (url.startsWith('/settings')) return settings;
      if (url.startsWith('/devices')) {
        if (deviceError) throw deviceError;
        return { data: devices };
      }
      return { data: [] };
    },
    state: { page: 'controls', selectedChildId: 7 }, controlRenderVersion: 0,
    AbortSignal, encodeURIComponent,
    icons: { device: '', control: '', policy: '', activity: '' },
    document: { querySelector: () => null },
    stopBreakReminderPolling: () => {}, startBreakReminderPolling: () => {},
    reconcileSelectedId: id => id, initials: () => 'AB', pageHead: () => '',
  });
  vm.runInContext(['escapeHtml', 'isDeviceOnline', 'switchRow', 'breakReminderHistoryMarkup',
    'renderDeviceControls'].map(name => functionSource(source, name)).join('\n'), sandbox);
  const content = { innerHTML: 'existing content' };
  return { content, render: () => sandbox.renderDeviceControls(content) };
}

test('control scope includes only linked devices, escapes names and identifies saved configuration', async () => {
  const view = controlView([
    { child_id: 7, device_name: '<Laptop>', online: true },
    { child_id: '7', device_name: 'Máy & Bàn', online: false },
    { child_id: 8, device_name: 'Unrelated device', online: true },
  ]);
  await view.render();
  const html = view.content.innerHTML;
  assert.equal(html.split('Áp dụng cho tất cả 2 thiết bị của &lt;An &amp; Bình&gt;').length - 1, 2);
  assert.match(html, /Thiết bị: &lt;Laptop&gt;, Máy &amp; Bàn/);
  assert.doesNotMatch(html, /Unrelated device|<Laptop>|<An|Đang khóa thiết bị|Cho phép sử dụng/);
  assert.match(html, /Đã lưu: Cấu hình khóa đang bật/);
  assert.match(html, /Cấu hình khóa đang bật/);
  assert.match(html, /Chưa có thông tin tuổi/);
  assert.match(html, /<small>0 tuổi<\/small>/);
  assert.match(html, /data-control-save-status role="status" aria-live="polite" aria-atomic="true"/);
});

test('no linked devices still permits saving and does not imply an offline device or permission to use', async () => {
  const view = controlView([], { settings: { ...config, is_locked: false } });
  await view.render();
  const html = view.content.innerHTML;
  assert.match(html, /Chưa có thiết bị liên kết với &lt;An &amp; Bình&gt;/);
  assert.match(html, /Bạn vẫn có thể lưu cấu hình, nhưng hiện chưa có thiết bị để áp dụng/);
  assert.match(html, /Cấu hình khóa đang tắt/);
  assert.doesNotMatch(html, /Tất cả thiết bị hiện ngoại tuyến|Cho phép sử dụng/);
  assert.match(html, /<button class="btn" type="submit">Lưu điều khiển<\/button>/);
});

test('offline guidance uses existing presence results and is not shown for a partially online group', async () => {
  const devices = [
    { child_id: 7, device_name: 'Máy A', online: false },
    { child_id: 7, device_name: 'Máy B', last_seen_at: null },
  ];
  const offline = controlView(devices);
  await offline.render();
  assert.match(offline.content.innerHTML, /Tất cả thiết bị hiện ngoại tuyến/);
  assert.match(offline.content.innerHTML, /Bạn vẫn có thể lưu; thiết bị chỉ có thể nhận cấu hình khi kết nối lại/);
  const mixed = controlView([{ ...devices[0], online: true }, devices[1]]);
  await mixed.render();
  assert.doesNotMatch(mixed.content.innerHTML, /Tất cả thiết bị hiện ngoại tuyến/);
  assert.match(mixed.content.innerHTML, /Lưu cấu hình không có nghĩa thiết bị đã áp dụng/);
});

test('device loading failure is propagated instead of rendering empty or offline guidance', async () => {
  const view = controlView([], { deviceError: new Error('device API unavailable') });
  await assert.rejects(view.render(), /device API unavailable/);
  assert.equal(view.content.innerHTML, 'existing content');
});

// Exercise the real submit/modal/keyboard handlers with a small DOM double.
// Browser layout and assistive-technology rendering are not emulated here.
function saveView(api, remindersEnabled = true, { savedLocked = true, locked = true, refresh } = {}) {
  const requests = [], toasts = [], renders = [];
  const frames = [], listeners = {};
  const document = { body: {}, addEventListener: (type, handler) => { listeners[type] = handler; } };
  class Element {
    constructor(attrs = '', text = '') {
      this.attrs = Object.fromEntries([...attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(match => [match[1], match[2] || '']));
      this.dataset = Object.fromEntries(Object.entries(this.attrs).filter(([key]) => key.startsWith('data-'))
        .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]));
      this.textContent = text;
      this.disabled = false;
      this.isConnected = true;
      this.listeners = {};
    }
    focus() { if (this.isConnected && !this.disabled) document.activeElement = this; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    matches() { return false; }
    closest(selector) { return selector.startsWith('[') && selector.slice(1, -1) in this.attrs ? this : null; }
  }
  class Form extends Element {
    constructor(childId = '7', version = 1) {
      super();
      this.id = 'device-control-form';
      this.dataset = { childId, renderVersion: String(version), savedLocked: String(savedLocked) };
      this.status = new Element();
      this.button = new Element('type="submit"', 'Lưu điều khiển');
      this.elements = {
        is_locked: Object.assign(new Element(), { checked: locked }),
        enable_webcam_monitoring: Object.assign(new Element(), { checked: false }),
        enable_screenshot_review: Object.assign(new Element(), { checked: true }),
        enable_break_reminders: Object.assign(new Element(), { checked: remindersEnabled }),
      };
      this.fields = {
        daily_limit_minutes: '120', allowed_start_time: '07:00', allowed_end_time: '21:00',
        break_interval_minutes: '45', break_duration_minutes: '10',
      };
      for (const name of Object.keys(this.fields)) {
        this.elements[name] = new Element();
        Object.defineProperty(this.elements[name], 'value', {
          get: () => this.fields[name], set: value => { this.fields[name] = value; },
        });
      }
    }
    querySelector(selector) {
      return selector === '[type="submit"]' ? this.button : selector === '[data-control-save-status]' ? this.status : null;
    }
    querySelectorAll() { return [...Object.values(this.elements), this.button]; }
  }
  let currentForm = new Form();
  const originalForm = currentForm;
  let modal = null, backdrop = null, html = '';
  const select = selector => {
    if (selector === '.modal') return modal;
    if (selector === '.modal-backdrop') return backdrop;
    if (!modal) return null;
    if (selector.startsWith('[data-')) {
      const [, attr, value] = /^\[([^=\]]+)(?:="([^"]+)")?\]/.exec(selector);
      return modal.nodes.find(node => attr in node.attrs && (value === undefined || node.attrs[attr] === value)) || null;
    }
    if (selector.includes('autofocus')) return modal.nodes[0];
    return null;
  };
  const root = {
    get firstElementChild() { return backdrop; },
    get innerHTML() { return html; },
    set innerHTML(value) {
      if (modal) {
        if (modal.nodes.includes(document.activeElement)) document.activeElement = document.body;
        modal.nodes.forEach(node => { node.isConnected = false; });
        modal.isConnected = false;
      }
      html = value;
      if (!value) { modal = null; backdrop = null; return; }
      modal = new Element();
      modal.nodes = [...value.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].map(match => new Element(match[1], match[2]));
      modal.querySelector = select;
      modal.querySelectorAll = () => modal.nodes.filter(node => !node.disabled);
      backdrop = new Element();
    },
    querySelector: select,
  };
  document.querySelector = selector => selector === '#device-control-form' ? currentForm
    : selector === '#page-content' ? 'controls content' : select(selector);
  const state = { page: 'controls', selectedChildId: 7, userMenuOpen: false,
    children: [{ child_id: 7, name: '<An & Bình>' }, { child_id: 8, name: 'Em' }],
    devices: [{ child_id: 7, device_name: '<Laptop>', online: false },
      { child_id: 7, device_name: 'Máy & Bàn', online: false },
      { child_id: 8, device_name: 'Other child device', online: true }],
  };
  const replaceForm = childId => {
    currentForm.isConnected = false;
    currentForm.querySelectorAll().concat(currentForm.status).forEach(node => { node.isConnected = false; });
    document.activeElement = document.body;
    currentForm = new Form(String(childId), sandbox.controlRenderVersion);
    return currentForm;
  };
  const sandbox = vm.createContext({
    document, state, modalRoot: root, modalReturnFocus: null, app: { inert: false }, controlRenderVersion: 1,
    requestAnimationFrame: callback => frames.push(callback),
    HTMLFormElement: Form,
    FormData: class { constructor(form) {
      return Object.entries(form.fields).filter(([name]) => !form.elements[name].disabled
        && (form.elements.enable_break_reminders.checked || !name.startsWith('break_')));
    } },
    api: async (url, options) => { requests.push({ url, ...options }); return api(); },
    toast: (...args) => toasts.push(args), localizeError: message => message,
    renderDeviceControls: async content => {
      renders.push(content);
      const version = ++sandbox.controlRenderVersion;
      const childId = state.selectedChildId;
      if (refresh) await refresh();
      if (version === sandbox.controlRenderVersion && state.page === 'controls' && childId === state.selectedChildId) replaceForm(childId);
    },
  });
  vm.runInContext(['escapeHtml', 'showModal', 'closeModal', 'deviceModalDismissBlocked',
    'isCurrentControlForm', 'showControlLockConfirmation', 'saveDeviceControls', 'handleSubmit']
    .map(name => functionSource(source, name)).join('\n'), sandbox);
  vm.runInContext(source.slice(source.indexOf('async function handleClick('),
    source.indexOf("document.addEventListener('submit'")), sandbox);
  vm.runInContext(source.slice(source.indexOf("document.addEventListener('keydown'"),
    source.indexOf("document.addEventListener('visibilitychange'")), sandbox);
  originalForm.button.focus();
  const flush = () => { while (frames.length) frames.shift()(); };
  const click = node => node.listeners.click ? node.listeners.click({ target: node }) : sandbox.handleClick({ target: node });
  const key = (key, shiftKey = false) => {
    const event = { key, shiftKey, target: document.activeElement, preventDefault() { this.prevented = true; } };
    listeners.keydown(event);
    return event;
  };
  return { button: originalForm.button, status: originalForm.status, form: originalForm,
    requests, toasts, renders, sandbox, state, document, root, select, flush, key, click,
    current: () => currentForm,
    submit: (form = currentForm) => sandbox.handleSubmit({ target: form, preventDefault() {} }),
    selectChild: childId => click(new Element(`data-action="select-control-child" data-id="${childId}"`)),
    switchChild(childId) {
      state.selectedChildId = childId;
      sandbox.controlRenderVersion++;
      return replaceForm(childId);
    },
    dismiss(method) {
      return method === 'Escape' ? key('Escape') : method === 'backdrop' ? backdrop.listeners.click({ target: backdrop })
        : click(select(method === 'Hủy' ? '[data-control-lock-cancel]' : '[data-action="close-modal"]'));
    },
  };
}

for (const selectedChildId of [7, '7']) {
  test(`reselecting the current child preserves unsaved controls and focus (${typeof selectedChildId} ID)`, async () => {
    const view = saveView(() => Promise.resolve(config));
    view.state.selectedChildId = selectedChildId;
    const form = view.current();
    const version = view.sandbox.controlRenderVersion;
    assert.equal(form.elements.daily_limit_minutes.value, '120');
    form.elements.daily_limit_minutes.value = '333';
    form.elements.is_locked.checked = false;
    form.elements.daily_limit_minutes.focus();

    await view.selectChild('7');
    view.flush();

    assert.equal(view.current(), form);
    assert.equal(form.isConnected, true);
    assert.equal(form.elements.daily_limit_minutes.value, '333');
    assert.equal(form.elements.is_locked.checked, false);
    assert.equal(view.document.activeElement, form.elements.daily_limit_minutes);
    assert.equal(view.state.selectedChildId, selectedChildId);
    assert.equal(view.sandbox.controlRenderVersion, version);
    assert.equal(view.renders.length, 0);
    assert.equal(view.requests.length, 0);
    assert.equal(view.toasts.length, 0);
  });
}

test('selecting a different child still renders its controls once', async () => {
  const view = saveView(() => Promise.resolve(config));
  const previousForm = view.current();
  previousForm.elements.daily_limit_minutes.value = '333';
  const version = view.sandbox.controlRenderVersion;

  await view.selectChild('8');

  assert.equal(view.state.selectedChildId, '8');
  assert.notEqual(view.current(), previousForm);
  assert.equal(previousForm.isConnected, false);
  assert.equal(view.current().dataset.childId, '8');
  assert.equal(view.sandbox.controlRenderVersion, version + 1);
  assert.deepEqual(view.renders, ['controls content']);
  assert.equal(view.requests.length, 0);
});

for (const remindersEnabled of [true, false]) {
  test(`save announces pending then saved configuration, preserving payload (reminders ${remindersEnabled})`, async () => {
    let finish;
    const view = saveView(() => new Promise(resolve => { finish = resolve; }), remindersEnabled);
    const pending = view.submit();
    assert.equal(view.button.disabled, true);
    assert.equal(view.button.textContent, 'Đang lưu điều khiển...');
    assert.match(view.status.textContent, /^Đang lưu điều khiển/);
    assert.equal(view.toasts.length, 0);
    assert.equal(view.renders.length, 0);
    const expected = { ...config, enable_break_reminders: remindersEnabled };
    delete expected.child_id;
    if (!remindersEnabled) {
      delete expected.break_interval_minutes;
      delete expected.break_duration_minutes;
    }
    assert.deepEqual(JSON.parse(JSON.stringify(view.requests)), [{ url: '/settings/7', method: 'PUT', body: expected }]);
    finish({ ...config });
    await pending;
    assert.equal(view.button.disabled, false);
    assert.equal(view.button.textContent, 'Lưu điều khiển');
    assert.equal(view.status.textContent, 'Đã lưu cấu hình. Chưa có xác nhận thiết bị đã áp dụng.');
    assert.equal(view.toasts[0][0], 'Đã lưu cấu hình điều khiển');
    assert.match(view.toasts[0][1], /Chưa có xác nhận từ thiết bị/);
    assert.equal(view.renders.length, 1);
    assert.equal(view.requests.length, 1);
  });
}

test('save failure restores the action, retains input and can subsequently save without automatic retry', async () => {
  let fail;
  let shouldFail = true;
  const view = saveView(() => shouldFail ? new Promise((resolve, reject) => { fail = reject; }) : Promise.resolve(config));
  const fields = { ...view.form.fields };
  const pending = view.submit();
  fail(new Error('connection lost'));
  await pending;
  assert.equal(view.button.disabled, false);
  assert.equal(view.button.textContent, 'Lưu điều khiển');
  assert.match(view.status.textContent, /Chưa xác nhận được cấu hình đã lưu/);
  assert.equal(view.toasts[0][2], 'error');
  assert.equal(view.renders.length, 0);
  assert.equal(view.requests.length, 1);
  assert.deepEqual(view.form.fields, fields);
  assert.ok(view.form.querySelectorAll().every(control => !control.disabled));
  assert.equal(view.document.activeElement, view.button);
  shouldFail = false;
  await view.submit();
  assert.equal(view.requests.length, 2);
  assert.equal(view.renders.length, 1);
  assert.equal(view.toasts[1][0], 'Đã lưu cấu hình điều khiển');
});

for (const outcome of ['success', 'failure']) {
  for (const destination of ['child B', 'new form for child A', 'another page']) {
    test(`late save ${outcome} leaves ${destination} and its drafts untouched`, async () => {
      let resolve, reject;
      const view = saveView(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
      const pending = view.submit();
      const next = view.switchChild(destination === 'child B' ? 8 : 7);
      if (destination === 'another page') view.state.page = 'policies';
      next.fields.daily_limit_minutes = '333';
      next.elements.is_locked.checked = false;
      next.elements.enable_screenshot_review.checked = false;
      next.elements.daily_limit_minutes.focus();
      const page = view.state.page;
      const childId = view.state.selectedChildId;
      if (outcome === 'success') resolve(config); else reject(new Error('old request failed'));
      await pending;
      assert.equal(view.current(), next);
      assert.equal(next.fields.daily_limit_minutes, '333');
      assert.equal(next.elements.is_locked.checked, false);
      assert.equal(next.elements.enable_screenshot_review.checked, false);
      assert.ok(next.querySelectorAll().every(control => !control.disabled));
      assert.equal(view.state.page, page);
      assert.equal(view.state.selectedChildId, childId);
      assert.equal(view.document.activeElement, next.elements.daily_limit_minutes);
      assert.equal(view.renders.length, 0);
      assert.equal(view.toasts.length, 0);
      assert.equal(view.requests.length, 1);
    });
  }
}

test('changing child while its GET is pending invalidates the old form before DOM replacement', async () => {
  let finish;
  const view = saveView(() => new Promise(resolve => { finish = resolve; }));
  const pending = view.submit();
  view.state.selectedChildId = 8;
  view.sandbox.controlRenderVersion++;
  finish(config);
  await pending;
  assert.equal(view.renders.length, 0);
  assert.equal(view.toasts.length, 0);
  assert.equal(view.state.selectedChildId, 8);
  await view.submit(view.form);
  assert.equal(view.requests.length, 1, 'obsolete visible form cannot send a second request');
});

test('pending save freezes the captured fields and rejects repeat submits before reading disabled fields', async () => {
  let fail;
  const view = saveView(() => new Promise((resolve, reject) => { fail = reject; }));
  view.form.elements.break_duration_minutes.disabled = true;
  const pending = view.submit();
  assert.ok(view.form.querySelectorAll().every(control => control.disabled));
  assert.equal(view.requests[0].body.allowed_start_time, '07:00');
  assert.equal(view.requests[0].body.allowed_end_time, '21:00');
  assert.equal(view.requests[0].body.daily_limit_minutes, 120);
  assert.equal(view.document.activeElement, view.status);
  await Promise.all(Array.from({ length: 10 }, () => view.submit()));
  assert.equal(view.requests.length, 1);
  assert.equal(view.button.disabled, true, 'a duplicate submit must not unlock the original request');
  fail(new Error('unavailable'));
  await pending;
  assert.equal(view.form.elements.break_duration_minutes.disabled, true, 'restore original disabled state');
  assert.equal(view.form.elements.daily_limit_minutes.disabled, false);
  assert.equal(view.form.elements.is_locked.disabled, false);
});

for (const method of ['Hủy', 'X', 'Escape', 'backdrop']) {
  test(`cancelling lock confirmation via ${method} sends nothing and preserves editable drafts and focus`, async () => {
    const view = saveView(async () => config, true, { savedLocked: false });
    view.form.fields.daily_limit_minutes = '90';
    await view.submit(); view.flush();
    assert.equal(view.requests.length, 0);
    assert.equal(view.sandbox.app.inert, true);
    assert.equal(view.document.activeElement, view.select('[data-control-lock-cancel]'));
    assert.match(view.root.innerHTML, /role="dialog" aria-modal="true" aria-labelledby="modal-title"/);
    assert.match(view.root.innerHTML, /Áp dụng cho tất cả 2 thiết bị của &lt;An &amp; Bình&gt;/);
    assert.match(view.root.innerHTML, /&lt;Laptop&gt;|Máy &amp; Bàn/);
    assert.doesNotMatch(view.root.innerHTML, /<Laptop>|Other child device|>Xác nhận</);
    const last = view.select('[data-control-lock-save]');
    const first = view.select('[data-action="close-modal"]');
    last.focus(); view.key('Tab'); assert.equal(view.document.activeElement, first);
    view.key('Tab', true); assert.equal(view.document.activeElement, last);
    await view.dismiss(method); view.flush();
    assert.equal(view.root.innerHTML, '');
    assert.equal(view.sandbox.app.inert, false);
    assert.equal(view.document.activeElement, view.button);
    assert.equal(view.requests.length, 0);
    assert.equal(view.form.fields.daily_limit_minutes, '90');
    assert.equal(view.form.elements.is_locked.checked, true, 'cancel keeps the unsaved draft');
    assert.equal(view.form.dataset.savedLocked, 'false');
    assert.ok(view.form.querySelectorAll().every(control => !control.disabled));
    await view.click(last);
    assert.equal(view.requests.length, 0, 'a detached confirmation cannot authorize a request');
    await view.submit();
    assert.ok(view.root.firstElementChild, 'another attempt still requires confirmation');
  });
}

test('confirming a new lock saves the whole captured form exactly once, including for offline devices', async () => {
  let finish;
  const view = saveView(() => new Promise(resolve => { finish = resolve; }), true, { savedLocked: false });
  view.form.fields.daily_limit_minutes = '90';
  await view.submit(); view.flush();
  const confirmation = view.select('[data-control-lock-save]');
  assert.equal(confirmation.textContent, 'Lưu yêu cầu khóa');
  const pending = view.click(confirmation);
  view.flush();
  await view.click(confirmation);
  await view.submit();
  assert.equal(view.requests.length, 1);
  assert.equal(view.requests[0].url, '/settings/7');
  assert.equal(view.requests[0].body.is_locked, true);
  assert.equal(view.requests[0].body.daily_limit_minutes, 90);
  assert.equal(view.requests[0].body.enable_screenshot_review, true);
  assert.ok(view.form.querySelectorAll().every(control => control.disabled));
  assert.equal(view.root.innerHTML, '');
  assert.equal(view.document.activeElement, view.status);
  finish(config);
  await pending;
  assert.equal(view.form.dataset.savedLocked, 'true');
  assert.equal(view.toasts[0][0], 'Đã lưu cấu hình điều khiển');
  assert.equal(view.document.activeElement, view.current().button);
});

test('lock confirmation cannot submit after switching child or close a replacement modal', async () => {
  const view = saveView(async () => config, true, { savedLocked: false });
  await view.submit();
  const stale = view.select('[data-control-lock-save]');
  const next = view.switchChild(8);
  next.fields.daily_limit_minutes = '333';
  await view.click(stale);
  assert.equal(view.requests.length, 0);
  assert.equal(view.current(), next);
  assert.equal(next.fields.daily_limit_minutes, '333');
  view.sandbox.showModal('New dialog', '', '<button type="button">Other action</button>');
  const html = view.root.innerHTML;
  await view.click(stale);
  assert.equal(view.root.innerHTML, html);
  assert.equal(view.requests.length, 0);
});

test('saving without a new lock needs no confirmation and zero devices does not block a confirmed lock', async () => {
  const unlocked = saveView(async () => config, true, { savedLocked: false, locked: false });
  await unlocked.submit();
  assert.equal(unlocked.requests.length, 1);
  assert.equal(unlocked.requests[0].body.is_locked, false);
  assert.equal(unlocked.root.innerHTML, '');
  const noDevices = saveView(async () => config, true, { savedLocked: false });
  noDevices.state.devices = [];
  await noDevices.submit();
  assert.match(noDevices.root.innerHTML, /0 thiết bị/);
  assert.match(noDevices.root.innerHTML, /hiện chưa có thiết bị/);
  await noDevices.click(noDevices.select('[data-control-lock-save]'));
  assert.equal(noDevices.requests.length, 1);
});

test('successful save followed by failed refresh stays editable and does not ask to confirm an already saved lock', async () => {
  const view = saveView(async () => config, true, { savedLocked: false,
    refresh: async () => { throw new Error('GET unavailable'); } });
  await view.submit();
  await view.click(view.select('[data-control-lock-save]'));
  assert.equal(view.form.dataset.savedLocked, 'true');
  assert.match(view.status.textContent, /Đã lưu cấu hình nhưng chưa tải lại được dữ liệu/);
  assert.ok(view.form.querySelectorAll().every(control => !control.disabled));
  assert.equal(view.document.activeElement, view.button);
  await view.submit();
  assert.equal(view.requests.length, 2);
  assert.equal(view.root.innerHTML, '');
});

test('navigation during post-save refresh does not replace the next child draft or steal focus', async () => {
  let finishRefresh;
  const view = saveView(async () => config, true, { refresh: () => new Promise(resolve => { finishRefresh = resolve; }) });
  const pending = view.submit();
  await new Promise(resolve => setImmediate(resolve));
  const next = view.switchChild(8);
  next.fields.daily_limit_minutes = '333';
  next.elements.daily_limit_minutes.focus();
  finishRefresh();
  await pending;
  assert.equal(view.current(), next);
  assert.equal(next.fields.daily_limit_minutes, '333');
  assert.equal(view.document.activeElement, next.elements.daily_limit_minutes);
  assert.equal(view.state.selectedChildId, 8);
});
