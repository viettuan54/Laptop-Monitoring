const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');

function load(relative, dependencies) {
  const context = { module: { exports: {} }, require: name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'), context);
  return context.module.exports;
}

test('dashboard reads survive the old shared budget, isolate accounts, and retain write limits', async t => {
  const limits = load('src/middlewares/rateLimit.middleware.js', {
    'express-rate-limit': require('express-rate-limit'),
    crypto: require('node:crypto'),
    '../config/redis': { createRateLimitStore: () => undefined },
  });
  const app = express();
  const auth = (req, res, next) => {
    if (!req.headers.authorization) return res.sendStatus(401);
    req.user = { user_id: req.headers.authorization };
    next();
  };
  const role = () => (req, res, next) => next();
  const rls = (req, res, next) => next();
  const ok = (req, res) => res.json({ data: ['existing activity'] });
  const controller = new Proxy({}, { get: () => ok });
  for (const name of ['children', 'devices', 'settings', 'aiAnalysis', 'logs']) {
    const router = load(`src/routes/${name}.routes.js`, {
      express,
      '../middlewares/auth.middleware': auth,
      '../middlewares/role.middleware': role,
      '../middlewares/rls.middleware': rls,
      '../middlewares/deviceAuth.middleware': auth,
      '../middlewares/deviceOwnership.middleware': rls,
      '../middlewares/rateLimit.middleware': limits,
      [`../controllers/${name}.controller`]: controller,
      '../controllers/screenshots.controller': controller,
      '../controllers/appEnforcement.controller': controller,
      '../controllers/breakReminder.controller': controller,
    });
    app.use(`/api/${name}`, router);
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, user = 'parent-one', method = 'GET') {
    const response = await fetch(base + route, { method, headers: user ? { authorization: user } : {} });
    await response.text();
    return response;
  }
  const reads = ['/api/children', '/api/devices', '/api/settings/1', '/api/aiAnalysis',
    '/api/logs/app', '/api/logs/web', '/api/logs/usage-summary'];
  for (const route of reads) assert.equal((await request(route, null)).status, 401);
  // A web/mobile session can exceed the former 100 requests / 15 minutes.
  for (let i = 0; i < 120; i++) assert.equal((await request(reads[i % reads.length])).status, 200);
  const blocked = await request('/api/devices');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) <= 60);
  assert.equal((await request('/api/devices', 'parent-two')).status, 200);
  // Read exhaustion must not prevent saving settings, and writes stay bounded.
  for (let i = 0; i < 100; i++) assert.equal((await request('/api/settings/1', 'parent-one', 'PUT')).status, 200);
  assert.equal((await request('/api/settings/1', 'parent-one', 'PUT')).status, 429);
  assert.equal((await request('/api/logs/app', 'parent-two')).status, 200);
});
