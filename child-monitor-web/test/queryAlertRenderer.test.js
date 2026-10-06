const test = require('node:test');
const assert = require('node:assert/strict');
const { renderQueryAlerts } = require('./queryAlertRenderer');

test('query alert renderer displays both levels and escapes API messages', async () => {
  const rows = [
    { alert_id: 1, device_id: 2, alert_type: 'text_risk', is_read: false,
      message: 'Cần quan sát bé trong thời gian này <script>fixture</script>', created_at: '2026-10-05T00:00:00Z' },
    { alert_id: 3, device_id: 2, alert_type: 'text_violence', is_read: false,
      message: 'Bé có dấu hiệu bị bạo lực', created_at: '2026-10-05T00:00:00Z' },
  ];
  const routes = [];
  const result = await renderQueryAlerts({ deviceId: 2, api: async route => {
    routes.push(route); return { data: rows };
  } });
  assert.ok(routes.includes('/alerts?device_id=2&limit=200'));
  assert.ok(routes.includes('/alerts?is_read=false&limit=200'));
  assert.match(result.html, /Cần quan sát bé trong thời gian này/);
  assert.match(result.html, /Bé có dấu hiệu bị bạo lực/);
  assert.match(result.html, /alert-symbol warning/);
  assert.match(result.html, /alert-symbol danger/);
  assert.match(result.html, /&lt;script&gt;fixture&lt;\/script&gt;/);
  assert.doesNotMatch(result.html, /<script>/);
  assert.equal((result.html.match(/class="alert-row /g) || []).length, 2);
  assert.equal(result.unreadCount, 2);
});

test('query alert renderer handles an empty parent response', async () => {
  const result = await renderQueryAlerts({ deviceId: 2, api: async () => ({ data: [] }) });
  assert.match(result.html, /Không có cảnh báo/);
  assert.doesNotMatch(result.html, /class="alert-row /);
  assert.equal(result.unreadCount, 0);
});
