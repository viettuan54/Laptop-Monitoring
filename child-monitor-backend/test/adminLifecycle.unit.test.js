const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { adminPool } = require('../src/config/db');
const admin = require('../src/controllers/admin.controller');
const auth = require('../src/controllers/auth.controller');
const children = require('../src/controllers/children.controller');

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}

async function scenario(t, { handler, role = 'admin', other = false, hasChildren = false,
  body = {}, self = false, missing = false, wrongPassword = false }) {
  const queries = [];
  const password = await bcrypt.hash('ValidPassword1!', 4);
  const current = { user_id: 8, role, is_active: true, is_verified: true,
    email: 'example@test.invalid', name: 'Test', password };
  const client = { release() {}, async query(sql, params) {
    queries.push(sql);
    if (/has_other_admin/.test(sql)) return { rows: [{ has_other_admin: other }] };
    if (/has_children/.test(sql)) return { rows: [{ has_children: hasChildren }] };
    if (/SELECT.*password FROM users/.test(sql)) return { rows: missing ? [] : [current] };
    if (/FROM users WHERE user_id = \$1 FOR UPDATE/.test(sql)) return { rows: missing ? [] : [current] };
    if (/UPDATE users/.test(sql)) return { rows: [{ ...current, role: params[0], is_active: params[1], is_verified: params[2] }] };
    return { rows: [], rowCount: 1 };
  } };
  t.mock.method(adminPool, 'connect', async () => client);
  const req = { params: { id: '8' }, body: { password: wrongPassword ? 'wrong' : 'ValidPassword1!', ...body },
    user: { user_id: 8 }, currentUser: { user_id: self ? 8 : 7, role: 'admin' } };
  const res = response();
  await handler(req, res);
  return { res, queries };
}

for (const [name, handler] of [['self-service', auth.deleteAccount], ['admin API', admin.deleteUser]]) {
  test(`${name}: rejects deletion of the only eligible admin`, async t => {
    const { res, queries } = await scenario(t, { handler });
    assert.equal(res.statusCode, 409);
    assert.match(res.body.message, /admin must remain/);
    assert.ok(queries.includes('ROLLBACK'));
    assert.ok(!queries.some(sql => /DELETE FROM users|INSERT INTO audit_logs/.test(sql)));
  });
  test(`${name}: permits deletion when another eligible admin remains`, async t => {
    const { res, queries } = await scenario(t, { handler, other: true });
    assert.equal(res.statusCode, 200);
    assert.ok(queries.some(sql => /DELETE FROM users/.test(sql)));
    assert.ok(queries.includes('COMMIT'));
    assert.ok(queries.findIndex(sql => /pg_advisory_xact_lock/.test(sql)) < queries.findIndex(sql => /FOR UPDATE/.test(sql)));
  });
  test(`${name}: parent deletion does not require another admin`, async t => {
    const { res, queries } = await scenario(t, { handler, role: 'parent' });
    assert.equal(res.statusCode, 200);
    assert.ok(!queries.some(sql => /has_other_admin/.test(sql)));
  });
}

test('self deletion still requires the correct password', async t => {
  const { res, queries } = await scenario(t, { handler: auth.deleteAccount, other: true, wrongPassword: true });
  assert.equal(res.statusCode, 401);
  assert.ok(!queries.some(sql => /DELETE FROM users/.test(sql)));
});

test('admin cannot unverify their own email', async t => {
  const { res, queries } = await scenario(t, { handler: admin.updateUser, self: true, body: { is_verified: false } });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /cannot unverify/);
  assert.equal(queries.length, 0);
});

for (const body of [{ role: 'parent' }, { is_active: false }, { is_verified: false }]) {
  test(`last eligible admin protection applies to ${JSON.stringify(body)}`, async t => {
    const { res, queries } = await scenario(t, { handler: admin.updateUser, body });
    assert.equal(res.statusCode, 409);
    assert.ok(!queries.some(sql => /UPDATE users/.test(sql)));
  });
}

test('unverifying another admin revokes existing sessions', async t => {
  const { res, queries } = await scenario(t, { handler: admin.updateUser, other: true, body: { is_verified: false } });
  assert.equal(res.statusCode, 200);
  assert.ok(queries.some(sql => /DELETE FROM refresh_tokens/.test(sql)));
});

test('promotion is rejected while the parent owns a child (and any child devices)', async t => {
  const { res, queries } = await scenario(t, { handler: admin.updateUser, role: 'parent', hasChildren: true, body: { role: 'admin' } });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /roles cannot be changed/);
  assert.ok(!queries.some(sql => /UPDATE users|DELETE FROM children|DELETE FROM devices/.test(sql)));
});

test('promotion of a parent without children also requires a separate admin account', async t => {
  const { res, queries } = await scenario(t, { handler: admin.updateUser, role: 'parent', body: { role: 'admin' } });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.message, /roles cannot be changed/);
  assert.ok(!queries.some(sql => /UPDATE users/.test(sql)));
});

test('a child request authenticated before promotion rechecks the locked owner role', async () => {
  const queries = [];
  const res = response();
  await children.createChild({ body: { name: 'Child', age: 10 }, user: { user_id: 8 },
    db: { async query(sql) { queries.push(sql); return { rows: [{ role: 'admin' }] }; } } }, res);
  assert.equal(res.statusCode, 403);
  assert.match(queries[0], /FOR SHARE/);
  assert.ok(!queries.some(sql => /INSERT INTO children/.test(sql)));
});
