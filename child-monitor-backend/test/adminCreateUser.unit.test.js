const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { adminPool } = require('../src/config/db');
const controller = require('../src/controllers/admin.controller');
const valid = { name: ' New Admin ', email: 'NEW@Example.test', password: 'ExamplePass1!', role: 'admin', is_verified: true };
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('invalid creation data never connects to the database', async t => {
  t.mock.method(adminPool, 'connect', async () => { throw Error('Unexpected database access'); });
  for (const overrides of [{ name: '' }, { name: 42 }, { email: 'invalid' }, { password: 'weak' },
    { password: 'A1!' + 'é'.repeat(36) }, { role: 'owner' }, { is_verified: 'true' }]) {
    const res = response();
    await controller.createUser({ body: { ...valid, ...overrides } }, res);
    assert.equal(res.statusCode, 400);
  }
});

for (const role of ['admin', 'parent']) {
  test(`creates a standalone ${role}, hashes password and records a secret-free audit`, async t => {
    const calls = [];
    t.mock.method(adminPool, 'connect', async () => ({ release() {}, async query(sql, params) {
      calls.push({ sql, params });
      if (/INSERT INTO users/.test(sql)) {
        return { rows: [{ user_id: 44, name: params[0], email: params[1], role: params[3], is_verified: params[4], is_active: true }] };
      }
      return { rows: [] };
    } }));
    const res = response();
    await controller.createUser({ body: { ...valid, role }, currentUser: { user_id: 9, role: 'admin' } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.role, role);
    assert.equal(res.body.name, 'New Admin');
    assert.equal(res.body.email, 'new@example.test');
    const insert = calls.find(call => /INSERT INTO users/.test(call.sql));
    assert.ok(await bcrypt.compare(valid.password, insert.params[2]));
    assert.ok(!JSON.stringify(res.body).includes(valid.password));
    assert.equal(res.body.password, undefined);
    const audit = calls.find(call => /INSERT INTO audit_logs/.test(call.sql));
    assert.equal(audit.params[2], 'user.create');
    assert.ok(!JSON.stringify(audit.params).includes(valid.password));
    assert.ok(!calls.some(call => /INSERT INTO children|INSERT INTO devices/.test(call.sql)));
    assert.ok(calls.some(call => call.sql === 'COMMIT'));
  });
}

for (const conflict of ['existing', 'race']) {
  test(`duplicate email (${conflict}) rolls back and returns 409`, async t => {
    const calls = [];
    t.mock.method(adminPool, 'connect', async () => ({ release() {}, async query(sql) {
      calls.push(sql);
      if (/LOWER\(email\)/.test(sql)) return { rows: conflict === 'existing' ? [{ user_id: 1 }] : [] };
      if (/INSERT INTO users/.test(sql)) throw Object.assign(Error('Duplicate'), { code: '23505' });
      return { rows: [] };
    } }));
    const res = response();
    await controller.createUser({ body: valid, currentUser: { user_id: 9, role: 'admin' } }, res);
    assert.equal(res.statusCode, 409);
    assert.ok(calls.includes('ROLLBACK'));
    assert.ok(!calls.includes('COMMIT'));
  });
}
