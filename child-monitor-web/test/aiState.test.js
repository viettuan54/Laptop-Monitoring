const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./queryAlertRenderer');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const tick = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Identity/value/focus boundary double only. No browser layout, CSS or screen-reader emulation.
function aiDOM() {
  const listeners = new Map();
  const encode = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const decode = value => value.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const document = {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatch(type, target) { for (const fn of [...(listeners.get(type) || [])]) fn({ target }); },
    hasFocus: () => true,
  };
  class Element {
    constructor(tag = 'div', attributes = {}) {
      this.tag = tag; this.attributes = attributes; this.children = []; this.parent = null;
      this.scrollTop = 0; this.scrollHeight = 100; this.clientHeight = 100;
      this.dataset = new Proxy({}, {
        get: (_, key) => this.attributes['data-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())],
        set: (_, key, value) => { this.attributes['data-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())] = String(value); return true; },
      });
    }
    get id() { return this.attributes.id; }
    get name() { return this.attributes.name; }
    get firstElementChild() { return this.children.find(c => c instanceof Element) || null; }
    get isConnected() { return this === document.body || Boolean(this.parent?.isConnected); }
    get disabled() { return 'disabled' in this.attributes; }
    set disabled(value) {
      if (value) { this.attributes.disabled = ''; if (document.activeElement === this) document.activeElement = document.body; }
      else delete this.attributes.disabled;
    }
    get readOnly() { return 'readonly' in this.attributes; }
    set readOnly(value) { if (value) this.attributes.readonly = ''; else delete this.attributes.readonly; }
    get value() { return this.currentValue ?? this.attributes.value ?? this.querySelectorAll('option').find(o => 'selected' in o.attributes)?.attributes.value ?? ''; }
    set value(value) { this.currentValue = String(value); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    contains(node) { return this === node || this.children.some(c => c instanceof Element && c.contains(node)); }
    matches(selector) {
      const parts = selector.trim().split(/\s+/);
      if (parts.length > 1) return this.matches(parts.pop()) && Boolean(this.parent?.closest(parts.join(' ')));
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (selector.startsWith('.')) return (this.attributes.class || '').split(' ').includes(selector.slice(1));
      const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
      return attr ? attr[1] in this.attributes && (attr[2] === undefined || this.attributes[attr[1]] === attr[2]) : this.tag === selector;
    }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
    querySelectorAll(selector) {
      const found = [];
      const walk = node => { for (const child of node.children) if (child instanceof Element) {
        if (selector.split(',').some(s => child.matches(s.trim()))) found.push(child);
        walk(child);
      } };
      walk(this); return found;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get innerHTML() { return this.children.map(c => c instanceof Element ? c.outerHTML : c).join(''); }
    set innerHTML(html) {
      if (document.activeElement !== this && this.contains(document.activeElement)) document.activeElement = document.body;
      for (const child of this.children) if (child instanceof Element) child.parent = null;
      this.children = [];
      const stack = [this];
      for (const m of String(html).matchAll(/<\/([\w-]+)\s*>|<([\w-]+)\b([^>]*)>|([^<]+)/g)) {
        if (m[1]) { if (stack.length > 1) stack.pop(); }
        else if (m[2]) {
          const attributes = Object.fromEntries([...m[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(a => [a[1], decode(a[2] ?? '')]));
          const node = new Element(m[2], attributes); node.parent = stack.at(-1); node.parent.children.push(node);
          if (!['input', 'img', 'br', 'hr'].includes(m[2])) stack.push(node);
        } else stack.at(-1).children.push(m[4]);
      }
    }
    get outerHTML() { return `<${this.tag}${Object.entries(this.attributes).map(([k, v]) => ` ${k}="${encode(v)}"`).join('')}>${this.innerHTML}</${this.tag}>`; }
    get textContent() { return decode(this.innerHTML.replace(/<[^>]*>/g, '')); }
    set textContent(value) { this.innerHTML = encode(value); }
    focus() { if (!this.disabled && this.isConnected) { document.activeElement = this; document.dispatch('focusin', this); } }
    reset() { for (const input of this.querySelectorAll('input')) input.value = ''; }
  }
  document.body = new Element('body'); document.activeElement = document.body;
  document.querySelector = selector => document.body.querySelector(selector);
  const modalRoot = new Element('div');
  const replace = () => {
    for (const child of document.body.children) child.parent = null;
    const content = new Element('main', { id: 'page-content', tabindex: '-1' });
    content.parent = document.body; document.body.children = [content]; document.activeElement = document.body;
    return content;
  };
  return { document, Element, modalRoot, replace, listeners };
}

const devices = [{ device_id: 'A', device_name: 'Máy A' }, { device_id: 'B', device_name: 'Máy B' }];
const row = (id, name = `${id}-result`) => ({ device_id: id, behavior_type: name, risk_level: 'low', suggestion: 'Gợi ý', analyzed_at: '2026-11-04T00:00:00Z' });
function fixture() {
  const dom = aiDOM(), calls = [], notices = [], modals = [], nav = [], closed = [];
  const state = { page: 'ai', role: 'parent', userId: 7, accessToken: 'token-1', selectedDeviceId: 'A', devices: devices.slice(), analyses: [], chat: [], userMenuOpen: false };
  const page = { ...dom, state, calls, notices, modals, nav, closed };
  page.request = async route => {
    if (route.startsWith('/devices')) return { data: devices };
    if (route.startsWith('/ai-analysis?')) return { data: [row(new URL('http://fixture' + route).searchParams.get('device_id'))] };
    if (route.startsWith('/ai-analysis/latest/')) return row(route.split('/').at(-1));
    if (route.startsWith('/ai-analysis/summary/')) return { summary: 'Báo cáo thử' };
    if (route === '/ai-analysis/chat') return { reply: 'Trả lời thử' };
    return {};
  };
  const context = page.context = vm.createContext({
    state, document: dom.document, modalRoot: dom.modalRoot, URLSearchParams, aiSessions: new WeakMap(),
    api: async (route, options = {}) => { calls.push({ route, method: options.method || 'GET', body: options.body }); return page.request(route, options); },
    pageHead: (_p, actions) => `<header>${actions}</header>`, sectionVisual: (_p, actions) => `<section>${actions}</section>`,
    toast: (...args) => notices.push(args), localizeError: x => x,
    showModal: (...args) => { modals.push(args); dom.modalRoot.innerHTML = '<div class="modal"></div>'; },
    closeModal: () => { closed.push(true); dom.modalRoot.innerHTML = ''; }, navigate: p => nav.push(p),
    HTMLFormElement: dom.Element,
    FormData: class { constructor(form) { this.entries = form.querySelectorAll('input').map(n => [n.name, n.value]); } [Symbol.iterator]() { return this.entries[Symbol.iterator](); } },
    INITIAL_CHAT: [], app: { inert: false }, toastRoot: new dom.Element(), modalReturnFocus: null, activityRenderVersion: 0,
    sessionStorage: { removeItem() {} }, emptyUsageSummary: () => ({}),
    stopScreenshotPolling() {}, stopBreakReminderPolling() {}, stopAlertPolling() {}, stopFaceCamera() {},
  });
  const helpers = [...source.slice(source.indexOf('function aiSession()'), source.indexOf('function pushPlatformOptions')).matchAll(/^(?:async )?function (\w+)\(/gm)].map(m => m[1]);
  for (const name of [...helpers, 'escapeHtml', 'formatDate', 'deviceName', 'queryString', 'reconcileSelectedId', 'riskLevelLabel', 'emptyState', 'handleClick', 'handleSubmit', 'clearSession']) {
    let code = functionSource(source, name);
    if (name === 'handleClick') code = code.split("\ndocument.addEventListener('submit'")[0];
    vm.runInContext(code, context);
  }
  const changeStart = source.indexOf("document.addEventListener('change', (event) =>", source.indexOf('async function handleClick'));
  vm.runInContext(source.slice(changeStart, source.indexOf("document.addEventListener('keydown'", changeStart)), context);
  const inputStart = source.indexOf("document.addEventListener('input', event =>");
  vm.runInContext(source.slice(inputStart, source.indexOf("document.addEventListener('visibilitychange'", inputStart)), context);
  page.mount = async (wait = true) => {
    state.page = 'ai'; page.content = dom.replace(); page.view = await context.renderAI(page.content);
    if (wait) await page.view.historyTask;
    return page.view;
  };
  page.find = selector => page.content.querySelector(selector);
  page.click = (action, period, focus = true) => {
    const button = page.content.querySelectorAll(`[data-action="${action}"]`).find(b => !period || b.dataset.period === period);
    assert.ok(button, action);
    if (focus) button.focus();
    return context.handleClick({ target: button });
  };
  page.change = id => { const picker = page.find('#ai-device'); picker.value = id; picker.focus(); dom.document.dispatch('change', picker); return page.view.historyTask; };
  page.draft = text => { const input = page.find('[name="message"]'); input.value = text; dom.document.dispatch('input', input); return input; };
  page.submit = () => context.handleSubmit({ target: page.find('#chat-form'), preventDefault() {} });
  page.leave = (route = 'alerts') => { state.page = route; page.content = dom.replace(); page.content.innerHTML = `<p>${route}</p>`; };
  page.loginAgain = () => { context.clearSession(); Object.assign(state, { role: 'parent', userId: 7, accessToken: 'new-login', page: 'ai', devices: devices.slice(), selectedDeviceId: 'A' }); };
  return page;
}

test('mount resolves before network, and history loading has a stable scoped status', async () => {
  const p = fixture(), request = deferred(); p.request = () => request.promise;
  const view = await p.mount(false);
  assert.equal(p.find('#ai-history').getAttribute('aria-busy'), 'true');
  assert.match(p.find('#ai-history-status').textContent, /Đang tải/);
  assert.equal(p.find('#chat-form').getAttribute('aria-busy'), 'false');
  request.resolve({ data: [] }); await view.historyTask;
  assert.equal(p.find('#ai-history').getAttribute('aria-busy'), 'false');
});

test('slow device A cannot replace B history or shared state', async () => {
  const p = fixture(), old = deferred(), normal = p.request;
  p.request = route => route.startsWith('/ai-analysis?device_id=A') ? old.promise : normal(route);
  const view = await p.mount(false); await tick(); const first = view.historyTask;
  await p.change('B'); const html = p.find('#ai-history').innerHTML;
  old.resolve({ data: [row('A', 'OLD')] }); await first;
  assert.equal(p.state.selectedDeviceId, 'B'); assert.equal(p.state.analyses[0].device_id, 'B');
  assert.equal(p.find('#ai-history').innerHTML, html);
});

test('A to B to A rejects the first A even though the selected ID matches again', async () => {
  const p = fixture(), requests = [], normal = p.request;
  p.request = route => { if (!route.startsWith('/ai-analysis?')) return normal(route); const d = deferred(); requests.push(d); return d.promise; };
  const view = await p.mount(false); await tick(); const a1 = view.historyTask;
  const b = p.change('B'); await tick(); const a2 = p.change('A'); await tick();
  requests[2].resolve({ data: [row('A', 'A-NEW')] }); await a2;
  requests[1].resolve({ data: [row('B')] }); await b;
  requests[0].resolve({ data: [row('A', 'A-OLD')] }); await a1;
  assert.equal(p.state.analyses[0].behavior_type, 'A-NEW');
  assert.doesNotMatch(p.find('#ai-history').innerHTML, /A-OLD/);
});

test('stale devices fetch cannot commit devices or launch the old history request', async () => {
  const p = fixture(), old = deferred(), normal = p.request; let first = true;
  p.request = route => { if (first) { first = false; return old.promise; } return normal(route); };
  const view = await p.mount(false); const pending = view.historyTask;
  await p.change('B'); old.resolve({ data: [{ device_id: 'OLD', device_name: 'Old' }] }); await pending;
  assert.equal(p.state.devices[0].device_id, 'A'); assert.equal(p.state.selectedDeviceId, 'B');
  assert.ok(!p.calls.some(c => c.route.includes('device_id=OLD')));
});

test('new scope GET failure clears old results and retry uses the selected scope', async () => {
  const p = fixture(); await p.mount(); const normal = p.request;
  p.request = route => { if (route.includes('device_id=B')) throw Error('offline'); return normal(route); };
  await p.change('B');
  assert.deepEqual(Array.from(p.state.analyses), []);
  assert.doesNotMatch(p.find('#ai-history').innerHTML, /A-result/);
  assert.equal(p.find('#ai-history').getAttribute('aria-busy'), 'false');
  assert.match(p.find('#ai-history-status').textContent, /offline/);
  p.request = normal; await p.click('retry-ai-history');
  assert.equal(p.state.analyses[0].device_id, 'B'); assert.equal(p.notices.length, 0);
});

for (const phase of ['devices', 'history']) test(`unmounted ${phase} request cannot write state or a replacement route`, async () => {
  const p = fixture(), request = deferred(), normal = p.request;
  p.request = route => route.startsWith(phase === 'devices' ? '/devices' : '/ai-analysis?') ? request.promise : normal(route);
  const view = await p.mount(false); await tick(); p.leave();
  const stateBefore = JSON.stringify([p.state.devices, p.state.selectedDeviceId, p.state.analyses]);
  request.resolve({ data: phase === 'devices' ? [{ device_id: 'OLD' }] : [row('A', 'OLD')] }); await view.historyTask;
  assert.equal(JSON.stringify([p.state.devices, p.state.selectedDeviceId, p.state.analyses]), stateBefore);
  assert.equal(p.content.textContent, 'alerts');
});

test('analysis POST completing on Alerts cannot render, toast, focus or refresh there', async () => {
  const p = fixture(); await p.mount(); const request = deferred(), normal = p.request;
  p.request = (route, options) => options.method === 'POST' ? request.promise : normal(route);
  const pending = p.click('run-analysis'); p.leave(); const calls = p.calls.length;
  request.resolve({}); await pending;
  assert.equal(p.content.textContent, 'alerts'); assert.equal(p.calls.length, calls);
  assert.equal(p.notices.length, 0); assert.equal(p.document.activeElement, p.document.body);
});

test('pending analysis is adopted on remount without a second POST', async () => {
  const p = fixture(); await p.mount(); const request = deferred(), normal = p.request;
  p.request = (route, options) => options.method === 'POST' ? request.promise : normal(route);
  const oldButton = p.find('[data-action="run-analysis"]');
  const pending = p.click('run-analysis'); p.leave(); await p.mount();
  const newButton = p.find('[data-action="run-analysis"]');
  assert.notEqual(oldButton, newButton); assert.equal(newButton.disabled, true);
  await p.click('run-analysis', null, false);
  assert.equal(p.calls.filter(c => c.method === 'POST').length, 1);
  request.resolve({}); await pending;
  assert.equal(newButton.disabled, false); assert.match(p.find('#ai-analysis-status').textContent, /đã hoàn thành/);
  assert.equal(p.find('#ai-history').getAttribute('aria-busy'), 'false');
});

test('analysis on A can finish while B is selected without changing B or sending a B POST', async () => {
  const p = fixture(); await p.mount(); const request = deferred(), normal = p.request;
  p.request = (route, options) => options.method === 'POST' ? request.promise : normal(route);
  const pending = p.click('run-analysis'); await p.change('B'); const html = p.find('#ai-history').innerHTML;
  request.resolve({}); await pending;
  assert.equal(p.find('#ai-history').innerHTML, html); assert.equal(p.state.selectedDeviceId, 'B');
  assert.equal(p.find('#ai-analysis-status').textContent, '');
  assert.equal(p.calls.find(c => c.method === 'POST').route, '/ai-analysis/analyze/A');
});

test('POST success and failed GET remain distinct; retry only loads GET results', async () => {
  const p = fixture(); await p.mount(); const normal = p.request; let posted = false, fail = true;
  p.request = (route, options) => {
    if (options.method === 'POST') { posted = true; return {}; }
    if (posted && fail && route.startsWith('/ai-analysis?')) throw Error('refresh offline');
    return normal(route);
  };
  await assert.doesNotReject(p.click('run-analysis'));
  assert.match(p.find('#ai-analysis-status').textContent, /đã hoàn thành, nhưng chưa tải lại/);
  assert.equal(p.find('[data-action="run-analysis"]').textContent, '✦ Chạy phân tích mới');
  assert.equal(p.notices.length, 0);
  fail = false; await p.click('retry-ai-analysis');
  assert.equal(p.calls.filter(c => c.method === 'POST').length, 1);
  assert.match(p.find('#ai-history').textContent, /A-result/);
  assert.equal(p.find('[data-action="retry-ai-analysis"]'), null);
});

test('analysis remains pending during refresh GET and duplicate POST is blocked', async () => {
  const p = fixture(); await p.mount(); const get = deferred(), normal = p.request; let posted = false;
  p.request = (route, options) => {
    if (options.method === 'POST') { posted = true; return {}; }
    return posted && route.startsWith('/ai-analysis?') ? get.promise : normal(route);
  };
  const pending = p.click('run-analysis'); await tick();
  assert.equal(p.find('[data-action="run-analysis"]').disabled, true);
  assert.equal(p.find('[data-action="run-analysis"]').textContent, 'Đang tải kết quả…');
  await p.click('run-analysis', null, false);
  assert.equal(p.calls.filter(c => c.method === 'POST').length, 1);
  get.resolve({ data: [row('A', 'NEW')] }); await pending;
  assert.equal(p.find('[data-action="run-analysis"]').disabled, false);
});

test('POST network failure is unconfirmed, not declared never executed, and does not auto-retry', async () => {
  const p = fixture(); await p.mount(); const normal = p.request;
  p.request = (route, options) => { if (options.method === 'POST') throw Error('offline'); return normal(route); };
  await p.click('run-analysis');
  assert.match(p.find('#ai-analysis-status').textContent, /Chưa xác nhận/);
  await p.click('retry-ai-analysis');
  assert.equal(p.calls.filter(c => c.method === 'POST').length, 1);
  assert.match(p.find('#ai-analysis-status').textContent, /Chưa xác nhận/);
});

test('chat keeps exact draft readonly while pending and submits only once', async () => {
  const p = fixture(); await p.mount(); const request = deferred(); p.request = () => request.promise;
  const input = p.draft('  Câu hỏi <gốc> & không sửa  '); input.focus();
  const pending = p.submit(); await p.submit();
  assert.equal(input.readOnly, true); assert.equal(input.value, '  Câu hỏi <gốc> & không sửa  ');
  assert.equal(p.find('[type="submit"]').disabled, true);
  assert.match(p.find('#ai-chat-status').textContent, /Đang chờ phản hồi/);
  assert.equal(p.state.chat.length, 0);
  const chatCalls = p.calls.filter(c => c.route === '/ai-analysis/chat');
  assert.equal(chatCalls.length, 1); assert.deepEqual(Object.keys(chatCalls[0].body), ['messages']);
  assert.equal(chatCalls[0].body.messages[0].content, input.value);
  request.resolve({ reply: 'Phản hồi' }); await pending;
  assert.equal(input.readOnly, false); assert.equal(input.value, '');
  assert.equal(p.state.chat.length, 2); assert.equal(p.document.activeElement, input);
});

test('failed chat preserves draft and completed history; explicit retry commits exactly one pair', async () => {
  const p = fixture(); p.state.chat.push({ role: 'model', content: 'Trước đó' }); await p.mount();
  const input = p.draft('Câu hỏi cần giữ'); const oldHistory = JSON.stringify(p.state.chat);
  p.request = async () => { throw Error('chat offline'); }; await p.submit();
  assert.equal(input.value, 'Câu hỏi cần giữ'); assert.equal(input.readOnly, false);
  assert.equal(JSON.stringify(p.state.chat), oldHistory); assert.match(p.find('#ai-chat-status').textContent, /chat offline/);
  p.request = async () => ({ reply: 'Thành công' }); await p.submit();
  assert.equal(p.state.chat.filter(m => m.content === 'Câu hỏi cần giữ').length, 1);
  assert.equal(p.state.chat.length, 3);
  const sends = p.calls.filter(c => c.route === '/ai-analysis/chat');
  assert.equal(JSON.stringify(sends[0].body), JSON.stringify(sends[1].body));
  assert.equal(p.notices.length, 0);
});

test('chat can complete in session memory while another route remains untouched', async () => {
  const p = fixture(); await p.mount(); const request = deferred(), normal = p.request;
  p.request = route => route === '/ai-analysis/chat' ? request.promise : normal(route);
  p.draft('Giữ hội thoại'); const pending = p.submit(); p.leave(); const count = p.calls.length;
  request.resolve({ reply: 'Đã trả lời' }); await pending;
  assert.equal(p.content.textContent, 'alerts'); assert.equal(p.calls.length, count);
  assert.equal(p.state.chat.length, 2); assert.equal(p.notices.length, 0);
  await p.mount(); assert.match(p.find('#chat-messages').textContent, /Đã trả lời/);
  assert.equal(p.find('[name="message"]').value, '');
});

test('chat pending survives remount and device changes without allowing duplicate submit', async () => {
  const p = fixture(); await p.mount(); const request = deferred(), normal = p.request;
  p.request = route => route === '/ai-analysis/chat' ? request.promise : normal(route);
  p.draft('Đang gửi'); const pending = p.submit(); p.leave(); await p.mount();
  assert.equal(p.find('[name="message"]').value, 'Đang gửi');
  assert.equal(p.find('[name="message"]').readOnly, true);
  await p.change('B'); await p.submit();
  assert.equal(p.calls.filter(c => c.route === '/ai-analysis/chat').length, 1);
  request.resolve({ reply: 'OK' }); await pending;
  assert.equal(p.find('[name="message"]').readOnly, false);
  assert.match(p.find('#chat-messages').textContent, /OK/); assert.equal(p.state.chat.length, 2);
});

test('an unsent draft survives leaving AI and history refresh without persistence', async () => {
  const p = fixture(); await p.mount(); p.draft('Bản nháp chưa gửi');
  const form = p.find('#chat-form'); await p.change('B');
  assert.equal(p.find('#chat-form'), form); assert.equal(p.find('[name="message"]').value, 'Bản nháp chưa gửi');
  p.leave(); await p.mount(); assert.equal(p.find('[name="message"]').value, 'Bản nháp chưa gửi');
  assert.equal(p.calls.filter(c => c.method === 'POST').length, 0);
});

test('chat payload keeps last 20 completed messages plus new question and no device context', async () => {
  const p = fixture(); for (let i = 0; i < 26; i++) p.state.chat.push({ role: i % 2 ? 'model' : 'user', content: `M${i}` });
  await p.mount(); p.draft('MỚI'); await p.submit();
  const body = p.calls.find(c => c.route === '/ai-analysis/chat').body;
  assert.equal(body.messages.length, 20); assert.equal(body.messages[0].content, 'M7');
  assert.equal(body.messages.at(-1).content, 'MỚI'); assert.deepEqual(Object.keys(body), ['messages']);
});

test('weekly result wins over an older daily response', async () => {
  const p = fixture(); await p.mount(); const daily = deferred(), weekly = deferred();
  p.request = route => route.endsWith('daily') ? daily.promise : weekly.promise;
  const first = p.click('summary', 'daily'); await p.click('summary', 'daily', false);
  const second = p.click('summary', 'weekly');
  assert.equal(p.calls.filter(c => c.route.includes('/summary/')).length, 2);
  weekly.resolve({ summary: 'WEEKLY NEW' }); await second;
  daily.resolve({ summary: 'DAILY OLD' }); await first;
  assert.match(p.find('#summary-result').textContent, /WEEKLY NEW/);
  assert.doesNotMatch(p.find('#summary-result').textContent, /DAILY OLD/);
  assert.match(p.find('#ai-summary-status').textContent, /Báo cáo tuần/);
});

test('old summary rejection cannot clear newer pending, change buttons or announce an old error', async () => {
  const p = fixture(); await p.mount(); const daily = deferred(), weekly = deferred();
  p.request = route => route.endsWith('daily') ? daily.promise : weekly.promise;
  const first = p.click('summary', 'daily'), second = p.click('summary', 'weekly');
  daily.reject(Error('OLD ERROR')); await first;
  assert.equal(p.find('#summary-result').getAttribute('aria-busy'), 'true');
  assert.equal(p.content.querySelectorAll('[data-action="summary"]').find(b => b.dataset.period === 'weekly').disabled, true);
  assert.doesNotMatch(p.find('#ai-summary-status').textContent, /OLD ERROR/);
  weekly.resolve({ summary: 'OK' }); await second;
});

for (const message of ['offline', 'HTTP 429']) test(`summary ${message} ends busy and offers scoped GET retry`, async () => {
  const p = fixture(); await p.mount(); p.request = async () => { throw Object.assign(Error(message), { status: message.includes('429') ? 429 : 500 }); };
  await p.click('summary', 'daily');
  assert.equal(p.find('#summary-result').getAttribute('aria-busy'), 'false');
  assert.match(p.find('#summary-result').textContent, new RegExp(message));
  assert.equal(p.notices.length, 0);
  p.request = async () => ({ summary: 'RECOVERED' }); await p.click('retry-ai-summary');
  assert.match(p.find('#summary-result').textContent, /RECOVERED/);
  assert.ok(p.calls.filter(c => c.route.includes('/summary/')).every(c => c.route === '/ai-analysis/summary/A?period=daily' && c.method === 'GET'));
});

test('device change A to B to A permanently invalidates the previous summary and retry hook', async () => {
  const p = fixture(); await p.mount(); const request = deferred(), normal = p.request;
  p.request = route => route.includes('/summary/') ? request.promise : normal(route);
  const pending = p.click('summary', 'daily'); await p.change('B'); await p.change('A');
  request.resolve({ summary: 'STALE' }); await pending;
  assert.equal(p.find('#summary-result').textContent, '');
  p.request = async route => { if (route.includes('/summary/')) throw Error('error'); return normal(route); };
  await p.click('summary', 'daily'); const retry = p.find('[data-action="retry-ai-summary"]');
  await p.change('B'); const count = p.calls.length;
  await p.context.handleClick({ target: retry }); assert.equal(p.calls.length, count);
});

test('summary and chat completion are independent and preserve stable form/report nodes', async () => {
  const p = fixture(); await p.mount(); const daily = deferred(), chat = deferred(), normal = p.request;
  p.request = route => route.includes('/summary/') ? daily.promise : route === '/ai-analysis/chat' ? chat.promise : normal(route);
  const form = p.find('#chat-form'), input = p.draft('Câu hỏi'), report = p.find('#summary-result');
  const s = p.click('summary', 'daily'), c = p.submit();
  daily.resolve({ summary: 'KEEP REPORT' }); await s; chat.resolve({ reply: 'OK' }); await c;
  assert.equal(p.find('#chat-form'), form); assert.equal(p.find('[name="message"]'), input);
  assert.equal(p.find('#summary-result'), report); assert.match(report.textContent, /KEEP REPORT/);
  p.draft('DRAFT AFTER CHAT'); await p.click('run-analysis');
  assert.match(report.textContent, /KEEP REPORT/); assert.equal(input.value, 'DRAFT AFTER CHAT');
});

test('daily to weekly to daily reuses the in-flight GET without displaying the intervening period', async () => {
  const p = fixture(); await p.mount(); const daily = deferred(), weekly = deferred();
  p.request = route => route.endsWith('daily') ? daily.promise : weekly.promise;
  const a1 = p.click('summary', 'daily'), b = p.click('summary', 'weekly'), a2 = p.click('summary', 'daily');
  assert.equal(p.calls.filter(c => c.route.includes('/summary/')).length, 2);
  weekly.resolve({ summary: 'OLD WEEKLY' }); await b;
  assert.equal(p.find('#summary-result').getAttribute('aria-busy'), 'true');
  daily.resolve({ summary: 'DAILY CURRENT' }); await Promise.all([a1, a2]);
  assert.match(p.find('#summary-result').textContent, /DAILY CURRENT/);
});

for (const departure of ['route', 'remount', 'device', 'device-roundtrip']) test(`latest response cannot open a modal after ${departure}`, async () => {
  const p = fixture(); await p.mount(); const request = deferred(), normal = p.request;
  p.request = route => route.includes('/latest/') ? request.promise : normal(route);
  const pending = p.click('latest-analysis');
  if (departure === 'route') p.leave();
  if (departure === 'remount') { p.leave(); await p.mount(); }
  if (departure.startsWith('device')) { await p.change('B'); if (departure === 'device-roundtrip') await p.change('A'); }
  request.resolve(row('A')); await pending;
  assert.equal(p.modals.length, 0); assert.equal(p.notices.length, 0);
});

test('latest deduplicates pending and opens normally with the trigger re-enabled', async () => {
  const p = fixture(); await p.mount(); const request = deferred(); p.request = () => request.promise;
  const button = p.find('[data-action="latest-analysis"]'); const pending = p.click('latest-analysis');
  await p.click('latest-analysis', null, false);
  assert.equal(p.calls.filter(c => c.route.includes('/latest/')).length, 1);
  request.resolve(row('A')); await pending;
  assert.equal(p.modals.length, 1); assert.equal(button.disabled, false);
  assert.equal(p.document.activeElement, button);
  assert.equal(p.listeners.get('focusin').size, 0); assert.equal(p.listeners.get('pointerdown').size, 0);
});

test('latest does not steal moved focus; explicit reopen uses the ready result', async () => {
  const p = fixture(); await p.mount(); const request = deferred(); p.request = () => request.promise;
  const pending = p.click('latest-analysis'); const input = p.find('[name="message"]'); input.focus();
  request.resolve(row('A')); await pending;
  assert.equal(p.modals.length, 0); assert.equal(p.document.activeElement, input);
  assert.match(p.find('#ai-latest-status').textContent, /Đã tải kết quả/);
  await p.click('latest-analysis'); assert.equal(p.modals.length, 1);
  assert.equal(p.calls.filter(c => c.route.includes('/latest/')).length, 1);
});

test('latest never replaces another modal and retains its result for a later explicit action', async () => {
  const p = fixture(); await p.mount(); const request = deferred(); p.request = () => request.promise;
  const pending = p.click('latest-analysis'); p.modalRoot.innerHTML = '<div>OTHER MODAL</div>';
  request.resolve(row('A')); await pending;
  assert.equal(p.modalRoot.textContent, 'OTHER MODAL'); assert.equal(p.modals.length, 0);
  p.modalRoot.innerHTML = ''; await p.click('latest-analysis'); assert.equal(p.modals.length, 1);
});

test('latest error ends pending and can be retried without generic toast', async () => {
  const p = fixture(); await p.mount(); p.request = async () => { throw Object.assign(Error('not found'), { status: 404 }); };
  await p.click('latest-analysis'); assert.equal(p.find('[data-action="latest-analysis"]').disabled, false);
  assert.match(p.find('#ai-latest-status').textContent, /not found/); assert.equal(p.notices.length, 0);
  p.request = async () => row('A'); await p.click('latest-analysis'); assert.equal(p.modals.length, 1);
});

for (const task of ['history', 'analysis', 'chat', 'summary', 'latest']) test(`${task} cannot update a new login with the same user ID`, async () => {
  const p = fixture(); await p.mount(); const request = deferred(), normal = p.request;
  p.request = route => {
    if ((task === 'history' && route.startsWith('/devices')) || (task === 'analysis' && route.includes('/analyze/'))
      || (task === 'chat' && route.endsWith('/chat')) || (task === 'summary' && route.includes('/summary/'))
      || (task === 'latest' && route.includes('/latest/'))) return request.promise;
    return normal(route);
  };
  let pending;
  if (task === 'history') pending = p.context.loadAIHistory(p.view);
  else if (task === 'chat') { p.draft('OLD SESSION'); pending = p.submit(); }
  else pending = p.click({ analysis: 'run-analysis', summary: 'summary', latest: 'latest-analysis' }[task], task === 'summary' ? 'daily' : undefined);
  const oldHistory = p.state.chat;
  p.loginAgain(); assert.notEqual(p.state.chat, oldHistory);
  p.request = normal; await p.mount(); const html = p.content.innerHTML, snapshot = JSON.stringify(p.state);
  request.resolve({ data: devices, reply: 'STALE REPLY', summary: 'STALE SUMMARY', ...row('A') }); await pending;
  assert.equal(p.content.innerHTML, html); assert.equal(JSON.stringify(p.state), snapshot);
  assert.equal(p.modals.length, 0); assert.equal(p.notices.length, 0);
});

for (const task of ['history', 'analysis', 'chat', 'summary', 'latest']) test(`token rotation preserves a legitimate pending ${task} operation`, async () => {
  const p = fixture(); await p.mount(); const request = deferred(), normal = p.request; let intercepted = false;
  p.request = (route, options) => {
    const matches = (task === 'history' && route.startsWith('/devices')) || (task === 'analysis' && route.includes('/analyze/'))
      || (task === 'chat' && route.endsWith('/chat')) || (task === 'summary' && route.includes('/summary/')) || (task === 'latest' && route.includes('/latest/'));
    if (matches && !intercepted) { intercepted = true; return request.promise; }
    return normal(route, options);
  };
  let pending;
  if (task === 'history') pending = p.context.loadAIHistory(p.view);
  else if (task === 'chat') { p.draft('TOKEN ROTATION'); pending = p.submit(); }
  else pending = p.click({ analysis: 'run-analysis', summary: 'summary', latest: 'latest-analysis' }[task], task === 'summary' ? 'daily' : undefined);
  p.state.accessToken = 'token-rotated';
  request.resolve({ data: devices, reply: 'VALID REPLY', summary: 'VALID SUMMARY', ...row('A') }); await pending;
  if (task === 'history') assert.equal(p.state.analyses[0].device_id, 'A');
  if (task === 'analysis') assert.match(p.find('#ai-analysis-status').textContent, /đã hoàn thành/);
  if (task === 'chat') assert.equal(p.state.chat.at(-1).content, 'VALID REPLY');
  if (task === 'summary') assert.match(p.find('#summary-result').textContent, /VALID SUMMARY/);
  if (task === 'latest') assert.equal(p.modals.length, 1);
});

test('history retry restores focus only while the interaction still owns it', async () => {
  const p = fixture(); await p.mount(); const normal = p.request;
  p.request = async () => { throw Error('offline'); }; await p.context.loadAIHistory(p.view);
  p.request = normal; await p.click('retry-ai-history');
  assert.equal(p.document.activeElement, p.find('#ai-history'));
  p.request = async () => { throw Error('offline'); }; await p.context.loadAIHistory(p.view);
  const request = deferred(); p.request = route => route.startsWith('/devices') ? request.promise : normal(route);
  const pending = p.click('retry-ai-history'); const input = p.find('[name="message"]'); input.focus();
  request.resolve({ data: devices }); await pending;
  assert.equal(p.document.activeElement, input); assert.equal(p.listeners.get('focusin').size, 0);
});

test('summary retry does not lose owned focus when its retry node disappears', async () => {
  const p = fixture(); await p.mount(); p.request = async () => { throw Error('offline'); };
  await p.click('summary', 'weekly'); p.request = async () => ({ summary: 'OK' });
  await p.click('retry-ai-summary');
  assert.equal(p.document.activeElement, p.content.querySelectorAll('[data-action="summary"]').find(b => b.dataset.period === 'weekly'));
});

test('analysis and chat completions never pull focus away from another control', async () => {
  const p = fixture(); await p.mount(); const post = deferred(), chat = deferred(), normal = p.request;
  p.request = route => route.includes('/analyze/') ? post.promise : route.endsWith('/chat') ? chat.promise : normal(route);
  const a = p.click('run-analysis'); const input = p.draft('FOCUS'); input.focus(); const c = p.submit();
  const picker = p.find('#ai-device'); picker.focus();
  post.resolve({}); chat.resolve({ reply: 'OK' }); await Promise.all([a, c]);
  assert.equal(p.document.activeElement, picker);
});

test('AI text stays escaped and history endpoint preserves limit, device and order', async () => {
  const p = fixture(), normal = p.request;
  const dangerous = '<img src=x onerror=alert(1)> & "text"';
  p.request = route => route.startsWith('/ai-analysis?') ? { data: [row('A', dangerous), row('A', 'SECOND')] } : normal(route);
  await p.mount(); const html = p.find('#ai-history').innerHTML;
  assert.ok(html.indexOf('&lt;img') < html.indexOf('SECOND')); assert.doesNotMatch(html, /<img/);
  assert.equal(p.calls[0].route, '/devices?limit=200');
  assert.equal(p.calls[1].route, '/ai-analysis?device_id=A&limit=50');
  p.request = async route => route.endsWith('/chat') ? { reply: dangerous } : { summary: dangerous };
  p.draft(dangerous); await p.submit(); await p.click('summary', 'daily');
  for (const id of ['#chat-messages', '#summary-result']) { assert.match(p.find(id).innerHTML, /&lt;img/); assert.doesNotMatch(p.find(id).innerHTML, /<img/); }
  assert.equal(p.state.chat[0].content, dangerous);
});

test('empty devices disable device actions without blocking chat', async () => {
  const p = fixture(); p.request = async route => route.startsWith('/devices') ? { data: [] } : { reply: 'OK' };
  await p.mount();
  assert.equal(p.find('[data-action="run-analysis"]').disabled, true);
  assert.equal(p.find('[data-action="latest-analysis"]').disabled, true);
  assert.equal(p.find('[type="submit"]').disabled, false);
  p.draft('NO DEVICE'); await p.submit(); assert.equal(p.state.chat.length, 2);
  assert.ok(!p.calls.some(c => c.route.includes('device_id=')));
});

test('non-AI click and submit branches still execute their original actions', async () => {
  const p = fixture(); await p.mount();
  const navButton = new p.Element('button', { 'data-page': 'alerts' });
  await p.context.handleClick({ target: navButton }); assert.deepEqual(p.nav, ['alerts']);
  const closeButton = new p.Element('button', { 'data-action': 'close-modal' });
  await p.context.handleClick({ target: closeButton }); assert.equal(p.closed.length, 1);
  const form = new p.Element('form', { id: 'push-token-form' });
  form.innerHTML = '<input name="provider" value="fcm"><input name="platform" value="web"><input name="token" value="fixture"><button type="submit">Submit</button>';
  let account = 0; p.context.renderAccount = async () => { account++; };
  await p.context.handleSubmit({ target: form, preventDefault() {} });
  assert.equal(p.calls.at(-1).route, '/notifications/tokens'); assert.equal(p.calls.at(-1).method, 'POST');
  assert.equal(account, 1); assert.equal(form.querySelector('[type="submit"]').disabled, false);
});

test('AI does not schedule polling, persistence, automatic retries or abort timers', async () => {
  const p = fixture(); let schedules = 0;
  p.context.setTimeout = p.context.setInterval = () => { schedules++; throw Error('AI must not schedule timers'); };
  await p.mount(); await p.click('summary', 'daily'); p.draft('NO TIMER'); await p.submit(); await p.click('run-analysis');
  assert.equal(schedules, 0);
  assert.equal(p.calls.filter(c => c.route.includes('/analyze/')).length, 1);
  assert.equal(p.calls.filter(c => c.route.endsWith('/chat')).length, 1);
});

test('old history error cannot finish loading of a newer device request', async () => {
  const p = fixture(); await p.mount(); const a = deferred(), b = deferred(), normal = p.request;
  p.request = route => route.startsWith('/devices') ? normal(route) : route.includes('device_id=A') ? a.promise : b.promise;
  const old = p.context.loadAIHistory(p.view); await tick(); const current = p.change('B'); await tick();
  a.reject(Error('OLD ERROR')); await old;
  assert.equal(p.find('#ai-history').getAttribute('aria-busy'), 'true');
  assert.match(p.find('#ai-history-status').textContent, /Máy B/);
  assert.doesNotMatch(p.find('#ai-history-status').textContent, /OLD ERROR/);
  b.resolve({ data: [row('B')] }); await current;
});

test('replacing the AI surface in the same main invalidates the old view and its state writes', async () => {
  const p = fixture(); await p.mount(); const old = deferred(), normal = p.request; let intercepted = false;
  p.request = route => { if (!intercepted) { intercepted = true; return old.promise; } return normal(route); };
  const previousView = p.view, pending = p.context.loadAIHistory(previousView);
  p.view = await p.context.renderAI(p.content); await p.view.historyTask;
  const html = p.content.innerHTML, snapshot = JSON.stringify(p.state);
  old.resolve({ data: [{ device_id: 'OLD' }] }); await pending;
  assert.equal(p.content.innerHTML, html); assert.equal(JSON.stringify(p.state), snapshot);
  assert.notEqual(previousView.surface, p.view.surface);
});

test('old analysis completion cannot unlock a different device operation', async () => {
  const p = fixture(); await p.mount(); const a = deferred(), b = deferred(), normal = p.request;
  p.request = route => route.endsWith('/analyze/A') ? a.promise : route.endsWith('/analyze/B') ? b.promise : normal(route);
  const first = p.click('run-analysis'); await p.change('B'); const second = p.click('run-analysis');
  a.resolve({}); await first;
  assert.equal(p.find('[data-action="run-analysis"]').disabled, true);
  assert.equal(p.find('[data-action="run-analysis"]').textContent, 'Đang phân tích…');
  b.resolve({}); await second; assert.equal(p.find('[data-action="run-analysis"]').disabled, false);
});

test('same-view failed chat after device change keeps the draft and permits an explicit retry', async () => {
  const p = fixture(); await p.mount(); const request = deferred(), normal = p.request;
  p.request = route => route.endsWith('/chat') ? request.promise : normal(route);
  p.draft('CHAT ON A'); const pending = p.submit(); await p.change('B');
  request.reject(Error('offline')); await pending;
  assert.equal(p.find('[name="message"]').value, 'CHAT ON A');
  assert.equal(p.find('[name="message"]').readOnly, false);
  assert.equal(p.state.chat.length, 0);
  assert.equal(p.document.activeElement, p.find('#ai-device'));
});
