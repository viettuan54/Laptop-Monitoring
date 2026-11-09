const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./queryAlertRenderer');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const activityHelpers = ['activityRequestCurrent', 'activitySurface', 'activityStatus',
  'activityPanelStart', 'activityFeedback', 'activityFocus'];

// Minimal DOM for async ownership/focus tests; this does not emulate layout or a screen reader.
function activityDOM() {
  const listeners = new Set();
  const document = {
    body: { matches: () => false }, hidden: false,
    addEventListener(type, fn) { if (type === 'focusin') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'focusin') listeners.delete(fn); },
    focus(node) { this.activeElement = node; for (const fn of listeners) fn({ target: node }); },
  };
  document.activeElement = document.body;
  let shell = '', markup = '', nodes = [], status;
  const surface = {
    get innerHTML() { return markup; },
    set innerHTML(value) {
      for (const node of nodes) node.isConnected = false;
      if (nodes.includes(document.activeElement)) document.activeElement = document.body;
      markup = value;
      nodes = [...value.matchAll(/<([a-z][\w-]*)\b([^>]*)>/g)].map(([, tag, attrs]) => {
        const attributes = Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
        return { tag, attributes, id: attributes.id, isConnected: true,
          dataset: Object.fromEntries(Object.entries(attributes).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5), v])),
          focus() { document.focus(this); }, matches: () => false,
        };
      });
    },
  };
  const content = {
    isConnected: true,
    get innerHTML() { return shell.replace('<div id="activity-load-status"', `<div data-status="${status?.textContent || ''}" id="activity-load-status"`).replace('<div id="activity-surface"></div>', `<div id="activity-surface">${markup}</div>`); },
    set innerHTML(value) { shell = value; surface.innerHTML = ''; status = value.includes('id="activity-load-status"') ? { textContent: '' } : null; },
    contains(node) { return node === content || nodes.includes(node); },
    querySelector(selector) {
      if (selector === '#activity-surface') return status ? surface : null;
      if (selector === '#activity-load-status') return status;
      if (selector.startsWith('#')) return nodes.find(n => n.id === selector.slice(1)) || null;
      const attr = /^\[([\w-]+)="([^"]*)"\]$/.exec(selector);
      return attr ? nodes.find(n => n.attributes[attr[1]] === attr[2]) || null : null;
    },
  };
  document.querySelector = selector => selector === '#page-content' ? content : content.querySelector(selector);
  document.body.contains = node => content.contains(node);
  return { content, document, listeners };
}

async function renderApplications(api, filter = {}) {
  const categories = [['learning', 'Học tập'], ['entertainment', 'Giải trí'], ['browsers', 'Trình duyệt'], ['unknown', 'Chưa phân loại']];
  const { content, document } = activityDOM();
  const context = vm.createContext({ api, URLSearchParams, activityRenderVersion: 0,
    document,
    state: { page: 'activity', accessToken: 'fixture', activityTab: 'apps', activityFilter: filter, activityOffset: 0, activityLimit: 10,
      devices: [{ device_id: 7, device_name: 'Máy kiểm thử' }] },
    icons: { activity: '', policy: '', device: '' }, categoryLabels: Object.fromEntries(categories),
    policyCategoryGroups: { app: categories }, accessStatusLabels: { blocked: 'Đã chặn', open: 'Đang mở' },
    stopScreenshotPolling: () => {}, pageHead: () => '<h1>Hoạt động ứng dụng</h1>', sectionVisual: () => '',
    emptyState: () => '<p>Chưa có dữ liệu</p>',
  });
  const names = ['escapeHtml', 'formatDate', 'queryString', 'deviceName', 'categoryLabel', 'categoryBadge',
    'accessStatusLabel', 'accessStatusBadge', 'duration', 'activityTabs', 'appEnforcementMarkup', ...activityHelpers, 'renderActivity'];
  vm.runInContext(names.map(name => functionSource(source, name)).join('\n'), context);
  await context.renderActivity(content);
  return { html: content.innerHTML, context };
}
module.exports = { renderApplications, activityDOM, activityHelpers };
