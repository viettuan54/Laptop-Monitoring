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

  const jpegAsset = await fetch(
    `http://127.0.0.1:${webPort}/assets/family-digital-wellbeing.jpg`
  );
  assert.equal(jpegAsset.status, 200);
  assert.equal(jpegAsset.headers.get('content-type'), 'image/jpeg');
  assert.ok((await jpegAsset.arrayBuffer()).byteLength > 0);

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
  assert.match(source, /<th>Trạng thái<\/th>/);
  assert.match(source, /name="access_status"/);
  assert.match(source, /accessStatusBadge\(item\.access_status\)/);
  assert.match(source, /accessStatusLabel\(item\.access_status\)/);
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
  assert.match(source, /api\(`\/logs\/usage-summary\?month=\$\{month\}`\)/);
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
