// Execute the dashboard's real alert renderer without replacing its row logic.
// Layout/browser behavior is outside this check. Acceptance supplies a live API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function functionSource(source, name) {
  const pattern = new RegExp(`^(?:async )?function ${name}\\(`, 'm');
  const match = pattern.exec(source);
  assert.ok(match, `Dashboard function ${name} is missing`);
  const rest = source.slice(match.index);
  const next = /\n(?:async )?function /g;
  const boundary = next.exec(rest);
  return boundary ? rest.slice(0, boundary.index) : rest;
}

async function renderQueryAlerts({ api, deviceId }) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const state = {
    devices: [{ device_id: deviceId, device_name: 'Thiết bị kiểm thử' }],
    alerts: [], alertFilter: { device_id: deviceId }, unreadAlertCount: 0,
  };
  let indicatorUpdated = false;
  const context = vm.createContext({
    state, api, URLSearchParams, icons: { alert: '!' },
    pageHead: () => '', sectionVisual: () => '', emptyState: () => '<p>Không có cảnh báo</p>',
    updateAlertIndicator: () => { indicatorUpdated = true; },
  });
  const functions = ['escapeHtml', 'formatDate', 'queryString', 'deviceName',
    'alertPresentation', 'renderAlerts'];
  vm.runInContext(functions.map(name => functionSource(source, name)).join('\n'), context);
  const content = { innerHTML: '' };
  await context.renderAlerts(content);
  assert.equal(indicatorUpdated, true);
  return { html: content.innerHTML, rows: state.alerts, unreadCount: state.unreadAlertCount };
}

module.exports = { renderQueryAlerts };
