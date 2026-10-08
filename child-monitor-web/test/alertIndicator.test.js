const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./queryAlertRenderer');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const rows = count => ({ data: Array.from({ length: count }, (_, i) => ({ alert_id: i + 1, is_read: false })) });

function element(className = '') {
  return {
    className, attributes: {}, children: [], textContent: '',
    classList: { contains: name => className.split(' ').includes(name) },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    querySelector() { return this.children[0] || null; },
    appendChild(child) { child.parent = this; this.children.push(child); },
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); },
  };
}

function dashboard({ count = 0, page = 'devices', role = 'parent', request } = {}) {
  const buttons = ['notification-button', 'nav-link', 'mobile-nav-link'].map(element);
  const intervals = new Map();
  const calls = [];
  const navigations = [];
  const storage = new Map();
  let timerId = 0;
  const state = { accessToken: 'fixture-session', refreshToken: 'fixture-refresh', userId: 7,
    role, page, unreadAlertCount: 0, devices: [], children: [], alerts: [], overviewChildId: '' };
  const context = vm.createContext({
    state, URLSearchParams, alertRefreshPromise: null, alertRefreshSequence: 0, alertRefreshTimer: null,
    screenshotRefreshTimer: null, activityRenderVersion: 0, clearTimeout: () => {},
    modalReturnFocus: null, app: {}, modalRoot: {}, toastRoot: {}, INITIAL_CHAT: [],
    location: { hash: '#' + page },
    document: { hidden: false, querySelectorAll: () => buttons, createElement: () => element() },
    window: { setInterval: (callback, ms) => { intervals.set(++timerId, { callback, ms }); return timerId; },
      clearInterval: id => intervals.delete(id) },
    sessionStorage: { setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    decodeJwt: () => ({ user_id: 7 }),
    renderAuth: () => {}, renderStartupError: error => { throw error; },
    renderShell: () => {}, navigate: async page => { navigations.push(page); }, toast: () => {},
    stopFaceCamera: () => {}, emptyUsageSummary: () => ({}),
    localMonthKey: () => '2026-10', loadOverviewUsageSummary: async () => ({}),
    api: async route => {
      calls.push(route);
      if (route === '/admin/stats') {
        if (role === 'admin') return {};
        throw Object.assign(new Error('Parent session'), { status: 403 });
      }
      return request ? request(route) : rows(count);
    },
  });
  const functions = ['stopScreenshotPolling', 'alertCountLabel', 'updateAlertIndicator', 'refreshUnreadAlertCount',
    'refreshAlertIndicatorInBackground', 'stopAlertPolling', 'startAlertPolling',
    'initialize', 'completeLogin', 'saveSession', 'detectRole', 'clearSession',
    'loadParentCore', 'reconcileSelectedId'];
  vm.runInContext(functions.map(name => functionSource(source, name)).join('\n'), context);
  return { context, state, buttons, intervals, calls, navigations,
    badgeText: () => buttons.map(button => button.querySelector('b')?.textContent ?? null),
    tick: async () => { for (const { callback } of intervals.values()) await callback(); },
  };
}

test('restored parent session shows badges on a direct device URL without opening alerts', async () => {
  const view = dashboard({ count: 7 });
  await view.context.initialize();
  await flush();
  assert.deepEqual(view.navigations, ['devices']);
  assert.deepEqual(view.badgeText(), ['7', '7', '7']);
  assert.equal(view.calls.filter(route => route.includes('is_read=false')).length, 1);
  assert.equal(view.intervals.size, 1);
  assert.equal([...view.intervals.values()][0].ms, 30_000);
  assert.match(view.buttons[0].attributes['aria-label'], /7 cảnh báo chưa đọc/);
});

test('login starts refreshing once and admin sessions do not fetch parent alerts', async () => {
  const parent = dashboard({ count: 4 });
  await parent.context.completeLogin({ accessToken: 'new-session', refreshToken: 'new-refresh' });
  await flush();
  assert.deepEqual(parent.badgeText(), ['4', '4', '4']);
  parent.context.startAlertPolling();
  await flush();
  assert.equal(parent.intervals.size, 1);
  const admin = dashboard({ role: 'admin' });
  await admin.context.initialize();
  await flush();
  assert.equal(admin.intervals.size, 0);
  assert.equal(admin.calls.some(route => route.startsWith('/alerts')), false);
});

test('background refresh updates new alerts without navigation and pauses while hidden', async () => {
  let count = 2;
  const view = dashboard({ request: () => rows(count) });
  await view.context.initialize();
  await flush();
  count = 5;
  await view.tick();
  assert.deepEqual(view.badgeText(), ['5', '5', '5']);
  view.context.document.hidden = true;
  const before = view.calls.length;
  count = 6;
  await view.tick();
  assert.equal(view.calls.length, before);
  view.context.document.hidden = false;
  await view.context.refreshAlertIndicatorInBackground();
  assert.deepEqual(view.badgeText(), ['6', '6', '6']);
  assert.deepEqual(view.navigations, ['devices']);
});

test('a failed background request keeps the last count and the next poll recovers', async () => {
  let fail = false;
  const view = dashboard({ request: () => { if (fail) throw new Error('Offline'); return rows(3); } });
  await view.context.initialize();
  await flush();
  fail = true;
  await view.tick();
  assert.deepEqual(view.badgeText(), ['3', '3', '3']);
  fail = false;
  await view.tick();
  assert.deepEqual(view.badgeText(), ['3', '3', '3']);
  assert.equal(view.calls.filter(route => route.includes('is_read=false')).length, 3);
});

test('overlapping count requests are coalesced and stale pre-read results cannot restore badges', async () => {
  const pending = [];
  const view = dashboard({ request: () => new Promise(resolve => pending.push(resolve)) });
  const first = view.context.refreshUnreadAlertCount();
  const duplicate = view.context.refreshUnreadAlertCount();
  assert.equal(pending.length, 1);
  const afterRead = view.context.refreshUnreadAlertCount({ force: true });
  assert.equal(pending.length, 2);
  pending[1](rows(1));
  await afterRead;
  assert.deepEqual(view.badgeText(), ['1', '1', '1']);
  pending[0](rows(9));
  await Promise.all([first, duplicate]);
  assert.deepEqual(view.badgeText(), ['1', '1', '1']);
});

test('logout cancels polling and rejects a late response from the old session', async () => {
  let finish;
  const view = dashboard({ request: () => new Promise(resolve => { finish = resolve; }) });
  await view.context.initialize();
  view.context.clearSession();
  assert.equal(view.intervals.size, 0);
  finish(rows(8));
  await flush();
  assert.equal(view.state.unreadAlertCount, 0);
  assert.deepEqual(view.badgeText(), [null, null, null]);
});

test('all three indicators show 99+ for large counts and disappear when none are unread', async () => {
  let count = 120;
  const view = dashboard({ request: () => rows(count) });
  await view.context.refreshUnreadAlertCount();
  assert.deepEqual(view.badgeText(), ['99+', '99+', '99+']);
  assert.match(view.buttons[0].attributes['aria-label'], /99\+ cảnh báo chưa đọc/);
  count = 0;
  await view.context.refreshUnreadAlertCount();
  assert.deepEqual(view.badgeText(), [null, null, null]);
  assert.match(view.buttons[0].attributes['aria-label'], /Không có cảnh báo chưa đọc/);
});

test('overview recent alerts cannot overwrite the global unread count', async () => {
  const view = dashboard({ request: route => {
    if (route.includes('is_read=false')) return rows(5);
    if (route.startsWith('/children')) return [];
    if (route === '/alerts?limit=200') return { data: [{ is_read: true }] };
    return { data: [] };
  } });
  await view.context.loadParentCore();
  assert.equal(view.state.alerts.length, 1);
  assert.equal(view.state.unreadAlertCount, 5);
  assert.deepEqual(view.badgeText(), ['5', '5', '5']);
});
