const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function getFreePort() {
  const holder = http.createServer();
  const port = await listen(holder);
  await new Promise((resolve) => holder.close(resolve));
  return port;
}

async function waitFor(url, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

test('static server, SPA fallback and API proxy work together', async (t) => {
  const mockApi = http.createServer((req, res) => {
    if (req.url === '/api/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        ok: true,
        authorization: req.headers.authorization,
        method: req.method,
      }));
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: 'not found' }));
  });
  const apiPort = await listen(mockApi);
  const webPort = await getFreePort();
  const dashboard = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      WEB_PORT: String(webPort),
      API_TARGET: `http://127.0.0.1:${apiPort}`,
    },
    stdio: 'ignore',
  });

  t.after(async () => {
    dashboard.kill();
    await new Promise((resolve) => mockApi.close(resolve));
  });

  await waitFor(`http://127.0.0.1:${webPort}/healthz`);

  const index = await fetch(`http://127.0.0.1:${webPort}/`);
  assert.equal(index.status, 200);
  assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(index.headers.get('x-frame-options'), 'DENY');
  assert.equal(
    index.headers.get('permissions-policy'),
    'camera=(self), microphone=(), geolocation=()'
  );
  const contentSecurityPolicy = index.headers.get('content-security-policy') || '';
  assert.match(contentSecurityPolicy, /script-src 'self'/);
  assert.match(contentSecurityPolicy, /style-src 'self' 'unsafe-inline'/);
  assert.match(contentSecurityPolicy, /img-src 'self' data:/);
  assert.match(contentSecurityPolicy, /connect-src 'self'/);
  assert.match(contentSecurityPolicy, /frame-ancestors 'none'/);
  assert.match(await index.text(), /id="app"/);

  const jpegAssets = [
    'family-digital-wellbeing.jpg',
    'section-child-profiles.jpg',
    'section-managed-devices.jpg',
    'section-usage-policies.jpg',
    'section-digital-activity.jpg',
    'section-safety-alerts.jpg',
    'section-ai-insights.jpg',
    'section-account-security.jpg',
  ];
  for (const asset of jpegAssets) {
    const jpegAsset = await fetch(`http://127.0.0.1:${webPort}/assets/${asset}`);
    assert.equal(jpegAsset.status, 200, `${asset} should be served`);
    assert.equal(jpegAsset.headers.get('content-type'), 'image/jpeg');
    assert.ok((await jpegAsset.arrayBuffer()).byteLength > 10_000, `${asset} should not be empty`);
  }

  const fallback = await fetch(`http://127.0.0.1:${webPort}/verify?token=demo`);
  assert.equal(fallback.status, 200);
  assert.match(await fallback.text(), /SafeNest/);

  const missingAsset = await fetch(`http://127.0.0.1:${webPort}/missing.js`);
  assert.equal(missingAsset.status, 404);

  const proxied = await fetch(`http://127.0.0.1:${webPort}/api/ping`, {
    headers: { Authorization: 'Bearer smoke-token' },
  });
  assert.equal(proxied.status, 200);
  assert.deepEqual(await proxied.json(), {
    ok: true,
    authorization: 'Bearer smoke-token',
    method: 'GET',
  });
});

test('dashboard source covers every backend route group', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const routeFragments = [
    '/auth/register',
    '/auth/login',
    '/auth/admin-face',
    '/auth/logout',
    '/auth/verify',
    '/auth/resend-verification',
    '/auth/change-password',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/refresh',
    '/auth/account',
    '/children',
    '/devices',
    '/rotate-secret',
    '/settings/',
    '/logs/app',
    '/logs/web',
    '/logs/usage-summary',
    '/alerts',
    '/notifications/tokens',
    '/notifications/test',
    '/ai-analysis',
    '/agent/heartbeat',
    '/agent/config',
    '/agent/classification/web/fallback',
    '/agent/classification/web/unknown-domains',
    '/agent/classification/web/backfill',
    '/agent/vision-alert',
    '/admin/users',
    '/admin/users/${id}',
    '/revoke-sessions',
    '/admin/stats',
    '/admin/blacklist',
    '/admin/audit-logs',
  ];

  for (const fragment of routeFragments) {
    assert.ok(source.includes(fragment), `Missing API coverage for ${fragment}`);
  }
});

test('dashboard uses Vietnamese locale and Vietnamese primary navigation', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  assert.match(html, /<html lang="vi">/);
  assert.match(source, /Tổng quan gia đình/);
  assert.match(source, /Quản lý tài khoản/);
  assert.match(source, /Intl\.DateTimeFormat\('vi-VN'/);
});

test('dashboard uses the blue visual theme', () => {
  const styles = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  assert.match(html, /<meta name="theme-color" content="#0f2e53"\s*\/?>/i);
  assert.match(styles, /--forest:\s*#174ea6;/i);
  assert.match(styles, /--forest-2:\s*#2563eb;/i);
  assert.match(styles, /--primary-dark:\s*#0f2e53;/i);
});

test('session refresh is single-flight and logout clears session-scoped state', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

  assert.match(source, /let refreshPromise = null;/);
  assert.match(source, /if \(refreshPromise\) return refreshPromise;/);
  assert.match(source, /finally \{[\s\S]*?refreshPromise = null;[\s\S]*?\}/);

  const clearSessionStart = source.indexOf('function clearSession()');
  const clearSessionEnd = source.indexOf('function stopFaceCamera()', clearSessionStart);
  assert.ok(clearSessionStart >= 0 && clearSessionEnd > clearSessionStart, 'Missing clearSession');
  const clearSessionSource = source.slice(clearSessionStart, clearSessionEnd);

  for (const key of [
    'accessToken',
    'refreshToken',
    'role',
    'userId',
    'children',
    'devices',
    'alerts',
    'analyses',
    'appLogs',
    'webLogs',
    'usageSummary',
    'adminStats',
    'adminUsers',
    'pushTokens',
    'selectedChildId',
    'selectedDeviceId',
    'categoryPolicies',
    'chat',
    'agentSecret',
  ]) {
    assert.match(clearSessionSource, new RegExp(`\\b${key}:`), `clearSession must reset ${key}`);
  }
  for (const storageKey of ['lm_access_token', 'lm_refresh_token', 'lm_role']) {
    assert.ok(clearSessionSource.includes(`sessionStorage.removeItem('${storageKey}')`));
  }
});

test('policy UI exposes and submits both AI classification toggles', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

  assert.match(source, /Phân loại AI & truy cập/);
  assert.match(source, /switchRow\('enable_app_classification', 'Phân loại ứng dụng'/);
  assert.match(source, /switchRow\('enable_web_classification', 'Phân loại website'/);
  assert.match(source, /'enable_app_classification',[\s\S]*'enable_web_classification'/);
});

test('policy UI manages allow and block rules for every app and website category', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

  assert.match(source, /\/settings\/\$\{state\.selectedChildId\}\/policies/);
  assert.match(source, /policies\/\$\{resourceType\}\/\$\{category\}/);
  for (const category of [
    'learning',
    'education',
    'entertainment',
    'browsers',
    'social',
    'unsafe',
    'unknown',
  ]) {
    assert.ok(source.includes(`'${category}'`), `Missing category policy UI for ${category}`);
  }
  assert.match(source, /Agent ghi nhớ tên miền đã được AI phân loại/);
});

test('activity UI displays and exports blocked or open access status', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

  assert.match(source, /const accessStatusLabels = Object\.freeze\(\{[\s\S]*blocked: 'Đã chặn',[\s\S]*open: 'Đang mở'/);
  assert.match(source, /<th>Trạng thái hiện tại<\/th>/);
  assert.match(source, /name="access_status"/);
  assert.match(source, /accessStatusBadge\(item\.access_status\)/);
  assert.match(source, /accessStatusLabel\(item\.access_status\)/);
  assert.match(source, /function websiteActivityTitle/);
  assert.match(source, /pageTitle === technicalBlockedTitle/);
  assert.match(source, /websiteActivityTitle\(item\)/);
});

test('activity and device UI expose operational monitoring controls', () => {
  const dashboardSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const deviceController = fs.readFileSync(
    path.resolve(ROOT, '..', 'child-monitor-backend', 'src', 'controllers', 'devices.controller.js'),
    'utf8'
  );

  assert.match(dashboardSource, /data-action="export-activity"/);
  assert.match(dashboardSource, /name="search"/);
  assert.match(dashboardSource, /function safeExternalUrl/);
  assert.match(dashboardSource, /function isDeviceOnline/);
  assert.match(dashboardSource, /Backend đã kết nối/);
  assert.match(deviceController, /last_seen_at/);
});

test('overview metrics and charts use monthly usage summary with Vietnam date keys', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

  assert.match(source, /usageSummary:\s*emptyUsageSummary\(\)/);
  assert.match(source, /`\/logs\/usage-summary\?month=\$\{month\}\$\{childId \? `&child_id=\$\{encodeURIComponent\(childId\)\}` : ''\}`/);
  assert.match(source, /id="overview-child"/);
  assert.match(source, /month_total_seconds/);
  assert.match(source, /today_seconds/);
  assert.match(source, /ignored_segment_count/);
  assert.match(source, /max_valid_agent_segment_seconds/);
  assert.match(source, /class="usage-quality-note"/);
  assert.match(source, /Bản ghi gốc vẫn được giữ nguyên/);
  assert.match(source, /usageDaysInMonth\(usageSummary\)/);
  assert.match(source, /usageRecentDays\(usageSummary\)/);
  assert.match(source, /class="usage-month-chart"/);
  assert.match(source, /class="chart-wrap usage-week-chart"/);

  const localDateKeyStart = source.indexOf('function localDateKey(');
  const localDateKeyEnd = source.indexOf('function emptyUsageSummary(', localDateKeyStart);
  assert.ok(localDateKeyStart >= 0 && localDateKeyEnd > localDateKeyStart);
  const localDateHelpers = source.slice(localDateKeyStart, localDateKeyEnd);
  assert.match(source, /const USAGE_TIME_ZONE = 'Asia\/Ho_Chi_Minh';/);
  assert.match(localDateHelpers, /timeZone:\s*USAGE_TIME_ZONE/);
  assert.match(localDateHelpers, /formatToParts\(date\)/);
  assert.match(localDateHelpers, /Date\.UTC\(/);
  assert.match(localDateHelpers, /getUTCDate\(\)/);
  assert.doesNotMatch(localDateHelpers, /toISOString\(\)/);

  const overviewStart = source.indexOf('async function renderOverview(');
  const overviewEnd = source.indexOf('function metric(', overviewStart);
  const overviewSource = source.slice(overviewStart, overviewEnd);
  assert.doesNotMatch(overviewSource, /toISOString\(\)/);
  assert.match(overviewSource, /usageSummary\.month_total_seconds/);
  assert.match(overviewSource, /usageSummary\.today_seconds/);
  assert.match(styles, /\.usage-month-chart\s*\{/);
  assert.match(styles, /grid-template-columns:\s*repeat\(var\(--usage-day-count\)/);
  assert.match(styles, /\.usage-month-scroll\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(styles, /\.usage-quality-note\s*\{/);
});

test('modal actions bubble to the delegated handler and activity filters cannot overflow', () => {
  const dashboardSource = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

  assert.doesNotMatch(dashboardSource, /querySelector\('\.modal'\)\.addEventListener\('click',[^\n]*stopPropagation/);
  assert.match(dashboardSource, /if \(event\.target === backdrop\) closeModal\(\);/);
  assert.match(dashboardSource, /if \(action === 'confirm-delete-child'\)[\s\S]*?api\(`\/children\/\$\{id\}`,[\s\S]*?method: 'DELETE'/);

  assert.match(styles, /\.activity-filters\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.field\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(styles, /\.activity-filters input\[type="datetime-local"\][\s\S]*?max-width:\s*100%/);
});

test('redesigned dashboard shell keeps navigation usable on desktop and mobile', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  for (const className of [
    'workspace-card',
    'topbar-shortcut',
    'nav-count',
    'sidebar-profile',
    'mobile-quick-nav',
    'mobile-nav-link',
    'hero-media-insight',
    'page-summary-strip',
    'section-visual',
    'section-visual-media',
  ]) {
    assert.ok(source.includes(className), `Dashboard markup is missing ${className}`);
    assert.match(styles, new RegExp(`\\.${className}\\s*(?:[,\\{])`), `Dashboard styles are missing .${className}`);
  }

  assert.match(styles, /\.mobile-quick-nav\s*\{[\s\S]*?display:\s*none/);
  assert.match(styles, /@media \(max-width:\s*610px\)[\s\S]*?\.mobile-quick-nav\s*\{[\s\S]*?display:\s*grid/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /\.sidebar\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(source, /data-page="api-lab"[^>]*>\$\{icons\.lab\}/);
});

test('dashboard sections include optimized and accessible illustration assets', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  const assets = [
    'section-child-profiles.jpg',
    'section-managed-devices.jpg',
    'section-usage-policies.jpg',
    'section-digital-activity.jpg',
    'section-safety-alerts.jpg',
    'section-ai-insights.jpg',
    'section-account-security.jpg',
  ];

  for (const asset of assets) {
    assert.ok(source.includes(`/assets/${asset}`), `Dashboard markup is missing ${asset}`);
    const assetPath = path.join(ROOT, 'assets', asset);
    assert.ok(fs.existsSync(assetPath), `${asset} is missing from assets`);
    assert.ok(fs.statSync(assetPath).size > 10_000, `${asset} is unexpectedly small`);
  }

  assert.match(source, /class="section-visual-media"><img[^>]+alt="\$\{escapeHtml\(visual\.alt\)\}"/);
  assert.match(source, /loading="lazy" decoding="async"/);
  assert.match(source, /class="profile-cover"><img src="\/assets\/section-account-security\.jpg" alt="[^"]+" width="1200" height="800"/);
  assert.match(styles, /\.profile-card\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(styles, /\.profile-cover img\s*\{[\s\S]*?object-fit:\s*cover/);
});

test('redesigned data pages expose summaries, resettable filters and accessible actions', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

  assert.match(source, /class="page-summary-strip"/);
  assert.match(source, /class="section-visual section-visual-/);
  assert.match(source, /data-action="clear-alert-filter"/);
  assert.match(source, /data-action="clear-admin-user-filter"/);
  assert.match(source, /data-action="clear-blacklist-filter"/);
  assert.match(source, /data-action="clear-audit-filter"/);
  assert.match(source, /data-action="view-audit"/);
  assert.match(source, /aria-label="Chỉnh sửa hồ sơ/);
  assert.match(source, /aria-label="Xóa hồ sơ/);
  assert.doesNotMatch(source, /style="grid-template-columns:/);
});

test('admin workspace presents operational context, scannable records and responsive tools', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');

  for (const className of [
    'admin-hero-flags',
    'admin-kpi-grid',
    'admin-operations-grid',
    'admin-section-intro',
    'admin-intro-stats',
    'admin-table-card',
    'admin-user-avatar',
    'admin-domain-cell',
    'audit-action-badge',
    'endpoint-list-head',
    'api-request-heading',
  ]) {
    assert.ok(source.includes(className), `Admin markup is missing ${className}`);
    assert.ok(styles.includes(`.${className}`), `Admin styles are missing .${className}`);
  }

  assert.match(source, /adminSectionIntro\('users'/);
  assert.match(source, /adminSectionIntro\('blacklist'/);
  assert.match(source, /adminSectionIntro\('audit'/);
  assert.match(source, /adminSectionIntro\('api-lab'/);
  assert.match(styles, /@media \(max-width:\s*610px\)[\s\S]*?\.admin-section-intro\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(styles, /@media \(max-width:\s*1024px\)[\s\S]*?\.endpoint-list\s*\{[\s\S]*?position:\s*static/);
});

test('dashboard preserves role on startup errors and prevents duplicate sensitive actions', () => {
  const source = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const initializeStart = source.indexOf('async function initialize()');
  const initializeEnd = source.indexOf('async function detectRole()', initializeStart);
  const initializeSource = source.slice(initializeStart, initializeEnd);

  assert.match(initializeSource, /renderStartupError\(error\)/);
  assert.doesNotMatch(initializeSource, /state\.role\s*=\s*'parent'/);
  assert.match(source, /const mutationActions = new Set\(/);
  assert.match(source, /button\.dataset\.busy === 'true'/);
  assert.match(source, /button\.setAttribute\('aria-busy', 'true'\)/);
  assert.match(source, /state\.unreadAlertCount/);
  assert.match(source, /api\('\/alerts\?is_read=false&limit=200'\)/);
});
