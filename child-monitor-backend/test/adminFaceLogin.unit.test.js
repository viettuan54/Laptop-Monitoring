const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-that-is-long-enough';
// The legacy opt-out must no longer allow password-only admin sessions.
process.env.FACE_AUTH_REQUIRED_FOR_ADMIN = 'false';

const { adminPool } = require('../src/config/db');
const authController = require('../src/controllers/auth.controller');
let originalQuery;

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function request(body) {
  return {
    body,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    get(name) {
      return name === 'user-agent' ? 'unit-test-agent' : undefined;
    },
  };
}

before(() => {
  originalQuery = adminPool.query;
});

after(() => {
  adminPool.query = originalQuery;
});

test('password-correct admin login returns a face challenge without JWT', async () => {
  const passwordHash = await bcrypt.hash('AdminPass1!', 4);
  adminPool.query = async (sql) => {
    if (/SELECT lock_until/.test(sql)) return { rows: [] };
    if (/SELECT user_id, name, email, password/.test(sql)) {
      return {
        rows: [{
          user_id: 7,
          name: 'Admin',
          email: 'admin@example.test',
          password: passwordHash,
          role: 'admin',
          is_verified: true,
          is_active: true,
          token_version: 1,
          face_enrolled: false,
          face_version: 0,
        }],
      };
    }
    return { rows: [], rowCount: 1 };
  };

  const res = response();
  await authController.login(request({
    email: 'admin@example.test',
    password: 'AdminPass1!',
  }), res);

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.requiresFaceVerification, true);
  assert.equal(res.body.faceMode, 'enroll');
  assert.match(res.body.faceChallenge, /^[a-f0-9]{64}$/);
  assert.equal(res.body.requiredFrames, 5);
  assert.equal(res.body.accessToken, undefined);
  assert.equal(res.body.refreshToken, undefined);
});
