const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./queryAlertRenderer');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

async function renderApplications(api, filter = {}) {
  const categories = [['learning', 'Học tập'], ['entertainment', 'Giải trí'], ['browsers', 'Trình duyệt'], ['unknown', 'Chưa phân loại']];
  const context = vm.createContext({ api, URLSearchParams, activityRenderVersion: 0,
    state: { activityTab: 'apps', activityFilter: filter, activityOffset: 0, activityLimit: 10,
      devices: [{ device_id: 7, device_name: 'Máy kiểm thử' }] },
    icons: { activity: '', policy: '', device: '' }, categoryLabels: Object.fromEntries(categories),
    policyCategoryGroups: { app: categories }, accessStatusLabels: { blocked: 'Đã chặn', open: 'Đang mở' },
    stopScreenshotPolling: () => {}, pageHead: () => '<h1>Hoạt động ứng dụng</h1>', sectionVisual: () => '',
    emptyState: () => '<p>Chưa có dữ liệu</p>',
  });
  const names = ['escapeHtml', 'formatDate', 'queryString', 'deviceName', 'categoryLabel', 'categoryBadge',
    'accessStatusLabel', 'accessStatusBadge', 'duration', 'activityTabs', 'appEnforcementMarkup', 'renderActivity'];
  vm.runInContext(names.map(name => functionSource(source, name)).join('\n'), context);
  const content = { innerHTML: '' };
  await context.renderActivity(content);
  return { html: content.innerHTML, context };
}
module.exports = { renderApplications };
