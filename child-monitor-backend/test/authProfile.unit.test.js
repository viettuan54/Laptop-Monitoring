const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { adminPool } = require('../src/config/db');
const auth = require('../src/middlewares/auth.middleware');
const { getProfile } = require('../src/controllers/auth.controller');
const router = require('../src/routes/auth.routes');

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

test('profile route requires authentication before returning account information', () => {
  const route = router.stack.find(layer => layer.route?.path === '/me' && layer.route.methods.get).route;
  assert.equal(route.stack[0].handle, auth);
  assert.equal(route.stack[1].handle, getProfile);
});

for (const role of ['parent', 'admin']) {
  test(`${role} profile returns the signed-in user's current database name only`, async t => {
    const user = { user_id: 10, name: 'Nguyễn Minh Anh', role, token_version: 1,
      is_active: true, is_verified: true, face_enrolled: true, email: 'private@example.test', password: 'private-hash' };
    t.mock.method(jwt, 'verify', () => ({ user_id: 10, token_version: 1, face_verified: true }));
    t.mock.method(adminPool, 'query', async (sql, params) => {
      assert.deepEqual(params, [10]);
      return { rows: [user] };
    });
    const req = { headers: { authorization: 'Bearer test-token' }, query: { user_id: 99 }, params: { user_id: 99 } };
    const res = response();
    await auth(req, res, () => getProfile(req, res));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { user_id: 10, name: 'Nguyễn Minh Anh', role });
  });
}

test('unauthenticated requests cannot read profile information', async t => {
  t.mock.method(adminPool, 'query', async () => { assert.fail('Unauthenticated request queried the database'); });
  const res = response();
  await auth({ headers: {} }, res, () => assert.fail('Unauthenticated request reached profile handler'));
  assert.equal(res.statusCode, 401);
});
