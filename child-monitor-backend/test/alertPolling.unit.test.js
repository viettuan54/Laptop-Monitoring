const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(relative, dependencies) {
  const context = { module: { exports: {} }, require: name => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', relative), 'utf8'), context);
  return context.module.exports;
}

test('frequent alert reads have an account-isolated budget without widening the general limit', () => {
  const limits = load('src/middlewares/rateLimit.middleware.js', {
    'express-rate-limit': { rateLimit: options => options, ipKeyGenerator: ip => ip },
    crypto: require('node:crypto'), '../config/redis': { createRateLimitStore: prefix => ({ prefix }) },
  });
  const read = limits.alertReadLimiter;
  // Two visible tabs, each issuing count + list reads every five seconds.
  assert.ok(read.max >= (read.windowMs / 5000) * 2 * 2);
  assert.notEqual(read.store.prefix, limits.parentLimiter.store.prefix);
  assert.equal(read.keyGenerator({ user: { user_id: 7 }, ip: 'shared-NAT' }), '7');
  assert.notEqual(read.keyGenerator({ user: { user_id: 8 }, ip: 'shared-NAT' }), '7');
  assert.equal(limits.parentLimiter.max, 100);
});

test('alert reads still authenticate, require a parent and enforce RLS; writes keep their old budget', () => {
  const routes = {};
  const router = { get: (path, ...handlers) => { routes.get = handlers; },
    put: (path, ...handlers) => { routes.put = handlers; } };
  const auth = () => {}, role = () => {}, rls = () => {};
  const read = () => {}, write = () => {}, get = () => {}, mark = () => {};
  load('src/routes/alerts.routes.js', {
    express: { Router: () => router }, '../middlewares/auth.middleware': auth,
    '../middlewares/role.middleware': value => { assert.equal(value, 'parent'); return role; },
    '../middlewares/rls.middleware': rls,
    '../controllers/alerts.controller': { getAlerts: get, markAsRead: mark },
    '../middlewares/rateLimit.middleware': { parentLimiter: write, alertReadLimiter: read },
  });
  assert.deepEqual(routes.get, [auth, role, read, rls, get]);
  assert.deepEqual(routes.put, [write, auth, role, rls, mark]);
  const app = fs.readFileSync(path.join(__dirname, '..', 'src/app.js'), 'utf8');
  assert.match(app, /app\.use\('\/api\/alerts', require\('\.\/routes\/alerts\.routes'\)\)/);
});
