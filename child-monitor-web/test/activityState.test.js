const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./queryAlertRenderer');
const { activityDOM, activityHelpers } = require('./appEnforcementRenderer');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

// Declaration contracts, not browser-computed styles or geometry.
function typeRule(selector) {
  const rules = [...styles.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some(value => value.trim() === selector));
  return Object.fromEntries(rules.flatMap(([, , body]) => body.split(';').filter(value => value.includes(':'))
    .map(value => { const colon = value.indexOf(':'); return [value.slice(0, colon).trim(), value.slice(colon + 1).trim()]; })));
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('Activity type roles override the actual small-text cascade and retain Layout alignment', () => {
  const roles = [
    ['.activity-history th', '0.875rem', '600', '1.4'],
    ['.activity-enforcement th', '0.875rem', '600', '1.4'],
    ['.activity-history td', '0.875rem', '400', '1.5'],
    ['.activity-enforcement td', '0.875rem', '400', '1.5'],
    ['.activity-history .cell-title strong', '1rem', '600', '1.45'],
    ['.activity-enforcement .cell-title strong', '1rem', '600', '1.45'],
    ['.activity-history .cell-title small', '0.875rem !important', '400', '1.5'],
    ['.activity-enforcement .cell-title small', '0.875rem !important', '400', '1.5'],
    ['.page-summary-strip small', '0.875rem !important', '500', '1.45'],
    ['.page-summary-strip strong', '1rem', '600', '1.4'],
    ['.activity-summary-primary strong', '1.125rem', '800', '1.4'],
    ['#activity-filter label', '0.875rem', '600', '1.5'],
    ['.btn', '0.875rem', '600', '1.5'],
    ['#activity-filter .input', '1rem', '400', '1.55'],
    ['#activity-filter .select', '1rem', '400', '1.55'],
    ['.activity-note', '1rem', '400', '1.6'],
    ['.activity-enforcement .card-head p', '1rem', '400', '1.6'],
    ['.activity-enforcement .card-head h2', '1.125rem', '600', '1.4'],
    ['.activity-history .table-footer', '0.875rem', '400', '1.5'],
    ['.activity-history .website-cell a', '0.875rem', '600', '1.5'],
  ];
  for (const [selector, size, weight, leading] of roles) {
    const rule = typeRule(`#activity-surface ${selector}`);
    assert.equal(rule['font-size'], size, selector);
    assert.equal(rule['font-weight'], weight, selector);
    assert.equal(rule['line-height'], leading, selector);
  }
  // These global important rules still exist; scoped important declarations beat them by specificity.
  assert.equal(typeRule('body small')['font-size'], '0.8rem !important');
  assert.equal(typeRule('.page-summary-strip small')['font-size'], '0.69rem !important');
  assert.equal(typeRule('th')['font-size'], '0.72rem');
  assert.equal(typeRule('td')['font-size'], '0.82rem');
  assert.equal(typeRule('#activity-surface .page-summary-strip strong')['margin-top'], 'auto');
  assert.equal(typeRule('#activity-surface .activity-filters .filter-actions')['grid-column'], '1 / -1');
  assert.equal(typeRule('#activity-surface .activity-note')['max-width'], '75ch');
  assert.equal(typeRule('#activity-surface #activity-filter input::placeholder').opacity, '1');
  assert.deepEqual(typeRule('#activity-surface #activity-load-status'), {});
});

test('table names and badges wrap without clipping or changing status colors and column bounds', () => {
  for (const table of ['.activity-history', '.activity-enforcement']) {
    const header = typeRule(`#activity-surface ${table} th`);
    assert.equal(header['text-transform'], 'none');
    assert.equal(header['letter-spacing'], 'normal');
    assert.equal(header['white-space'], 'normal');
    for (const tag of ['strong', 'small']) {
      const rule = typeRule(`#activity-surface ${table} .cell-title ${tag}`);
      assert.equal(rule['white-space'], 'normal');
      assert.equal(rule.overflow, 'visible');
      assert.equal(rule['text-overflow'], 'clip');
      assert.equal(rule['overflow-wrap'], 'anywhere');
      assert.equal(rule['max-width'], '100%');
      assert.equal(rule.height, undefined);
      assert.equal(rule['-webkit-line-clamp'], undefined);
    }
    const badge = typeRule(`#activity-surface ${table} .badge`);
    assert.equal(badge.width, 'fit-content');
    assert.equal(badge['max-width'], '100%');
    assert.equal(badge['white-space'], 'normal');
    assert.equal(badge['overflow-wrap'], 'anywhere');
    assert.equal(badge['font-size'], '0.875rem');
    assert.equal(badge['font-weight'], '600');
    assert.equal(badge.color, undefined);
    assert.equal(badge.background, undefined);
  }
  assert.equal(typeRule('.cell-title')['max-width'], '340px');
  assert.equal(typeRule('.table-scroll')['overflow-x'], 'auto');
});

function dashboard(api = async () => ({ data: [] })) {
  const dom = activityDOM();
  const notices = [], calls = [];
  const categories = [['unknown', 'Chưa phân loại']];
  const state = { page: 'activity', accessToken: 'fixture', activityTab: 'web', activityOffset: 0,
    activityLimit: 2, activityFilter: {}, devices: [{ device_id: 7, device_name: 'Máy thử' }],
    activityViewRows: [{ domain: 'old.example' }], webLogs: [], appLogs: [] };
  const context = vm.createContext({ state, document: dom.document, URL, URLSearchParams,
    activityRenderVersion: 0, stopScreenshotPolling() {}, icons: {},
    policyCategoryGroups: { app: categories, web: categories }, categoryLabels: Object.fromEntries(categories),
    accessStatusLabels: { open: 'Đang mở' },
    pageHead: (_page, actions) => `<header><h1>Hoạt động</h1>${actions}</header>`, sectionVisual: () => '',
    emptyState: (_icon, title, description) => `<h2>${title}</h2><p>${description}</p>`, localizeError: message => message,
    toast: (...args) => notices.push(args),
    api: (...args) => { calls.push(args); return api(...args); },
  });
  const functions = [...activityHelpers, 'activityTabs', 'renderActivity', 'appEnforcementMarkup',
    'escapeHtml', 'formatDate', 'queryString', 'deviceName', 'categoryLabel', 'categoryBadge',
    'accessStatusLabel', 'accessStatusBadge', 'duration', 'websiteActivityTitle', 'websiteActivitySubtitle', 'safeExternalUrl'];
  vm.runInContext(functions.map(name => functionSource(source, name)).join('\n'), context);
  vm.runInContext(source.slice(source.indexOf('async function handleClick(event)'),
    source.indexOf("\ndocument.addEventListener('submit'", source.indexOf('async function handleClick(event)'))), context);
  const click = (action, data = {}) => {
    const button = { dataset: { action, ...data } };
    return context.handleClick({ target: { closest: selector => selector === '[data-action]' ? button : null } });
  };
  return { ...dom, state, context, notices, calls, click };
}

const rows = Array.from({ length: 5 }, (_, index) => ({ domain: `site-${index}.example`,
  url: `https://site-${index}.example`, device_id: 7, duration_seconds: 10, category: 'unknown', access_status: 'open' }));

test('long Vietnamese names, badge labels and URL fallbacks remain complete in table markup and links', async () => {
  const name = 'Ứng dụng học tập & tra cứu <tài liệu> '.repeat(12);
  const device = 'Máy tính của Nguyễn Hoàng Anh — '.repeat(12);
  const category = 'Danh mục cần phụ huynh xem xét '.repeat(8);
  const url = `https://example.com/${'a'.repeat(600)}?q=hoc&lang=vi`;
  const row = { ...rows[0], app_name: name, page_title: name, url, access_status: 'blocked' };
  const page = dashboard(async endpoint => ({ data: endpoint.includes('enforcement')
    ? [{ ...row, outcome: 'failed', reason: 'access_denied' }] : [row] }));
  page.state.devices[0].device_name = device;
  page.context.categoryLabels.unknown = category;
  for (const tab of ['apps', 'web']) {
    page.state.activityTab = tab;
    await page.context.renderActivity(page.content);
    const html = page.content.innerHTML;
    const renderedName = tab === 'web' ? name.trim() : name;
    assert.ok(html.includes(`<strong>${page.context.escapeHtml(renderedName)}</strong>`));
    assert.ok(html.includes(page.context.escapeHtml(device)));
    assert.ok(html.includes(page.context.escapeHtml(category)));
    assert.doesNotMatch(html, /<tài liệu>/);
    assert.equal(page.state.activityViewRows.length, 1);
    assert.equal(page.state.activityViewRows[0].url, url);
    if (tab === 'web') assert.ok(html.includes(`href="${page.context.escapeHtml(url)}" target="_blank" rel="noopener noreferrer"`));
    else assert.match(html, /Yêu cầu chặn[\s\S]*Chặn thất bại/);
    assertTabs(html, tab);
  }
  page.context.api = async () => ({ data: [{ ...row, page_title: '', domain: '' }] });
  await page.context.renderActivity(page.content);
  assert.ok(page.content.innerHTML.includes(`<strong>${page.context.escapeHtml(url)}</strong>`));
  assert.ok(page.content.innerHTML.includes(`href="${page.context.escapeHtml(url)}" target="_blank" rel="noopener noreferrer"`));
});

for (const action of ['activity-tab', 'activity-page', 'refresh-app-enforcement', 'refresh-screenshots', 'clear-activity-filter', 'retry-activity']) {
  test(`${action}: handler awaits and catches a rejected renderer`, async () => {
    const page = dashboard();
    page.context.renderActivity = async () => { throw new Error('fixture rejection'); };
    await assert.doesNotReject(page.click(action, { tab: 'apps', offset: '2' }));
    assert.equal(page.notices.length, 1);
    assert.equal(page.notices[0][2], 'error');
  });
}

test('loading replaces old data/actions; failure is local, ends busy and allows tab changes', async () => {
  const request = deferred();
  const page = dashboard(() => request.promise);
  const pending = page.context.renderActivity(page.content);
  assert.match(page.content.innerHTML, /Đang tải hoạt động website/);
  assert.match(page.content.innerHTML, /aria-busy="true"/);
  assert.doesNotMatch(page.content.innerHTML, /export-activity|activity-page|old\.example/);
  assert.equal(page.state.activityViewRows.length, 0);
  const status = page.content.querySelector('#activity-load-status');
  request.reject(new Error('offline'));
  await pending;
  assert.match(page.content.innerHTML, /Chưa tải được hoạt động website/);
  assert.match(page.content.innerHTML, /data-action="retry-activity"/);
  assert.match(page.content.innerHTML, /aria-busy="false"/);
  assert.equal(page.notices.length, 0);
  assert.equal(page.content.querySelector('#activity-load-status'), status);
  page.context.api = async () => ({ data: [] });
  await page.click('activity-tab', { tab: 'apps' });
  assert.match(status.textContent, /Có 0 bản ghi phù hợp trong 0 bản ghi đã tải/);
  assert.equal(page.state.activityTab, 'apps');
});

test('retry preserves tab, filters, offset, API limit and CSV eligibility', async () => {
  let fail = true;
  const page = dashboard(async () => { if (fail) throw Error('offline'); return { data: rows }; });
  page.state.activityFilter = { search: 'site', device_id: '7', start: '2026-10-01T10:00', category: 'unknown' };
  page.state.activityOffset = 2;
  const filter = JSON.stringify(page.state.activityFilter);
  await page.context.renderActivity(page.content);
  assert.equal(page.state.activityOffset, 2);
  fail = false;
  await page.click('retry-activity');
  assert.equal(JSON.stringify(page.state.activityFilter), filter);
  assert.equal(page.state.activityTab, 'web');
  assert.equal(page.state.activityOffset, 2);
  assert.equal(page.calls[0][0], page.calls[1][0]);
  assert.equal(new URL(page.calls[1][0], 'https://test').searchParams.get('limit'), '200');
  assert.match(page.content.innerHTML, /Trang 2\/3/);
  assert.match(page.content.innerHTML, /data-action="export-activity" >/);
  assert.equal(page.state.activityViewRows.length, 5);
});

for (const outcome of ['success', 'failure']) {
  test(`late ${outcome} cannot change a newer render, status, state or focus`, async () => {
    const request = deferred();
    const page = dashboard(() => request.promise);
    const old = page.context.renderActivity(page.content);
    page.context.api = async () => ({ data: rows });
    await page.context.renderActivity(page.content);
    const html = page.content.innerHTML;
    const logs = page.state.webLogs;
    const active = page.document.activeElement;
    if (outcome === 'success') request.resolve({ data: [{ domain: 'stale.example' }] });
    else request.reject(Error('stale failure'));
    await old;
    assert.equal(page.content.innerHTML, html);
    assert.equal(page.state.webLogs, logs);
    assert.equal(page.document.activeElement, active);
    assert.equal(page.listeners.size, 0);
  });
}

test('old device response cannot replace device state or request activity logs', async () => {
  const request = deferred();
  const page = dashboard(() => request.promise);
  page.state.devices = [];
  const pending = page.context.renderActivity(page.content);
  page.context.activityRenderVersion++;
  page.state.devices = [{ device_id: 99 }];
  request.resolve({ data: [{ device_id: 1 }] });
  await pending;
  assert.equal(page.state.devices[0].device_id, 99);
  assert.equal(page.calls.length, 1);
});

for (const invalidation of ['navigation', 'logout', 'new-session', 'disconnected']) {
  for (const outcome of ['success', 'failure']) {
    test(`${invalidation}: pending ${outcome} cannot update the previous Activity view`, async () => {
      const request = deferred();
      const page = dashboard(() => request.promise);
      const pending = page.context.renderActivity(page.content);
      if (invalidation === 'navigation') page.state.page = 'overview';
      if (invalidation === 'logout') page.state.accessToken = '';
      if (invalidation === 'new-session') page.state.accessToken = 'new-token';
      if (invalidation === 'disconnected') page.content.isConnected = false;
      const html = page.content.innerHTML;
      if (outcome === 'success') request.resolve({ data: rows });
      else request.reject(Error('offline'));
      await pending;
      assert.equal(page.content.innerHTML, html);
      assert.equal(page.state.webLogs.length, 0);
      assert.equal(page.notices.length, 0);
      assert.equal(page.listeners.size, 0);
    });
  }
}

test('older completion cannot clear the busy state of a newer pending request', async () => {
  const first = deferred(), second = deferred();
  const page = dashboard(() => first.promise);
  const old = page.context.renderActivity(page.content);
  page.context.api = () => second.promise;
  const current = page.context.renderActivity(page.content);
  first.reject(Error('old failure'));
  await old;
  assert.match(page.content.innerHTML, /aria-busy="true"/);
  second.resolve({ data: [] });
  await current;
  assert.match(page.content.innerHTML, /aria-busy="false"/);
});

function assertTabs(html, activeTab) {
  const ids = [...html.matchAll(/(?<![\w-])id="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g)) {
    for (const id of match[1].split(/\s+/)) assert.ok(ids.includes(id), `missing ${id}`);
  }
  assert.match(html, /role="tablist"/);
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 3);
  assert.match(html, new RegExp(`id="activity-tab-${activeTab}"[^>]*aria-selected="true"[^>]*tabindex="0"`));
  assert.equal((html.match(/role="tabpanel"[^>]* hidden/g) || []).length, 2);
}

test('Activity renders real data without the decorative banner, preserving all summary values and filters', async () => {
  for (const tab of ['apps', 'web']) {
    const data = rows.map((row, i) => ({ ...row, app_name: `App ${i}`, access_status: i === 0 ? 'blocked' : 'open' }));
    const page = dashboard(async url => ({ data: url.includes('enforcement') ? [] : data }));
    let bannerCalls = 0;
    page.context.sectionVisual = () => { bannerCalls++; return '<section class="section-visual">Banner</section>'; };
    page.state.activityTab = tab;
    await page.context.renderActivity(page.content);
    const html = page.content.innerHTML;
    assert.equal(bannerCalls, 0);
    assert.doesNotMatch(html, /section-visual|summary-icon/);
    assert.match(html, /<h1>Hoạt động<\/h1>/);
    const summary = html.match(/<section class="page-summary-strip"[^>]*>([\s\S]*?)<\/section>/)[1];
    assert.equal((summary.match(/<small>/g) || []).length, 4);
    assert.match(summary, /class="activity-summary-primary"><span><small>Bản ghi phù hợp<\/small><strong>5 bản ghi/);
    assert.ok(summary.includes(`Thời lượng các kết quả</small><strong>${page.context.duration(50)}`));
    assert.match(summary, /<strong>1 lượt/);
    assert.match(summary, /Thiết bị trong kết quả<\/small><strong>1 thiết bị/);
    const filter = html.match(/<form id="activity-filter"[\s\S]*?<\/form>/)[0];
    assert.deepEqual([...filter.matchAll(/name="([^"]+)"/g)].map(match => match[1]),
      ['search', 'device_id', 'category', 'access_status', 'start', 'end']);
    assert.match(filter, /data-action="clear-activity-filter"/);
    assert.match(filter, /type="submit">Áp dụng/);
    assert.match(html, /class="table-card activity-history"/);
    assert.match(html, /data-action="activity-page"/);
    assert.match(html, /data-action="export-activity"/);
    assert.match(html, /class="activity-note">Trang tải tối đa 200/);
    assert.match(html, /class="activity-note">Các chỉ số và CSV/);
    assert.match(html, /class="activity-note">Khoảng thời gian được lọc/);
    if (tab === 'apps') assert.ok(html.indexOf('activity-history') < html.indexOf('activity-enforcement'));
    else assert.doesNotMatch(html, /activity-enforcement|app-enforcement-title|refresh-app-enforcement/);
    assertTabs(html, tab);
  }
});

test('Activity layout retains Distill surfaces with only the approved minimum target heights', () => {
  const marker = '/* Activity content: preserve existing column breakpoints and control styles. */';
  const scoped = styles.slice(styles.indexOf(marker) + marker.length);
  assert.ok(styles.includes(marker));
  const blocks = [...scoped.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  assert.ok(blocks.length > 0);
  for (const [, selectors, declarations] of blocks) {
    const focusSelector = '#activity-surface :is(button, a, .input, .select, [tabindex]):focus-visible';
    if (selectors.includes(':focus')) {
      assert.equal(selectors.trim(), focusSelector);
      assert.equal(declarations.trim(), 'outline-color: var(--forest);');
    } else {
      for (const selector of selectors.trim().split(',')) assert.ok(selector.trim().startsWith('#activity-surface '), selector);
    }
    assert.doesNotMatch(declarations, /(?:^|;)\s*(?:grid-template-columns|order|(?:max-)?height|outline)\s*:/);
    for (const declaration of declarations.split(';').filter(value => /^\s*min-height\s*:/.test(value))) {
      assert.equal(declaration.trim(), 'min-height: 44px');
      for (const selector of selectors.trim().split(',')) assert.ok([
        '#activity-surface .activity-tabs .tab', '#activity-surface .btn-sm',
      ].includes(selector.trim()), selector);
      assert.equal(declarations.trim(), 'min-height: 44px;');
    }
    for (const declaration of declarations.split(';').filter(value => value.includes('!important'))) {
      assert.match(declaration.trim(), /^font-size: 0\.875rem !important$/);
      for (const selector of selectors.trim().split(',')) assert.ok([
        '#activity-surface .page-summary-strip small',
        '#activity-surface .activity-history .cell-title small',
        '#activity-surface .activity-enforcement .cell-title small',
      ].includes(selector.trim()), selector);
    }
  }
  assert.equal((scoped.match(/!important/g) || []).length, 2);
  assert.doesNotMatch(scoped, /@media|\.screenshot-grid|\.screenshot-preview\s*\{/);
  assert.match(scoped, /\.page-summary-strip > div\s*\{[^}]*display: flex/);
  assert.match(scoped, /\.page-summary-strip strong\s*\{[^}]*white-space: normal/);
  assert.match(scoped, /#activity-filter\s*\{[^}]*background: transparent;[^}]*box-shadow: none/);
  assert.match(scoped, /\.activity-history\s*\{[^}]*box-shadow: none/);
  assert.match(scoped, /\.activity-enforcement\s*\{[^}]*border-top: 1px solid var\(--line\)/);
});

test('Activity focus color has contrast against surrounding surfaces and retains the separated outline', () => {
  const selector = '#activity-surface :is(button, a, .input, .select, [tabindex]):focus-visible';
  const blocks = [...styles.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const focusBlocks = blocks.filter(([, selectors]) => selectors.trim() === selector);
  assert.equal(focusBlocks.length, 1);
  assert.equal(focusBlocks[0][2].trim(), 'outline-color: var(--forest);');
  const root = typeRule(':root');
  assert.equal(root['--forest'], '#174ea6');
  assert.equal(root['--primary-ring'], '#60a5fa');
  const luminance = hex => hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (a, b) => {
    const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  for (const background of [root['--paper'], root['--cream'], root['--mint'], root['--mint-2'], '#f5f8fc', '#f8fbff']) {
    assert.ok(contrast(root['--forest'], background) >= 3, background);
  }
  // The active fill matches the new ring, so the existing 3px gap is essential.
  // This checks source geometry assumptions, not rendered pixels or clipping.
  assert.equal(typeRule('.tab.active').background, 'var(--forest)');
  assert.equal(typeRule('.tabs').background, 'white');
  assert.equal(contrast(root['--forest'], root['--forest']), 1);
  for (const target of ['button', 'a', '.input', '.select', '[tabindex]']) {
    const focus = typeRule(`${target}:focus-visible`);
    assert.equal(focus.outline, '3px solid var(--primary-ring)');
    assert.equal(focus['outline-offset'], '3px');
  }
  assert.equal(typeRule('#activity-surface .activity-tabs .tab')['min-height'], '44px');
  assert.equal(typeRule('#activity-surface .btn-sm')['min-height'], '44px');
});

test('Activity disabled hover preserves the default primary fill and all other disabled properties', () => {
  const selector = '#activity-surface .btn:not(.btn-secondary):not(.btn-danger):not(.btn-ghost):disabled:hover';
  assert.deepEqual(typeRule(selector), { background: typeRule('.btn').background });
  assert.equal(typeRule('.btn').background, 'var(--forest)');
  assert.deepEqual(typeRule('.btn:disabled'), {
    cursor: 'not-allowed', opacity: '0.55', transform: 'none', 'box-shadow': 'none',
  });
  assert.equal(typeRule('.btn:not(.btn-secondary):not(.btn-danger):not(.btn-ghost):hover').background, 'var(--primary-hover)');
  assert.equal(typeRule('.btn-secondary').background, 'white');
  assert.equal(typeRule('.btn-danger').background, 'var(--red-soft)');
  assert.equal(typeRule('.btn-ghost').background, 'transparent');
});

test('Activity target heights are scoped and match the actual history and enforcement controls', async () => {
  assert.equal(typeRule('#activity-surface .activity-tabs .tab')['min-height'], '44px');
  assert.deepEqual(typeRule('#activity-surface .btn-sm'), { 'min-height': '44px' });
  // Shared controls retain their existing sizes; scoped selectors win by specificity.
  assert.equal(typeRule('.tab')['min-height'], '34px');
  assert.equal(typeRule('.btn-sm')['min-height'], '38px');
  assert.equal(typeRule('#activity-surface .activity-history .pagination')['flex-wrap'], 'wrap');
  assert.equal(typeRule('#activity-surface .activity-history .pagination > button')['flex-shrink'], '0');
  assert.equal(typeRule('#activity-surface .activity-enforcement .card-head > button')['flex-shrink'], '0');
  const page = dashboard(async endpoint => ({ data: endpoint.includes('enforcement') ? [] : rows }));
  for (const tab of ['apps', 'web']) {
    page.state.activityTab = tab;
    await page.context.renderActivity(page.content);
    const html = page.content.innerHTML;
    const smallButtons = [...html.matchAll(/<button\b[^>]*class="[^"]*\bbtn-sm\b[^"]*"[^>]*>/g)]
      .map(([tag]) => tag.match(/data-action="([^"]+)"/)[1]);
    assert.deepEqual(smallButtons, tab === 'apps'
      ? ['activity-page', 'activity-page', 'refresh-app-enforcement']
      : ['activity-page', 'activity-page']);
    assertTabs(html, tab);
  }
});

test('Activity layout aligns existing summary wrappers and places filter actions across the grid', async () => {
  const rule = selector => [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some(value => value.trim() === selector))
    .map(([, , declarations]) => declarations).join('\n');
  const values = rule('#activity-surface .page-summary-strip strong');
  assert.match(rule('#activity-surface .page-summary-strip > div'), /align-items: stretch/);
  assert.match(rule('#activity-surface .page-summary-strip > div > span'), /display: flex;[\s\S]*flex-direction: column;[\s\S]*flex: 1/);
  assert.match(values, /margin-top: auto/);
  assert.match(values, /padding-top: 2px/);
  assert.match(rule('#activity-surface .activity-summary-primary strong'), /font-weight: 800/);
  assert.match(rule('#activity-surface .activity-filters .filter-actions'), /grid-column: 1 \/ -1/);
  assert.doesNotMatch(rule('#activity-surface .activity-filters .filter-actions'), /justify-content|\bheight\s*:|\bpadding\s*:/);
  // Retain the existing end alignment and mobile button expansion in the cascade.
  assert.match(rule('.filters .filter-actions'), /justify-content: flex-end/);
  assert.match(rule('.activity-filters .filter-actions .btn'), /flex: 1/);
  for (const tab of ['apps', 'web']) {
    const page = dashboard(async url => ({ data: url.includes('enforcement') ? [] : rows.map(row => ({ ...row, app_name: 'App' })) }));
    page.state.activityTab = tab;
    await page.context.renderActivity(page.content);
    const html = page.content.innerHTML;
    const summary = html.match(/<section class="page-summary-strip"[^>]*>([\s\S]*?)<\/section>/)[1];
    assert.equal((summary.match(/<div(?: class="activity-summary-primary")?><span><small>/g) || []).length, 4);
    const form = html.match(/<form id="activity-filter"[\s\S]*?<\/form>/)[0];
    assert.deepEqual([...form.matchAll(/name="([^"]+)"/g)].map(m => m[1]),
      ['search', 'device_id', 'category', 'access_status', 'start', 'end']);
    assert.ok(form.indexOf('name="end"') < form.indexOf('class="filter-actions"'));
    assert.ok(form.indexOf('data-action="clear-activity-filter"') < form.indexOf('type="submit"'));
    assertTabs(html, tab);
  }
});

test('history and enforcement wrapping preserves reading and action order', async () => {
  const rule = selector => [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(',').some(value => value.trim() === selector))
    .map(([, , declarations]) => declarations).join('\n');
  for (const selector of ['#activity-surface .activity-history .table-footer',
    '#activity-surface .activity-history .pagination', '#activity-surface .activity-enforcement .card-head']) {
    assert.match(rule(selector), /flex-wrap: wrap/);
    assert.doesNotMatch(rule(selector), /flex-direction|\border\s*:/);
  }
  assert.match(rule('.table-footer'), /flex-direction: column/);
  assert.match(rule('#activity-surface .activity-enforcement .card-head > div'), /flex: 1 1 24rem;[\s\S]*min-width: 0;[\s\S]*max-width: 100%/);
  for (const selector of ['#activity-surface .activity-history .pagination > button',
    '#activity-surface .activity-enforcement .card-head > button']) assert.match(rule(selector), /flex-shrink: 0/);
  const page = dashboard(async url => ({ data: url.includes('enforcement') ? [] : [{ app_name: 'App', device_id: 7 }] }));
  page.state.activityTab = 'apps';
  await page.context.renderActivity(page.content);
  const footer = page.content.innerHTML.match(/<div class="table-footer">([\s\S]*?)<\/section>/)[1];
  assert.ok(footer.indexOf('Hiển thị') < footer.indexOf('class="pagination"'));
  assert.ok(footer.indexOf('class="pagination"') < footer.indexOf('Thời lượng các kết quả'));
  assert.ok(page.content.innerHTML.indexOf('activity-history') < page.content.innerHTML.indexOf('activity-enforcement'));
  const head = page.content.innerHTML.match(/<section class="card activity-enforcement"[\s\S]*?<div class="card-head">([\s\S]*?)<\/button>/)[1];
  assert.match(head, /^<div><h2/);
  assert.match(head, /<\/div><button[^>]*data-action="refresh-app-enforcement"/);
});

test('tab/panel IDs and references remain valid in loading, error and success', async () => {
  for (const tab of ['apps', 'web']) {
    const request = deferred();
    const page = dashboard(() => request.promise);
    page.state.activityTab = tab;
    const pending = page.context.renderActivity(page.content);
    assertTabs(page.content.innerHTML, tab);
    request.reject(Error('offline'));
    await pending;
    assertTabs(page.content.innerHTML, tab);
    page.context.api = async () => ({ data: [] });
    await page.context.renderActivity(page.content);
    assertTabs(page.content.innerHTML, tab);
  }
});

for (const interaction of ['activity-tab', 'activity-page']) {
  test(`${interaction} restores owned focus and disposes its listener`, async () => {
    const page = dashboard(async () => ({ data: rows }));
    await page.context.renderActivity(page.content);
    page.content.querySelector(interaction === 'activity-tab' ? '#activity-tab-web' : '[data-action="activity-page"]').focus();
    await page.context.renderActivity(page.content, interaction);
    assert.equal(page.document.activeElement.id, interaction === 'activity-tab' ? 'activity-tab-web' : 'activity-panel-web');
    assert.equal(page.document.activeElement.isConnected, true);
    assert.equal(page.listeners.size, 0);
  });
}

test('failure offers keyboard focus on retry and never steals focus after the user moves away', async () => {
  const page = dashboard();
  await page.context.renderActivity(page.content);
  page.content.querySelector('#activity-tab-web').focus();
  page.context.api = async () => { throw Error('offline'); };
  await page.context.renderActivity(page.content, 'activity-page');
  assert.equal(page.document.activeElement.dataset.action, 'retry-activity');
  const request = deferred();
  page.context.api = () => request.promise;
  const pending = page.context.renderActivity(page.content, 'retry-activity');
  const outside = { id: 'other-control' };
  page.document.focus(outside);
  request.resolve({ data: rows });
  await pending;
  assert.equal(page.document.activeElement, outside);
});

test('enforcement failure keeps application history and its separate retry', async () => {
  const page = dashboard(async path => {
    if (path.startsWith('/logs/app-enforcement')) throw Error('receipts unavailable');
    return { data: [{ app_name: 'Fixture app', device_id: 7 }] };
  });
  page.state.activityTab = 'apps';
  await page.context.renderActivity(page.content);
  assert.match(page.content.innerHTML, /Fixture app/);
  assert.match(page.content.innerHTML, /Chưa tải được kết quả chặn/);
  assert.match(page.content.innerHTML, /data-action="refresh-app-enforcement"/);
  assert.doesNotMatch(page.content.innerHTML, /data-action="retry-activity"/);
});

for (const tab of ['apps', 'web']) {
  test(`${tab}: copy distinguishes loaded, filtered and paginated totals without changing queries`, async () => {
    const data = rows.map((row, i) => ({ ...row, app_name: `Fixture ${i}`, category: i === 0 ? 'learning' : 'unknown' }));
    const page = dashboard(async url => ({ data: url.includes('enforcement') ? [] : data }));
    page.state.activityTab = tab;
    page.state.activityFilter = { category: 'unknown', access_status: 'open', start: '2026-10-01T10:00', end: '2026-10-31T10:00' };
    page.state.activityOffset = 2;
    await page.context.renderActivity(page.content);
    const html = page.content.innerHTML;
    assert.match(html, /tối đa 200 bản ghi gần nhất theo thiết bị và khoảng thời gian đã áp dụng/);
    assert.match(html, /Khi chọn tất cả thiết bị, giới hạn này tính chung, không phải cho từng thiết bị/);
    assert.match(html, /Tìm kiếm, danh mục và trạng thái chỉ lọc trong tập đã tải/);
    assert.match(html, /Có 4 bản ghi phù hợp trong 5 bản ghi đã tải. Trang 2\/2/);
    assert.match(html, /Bản ghi phù hợp<\/small><strong>4 bản ghi/);
    assert.ok(html.includes(`Thời lượng các kết quả</small><strong>${page.context.duration(40)}`));
    assert.match(html, /Thiết bị trong kết quả<\/small><strong>1 thiết bị/);
    assert.match(html, /Hiển thị 3–4 \/ 4 bản ghi phù hợp/);
    assert.match(html, /Các chỉ số và CSV gồm toàn bộ kết quả sau lọc trong tập đã tải, kể cả các trang kết quả khác/);
    assert.match(html, /không đại diện cho toàn bộ thời gian sử dụng/);
    assert.match(html, /Xuất kết quả CSV/);
    assert.match(html, tab === 'apps' ? /lúc ứng dụng bắt đầu hoạt động/ : /lúc truy cập website/);
    assert.match(html, tab === 'apps' ? /Bản ghi thuộc nhóm chặn/ : /Bản ghi có trạng thái chặn/);
    const query = new URL(page.calls[0][0], 'https://fixture').searchParams;
    assert.equal(query.get('limit'), '200');
    assert.equal(query.get('start'), page.state.activityFilter.start);
    assert.equal(query.get('end'), page.state.activityFilter.end);
    for (const local of ['search', 'category', 'access_status', 'offset', 'device_id']) assert.equal(query.has(local), false);
    assert.equal(page.state.activityViewRows.length, 4);
    assertTabs(html, tab);
  });

  test(`${tab}: empty loaded data and no matches have different guidance`, async () => {
    const page = dashboard();
    page.state.activityTab = tab;
    await page.context.renderActivity(page.content);
    assert.match(page.content.innerHTML, /Chưa có bản ghi trong phạm vi đã chọn/);
    assert.match(page.content.innerHTML, /Thử đổi thiết bị hoặc khoảng thời gian/);
    assert.doesNotMatch(page.content.innerHTML, /Không có kết quả phù hợp|data-action="retry-activity"/);
    page.context.api = async () => ({ data: rows.map(row => ({ ...row, app_name: 'Existing' })) });
    page.state.activityFilter = { search: 'does-not-exist' };
    await page.context.renderActivity(page.content);
    assert.match(page.content.innerHTML, /Không có kết quả phù hợp/);
    assert.match(page.content.innerHTML, /Thử đổi từ khóa, danh mục hoặc trạng thái/);
    assert.match(page.content.innerHTML, /Có 0 bản ghi phù hợp trong 5 bản ghi đã tải/);
    assert.doesNotMatch(page.content.innerHTML, /Chưa có bản ghi trong phạm vi đã chọn|data-action="retry-activity"/);
    assert.equal(page.state.activityViewRows.length, 0);
    assert.match(page.content.innerHTML, /data-action="export-activity" disabled/);
  });

  test(`${tab}: CSV includes filtered records from every page with unchanged bytes and download naming`, async () => {
    const data = rows.map((row, i) => ({ ...row, app_name: `Fixture ${i}`, category: i === 0 ? 'learning' : 'unknown' }));
    const page = dashboard(async url => ({ data: url.includes('enforcement') ? [] : data }));
    page.state.activityTab = tab;
    page.state.activityFilter = { category: 'unknown' };
    page.state.activityOffset = 2;
    await page.context.renderActivity(page.content);
    let blob, appended = false, clicked = false, removed = false, revoked = false;
    const link = { click() { clicked = true; }, remove() { removed = true; } };
    page.context.Blob = Blob;
    page.context.URL = class extends URL {
      static createObjectURL(value) { blob = value; return 'blob:fixture'; }
      static revokeObjectURL(value) { assert.equal(value, 'blob:fixture'); revoked = true; }
    };
    page.document.createElement = tag => { assert.equal(tag, 'a'); return link; };
    page.document.body.appendChild = node => { assert.equal(node, link); appended = true; };
    vm.runInContext(['csvCell', 'exportActivityCsv'].map(name => functionSource(source, name)).join('\n'), page.context);
    page.context.exportActivityCsv();
    const bytes = Buffer.from(await blob.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    const lines = bytes.subarray(3).toString('utf8').split('\r\n');
    assert.equal(lines.length, 5, 'header plus four filtered rows, although only two are on this page');
    assert.equal(lines[0], tab === 'apps'
      ? '"Ứng dụng","Danh mục","Chính sách hiện tại","Thiết bị","Bắt đầu","Kết thúc","Thời lượng (giây)"'
      : '"Tiêu đề","Tên miền","URL","Danh mục","Trạng thái hiện tại","Thiết bị","Truy cập","Thời lượng (giây)"');
    for (let i = 1; i < 5; i++) assert.ok(lines[i].includes(tab === 'apps' ? `Fixture ${i}` : `site-${i}.example`));
    assert.ok(!lines.slice(1).join('').includes(tab === 'apps' ? 'Fixture 0' : 'site-0.example'));
    assert.equal(blob.type, 'text/csv;charset=utf-8');
    assert.match(link.download, new RegExp(`^safenest-${tab}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
    assert.equal(link.href, 'blob:fixture');
    assert.ok(appended && clicked && removed && revoked);
  });
}
