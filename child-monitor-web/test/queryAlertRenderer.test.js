const test = require('node:test');
const assert = require('node:assert/strict');
const { renderQueryAlerts } = require('./queryAlertRenderer');

test('Distill never calls the alerts banner and preserves the real page heading and description', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { functionSource } = require('./queryAlertRenderer');
  const { fixture } = require('./alertsState.test');
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const view = fixture(); const bannerCalls = [];
  view.context.currentDateLabel = () => 'Fixture date';
  vm.runInContext(source.match(/const pageTitles = \{[\s\S]*?\n\};/)[0] + '\n' + functionSource(source, 'pageHead'), view.context);
  view.context.sectionVisual = page => { bannerCalls.push(page); return '<section class="section-visual">Banner</section>'; };
  await view.render(); await view.render({ background: true });
  assert.deepEqual(bannerCalls, []);
  assert.equal(view.content.querySelector('h1').textContent, 'Cảnh báo');
  assert.ok(view.content.querySelector('.page-head-copy').textContent.includes('Những tín hiệu phụ huynh cần xem xét và phản hồi.'));
  assert.equal(view.content.querySelector('.section-visual'), null);
  assert.equal(view.content.querySelector('[data-action="mark-all-read"]').getAttribute('aria-describedby'), 'alerts-read-help');
  const summary = view.content.querySelector('.alert-summary');
  assert.equal(summary.children.filter(node => node.tag === 'div').length, 4);
  assert.equal(summary.querySelectorAll('.summary-icon').length, 0);
  for (const cell of summary.children.filter(node => node.tag === 'div')) {
    assert.equal(cell.children.filter(node => node.tag).length, 1);
    assert.ok(cell.querySelector('small')); assert.ok(cell.querySelector('strong'));
  }
});

test('Distill CSS matches alert containers and only removes decoration and the inner icon column', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const { fixture } = require('./alertsState.test'); const view = fixture(); await view.render();
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const distillStart = css.indexOf('/* Alerts: flatten decoration');
  const layoutStart = css.indexOf('/* Alerts layout:');
  assert.ok(distillStart >= 0 && layoutStart > distillStart);
  const rules = [...css.slice(distillStart, layoutStart).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.trim().startsWith('#alerts-surface'));
  const expected = {
    '#alerts-surface .alert-summary': { 'border-radius': '0', 'box-shadow': 'none' },
    '#alerts-surface .alert-summary > div': { 'grid-template-columns': 'minmax(0, 1fr)' },
    '#alerts-surface #alert-filter': { 'box-shadow': 'none' },
    '#alerts-surface #alerts-results': { 'box-shadow': 'none' },
  };
  assert.equal(rules.length, 4);
  for (const [, selectorText, declarations] of rules) {
    const selector = selectorText.trim(); assert.ok(selector in expected);
    const actual = Object.fromEntries(declarations.split(';').filter(part => part.includes(':')).map(part => part.split(':').map(value => value.trim())));
    assert.deepEqual(actual, expected[selector]);
    if (!selector.includes(' > ')) assert.equal(view.content.querySelectorAll(selector).length, 1);
  }
  // Inner cells follow this direct-child relationship; preserve the outer 4/2/1 grid.
  const summary = view.content.querySelector('.alert-summary');
  assert.equal(summary.querySelectorAll('div').filter(node => node.parent === summary).length, 4);
  assert.match(css, /\.page-summary-strip\s*\{\s*display: grid;\s*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 1260px\)[\s\S]*?\.page-summary-strip\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 390px\)[\s\S]*?\.page-summary-strip\s*\{\s*grid-template-columns: 1fr;/);
  assert.match(css, /\.card\s*\{[^}]*box-shadow: var\(--shadow-sm\)/);
  assert.match(css, /\.filters\s*\{[^}]*padding: 18px;[^}]*box-shadow: 0 8px 24px/);
  assert.match(css, /\.page-summary-strip\s*\{[^}]*border: 1px solid var\(--line\);[^}]*box-shadow: 0 8px 24px/);
});

test('Alerts Layout A only scopes wrapping and group spacing before Activity CSS', () => {
  const fs = require('node:fs'), path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const layoutStart = css.indexOf('/* Alerts layout:');
  const typesetStart = css.indexOf('/* Alerts typeset:');
  const activityStart = css.indexOf('/* Activity content:');
  assert.ok(layoutStart >= 0 && typesetStart > layoutStart && activityStart > typesetStart);
  const layout = css.slice(layoutStart, typesetStart).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...layout.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const expected = {
    '#alerts-surface .page-head': { 'flex-wrap': 'wrap' },
    '#alerts-surface .head-actions': { 'align-items': 'center', 'min-width': '0', 'max-width': '100%' },
    '#alerts-surface [data-action="mark-all-read"]': { 'min-width': '0', 'max-width': '100%' },
    '#alerts-surface .alert-summary': { 'margin-bottom': '8px' },
    '#alerts-surface #alerts-scope-note': { margin: '0 0 16px' },
    '#alerts-surface #alerts-filter-help': { margin: '0 0 8px' },
    '#alerts-surface #alert-filter': { 'margin-bottom': '8px' },
    '#alerts-surface #alerts-read-help': { margin: '0 0 16px' },
    '#alerts-surface #alerts-load-status:not(:empty)': { 'margin-bottom': '16px' },
    '#alerts-surface #alerts-load-status p': { margin: '0 0 8px' },
  };
  assert.equal(rules.length, Object.keys(expected).length);
  assert.deepEqual(rules.map(([, selector]) => selector.trim()).sort(), Object.keys(expected).sort());
  for (const [, selector, declarations] of rules) {
    const actual = Object.fromEntries(declarations.split(';').filter(part => part.includes(':')).map(part => part.split(':').map(value => value.trim())));
    assert.deepEqual(actual, expected[selector.trim()]);
  }
  // Account for every Alerts rule: four Distill, ten Layout, ten Typeset, two Adapt and one Polish.
  const allAlertRules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.includes('#alerts-surface'));
  assert.equal(allAlertRules.length, rules.length + 4 + 10 + 2 + 1);
  assert.doesNotMatch(layout, /@media|!important/);
  assert.doesNotMatch(css.slice(activityStart), /#alerts-surface/);
  // These are source contracts, not proof of rendered wrapping or margin collapse.
  assert.match(css, /\.page-head\s*\{\s*align-items: stretch;\s*flex-direction: column;/);
  assert.match(css, /\.head-actions\s*\{\s*display: flex;\s*flex-wrap: wrap;\s*justify-content: flex-end;\s*gap: 9px;/);
  assert.match(css, /\.filters-alerts\s*\{\s*grid-template-columns: repeat\(2, minmax\(180px, 1fr\)\) auto;/);
  assert.match(css, /\.filters\s*\{[^}]*gap: 12px;/);
  assert.match(css, /\.alert-row\s*\{\s*display: grid;\s*grid-template-columns: auto minmax\(0, 1fr\) auto;\s*align-items: start;\s*gap: 15px;\s*padding: 17px 20px;/);
  assert.match(css, /\.page-summary-strip small,\s*\.page-summary-strip strong\s*\{\s*display: block;\s*overflow: hidden;\s*text-overflow: ellipsis;\s*white-space: nowrap;/);
});

test('Alerts layout status targets support empty, message-only and retry states without replacing the filter', async () => {
  const { fixture, deferred, row } = require('./alertsState.test');
  const view = fixture(); await view.render();
  const region = view.content.querySelector('#alerts-load-status');
  const filter = view.content.querySelector('#alert-filter');
  assert.equal(region.querySelector('p').textContent, 'Đã tải cảnh báo.');
  await view.render({ background: true });
  assert.equal(region.innerHTML, ''); // No whitespace text node preventing :empty.
  const wait = deferred(); view.context.api = () => wait.promise;
  const pending = view.render();
  assert.equal(view.content.querySelector('#alerts-load-status'), region);
  assert.equal(region.querySelectorAll('p').length, 1);
  assert.ok(region.querySelector('p').textContent.trim());
  assert.equal(region.querySelector('button'), null);
  wait.reject(Error('offline')); await pending;
  assert.equal(region.querySelectorAll('p').length, 1);
  assert.ok(region.querySelector('p').textContent.trim());
  const retry = region.querySelector('[data-action="retry-alerts"]');
  assert.ok(retry); assert.equal(retry.textContent, 'Tải lại danh sách');
  assert.equal(region.getAttribute('role'), 'status');
  assert.equal(region.getAttribute('aria-live'), 'polite');
  assert.equal(region.closest('[aria-busy]'), null);
  view.context.api = async () => ({ data: [row()] });
  await view.render();
  assert.equal(view.content.querySelector('#alerts-load-status'), region);
  assert.equal(region.querySelector('p').textContent, 'Đã tải cảnh báo.');
  assert.equal(region.querySelector('button'), null);
  await view.render({ background: true });
  assert.equal(region.innerHTML, '');
  assert.equal(view.content.querySelector('#alert-filter'), filter);
});

test('Alerts Typeset B overrides small-text cascade with only the approved scoped type and wrapping properties', () => {
  const fs = require('node:fs'), path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const start = css.indexOf('/* Alerts typeset:');
  const end = css.indexOf('/* Alerts adapt:');
  const activityStart = css.indexOf('/* Activity content:');
  assert.ok(start > css.indexOf('/* Alerts layout:') && end > start && activityStart > end);
  const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const expected = {
    '#alerts-surface .alert-copy': { 'overflow-wrap': 'anywhere' },
    '#alerts-surface .alert-copy strong': { 'font-size': '16px', 'font-weight': '650', 'line-height': '1.4' },
    '#alerts-surface .alert-copy p': { 'font-size': '16px', 'font-weight': '400', 'line-height': '1.6' },
    '#alerts-surface .alert-copy small': { 'font-size': '14px !important', 'font-weight': '400', 'line-height': '1.5' },
    '#alerts-surface .alert-summary small': { 'font-size': '14px !important', 'font-weight': '500', 'line-height': '1.4' },
    '#alerts-surface .alert-summary strong': { 'font-size': '18px', 'font-weight': '700', 'line-height': '1.35' },
    '#alerts-surface .alert-summary small, #alerts-surface .alert-summary strong': {
      'white-space': 'normal', overflow: 'visible', 'text-overflow': 'clip', 'overflow-wrap': 'anywhere',
    },
    '#alerts-surface #alerts-scope-note, #alerts-surface #alerts-filter-help, #alerts-surface #alerts-read-help': {
      'font-size': '14px', 'font-weight': '400', 'line-height': '1.6',
    },
    '#alerts-surface .alert-row .badge': {
      'font-size': '14px', 'font-weight': '650', 'line-height': '1.4', 'white-space': 'normal', 'max-width': '100%', 'overflow-wrap': 'anywhere',
    },
    '#alerts-surface .empty-state p': { 'font-size': '14px', 'font-weight': '400', 'line-height': '1.6' },
  };
  const selectors = rules.map(([, selector]) => selector.trim().replace(/\s+/g, ' '));
  assert.deepEqual(selectors.sort(), Object.keys(expected).sort());
  for (const [, selector, declarations] of rules) {
    for (const part of selector.split(',')) assert.ok(part.trim().startsWith('#alerts-surface '));
    const actual = Object.fromEntries(declarations.split(';').filter(part => part.includes(':')).map(part => part.split(':').map(value => value.trim())));
    assert.deepEqual(actual, expected[selector.trim().replace(/\s+/g, ' ')]);
  }
  assert.equal((block.match(/!important/g) || []).length, 2);
  // Both shared important font sizes remain; ID-scoped important declarations win.
  assert.match(css.slice(0, start), /body small\s*\{\s*font-size: 0\.8rem !important;/);
  assert.match(css.slice(0, start), /\.page-summary-strip small\s*\{[^}]*font-size: 0\.69rem !important;/);
  assert.doesNotMatch(block, /@media|break-all|ellipsis|font-family|(?:^|[;{])\s*(?:color|padding|margin|gap|grid|display|height|min-height)\s*:/);
  assert.doesNotMatch(css.slice(activityStart), /#alerts-surface/);
  assert.match(css, /\.alerts-card\s*\{\s*overflow: hidden;/);
  assert.match(css, /\.empty-state p\s*\{\s*max-width: 430px;/);
});

test('Typeset targets preserve full long event and device text through polling and exclude the header badge', async () => {
  const { fixture, row } = require('./alertsState.test');
  const deviceName = 'Máy tính của bé Nguyễn Hoàng Anh ' + 'TênThiếtBịRấtDài'.repeat(24);
  const message = 'Nội dung cần phụ huynh xem xét. '.repeat(30) + 'https://example.test/' + 'duongdanlienmach'.repeat(60);
  let rows = [{ ...row(7, true), message }, row(8)];
  const view = fixture(async () => ({ data: rows }));
  view.state.devices[0].device_name = deviceName;
  await view.render();
  const form = view.content.querySelector('#alert-filter');
  const verify = () => {
    const article = view.content.querySelector('[data-alert-id="7"]');
    const copy = article.querySelector('.alert-copy');
    assert.equal(copy.querySelector('strong').textContent, 'Bé có dấu hiệu bị bạo lực');
    assert.equal(copy.querySelector('p').textContent, rows[0].message);
    assert.equal(copy.querySelector('small').textContent, deviceName + ' · ' + view.context.formatDate(rows[0].created_at));
    const badges = view.content.querySelector('#alerts-surface').querySelectorAll('.alert-row .badge');
    assert.equal(badges.length, 1); assert.equal(badges[0], article.querySelector('.badge'));
    assert.equal(badges[0].textContent, 'Đã đọc');
    const headerBadge = view.content.querySelector('[data-alert-unread-count]');
    assert.equal(headerBadge.closest('.alert-row'), null);
    assert.ok(!badges.includes(headerBadge)); assert.equal(headerBadge.textContent, '1 chưa đọc');
    assert.equal(view.content.querySelector('#alert-filter'), form);
  };
  verify();
  rows = [{ ...rows[0], message: message + ' Cập nhật đầy đủ.' }, row(8)];
  await view.render({ background: true });
  verify();
  // DOM mock checks content/selector scope only, not visual wrapping or geometry.
});

test('Alerts Adapt adds only the scoped row target height and focus color for existing controls', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const { fixture } = require('./alertsState.test');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const start = css.indexOf('/* Alerts adapt:');
  const end = css.indexOf('/* Alerts polish:');
  const activityStart = css.indexOf('/* Activity content:');
  assert.ok(start > css.indexOf('/* Alerts typeset:') && end > start && activityStart > end);
  const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const rules = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  assert.deepEqual(rules.map(([, selector, declaration]) => [selector.trim(), declaration.trim()]), [
    ['#alerts-surface [data-action="mark-alert"]', 'min-height: 44px;'],
    ['#alerts-surface :is(button, .select, [tabindex]):focus-visible', 'outline-color: var(--forest);'],
  ]);
  assert.doesNotMatch(block, /@media|!important/);
  assert.doesNotMatch(css.slice(activityStart), /#alerts-surface/);
  assert.match(css, /\.btn-sm\s*\{\s*min-height: 38px;/);
  assert.match(css, /\.btn\s*\{\s*min-height: 44px;/);
  assert.match(css, /\.input,\s*\.select,\s*\.textarea\s*\{[^}]*min-height: 46px;/);
  assert.match(css, /button:focus-visible,\s*a:focus-visible,\s*\.input:focus-visible,\s*\.select:focus-visible,\s*\.textarea:focus-visible,\s*\[tabindex\]:focus-visible\s*\{\s*outline: 3px solid var\(--primary-ring\);\s*outline-offset: 3px;/);
  assert.match(css, /\.input:focus,\s*\.select:focus,\s*\.textarea:focus\s*\{\s*border-color: var\(--forest-2\);\s*background: white;\s*box-shadow: 0 0 0 4px rgba\(37, 99, 235, 0\.12\);/);
  // The DOM double does not implement :is or :focus-visible; verify their real
  // target branches and scope without claiming browser focus/geometry coverage.
  const view = fixture(); await view.render();
  const surface = view.content.querySelector('#alerts-surface');
  const mark = surface.querySelector('[data-action="mark-alert"]');
  assert.equal(mark.tag, 'button'); assert.equal(mark.disabled, false);
  assert.equal(surface.querySelectorAll('button').length, 4);
  assert.equal(surface.querySelectorAll('.select').length, 2);
  assert.equal(surface.querySelectorAll('[tabindex]').length, 2);
  assert.equal(surface.querySelector('#alerts-results').getAttribute('tabindex'), '-1');
  assert.equal(mark.closest('[data-alert-id]').getAttribute('tabindex'), '-1');
  const controls = surface.querySelector('#alert-filter');
  view.context.api = async () => { throw Error('mock offline'); };
  await view.render();
  assert.equal(view.content.querySelector('#alerts-surface'), surface);
  assert.equal(surface.querySelector('#alert-filter'), controls);
  assert.equal(surface.querySelector('[data-action="retry-alerts"]').tag, 'button');
  assert.equal(surface.querySelector('[data-action="mark-all-read"]').disabled, true);
});

test('Alerts focus token exceeds 3:1 against CSS-derived surrounding surfaces', () => {
  const fs = require('node:fs'), path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const root = css.match(/:root\s*\{([^}]+)\}/)[1];
  const token = name => root.match(new RegExp('--' + name + ':\\s*(#[0-9a-f]{6})'))[1];
  assert.equal(token('forest'), '#174ea6'); assert.equal(token('primary-ring'), '#60a5fa');
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const blend = (foreground, alpha, background) => foreground.map((v, i) => v * alpha + background[i] * (1 - alpha));
  const rgba = rule => css.match(rule)[1].split(',').map(Number);
  const over = (color, background) => blend(color.slice(0, 3), color[3], background);
  const cream = rgb(token('cream')), white = rgb(token('paper'));
  const card = over(rgba(/\.card\s*\{[^}]*background: rgba\(([^)]+)\)/), cream);
  const unread = over(rgba(/\.alert-row\.unread\s*\{\s*background: rgba\(([^)]+)\)/), card);
  const filter = over(rgba(/\.filters\s*\{[^}]*background: rgba\(([^)]+)\)/), cream);
  const selectShadow = over(rgba(/\.textarea:focus\s*\{[^}]*box-shadow: 0 0 0 4px rgba\(([^)]+)\)/), filter);
  const luminance = color => color.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  const focus = rgb(token('forest'));
  for (const [name, background] of Object.entries({ white, cream, card, unread, filter, selectShadow })) {
    assert.ok(contrast(focus, background) >= 3, name + ' focus contrast below 3:1');
  }
  assert.ok(contrast(rgb(token('primary-ring')), white) < 3);
  // Alpha composites use the base canvas; rendered gradients/occlusion need Browser QA.
});

test('Alerts Polish preserves primary disabled fill without changing enabled hover, variants or submit state', async () => {
  const fs = require('node:fs'), path = require('node:path');
  const { fixture, deferred, row } = require('./alertsState.test');
  const css = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const start = css.indexOf('/* Alerts polish:');
  const end = css.indexOf('/* Activity content:');
  assert.ok(start > css.indexOf('/* Alerts adapt:') && end > start);
  const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const rules = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  assert.deepEqual(rules.map(([, selector, declaration]) => [selector.trim(), declaration.trim()]), [
    ['#alerts-surface .btn:not(.btn-secondary):not(.btn-danger):not(.btn-ghost):disabled:hover', 'background: var(--forest);'],
  ]);
  assert.doesNotMatch(block, /!important|@media/);
  assert.doesNotMatch(css.slice(end), /#alerts-surface/);
  assert.match(css, /--forest: #174ea6;/);
  assert.match(css, /--primary-hover: #123f8c;/);
  assert.match(css, /\.btn\s*\{[^}]*background: var\(--forest\);/);
  assert.match(css, /\.btn:not\(\.btn-secondary\):not\(\.btn-danger\):not\(\.btn-ghost\):hover\s*\{\s*background: var\(--primary-hover\);\s*\}/);
  assert.match(css, /\.btn:disabled\s*\{\s*cursor: not-allowed;\s*opacity: 0\.55;\s*transform: none;\s*box-shadow: none;\s*\}/);
  // The exact selector excludes enabled buttons and all three variants. The
  // DOM mock checks the current primary target and pending flow, not real hover.
  const view = fixture(); await view.render();
  const surface = view.content.querySelector('#alerts-surface');
  const form = surface.querySelector('#alert-filter');
  const apply = form.querySelector('[type="submit"]');
  const primary = surface.querySelectorAll('.btn').filter(button =>
    !['.btn-secondary', '.btn-danger', '.btn-ghost'].some(variant => button.matches(variant)));
  assert.deepEqual(primary, [apply]); assert.equal(apply.disabled, false);
  const wait = deferred();
  view.context.api = async (route, options) => {
    assert.match(route, /^\/alerts\?/); assert.equal(options?.method, undefined);
    return wait.promise;
  };
  const pending = view.context.handleSubmit({ target: form, preventDefault() {} });
  assert.equal(apply.disabled, true);
  assert.match(view.status(), /Đang tải cảnh báo/);
  assert.equal(surface.querySelector('[data-action="mark-all-read"]').disabled, true);
  assert.equal(surface.querySelector('[data-action="mark-alert"]').disabled, true);
  wait.resolve({ data: [row()] }); await pending;
  assert.equal(surface.querySelector('#alert-filter'), form);
  assert.equal(form.querySelector('[type="submit"]'), apply);
  assert.equal(apply.disabled, false);
  assert.equal(view.content.alertsView.pending, null);
  assert.equal(view.status(), 'Đã tải cảnh báo.');
});

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

test('list rendering does not depend on a failed or stalled unread indicator', async () => {
  const { fixture, deferred, row } = require('./alertsState.test');
  for (const stalled of [false, true]) {
    const view = fixture(async () => ({ data: [row(8), row(7)] }));
    const wait = deferred();
    view.context.refreshUnreadAlertCount = stalled ? () => wait.promise : async () => { throw Error('indicator failed'); };
    assert.equal((await view.render()).status, 'success');
    assert.deepEqual(Array.from(view.state.alerts, item => item.alert_id), [8, 7]);
    assert.equal(view.content.alertsView.pending, null); assert.equal(view.toasts.length, 0);
    wait.resolve();
  }
});

test('alert IDs are escaped in row and button attributes; existing labels and limits stay intact', async () => {
  const { row } = require('./alertsState.test');
  const result = await renderQueryAlerts({ deviceId: 2, api: async () => ({ data: [row('7" onfocus="fixture')] }) });
  assert.match(result.html, /data-alert-id="7&quot; onfocus=&quot;fixture"/);
  assert.match(result.html, /data-id="7&quot; onfocus=&quot;fixture"/);
  assert.doesNotMatch(result.html, /data-alert-id="7" onfocus=/);
  assert.match(result.html, /aria-live="polite"/);
});

test('Clarify summary labels keep all four counts and the current request scope', async () => {
  const { fixture, row } = require('./alertsState.test');
  const rows = [
    { ...row(10), alert_type: 'posture_warning' },
    { ...row(9, true), alert_type: 'posture_warning' },
    { ...row(8), alert_type: 'eye_distance_warning' },
    row(7),
  ];
  const view = fixture(async () => ({ data: rows })); await view.render();
  const summary = view.content.querySelector('.alert-summary');
  assert.deepEqual(summary.querySelectorAll('small').map(node => node.textContent),
    ['Trong danh sách', 'Chưa đọc', 'Tư thế', 'Khoảng cách mắt']);
  assert.deepEqual(summary.querySelectorAll('strong').map(node => node.textContent),
    ['4 cảnh báo', '3 cảnh báo', '2 cảnh báo', '1 cảnh báo']);
  assert.doesNotMatch(summary.textContent, /tín hiệu|Tổng cảnh báo/);
  assert.deepEqual(view.calls, [{ route: '/alerts?device_id=2&limit=200', method: 'GET' }]);
  assert.deepEqual(Array.from(view.state.alerts, item => item.alert_id), [10, 9, 8, 7]);
  assert.equal(view.content.querySelector('#alert-filter').querySelectorAll('label')[1].textContent, 'Trạng thái đọc');
  assert.deepEqual(view.content.querySelector('[name="is_read"]').options.map(option => option.getAttribute('value')), ['', 'false', 'true']);
});

test('exactly three approved notes are outside live/busy regions and bulk description resolves', async () => {
  const { fixture } = require('./alertsState.test'); const view = fixture(); await view.render();
  const notes = {
    'alerts-scope-note': 'Tối đa 200 cảnh báo mới nhất theo bộ lọc đã áp dụng. Bốn chỉ số chỉ tính các cảnh báo trong danh sách này.',
    'alerts-filter-help': 'Chọn Áp dụng để cập nhật danh sách theo lựa chọn bên dưới.',
    'alerts-read-help': '“Chưa đọc” là chưa được đánh dấu. “Đã đọc” là đã được đánh dấu, không có nghĩa sự việc đã được giải quyết. Khi lọc “Chưa đọc”, cảnh báo vừa đánh dấu sẽ rời danh sách sau khi tải lại.',
  };
  for (const [id, copy] of Object.entries(notes)) {
    assert.equal(view.content.querySelectorAll('#' + id).length, 1);
    const note = view.content.querySelector('#' + id);
    assert.equal(note.textContent, copy); assert.equal(note.tag, 'p');
    assert.equal(note.closest('[aria-live]'), null); assert.equal(note.closest('[aria-busy]'), null);
    assert.equal(note.closest('#alerts-results'), null);
  }
  const bulk = view.content.querySelector('[data-action="mark-all-read"]');
  assert.equal(bulk.textContent, 'Đánh dấu các mục đang hiển thị là đã đọc');
  assert.equal(bulk.getAttribute('aria-describedby'), 'alerts-read-help');
  assert.equal(bulk.getAttribute('aria-label'), null);
  assert.equal(view.content.querySelector('[data-action="mark-alert"]').textContent, 'Đánh dấu đã đọc');
  for (const control of view.content.querySelectorAll('[aria-describedby]')) {
    for (const id of control.getAttribute('aria-describedby').split(/\s+/)) assert.equal(view.content.querySelectorAll('#' + id).length, 1);
  }
  const html = view.content.innerHTML;
  assert.ok(html.indexOf('id="alerts-scope-note"') > html.indexOf('class="page-summary-strip'));
  assert.ok(html.indexOf('id="alerts-filter-help"') < html.indexOf('id="alert-filter"'));
  assert.ok(html.indexOf('id="alerts-read-help"') > html.indexOf('</form>'));
  assert.ok(html.indexOf('id="alerts-read-help"') < html.indexOf('id="alerts-load-status"'));
});

test('empty copy follows applied filters, never draft controls or assumptions about other data', async () => {
  const { fixture } = require('./alertsState.test');
  for (const filter of [{}, { device_id: '', is_read: '' }, { device_id: '2' }, { is_read: 'false' }, { is_read: 'true' }]) {
    const view = fixture(async () => ({ data: [] })); view.state.alertFilter = filter;
    await view.render();
    const applied = Boolean(filter.device_id || filter.is_read);
    const title = applied ? 'Không có cảnh báo theo bộ lọc này' : 'Chưa có cảnh báo để hiển thị';
    const description = applied ? 'Bạn có thể đổi thiết bị hoặc trạng thái đọc rồi chọn Áp dụng.' : 'Danh sách vừa tải không có cảnh báo.';
    const results = view.content.querySelector('#alerts-results');
    assert.equal(results.querySelector('h3').textContent, title);
    assert.equal(results.querySelector('p').textContent, description);
    const form = view.content.querySelector('#alert-filter');
    form.querySelector('[name="device_id"]').value = applied ? '' : '3';
    form.querySelector('[name="is_read"]').value = applied ? '' : 'false';
    await view.render({ background: true });
    assert.equal(results.querySelector('h3').textContent, title);
    assert.equal(view.content.querySelector('#alert-filter'), form);
    assert.equal(view.calls.length, 2); assert.equal(view.calls[0].route, view.calls[1].route);
    assert.match(view.calls[0].route, /limit=200/);
    assert.doesNotMatch(results.textContent, /trẻ.*an toàn|phạm vi khác|đã giải quyết|đã khắc phục|đã xử lý/i);
    view.context.api = async () => { throw Error('offline'); };
    await view.render();
    assert.match(view.status(), /Chưa tải được cảnh báo theo bộ lọc đã chọn/);
    assert.ok(view.content.querySelector('[data-action="retry-alerts"]'));
  }
});
