const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { adminPool } = require('../src/config/db');
const resetFace = require('../src/controllers/adminFaceReset.controller');
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
test('an admin cannot reset their own face', async () => {
  const res = response();
  await resetFace({ params: { id: '9' }, currentUser: { user_id: 9 } }, res);
  assert.equal(res.statusCode, 400);
});
for (const allowed of [false, true]) {
  test(`another admin reset: password ${allowed ? 'valid' : 'invalid'}`, async t => {
    const queries = [];
    const password = await bcrypt.hash('AdminPass1!', 4);
    t.mock.method(adminPool, 'connect', async () => ({ release() {}, async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT password/.test(sql)) return { rows: [{ password, role: 'admin', is_active: true,
        is_verified: true, face_enrolled: true, token_version: 2 }] };
      if (/UPDATE users/.test(sql)) return { rows: [{ user_id: 10 }] };
      return { rows: [] };
    } }));
    const res = response();
    await resetFace({ params: { id: '10' }, currentUser: { user_id: 9, role: 'admin' }, user: { token_version: 2 },
      body: { password: allowed ? 'AdminPass1!' : 'wrong' } }, res);
    assert.equal(res.statusCode, allowed ? 200 : 403);
    if (allowed) {
      for (const table of ['admin_face_templates', 'admin_face_challenges', 'refresh_tokens']) {
        assert.deepEqual(queries.find(q => q.sql.includes('DELETE FROM ' + table)).params, [10]);
      }
      assert.ok(queries.some(q => /face_version=face_version\+1, token_version=token_version\+1/.test(q.sql)));
      assert.ok(queries.some(q => /INSERT INTO audit_logs/.test(q.sql)));
    } else assert.ok(!queries.some(q => /UPDATE users|DELETE FROM/.test(q.sql)));
  });
}
