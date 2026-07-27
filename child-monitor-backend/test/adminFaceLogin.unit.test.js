const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-that-is-long-enough';
process.env.FACE_AUTH_REQUIRED_FOR_ADMIN = 'true';

let mockedFaceResult = {
  label: 'admin',
  confidence: 0.92,
  matched_frames: 3,
  required_frames: 2,
};

const faceServicePath = require.resolve('../src/services/faceAuth.service');
require.cache[faceServicePath] = {
  id: faceServicePath,
  filename: faceServicePath,
  loaded: true,
  exports: {
    FaceAuthUnavailableError: class FaceAuthUnavailableError extends Error {},
    REQUIRED_FRAME_COUNT: 3,
    verifyAdminFace: async () => mockedFaceResult,
  },
};

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
  assert.match(res.body.faceChallenge, /^[a-f0-9]{64}$/);
  assert.equal(res.body.requiredFrames, 3);
  assert.equal(res.body.accessToken, undefined);
  assert.equal(res.body.refreshToken, undefined);
});

test('matching admin face label consumes challenge before issuing tokens', async () => {
  mockedFaceResult = {
    label: 'admin',
    confidence: 0.92,
    matched_frames: 3,
    required_frames: 2,
  };
  let challengeConsumed = false;
  adminPool.query = async (sql) => {
    if (/UPDATE admin_face_challenges/.test(sql) && /attempts = attempts \+ 1/.test(sql)) {
      return { rows: [{ user_id: 7, attempts: 1 }] };
    }
    if (/SELECT user_id, email, role/.test(sql)) {
      return {
        rows: [{
          user_id: 7,
          email: 'admin@example.test',
          role: 'admin',
          is_verified: true,
          is_active: true,
          token_version: 1,
        }],
      };
    }
    if (/DELETE FROM admin_face_challenges/.test(sql) && /RETURNING user_id/.test(sql)) {
      challengeConsumed = true;
      return { rows: [{ user_id: 7 }] };
    }
    if (/INSERT INTO refresh_tokens/.test(sql)) {
      assert.equal(challengeConsumed, true);
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  };

  const res = response();
  await authController.verifyAdminFace(request({
    challenge: 'a'.repeat(64),
    frames: ['frame-1', 'frame-2', 'frame-3'],
  }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.faceLabel, 'admin');
  assert.ok(res.body.accessToken);
  assert.ok(res.body.refreshToken);
});

test('non-admin face label is rejected without issuing tokens', async () => {
  mockedFaceResult = {
    label: 'fail',
    confidence: 0.31,
    matched_frames: 0,
    required_frames: 2,
  };
  let refreshInserted = false;
  adminPool.query = async (sql) => {
    if (/UPDATE admin_face_challenges/.test(sql) && /attempts = attempts \+ 1/.test(sql)) {
      return { rows: [{ user_id: 7, attempts: 1 }] };
    }
    if (/SELECT user_id, email, role/.test(sql)) {
      return {
        rows: [{
          user_id: 7,
          email: 'admin@example.test',
          role: 'admin',
          is_verified: true,
          is_active: true,
          token_version: 1,
        }],
      };
    }
    if (/INSERT INTO failed_login_attempts/.test(sql)) {
      return { rows: [{ attempt_count: 1 }] };
    }
    if (/INSERT INTO refresh_tokens/.test(sql)) {
      refreshInserted = true;
    }
    return { rows: [], rowCount: 1 };
  };

  const res = response();
  await authController.verifyAdminFace(request({
    challenge: 'b'.repeat(64),
    frames: ['frame-1', 'frame-2', 'frame-3'],
  }), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.message, 'Face verification failed');
  assert.equal(res.body.accessToken, undefined);
  assert.equal(refreshInserted, false);
});
