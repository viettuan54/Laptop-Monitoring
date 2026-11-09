const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./queryAlertRenderer');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const row = (id = 7, read = false) => ({ alert_id: id, device_id: 2, alert_type: 'text_violence',
  is_read: read, message: 'Fixture <message>', created_at: '2026-10-31T00:00:00Z' });

// DOM boundary double for identity, attributes, focus and async ownership only.
// No CSS/layout, browser event timing or screen-reader behavior is simulated.
function alertDOM() {
  const listeners = new Set();
  const document = {
    addEventListener(type, fn) { if (type === 'focusin') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'focusin') listeners.delete(fn); },
    focus(node) { this.activeElement = node; for (const fn of listeners) fn({ target: node }); },
  };
  class Element {
    constructor(tag = 'div', attributes = {}) {
      this.tag = tag; this.attributes = attributes; this.children = []; this.parent = null;
      this.dataset = new Proxy({}, {
        get: (_, key) => this.attributes['data-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())],
        set: (_, key, value) => { this.attributes['data-' + key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())] = String(value); return true; },
        deleteProperty: (_, key) => { delete this.attributes['data-' + key]; return true; },
      });
    }
    get id() { return this.attributes.id; }
    get disabled() { return 'disabled' in this.attributes; }
    set disabled(value) { if (value) { this.attributes.disabled = ''; if (document.activeElement === this) document.activeElement = document.body; } else delete this.attributes.disabled; }
    get options() { return this.querySelectorAll('option'); }
    get value() { return this.selectedValue ?? (this.options.find(o => 'selected' in o.attributes) || this.options[0])?.attributes.value ?? this.attributes.value ?? ''; }
    set value(value) { this.selectedValue = value; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    removeAttribute(name) { delete this.attributes[name]; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    contains(node) { return node === this || this.children.some(c => c instanceof Element && c.contains(node)); }
    matches(selector) {
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (selector.startsWith('.')) return (this.attributes.class || '').split(' ').includes(selector.slice(1));
      const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
      return attribute ? attribute[1] in this.attributes && (attribute[2] === undefined || this.attributes[attribute[1]] === attribute[2]) : this.tag === selector;
    }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
    querySelectorAll(selector) {
      const alternatives = selector.split(',').map(x => x.trim().split(/\s+/));
      const result = [];
      const visit = node => {
        for (const child of node.children) if (child instanceof Element) {
          if (alternatives.some(parts => child.matches(parts.at(-1)) && (parts.length === 1 || child.parent?.closest(parts[0])))) result.push(child);
          visit(child);
        }
      };
      visit(this); return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get innerHTML() { return this.children.map(c => c instanceof Element ? c.outerHTML : c).join(''); }
    set innerHTML(html) {
      if (document.activeElement !== this && this.contains(document.activeElement)) document.activeElement = document.body;
      for (const child of this.children) if (child instanceof Element) child.parent = null;
      this.children = [];
      const stack = [this];
      for (const match of html.matchAll(/<\/([\w-]+)\s*>|<([\w-]+)\b([^>]*)>|([^<]+)/g)) {
        if (match[1]) { if (stack.length > 1) stack.pop(); }
        else if (match[2]) {
          const attributes = Object.fromEntries([...match[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m => [m[1], m[2] ?? '']));
          const node = new Element(match[2], attributes); node.parent = stack.at(-1); node.parent.children.push(node);
          if (!['input', 'img', 'br', 'hr'].includes(match[2])) stack.push(node);
        } else stack.at(-1).children.push(match[4]);
      }
    }
    get outerHTML() { return `<${this.tag}${Object.entries(this.attributes).map(([k, v]) => ` ${k}="${v}"`).join('')}>${this.innerHTML}</${this.tag}>`; }
    get textContent() { return this.innerHTML.replace(/<[^>]*>/g, ''); }
    set textContent(value) { this.innerHTML = value; }
    cloneNode() { const holder = new Element(); holder.innerHTML = this.outerHTML; return holder.children[0]; }
    replaceWith(next) {
      if (!this.parent) return;
      if (this.contains(document.activeElement)) document.activeElement = document.body;
      const parent = this.parent; parent.children[parent.children.indexOf(this)] = next; next.parent = parent; this.parent = null;
    }
    focus(options) { this.focusOptions = options; document.focus(this); }
  }
  document.body = new Element('body'); document.activeElement = document.body;
  const content = new Element('main', { id: 'page-content' }); content.parent = document.body;
  content.isConnected = true; document.body.children.push(content);
  document.createElement = tag => new Element(tag);
  document.querySelector = selector => document.body.querySelector(selector);
  return { document, content, listeners, Element };
}

function fixture(request = async () => ({ data: [row()] })) {
  const dom = alertDOM();
  const calls = [], toasts = [];
  const state = { accessToken: 'session-A', role: 'parent', page: 'alerts', userMenuOpen: false,
    devices: [{ device_id: 2, device_name: 'Fixture' }], alerts: [], alertFilter: { device_id: '2' } };
  const context = vm.createContext({
    state, ...dom, URLSearchParams, icons: { alert: '!' }, alertListRefreshPromise: null,
    api: async (route, options) => { calls.push({ route, method: options?.method || 'GET' }); return request(route, options); },
    refreshUnreadAlertCount: async () => {}, pageHead: (_page, actions) => `<header>${actions}</header>`,
    sectionVisual: () => '', emptyState: () => '<p>Không có cảnh báo</p>',
    toast: (...args) => toasts.push(args), localizeError: x => x,
    HTMLFormElement: dom.Element,
    FormData: class { constructor(form) { this.entries = form.querySelectorAll('select').map(node => [node.attributes.name, node.value]); } [Symbol.iterator]() { return this.entries[Symbol.iterator](); } },
  });
  for (const name of ['escapeHtml', 'formatDate', 'queryString', 'deviceName', 'alertPresentation', 'emptyState', 'renderAlerts', 'refreshVisibleAlerts', 'handleClick', 'handleSubmit']) {
    let code = functionSource(source, name);
    if (name === 'handleClick') code = code.split("\ndocument.addEventListener('submit'")[0];
    vm.runInContext(code, context);
  }
  return { ...dom, context, state, calls, toasts,
    render: options => context.renderAlerts(dom.content, options),
    click: async (action, id) => {
      const button = dom.content.querySelectorAll('[data-action]').find(node => node.dataset.action === action && (id === undefined || node.dataset.id === String(id)));
      assert.ok(button, action); button.focus();
      return context.handleClick({ target: button });
    },
    status: () => dom.content.querySelector('#alerts-load-status').textContent,
  };
}
module.exports = { fixture, deferred, row };

if (require.main === module) {
  for (const action of ['clear-alert-filter', 'mark-alert', 'mark-all-read']) {
    test(`${action}: GET rejection stays in page, retry is GET only`, async () => {
      const view = fixture(); await view.render();
      const form = view.content.querySelector('#alert-filter');
      view.context.api = async (route, options) => { view.calls.push({ route, method: options?.method || 'GET' }); if (options?.method === 'PUT') return {}; throw Error('offline'); };
      await view.click(action, action === 'mark-alert' ? 7 : undefined);
      assert.equal(view.toasts.length, 0); assert.match(view.status(), /Chưa tải/);
      assert.equal(view.content.alertsView.pending, null);
      assert.equal(view.content.querySelector('#alert-filter'), form);
      assert.ok(view.content.querySelectorAll('[data-action="mark-alert"], [data-action="mark-all-read"]').every(b => b.disabled));
      if (action === 'clear-alert-filter') {
        assert.equal(view.content.querySelector('#alerts-results').innerHTML, '');
        assert.equal(view.content.querySelector('.alert-summary').innerHTML, '');
        assert.equal(form.querySelector('[name="device_id"]').value, '');
      } else assert.match(view.status(), /Đã đánh dấu/);
      const writes = view.calls.filter(c => c.method === 'PUT').length;
      await view.click('retry-alerts');
      assert.equal(view.calls.filter(c => c.method === 'PUT').length, writes);
      view.context.api = async () => ({ data: [row(7, true)] });
      await view.click('retry-alerts');
      assert.equal(view.content.alertsView.valid, true);
      assert.equal(view.content.querySelector('[data-action="retry-alerts"]'), null);
      assert.equal(view.document.activeElement, view.content.querySelector('#alerts-results'));
    });
  }

  for (const uncertain of [0, 1, 2]) for (const getFails of [false, true]) {
    test(`bulk outcomes: ${uncertain} unconfirmed, reconciliation failure=${getFails}`, async () => {
      const view = fixture(async () => ({ data: [row(7), row(8)] }));
      view.state.alertFilter.is_read = 'false'; await view.render();
      const requests = [];
      view.context.api = async (route, options) => {
        requests.push({ route, method: options?.method || 'GET' });
        if (options?.method === 'PUT') { if (Number(route.split('/')[2]) < 7 + uncertain) throw Error('unconfirmed'); return {}; }
        if (getFails) throw Error('GET failed'); return { data: [] };
      };
      await view.click('mark-all-read');
      assert.deepEqual(requests.map(r => r.method), ['PUT', 'PUT', 'GET']);
      assert.deepEqual(requests.slice(0, 2).map(r => r.route), ['/alerts/7/read', '/alerts/8/read']);
      assert.equal(requests[2].route, '/alerts?device_id=2&is_read=false&limit=200');
      const outcome = uncertain === 0
        ? 'Đã đánh dấu 2 cảnh báo là đã đọc.'
        : uncertain === 1
          ? 'Đã đánh dấu 1 cảnh báo là đã đọc. Chưa xác nhận được việc đánh dấu 1 cảnh báo còn lại.'
          : 'Chưa xác nhận được việc đánh dấu đã đọc cho 2 cảnh báo.';
      assert.ok(view.status().startsWith(outcome));
      assert.match(view.status(), getFails ? /Chưa tải lại/ : /Danh sách đã được cập nhật/);
      assert.equal(view.toasts.length, 0); assert.equal(view.content.alertsView.pending, null);
      assert.equal(view.content.alertsView.valid, !getFails);
      if (!getFails) {
        assert.equal(view.state.alerts.length, 0);
        assert.equal(view.content.querySelector('#alerts-results h3').textContent, 'Không có cảnh báo theo bộ lọc này');
      }
    });
  }

  test('Clarify bulk label still marks only unread IDs from the displayed scope', async () => {
    const view = fixture(async () => ({ data: [row(7), row(8, true), row(9)] })); await view.render();
    const calls = [];
    view.context.api = async (route, options) => { calls.push({ route, method: options?.method || 'GET' }); return options?.method === 'PUT' ? {} : { data: [row(7, true), row(8, true), row(9, true)] }; };
    await view.click('mark-all-read');
    assert.deepEqual(calls, [{ route: '/alerts/7/read', method: 'PUT' }, { route: '/alerts/9/read', method: 'PUT' }, { route: '/alerts?device_id=2&limit=200', method: 'GET' }]);
    assert.equal(view.status(), 'Đã đánh dấu 2 cảnh báo là đã đọc. Danh sách đã được cập nhật.');
    assert.equal(view.content.querySelector('[data-action="mark-all-read"]').disabled, true);
    assert.equal(view.content.querySelectorAll('.badge').filter(node => node.textContent === 'Đã đọc').length, 3);
    assert.equal(view.toasts.length, 0);
  });

  test('filter submit preserves controls and draft, removes old scope, retry retains applied filter', async () => {
    const view = fixture(); await view.render();
    const form = view.content.querySelector('#alert-filter');
    const device = form.querySelector('[name="device_id"]'); device.value = '3';
    const wait = deferred(); view.context.api = () => wait.promise;
    form.querySelector('[type="submit"]').focus();
    const pending = view.context.handleSubmit({ target: form, preventDefault() {} });
    assert.match(view.status(), /Đang tải/);
    assert.equal(view.content.querySelector('#alerts-results').getAttribute('aria-busy'), 'true');
    assert.equal(view.content.querySelector('#alerts-results').innerHTML, '');
    device.value = '4'; device.focus(); wait.reject(Error('offline')); await pending;
    assert.equal(view.state.alertFilter.device_id, '3'); assert.equal(device.value, '4');
    assert.equal(view.document.activeElement, device);
    const routes = []; view.context.api = async route => { routes.push(route); return { data: [] }; };
    await view.click('retry-alerts');
    assert.equal(routes[0], '/alerts?device_id=3&limit=200');
    assert.equal(view.content.querySelector('#alert-filter'), form); assert.equal(device.value, '4');
  });

  test('polling is skipped during PUT/reconciliation, IDs frozen, stale background cannot commit', async () => {
    const view = fixture(async () => ({ data: [row(7), row(8)] })); await view.render();
    const old = deferred(); view.context.api = () => old.promise;
    const background = view.render({ background: true });
    const put = deferred(), get = deferred(), routes = [];
    view.context.api = (route, options) => { routes.push(route); return options?.method === 'PUT' ? put.promise : get.promise; };
    const action = view.click('mark-all-read');
    view.state.alerts.push(row(9));
    await view.context.refreshVisibleAlerts(); assert.equal(routes.length, 2);
    old.resolve({ data: [row(99)] }); await background; assert.notEqual(view.state.alerts[0].alert_id, 99);
    put.resolve({}); await new Promise(resolve => setImmediate(resolve));
    await view.context.refreshVisibleAlerts(); assert.equal(routes.length, 3);
    assert.ok(!routes.some(route => route.includes('/9/read')));
    get.resolve({ data: [] }); await action; assert.equal(view.content.alertsView.pending, null);
    view.context.api = async () => ({ data: [row(10)] });
    await view.context.refreshVisibleAlerts(); assert.equal(view.state.alerts[0].alert_id, 10);
  });

  for (const change of ['page', 'session', 'detached']) for (const reject of [false, true]) {
    test(`late PUT ${reject ? 'error' : 'success'} after ${change} has no UI effects`, async () => {
      const view = fixture(); await view.render(); const wait = deferred(); let calls = 0;
      view.context.api = () => { calls++; return wait.promise; };
      const pending = view.click('mark-alert', 7); const html = view.content.innerHTML;
      if (change === 'page') view.state.page = 'activity';
      if (change === 'session') view.state.accessToken = '';
      if (change === 'detached') view.content.isConnected = false;
      // Navigation/logout replaces the shell, detaching the original controls.
      view.content.isConnected = false;
      view.document.body.innerHTML = '<main id="new-page">New page</main>';
      reject ? wait.reject(Error('late')) : wait.resolve({}); await pending;
      assert.equal(calls, 1); assert.equal(view.toasts.length, 0);
      assert.equal(view.document.body.innerHTML, '<main id="new-page">New page</main>');
      assert.match(view.status(), /Đang đánh dấu/); assert.equal(view.state.alerts[0].is_read, false);
      assert.equal(view.content.querySelector('#alerts-results').innerHTML, html.match(/<section id="alerts-results"[^>]*>([\s\S]*?)<\/section>/)[1]);
    });
  }

  test('old operation cannot release new pending or overwrite its feedback', async () => {
    const view = fixture(); await view.render(); const old = deferred(), fresh = deferred();
    view.context.api = (_route, options) => options?.method === 'PUT' ? old.promise : fresh.promise;
    const first = view.click('mark-alert', 7);
    view.state.alertFilter = { device_id: '3' }; const second = view.render();
    const owner = view.content.alertsView.pending;
    old.reject(Error('late')); await first;
    assert.equal(view.content.alertsView.pending, owner); assert.match(view.status(), /Đang tải/);
    fresh.resolve({ data: [row(12)] }); await second; assert.equal(view.state.alerts[0].alert_id, 12);
  });

  test('old bulk finally cannot unlock the next filter request', async () => {
    const view = fixture(); await view.render(); const old = deferred(), fresh = deferred();
    view.context.api = (_route, options) => options?.method === 'PUT' ? old.promise : fresh.promise;
    const first = view.click('mark-all-read');
    view.state.alertFilter = { device_id: '3' }; const second = view.render();
    const bulk = view.content.querySelector('[data-action="mark-all-read"]');
    old.reject(Error('late')); await first;
    assert.equal(bulk.disabled, true); assert.match(view.status(), /Đang tải/);
    fresh.resolve({ data: [] }); await second; assert.equal(bulk.disabled, true);
  });

  test('polling error after a failed filter does not claim an old list is displayed', async () => {
    const view = fixture(); await view.render(); view.state.alertFilter = { device_id: '3' };
    view.context.api = async () => { throw Error('offline'); };
    await view.render(); await view.context.refreshVisibleAlerts();
    assert.match(view.status(), /theo bộ lọc đã chọn/); assert.doesNotMatch(view.status(), /đang hiển thị/);
    assert.equal(view.content.querySelector('#alerts-results').innerHTML, '');
  });

  test('mark action restores focus to the row, or results when removed, without stealing moved focus', async () => {
    for (const result of [[row(7, true)], []]) {
      const view = fixture(); await view.render(); view.context.api = async (_route, options) => options?.method === 'PUT' ? {} : { data: result };
      await view.click('mark-alert', 7);
      assert.equal(view.document.activeElement, view.content.querySelector(result.length ? '[data-alert-id="7"]' : '#alerts-results'));
    }
    const view = fixture(); await view.render(); const wait = deferred();
    view.context.api = async (_route, options) => options?.method === 'PUT' ? wait.promise : { data: [] };
    const pending = view.click('mark-alert', 7);
    const select = view.content.querySelector('[name="device_id"]'); select.focus(); wait.resolve({}); await pending;
    assert.equal(view.document.activeElement, select); assert.equal(view.listeners.size, 0);
  });

  test('initial devices response cannot cross session/route boundaries', async () => {
    for (const reject of [false, true]) {
      const view = fixture(); view.state.devices = []; const wait = deferred(); view.context.api = () => wait.promise;
      const pending = view.render(); view.state.page = 'activity';
      reject ? wait.reject(Error('late')) : wait.resolve({ data: [{ device_id: 999 }] });
      assert.equal((await pending).status, 'ignored'); assert.equal(view.state.devices.length, 0);
      assert.equal(view.toasts.length, 0);
    }
  });

  test('initial device failure recovers, controls have stable IDs and live region is outside busy results', async () => {
    const view = fixture(); view.state.devices = []; view.context.api = async () => { throw Error('offline'); };
    await view.render(); assert.match(view.status(), /Chưa tải/);
    view.context.api = async route => ({ data: route.startsWith('/devices') ? [{ device_id: 2, device_name: 'Recovered' }] : [row()] });
    await view.click('retry-alerts');
    assert.equal(view.content.querySelector('[name="device_id"]').options.length, 2);
    const status = view.content.querySelector('#alerts-load-status'), results = view.content.querySelector('#alerts-results');
    assert.equal(results.contains(status), false); assert.equal(status.getAttribute('role'), 'status');
    assert.equal(status.getAttribute('aria-live'), 'polite'); assert.equal(status.getAttribute('aria-atomic'), 'true');
    assert.equal(results.getAttribute('aria-busy'), 'false'); assert.equal(results.getAttribute('tabindex'), '-1');
    const ids = view.content.querySelectorAll('[id]').map(node => node.id); assert.equal(ids.length, new Set(ids).size);
    assert.equal(view.content.querySelectorAll('[tabindex]').some(node => Number(node.getAttribute('tabindex')) > 0), false);
  });
}
