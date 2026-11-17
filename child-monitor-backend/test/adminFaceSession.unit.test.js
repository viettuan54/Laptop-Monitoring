const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'test-face-session-secret-0123456789';
const blacklistPath = require.resolve('../src/utils/tokenBlacklist');
require.cache[blacklistPath] = { id: blacklistPath, filename: blacklistPath, loaded: true, exports: { isBlacklisted: async () => false } };
const { adminPool } = require('../src/config/db');
const auth = require('../src/middlewares/auth.middleware');
for (const [name, role, enrolled, verifiedClaim, allowed] of [
  ['legacy admin token', 'admin', true, false, false],
  ['reset admin', 'admin', false, true, false],
  ['verified admin', 'admin', true, true, true],
  ['parent without face', 'parent', false, false, true],
]) {
  test(name, async t => {
    t.mock.method(adminPool, 'query', async () => ({ rows: [{ user_id: 9, role, is_active: true,
      is_verified: true, face_enrolled: enrolled, token_version: 4 }] }));
    const token = jwt.sign({ user_id: 9, token_version: 4, face_verified: verifiedClaim }, process.env.JWT_SECRET);
    let next = false;
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() {} };
    await auth({ headers: { authorization: 'Bearer ' + token } }, res, () => { next = true; });
    assert.equal(next, allowed);
    if (!allowed) assert.equal(res.statusCode, 401);
  });
}
