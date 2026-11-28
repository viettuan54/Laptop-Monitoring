const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { source, functionSource } = require('./dashboardSource');

function setup(role) {
  const app = { innerHTML: '' };
  const content = { innerHTML: '', setAttribute() {} };
  const notifications = [];
  const requests = [];
  const state = { role, page: 'api-lab', agentEndpoint: 'heartbeat', agentSecret: 'test-secret' };
  class Form {
    constructor() { this.id = 'agent-request-form'; }
    querySelector() { return { disabled: false }; }
  }
  const context = vm.createContext({
    state, app, location: { hash: 'api-lab' }, icons: {}, pageTitles: {},
    document: { body: { classList: { toggle() {} }, contains: () => false }, querySelector: () => content },
    brandMarkup: () => '', escapeHtml: String, updateAlertIndicator() {}, alertCountLabel: String,
    stopScreenshotPolling() {}, stopBreakReminderPolling() {}, invalidateActivityRender() {},
    loading: () => '', adminLoadingSkeleton: () => '', pageHead: () => '', adminStatsStrip: () => '',
    emptyState: () => 'error', localizeError: String,
    agentEndpoints: { heartbeat: { method: 'POST', path: '/agent/heartbeat', label: 'Heartbeat', body: {} } },
    HTMLFormElement: Form, FormData: class { constructor() { return [['request_data', '{}']]; } },
    performance: { now: () => 0 },
    toast: (...args) => notifications.push(args), api: async (...args) => { requests.push(args); return {}; },
  });
  for (const name of ['renderOverview', 'renderChildren', 'renderDevices', 'renderDeviceControls',
    'renderPolicies', 'renderActivity', 'renderAlerts', 'renderAI', 'renderAccount',
    'renderAdminOverview', 'renderUsers', 'renderBlacklist', 'renderAudit']) {
    context[name] = () => { content.innerHTML = name; };
  }
  for (const name of ['navItem', 'mobileNavItem', 'renderShell', 'navigate', 'renderApiLab', 'handleSubmit', 'handleClick']) {
    vm.runInContext(functionSource(source, name), context);
  }
  return { context, state, app, content, notifications, requests,
    submit: () => context.handleSubmit({ target: new Form(), preventDefault() {} }) };
}

test('parent menu hides Agent API and a direct route returns to overview', async () => {
  const f = setup('parent');
  await f.context.navigate('api-lab');
  assert.doesNotMatch(f.app.innerHTML, /data-page="api-lab"/);
  assert.match(f.app.innerHTML, /data-action="agent-guide"/);
  assert.equal(f.state.page, 'overview');
  assert.equal(f.context.location.hash, 'overview');
  assert.equal(f.content.innerHTML, 'renderOverview');
});

test('admin keeps the Agent API menu, shortcut and request form', async () => {
  const f = setup('admin');
  await f.context.navigate('api-lab');
  assert.equal((f.app.innerHTML.match(/data-page="api-lab"/g) || []).length, 2);
  assert.equal(f.state.page, 'api-lab');
  assert.match(f.content.innerHTML, /id="agent-request-form"/);
  await f.submit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0][0], '/agent/heartbeat');
  assert.equal(f.requests[0][1].headers['X-Device-Secret'], 'test-secret');
});

test('parent cannot render the lab or submit a stale Agent request form', async () => {
  const f = setup('parent');
  assert.throws(() => f.context.renderApiLab(f.content), /chỉ dành cho quản trị viên/);
  await f.submit();
  assert.equal(f.requests.length, 0);
  assert.equal(f.notifications[0][2], 'error');
});

for (const action of ['set-agent-secret', 'clear-agent-secret', 'select-agent-endpoint']) {
  test(`parent cannot use stale lab action ${action}`, async () => {
    const f = setup('parent');
    const button = { dataset: { action, endpoint: 'config' } };
    await f.context.handleClick({ target: { closest: selector => selector === '[data-action]' ? button : null } });
    assert.equal(f.state.agentSecret, 'test-secret');
    assert.equal(f.state.agentEndpoint, 'heartbeat');
    assert.equal(f.notifications[0][2], 'error');
  });
}

test('parent cannot load a secret through a stale lab modal', async () => {
  const f = setup('parent');
  let submit;
  f.context.document.addEventListener = (type, handler) => { submit = handler; };
  const entry = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  vm.runInContext(entry.slice(entry.indexOf("document.addEventListener('submit'"), entry.indexOf("document.addEventListener('click'")), f.context);
  await submit({ target: { id: 'agent-secret-form' }, preventDefault() {} });
  assert.equal(f.state.agentSecret, 'test-secret');
  assert.equal(f.notifications[0][2], 'error');
});
