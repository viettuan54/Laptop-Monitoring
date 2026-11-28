const { source, functionSource } = require('./dashboardSource');
// Execute the dashboard's real alert renderer without replacing its row logic.
// Layout/browser behavior is outside this check. Acceptance supplies a live API.
const assert = require('node:assert/strict');
const vm = require('node:vm');


async function renderQueryAlerts({ api, deviceId }) {
  const state = {
    devices: [{ device_id: deviceId, device_name: 'Thiết bị kiểm thử' }],
    alerts: [], alertFilter: { device_id: deviceId }, unreadAlertCount: 0,
    accessToken: 'fixture-session', role: 'parent', page: 'alerts',
  };
  let indicatorUpdated = false;
  const context = vm.createContext({
    state, api, URLSearchParams, icons: { alert: '!' },
    alertRefreshPromise: null, alertRefreshSequence: 0,
    pageHead: () => '', sectionVisual: () => '', emptyState: () => '<p>Không có cảnh báo</p>',
    updateAlertIndicator: () => { indicatorUpdated = true; },
  });
  const functions = ['escapeHtml', 'formatDate', 'queryString', 'deviceName',
    'alertPresentation', 'refreshUnreadAlertCount', 'renderAlerts'];
  vm.runInContext(functions.map(name => functionSource(source, name)).join('\n'), context);
  const content = { innerHTML: '', isConnected: true };
  await context.renderAlerts(content);
  assert.equal(indicatorUpdated, true);
  return { html: content.innerHTML, rows: state.alerts, unreadCount: state.unreadAlertCount };
}

module.exports = { renderQueryAlerts, functionSource };
