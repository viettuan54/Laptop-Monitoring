const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./queryAlertRenderer');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// A small DOM boundary double: exercise the real renderer's request guards and
// replacement targets without claiming browser layout or focus behavior.
function fixture(request) {
  const replacements = [];
  const focusCalls = [];
  const selectors = ['.alert-summary', '.alerts-card', '[data-alert-unread-count]', '[data-action="mark-all-read"]'];
  const focused = { dataset: { action: 'mark-alert', id: '7' } };
  const nextButton = { dataset: { ...focused.dataset }, focus: options => focusCalls.push(options) };
  const parts = new Map(selectors.map(selector => [selector, {
    outerHTML: 'previous', contains: node => selector === '.alerts-card' && node === focused,
    replaceWith: replacement => { replacements.push(selector); parts.get(selector).outerHTML = replacement.outerHTML; },
  }]));
  const content = { isConnected: true, innerHTML: 'original full page',
    querySelector: selector => parts.get(selector), querySelectorAll: () => [nextButton],
    focus: options => focusCalls.push(options) };
  const state = { accessToken: 'session-A', role: 'parent', page: 'alerts',
    devices: [{ device_id: 2, device_name: 'Fixture' }], alerts: [], alertFilter: { device_id: '2' } };
  const context = vm.createContext({
    state, api: request, URLSearchParams, icons: { alert: '!' },
    pageHead: (_page, actions) => actions, sectionVisual: () => '', emptyState: () => 'empty',
    refreshUnreadAlertCount: async () => {},
    document: { activeElement: focused, createElement: () => ({
      innerHTML: '', querySelector(selector) { return { outerHTML: selector + this.innerHTML }; },
    }) },
  });
  for (const name of ['escapeHtml', 'formatDate', 'queryString', 'deviceName', 'alertPresentation', 'renderAlerts']) {
    vm.runInContext(functionSource(source, name), context);
  }
  return { context, state, content, replacements, focusCalls };
}

const incoming = { alert_id: 7, device_id: 2, alert_type: 'text_violence', is_read: false,
  message: 'Bé có dấu hiệu bị bạo lực', created_at: '2026-10-31T00:00:00Z' };

test('live results appear without replacing the filter or scrolling; unchanged results keep their nodes', async () => {
  const routes = [];
  const view = fixture(async route => { routes.push(route); return { data: [incoming] }; });
  await view.context.renderAlerts(view.content, { background: true });
  assert.equal(routes[0], '/alerts?device_id=2&limit=200');
  assert.equal(view.state.alerts[0].alert_id, 7);
  assert.equal(view.content.innerHTML, 'original full page');
  assert.equal(view.replacements.length, 4);
  assert.equal(view.replacements.includes('#alert-filter'), false);
  assert.equal(view.focusCalls.length, 1);
  assert.equal(view.focusCalls[0].preventScroll, true);
  await view.context.renderAlerts(view.content, { background: true });
  assert.equal(view.replacements.length, 4);
  assert.equal(view.focusCalls.length, 1);
});

test('late responses cannot overwrite another page, session, filter or detached content', async () => {
  for (const invalidate of [
    view => { view.state.page = 'policies'; },
    view => { view.state.accessToken = ''; },
    view => { view.state.alertFilter = { device_id: '3' }; },
    view => { view.content.isConnected = false; },
  ]) {
    let finish;
    const view = fixture(() => new Promise(resolve => { finish = resolve; }));
    const pending = view.context.renderAlerts(view.content, { background: true });
    invalidate(view);
    finish({ data: [incoming] });
    await pending;
    assert.equal(view.replacements.length, 0);
    assert.equal(view.state.alerts.length, 0);
  }
});

test('a newer render wins when an earlier request completes late', async () => {
  const pending = [];
  const view = fixture(() => new Promise(resolve => pending.push(resolve)));
  const first = view.context.renderAlerts(view.content, { background: true });
  const second = view.context.renderAlerts(view.content, { background: true });
  pending[1]({ data: [incoming] });
  await second;
  pending[0]({ data: [] });
  await first;
  assert.equal(view.state.alerts[0].alert_id, 7);
  assert.equal(view.replacements.length, 4);
});
