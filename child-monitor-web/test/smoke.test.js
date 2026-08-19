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
  assert.match(await index.text(), /id="app"/);

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
    '/alerts',
    '/notifications/tokens',
    '/notifications/test',
    '/ai-analysis',
    '/agent/heartbeat',
    '/agent/config',
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
