const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./queryAlertRenderer');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const code = 'fixture-only-device-code';
const result = { device_name: 'Máy <An> & Bình', device_secret: code };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Lightweight DOM double for the real modal, delegated click and keyboard code.
// This checks interaction contracts; it does not emulate browser layout or AT.
function dashboard({ api = async () => result, copy = async () => {} } = {}) {
  const frames = [], requests = [], toasts = [], navigation = [], copied = [], listeners = {};
  const timers = new Map();
  let clock = 0, timerSequence = 0;
  let modal = null, backdrop = null, html = '';
  const document = { activeElement: null, body: { contains: node => node.isConnected },
    addEventListener: (name, fn) => { listeners[name] = fn; } };
  const decode = text => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"')
    .replaceAll('&#039;', "'").replaceAll('&amp;', '&');
  class Element {
    constructor(tag, attrs = '', text = '') {
      this.tag = tag;
      this.attrs = Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], decode(m[2])]));
      this.dataset = Object.fromEntries(Object.entries(this.attrs).filter(([key]) => key.startsWith('data-'))
        .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()), value]));
      this.id = this.attrs.id || '';
      this.disabled = /\bdisabled\b/.test(attrs);
      this.checked = false;
      this.isConnected = true;
      this.textContent = decode(text);
      this.listeners = {};
    }
    focus() { if (!this.disabled && this.isConnected) document.activeElement = this; }
    matches() { return false; }
    closest(selector) {
      if (selector === '.modal') return this.parent || null;
      if (selector === '.device-confirmation') return this.parent?.confirmation || null;
      if (selector === '[data-action]') return this.dataset.action ? this : null;
      return null;
    }
    setAttribute(name, value) { this.attrs[name] = value; }
    removeAttribute(name) { delete this.attrs[name]; }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    querySelector(selector) { return this.parent?.querySelector(selector) || null; }
    querySelectorAll(selector) {
      if (selector === 'input, select') return this.parent?.nodes.filter(node => ['input', 'select'].includes(node.tag)) || [];
      return [];
    }
  }
  const opener = new Element('button', 'data-action="add-device"');
  let fallback = opener;
  document.activeElement = opener;
  function select(selector) {
    if (selector === '.modal') return modal;
    if (selector === '.modal-backdrop') return backdrop;
    if (!modal) return null;
    if (selector.startsWith('#')) return modal.nodes.find(n => n.id === selector.slice(1)) || null;
    if (selector === '.device-modal-status') return modal.nodes.find(n => n.attrs.class?.includes('device-modal-status')) || null;
    if (selector === '.modal-close') return modal.nodes.find(n => n.attrs.class === 'modal-close') || null;
    if (selector === '[type="submit"]') return modal.nodes.find(n => n.attrs.type === 'submit') || null;
    if (selector.includes('[data-action=')) {
      const action = /data-action="([^"]+)"/.exec(selector)[1];
      return modal.nodes.find(n => n.dataset.action === action
        && (!selector.startsWith('.device-confirmation') || n.attrs.class !== 'modal-close')) || null;
    }
    return modal.nodes.find(n => n.tag === 'button' && !n.disabled) || null;
  }
  const root = {
    get firstElementChild() { return backdrop; },
    get innerHTML() { return html; },
    set innerHTML(value) {
      if (modal) {
        modal.isConnected = false;
        modal.nodes.forEach(node => { node.isConnected = false; });
      }
      html = value;
      if (!value) { modal = null; backdrop = null; return; }
      modal = new Element('section');
      modal.nodes = [];
      modal.querySelector = select;
      modal.querySelectorAll = selector => selector === 'button'
        ? modal.nodes.filter(n => n.tag === 'button')
        : modal.nodes.filter(n => !n.disabled && (n.tag === 'button' || n.tag === 'input' || n.attrs.tabindex === '0'));
      modal.contains = node => node.isConnected && node.parent === modal;
      const identity = /<div class="device-confirmation"([^>]*)>/.exec(value);
      if (identity) modal.confirmation = new Element('div', identity[1]);
      for (const match of value.matchAll(/<(button|input|select|code|p|form)\b([^>]*)>/g)) {
        const tail = value.slice(match.index + match[0].length);
        const text = match[1] === 'input' ? '' : tail.split(`</${match[1]}>`)[0];
        const node = new Element(match[1], match[2], text);
        node.parent = modal;
        modal.nodes.push(node);
      }
      backdrop = new Element('div');
    },
    querySelector: select,
  };
  document.querySelector = selector => selector === '[data-action="add-device"]' ? fallback : select(selector);
  const state = { page: 'devices', userMenuOpen: false, selectedDeviceId: 7, children: [{ child_id: 3, name: 'An <Bình>' }],
    devices: [7, 8].map(device_id => ({ device_id, child_id: 3,
      device_name: result.device_name, device_uid: `UID-${device_id}` })) };
  const context = vm.createContext({
    document, state, modalRoot: root, modalReturnFocus: null, app: { inert: false },
    requestAnimationFrame: fn => frames.push(fn), HTMLFormElement: Element,
    setTimeout: (callback, delay) => {
      const id = ++timerSequence;
      timers.set(id, { callback, due: clock + delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    FormData: class {
      constructor(form) {
        const fields = form.querySelectorAll('input, select');
        return Object.entries(form.values || {}).filter(([name]) => !fields.some(field => field.attrs.name === name && field.disabled));
      }
    },
    api: async (...args) => { requests.push(args); return api(...args); },
    navigator: { clipboard: { writeText: async value => { copied.push(value); return copy(value); } } },
    toast: (...args) => toasts.push(args), navigate: page => navigation.push(page),
    localizeError: text => text, renderDevices: async () => {},
  });
  vm.runInContext(['escapeHtml', 'showModal', 'closeModal', 'deviceForm', 'handleSubmit', 'renameDeviceFromModal',
    'deviceModalDismissBlocked', 'protectDeviceModalOnUnload', 'beginDeviceModalRequest',
    'registerDeviceFromModal', 'showDeviceConfirmation', 'confirmDeviceAction', 'showSecret', 'copyDeviceSecret']
    .map(name => functionSource(source, name)).join('\n'), context);
  vm.runInContext(source.slice(source.indexOf('async function handleClick('),
    source.indexOf("document.addEventListener('submit'")), context);
  vm.runInContext(source.slice(source.indexOf("document.addEventListener('keydown'"),
    source.indexOf("document.addEventListener('visibilitychange'")), context);
  const flush = () => { while (frames.length) frames.shift()(); };
  const click = node => context.handleClick({ target: node });
  const key = (key, shiftKey = false) => {
    const event = { key, shiftKey, target: document.activeElement, preventDefault() { this.prevented = true; } };
    listeners.keydown(event);
    return event;
  };
  const dismiss = method => method === 'X' ? click(select('.modal-close'))
    : method === 'Escape' ? key('Escape') : backdrop.listeners.click({ target: backdrop });
  const acknowledge = () => {
    const saved = select('#device-secret-saved');
    saved.checked = true;
    saved.listeners.change();
  };
  const unload = () => {
    const event = { preventDefault() { this.prevented = true; } };
    context.protectDeviceModalOnUnload(event);
    return !!event.prevented;
  };
  return { context, root, state, document, requests, toasts, navigation, copied, opener,
    select, flush, click, key, dismiss, acknowledge, unload,
    advanceTime(ms) {
      clock += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= clock) { timers.delete(id); timer.callback(); }
      }
    },
    pendingTimers: () => timers.size,
    async openRename(id = '7') {
      await click(new Element('button', `data-action="edit-device" data-id="${id}"`));
      flush();
      return select('#edit-device-form');
    },
    replaceOpener() { opener.isConnected = false; fallback = new Element('button'); return fallback; } };
}

for (const method of ['X', 'Escape', 'backdrop']) {
  test(`one-time code survives ${method} until saving is explicitly acknowledged`, async () => {
    const page = dashboard();
    page.context.showSecret(result); page.flush();
    const copy = page.select('[data-action="copy-secret"]');
    assert.equal(page.document.activeElement, copy);
    assert.equal(page.select('#device-secret-close').disabled, true);
    assert.equal(page.unload(), true);
    await page.click(copy);
    assert.deepEqual(page.copied, [code]);
    assert.equal(page.select('#device-secret-saved').checked, false, 'copying is not saving');
    await page.dismiss(method);
    assert.equal(page.select('#secret-value').textContent, code);
    assert.equal(page.context.app.inert, true);
    assert.equal(page.document.activeElement.id, 'device-secret-saved');
    page.context.showModal('Other dialog', '', '');
    assert.equal(page.select('#secret-value').textContent, code, 'another modal cannot discard the code');
    page.acknowledge();
    assert.equal(page.select('#device-secret-close').disabled, false);
    assert.equal(page.unload(), false);
    await page.dismiss(method); page.flush();
    assert.equal(page.root.innerHTML, '');
    assert.equal(page.context.app.inert, false);
    assert.equal(page.document.activeElement, page.opener);
    assert.equal(page.requests.length, 0);
  });
}

test('secret dialog traps Tab and returns focus after the device list replaces its opener', async () => {
  const page = dashboard();
  page.context.showSecret(result); page.flush(); page.acknowledge();
  const first = page.select('.modal-close'), last = page.select('#device-secret-close');
  last.focus(); assert.equal(page.key('Tab').prevented, true); assert.equal(page.document.activeElement, first);
  first.focus(); page.key('Tab', true); assert.equal(page.document.activeElement, last);
  const fallback = page.replaceOpener();
  await page.click(last); page.flush();
  assert.equal(page.document.activeElement, fallback);
});

test('clipboard denial retains the code and provides manual copy without marking it saved', async () => {
  const page = dashboard({ copy: async () => { throw Error('NotAllowedError'); } });
  page.context.showSecret(result); page.flush();
  const copy = page.select('[data-action="copy-secret"]');
  await page.click(copy);
  assert.equal(page.select('#secret-value').textContent, code);
  assert.match(page.select('#device-secret-status').textContent, /sao chép thủ công/);
  assert.equal(page.document.activeElement.id, 'secret-value');
  assert.equal(page.select('#device-secret-saved').checked, false);
  assert.equal(copy.disabled, false);
  page.context.navigator.clipboard = undefined;
  await page.click(copy);
  assert.equal(page.select('#secret-value').textContent, code);
  assert.equal(page.unload(), true);
});

test('slow clipboard copying is not repeated and restores focus if disabling the button blurred it', async () => {
  const clipboard = deferred(), page = dashboard({ copy: () => clipboard.promise });
  page.context.showSecret(result); page.flush();
  const copy = page.select('[data-action="copy-secret"]');
  const pending = page.click(copy);
  page.document.activeElement = page.document.body;
  await page.click(copy);
  assert.equal(page.copied.length, 1);
  clipboard.resolve(); await pending;
  assert.equal(page.document.activeElement, copy);
  assert.equal(page.select('#device-secret-saved').checked, false);
});

for (const action of ['delete-device', 'rotate-secret']) {
  test(`${action} binds confirmation to the displayed device and submits once during a slow response`, async () => {
    const response = deferred(), page = dashboard({ api: () => response.promise });
    page.context.showDeviceConfirmation(action, '8'); page.flush();
    assert.match(page.root.innerHTML, /Máy &lt;An&gt; &amp; Bình/);
    assert.match(page.root.innerHTML, /An &lt;Bình&gt;/);
    assert.match(page.root.innerHTML, /UID-8/);
    assert.doesNotMatch(page.root.innerHTML, /UID-7/);
    assert.equal(page.document.activeElement.textContent, 'Hủy');
    const confirm = page.select(`[data-action="confirm-${action}"]`);
    const pending = page.click(confirm);
    for (let i = 0; i < 10; i++) await page.click(confirm);
    for (const method of ['X', 'Escape', 'backdrop']) await page.dismiss(method);
    assert.equal(page.requests.length, 1);
    assert.equal(page.unload(), true);
    assert.ok(page.root.firstElementChild);
    assert.equal(page.requests[0][0], action === 'delete-device' ? '/devices/8' : '/devices/8/rotate-secret');
    assert.equal(page.requests[0][1].method, action === 'delete-device' ? 'DELETE' : 'POST');
    response.resolve(result); await pending; page.flush();
    if (action === 'rotate-secret') {
      assert.equal(page.select('#secret-value').textContent, code);
      assert.equal(page.document.activeElement.dataset.action, 'copy-secret');
      page.acknowledge(); await page.click(page.select('#device-secret-close')); page.flush();
      assert.equal(page.document.activeElement, page.opener);
    } else {
      assert.equal(page.root.innerHTML, '');
      assert.deepEqual(page.navigation, ['devices']);
      assert.equal(page.state.selectedDeviceId, 7, 'deleting device 8 does not clear the selection of device 7');
    }
  });

  test(`${action} can be cancelled and keeps the same target available after an API error`, async () => {
    let failure = true;
    const page = dashboard({ api: async () => { if (failure) throw Error('HTTP 503'); return result; } });
    page.context.showDeviceConfirmation(action, '8'); page.flush();
    await page.click(page.document.activeElement);
    assert.equal(page.requests.length, 0);
    page.context.showDeviceConfirmation(action, '8'); page.flush();
    const confirm = page.select(`[data-action="confirm-${action}"]`);
    await page.click(confirm);
    assert.match(page.root.innerHTML, /UID-8/);
    assert.match(page.select('.device-modal-status').textContent, /Hãy kiểm tra kết nối/);
    assert.equal(confirm.disabled, false);
    assert.equal(page.unload(), false);
    assert.equal(page.toasts.at(-1)[2], 'error');
    failure = false;
    await page.click(confirm);
    assert.equal(page.requests.length, 2);
    assert.equal(page.requests[0][0], page.requests[1][0]);
  });
}

test('stale or mismatched confirmation cannot submit a different device', async () => {
  const page = dashboard();
  page.context.showDeviceConfirmation('delete-device', '7');
  const stale = page.select('[data-action="confirm-delete-device"]');
  page.context.showDeviceConfirmation('delete-device', '8');
  await page.click(stale);
  const current = page.select('[data-action="confirm-delete-device"]');
  current.dataset.id = '7';
  await page.click(current);
  assert.equal(page.requests.length, 0);
  page.context.closeModal();
  page.context.showDeviceConfirmation('delete-device', '999');
  assert.equal(page.root.innerHTML, '');
  assert.equal(page.toasts.at(-1)[2], 'error');
});

test('registration cannot be dismissed or submitted twice while the one-time code is pending', async () => {
  const response = deferred(), page = dashboard({ api: () => response.promise });
  page.context.showModal('Đăng ký thiết bị', '', page.context.deviceForm());
  page.flush();
  const form = page.select('#device-form');
  form.values = { child_id: '3', device_name: 'Laptop', device_uid: 'UID-9' };
  const event = { target: form, preventDefault() {} };
  const pending = page.context.handleSubmit(event);
  await page.context.handleSubmit(event);
  for (const method of ['X', 'Escape', 'backdrop']) await page.dismiss(method);
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0][0], '/devices');
  assert.equal(page.requests[0][1].body.child_id, 3);
  assert.equal(page.unload(), true);
  // A later list refresh failure must not destroy the successfully returned code.
  page.context.renderDevices = async () => { throw Error('list refresh failed'); };
  response.resolve(result); await pending; page.flush();
  assert.equal(page.select('#secret-value').textContent, code);
  assert.equal(page.document.activeElement.dataset.action, 'copy-secret');
  assert.equal(page.context.modalReturnFocus, page.opener);
  assert.equal(page.context.app.inert, true);
});

test('registration failure preserves input and releases the dialog for retry or cancellation', async () => {
  const page = dashboard({ api: async () => { throw Error('offline'); } });
  page.context.showModal('Đăng ký thiết bị', '', page.context.deviceForm());
  const form = page.select('#device-form');
  form.values = { child_id: '3', device_name: 'Laptop của An', device_uid: 'UID-9' };
  await page.context.handleSubmit({ target: form, preventDefault() {} });
  assert.equal(form.values.device_name, 'Laptop của An');
  assert.equal(page.select('.modal').nodes.find(n => n.attrs.type === 'submit').disabled, false);
  assert.equal(page.unload(), false);
  await page.dismiss('Escape');
  assert.equal(page.root.innerHTML, '');
});

test('registration captures every value before locking fields and keeps them locked until the secret arrives', async () => {
  const response = deferred();
  let lockedAtSend = false;
  const page = dashboard({ api: () => {
    lockedAtSend = page.select('#device-form').querySelectorAll('input, select').every(field => field.disabled);
    return response.promise;
  } });
  page.context.showModal('Đăng ký thiết bị', '', page.context.deviceForm()); page.flush();
  const form = page.select('#device-form');
  const fields = form.querySelectorAll('input, select');
  assert.deepEqual(fields.map(field => field.attrs.name), ['child_id', 'device_name', 'device_uid']);
  form.values = { child_id: '3', device_name: 'Laptop học tập của An', device_uid: 'UID-9' };
  const event = { target: form, preventDefault() {} };
  const pending = page.context.handleSubmit(event);
  assert.equal(lockedAtSend, true);
  assert.ok(fields.every(field => field.disabled));
  assert.equal(page.document.activeElement, page.select('.device-modal-status'));
  assert.match(page.select('.device-modal-status').textContent, /Các trường tạm khóa/);
  page.advanceTime(10_000);
  assert.ok(fields.every(field => field.disabled));
  assert.match(page.select('.device-modal-status').textContent, /mất nhiều thời gian hơn bình thường/);
  await page.context.handleSubmit(event);
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0][0], '/devices');
  assert.equal(page.requests[0][1].method, 'POST');
  assert.deepEqual({ ...page.requests[0][1].body }, { child_id: 3, device_name: 'Laptop học tập của An', device_uid: 'UID-9' });
  response.resolve(result); await pending; page.flush();
  assert.equal(form.isConnected, false);
  assert.equal(page.select('#secret-value').textContent, code);
  assert.equal(page.select('#device-secret-saved').checked, false);
  assert.equal(page.select('#device-secret-close').disabled, true);
  assert.equal(page.document.activeElement.dataset.action, 'copy-secret');
});

test('registration unlocks unchanged fields after failure and sends edited values only on explicit retry', async () => {
  let response = deferred();
  const page = dashboard({ api: () => response.promise });
  page.context.showModal('Đăng ký thiết bị', '', page.context.deviceForm()); page.flush();
  const form = page.select('#device-form');
  const fields = form.querySelectorAll('input, select');
  const original = { child_id: '3', device_name: 'Laptop của An', device_uid: 'UID-9' };
  form.values = { ...original };
  const event = { target: form, preventDefault() {} };
  const pending = page.context.handleSubmit(event);
  assert.ok(fields.every(field => field.disabled));
  response.reject(Error('offline')); await pending;
  assert.equal(page.select('#device-form'), form);
  assert.deepEqual(form.values, original);
  assert.ok(fields.every(field => !field.disabled));
  assert.equal(page.select('[type="submit"]').disabled, false);
  assert.equal(page.unload(), false);
  assert.match(page.select('.device-modal-status').textContent, /Hãy kiểm tra kết nối/);
  assert.equal(page.requests.length, 1);
  form.values = { child_id: '4', device_name: 'Laptop của Bình', device_uid: 'UID-10' };
  response = deferred();
  const retry = page.context.handleSubmit(event);
  assert.ok(fields.every(field => field.disabled));
  await page.context.handleSubmit(event);
  assert.equal(page.requests.length, 2);
  assert.deepEqual({ ...page.requests[1][1].body }, { child_id: 4, device_name: 'Laptop của Bình', device_uid: 'UID-10' });
  response.resolve(result); await retry; page.flush();
  assert.equal(page.select('#secret-value').textContent, code);
  assert.equal(page.select('#device-secret-close').disabled, true);
});

test('rename submits once and keeps its existing API, completion and focus behavior', async () => {
  const response = deferred(), page = dashboard({ api: () => response.promise });
  const form = await page.openRename();
  form.values = { device_name: 'Laptop học tập của An' };
  const submit = page.select('[type="submit"]');
  const event = { target: form, preventDefault() {} };
  const pending = page.context.handleSubmit(event);
  const duplicate = page.context.handleSubmit(event);
  const disabledWhilePending = submit.disabled;
  response.resolve({});
  await Promise.all([pending, duplicate]); page.flush();
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0][0], '/devices/7');
  assert.equal(page.requests[0][1].method, 'PUT');
  assert.equal(page.requests[0][1].body.device_name, form.values.device_name);
  assert.equal(disabledWhilePending, true);
  assert.equal(page.root.innerHTML, '');
  assert.deepEqual(page.navigation, ['devices']);
  assert.equal(page.toasts[0][0], 'Đã đổi tên thiết bị');
  assert.equal(page.document.activeElement, page.opener);
});

for (const nextDialog of ['registration', 'same-device-rename']) {
  for (const outcome of ['success', 'failure']) {
    test(`late rename ${outcome} leaves a new ${nextDialog} modal and its input untouched`, async () => {
      const response = deferred(), page = dashboard({ api: () => response.promise });
      const form = await page.openRename();
      form.values = { device_name: 'Tên đang lưu' };
      const pending = page.context.handleSubmit({ target: form, preventDefault() {} });
      await page.dismiss('Escape'); page.flush();
      let newForm;
      if (nextDialog === 'registration') {
        page.context.showModal('Đăng ký thiết bị', '', page.context.deviceForm()); page.flush();
        newForm = page.select('#device-form');
      } else newForm = await page.openRename();
      newForm.values = { device_name: 'Nội dung đang nhập chưa lưu' };
      const activeModal = page.select('.modal'), activeControl = page.document.activeElement;
      const newSubmit = page.select('[type="submit"]');
      const html = page.root.innerHTML;
      if (outcome === 'success') response.resolve({});
      else response.reject(Error('offline'));
      await pending; page.flush();
      assert.equal(page.select('.modal'), activeModal);
      assert.equal(page.root.innerHTML, html);
      assert.equal(newForm.values.device_name, 'Nội dung đang nhập chưa lưu');
      assert.equal(newSubmit.disabled, false);
      assert.equal(page.document.activeElement, activeControl);
      assert.equal(page.context.app.inert, true);
      assert.deepEqual(page.navigation, []);
      assert.deepEqual(page.toasts, []);
      assert.equal(page.requests.length, 1);
    });
  }
}

test('late rename does not navigate back after the user changes page', async () => {
  const response = deferred(), page = dashboard({ api: () => response.promise });
  const form = await page.openRename();
  form.values = { device_name: 'Tên đang lưu' };
  const pending = page.context.handleSubmit({ target: form, preventDefault() {} });
  page.state.page = 'children';
  response.resolve({}); await pending;
  assert.equal(page.state.page, 'children');
  assert.deepEqual(page.navigation, []);
  assert.deepEqual(page.toasts, []);
});

test('current rename failure preserves input and allows an explicit retry', async () => {
  let fail = true;
  const page = dashboard({ api: async () => { if (fail) throw Error('offline'); return {}; } });
  const form = await page.openRename();
  const modal = page.select('.modal');
  form.values = { device_name: 'Tên chưa lưu' };
  const event = { target: form, preventDefault() {} };
  await page.context.handleSubmit(event);
  assert.equal(page.select('.modal'), modal);
  assert.equal(form.values.device_name, 'Tên chưa lưu');
  assert.equal(page.select('[type="submit"]').disabled, false);
  assert.equal(page.toasts.at(-1)[2], 'error');
  assert.deepEqual(page.navigation, []);
  fail = false;
  await page.context.handleSubmit(event);
  assert.equal(page.requests.length, 2);
  assert.equal(page.root.innerHTML, '');
  assert.deepEqual(page.navigation, ['devices']);
});

for (const action of ['registration', 'delete-device', 'rotate-secret']) {
  for (const outcome of ['success', 'failure']) {
    test(`${action} announces a slow request without retrying and handles late ${outcome}`, async () => {
      const response = deferred(), page = dashboard({ api: () => response.promise });
      let pending, repeat;
      if (action === 'registration') {
        page.context.showModal('Đăng ký thiết bị', '', page.context.deviceForm()); page.flush();
        const form = page.select('#device-form');
        form.values = { child_id: '3', device_name: 'Laptop', device_uid: 'UID-9' };
        repeat = () => page.context.handleSubmit({ target: form, preventDefault() {} });
      } else {
        page.context.showDeviceConfirmation(action, '8'); page.flush();
        const confirm = page.select(`[data-action="confirm-${action}"]`);
        repeat = () => page.click(confirm);
      }
      pending = repeat();
      const status = page.select('.device-modal-status');
      const initialMessage = status.textContent;
      page.advanceTime(9999);
      assert.equal(status.textContent, initialMessage);
      page.select('.modal').focus();
      const focusBeforeNotice = page.document.activeElement;
      page.advanceTime(1);
      assert.match(status.textContent, /mất nhiều thời gian hơn bình thường/);
      assert.equal(status.attrs.role, 'status');
      assert.equal(status.attrs['aria-live'], 'polite');
      assert.equal(page.document.activeElement, focusBeforeNotice, 'slow notice must not steal focus');
      page.advanceTime(60_000);
      await repeat();
      assert.equal(page.requests.length, 1, 'waiting does not retry or release duplicate protection');
      assert.ok(page.select('.modal').nodes.filter(node => node.tag === 'button').every(node => node.disabled));
      for (const method of ['X', 'Escape', 'backdrop']) await page.dismiss(method);
      assert.ok(page.select('.modal'));
      assert.equal(page.unload(), true);
      if (outcome === 'success') response.resolve(result);
      else response.reject(Error('offline'));
      await pending; page.flush();
      assert.equal(page.pendingTimers(), 0);
      if (outcome === 'failure') {
        assert.match(status.textContent, /Hãy kiểm tra kết nối/);
        assert.doesNotMatch(status.textContent, /mất nhiều thời gian hơn bình thường/);
        assert.equal(page.select('.modal').dataset.devicePending, undefined);
        assert.ok(page.select('.modal').nodes.filter(node => node.tag === 'button').every(node => !node.disabled));
        assert.equal(page.unload(), false);
      } else if (action === 'delete-device') {
        assert.equal(page.root.innerHTML, '');
        assert.deepEqual(page.navigation, ['devices']);
      } else {
        assert.equal(page.select('#secret-value').textContent, code);
        assert.equal(page.select('#device-secret-saved').checked, false);
        assert.equal(page.select('#device-secret-close').disabled, true);
        assert.equal(page.unload(), true);
        assert.equal(page.document.activeElement.dataset.action, 'copy-secret');
      }
    });
  }
}

test('finished requests clear their notice timer before a new request or modal', async () => {
  const page = dashboard({ api: async () => { throw Error('offline'); } });
  page.context.showDeviceConfirmation('rotate-secret', '8'); page.flush();
  await page.click(page.select('[data-action="confirm-rotate-secret"]'));
  const status = page.select('.device-modal-status'), errorMessage = status.textContent;
  assert.equal(page.pendingTimers(), 0);
  page.advanceTime(10_000);
  assert.equal(status.textContent, errorMessage);
  const retry = deferred();
  page.context.api = () => retry.promise;
  const pending = page.click(page.select('[data-action="confirm-rotate-secret"]'));
  const loadingMessage = status.textContent;
  page.advanceTime(9999);
  assert.equal(status.textContent, loadingMessage);
  retry.resolve(result); await pending; page.flush();
  assert.equal(page.pendingTimers(), 0);
  const secretStatus = page.select('#device-secret-status');
  page.advanceTime(10_000);
  assert.equal(secretStatus.textContent, '');
  assert.equal(page.select('#secret-value').textContent, code);
});

test('other dashboard dialogs retain normal dismissal, focus restoration and no unload warning', () => {
  const page = dashboard();
  page.context.showModal('Unrelated dialog', '', '<button data-action="close-modal">Đóng</button>');
  page.flush();
  assert.equal(page.unload(), false);
  page.key('Escape'); page.flush();
  assert.equal(page.root.innerHTML, '');
  assert.equal(page.document.activeElement, page.opener);
  assert.equal(page.context.app.inert, false);
});
