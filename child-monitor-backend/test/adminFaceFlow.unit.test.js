const { test } = require('node:test');
const assert = require('node:assert/strict');
let inference;
class Unavailable extends Error {}
const servicePath = require.resolve('../src/services/faceAuth.service');
require.cache[servicePath] = { id: servicePath, filename: servicePath, loaded: true,
  exports: { REQUIRED_FRAME_COUNT: 5, FaceAuthUnavailableError: Unavailable,
    hasDuplicateFace: (_, templates) => templates.some(template => template.duplicate),
    verifyAdminFace: (...args) => inference(...args) } };
const { adminPool } = require('../src/config/db');
const { completeFaceLogin } = require('../src/controllers/adminFace.controller');
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

async function flow(t, options = {}) {
  const { enrolled = false, accepted = true, claimMissing = false, consumed = true,
    userChange = {}, finalChange = {}, modelError = null, missingTemplate = false, auditError = false, duplicate = false } = options;
  const queries = [];
  const user = { user_id: 9, email: 'admin@example.test', role: 'admin', is_active: true,
    is_verified: true, token_version: 2, face_version: 3, face_enrolled: enrolled, ...userChange };
  const claim = { user_id: 9, purpose: enrolled ? 'verify' : 'enroll', face_version: 3, token_version: 2, attempts: 1 };
  let issued = 0, receivedTemplate;
  inference = async (frames, template) => {
    receivedTemplate = template;
    if (modelError) throw modelError;
    return { accepted, embedding: Array(128).fill(1/Math.sqrt(128)), model_id: 'test-model' };
  };
  const query = async (sql, params) => {
    queries.push({ sql, params });
    if (/UPDATE admin_face_challenges SET attempts=attempts\+1/.test(sql)) return { rows: claimMissing ? [] : [claim] };
    if (/FROM users WHERE/.test(sql)) return { rows: [{ ...user, ...(/FOR UPDATE/.test(sql) ? finalChange : {}) }] };
    if (/SELECT embedding/.test(sql)) {
      assert.equal(params[0], 9);
      if (/user_id <>/.test(sql)) return { rows: duplicate ? [{ duplicate: true }] : [] };
      return { rows: missingTemplate ? [] : [{ embedding: ['account-9-only'], model_id: 'test-model' }] };
    }
    if (/DELETE FROM admin_face_challenges/.test(sql)) return { rows: consumed ? [{ user_id: 9 }] : [] };
    if (auditError && /INSERT INTO audit_logs/.test(sql)) throw Error('audit unavailable');
    return { rows: [], rowCount: 1 };
  };
  const client = { query, release() {} };
  t.mock.method(adminPool, 'query', query);
  t.mock.method(adminPool, 'connect', async () => client);
  const res = response();
  const req = { ip: '127.0.0.1', get: () => 'unit-test', body: {
    challenge: 'a'.repeat(64), frames: ['a', 'b', 'c', 'd', 'e'], user_id: 999, mode: 'enroll', embedding: ['attacker'] } };
  await completeFaceLogin(req, res, {
    handleFailedAttempt: async () => {},
    issueSession: async (who, db) => {
      assert.equal(who.user_id, 9); assert.equal(db, client);
      assert.ok(queries.some(q => /DELETE FROM admin_face_challenges/.test(q.sql)));
      assert.ok(queries.some(q => /INSERT INTO audit_logs/.test(q.sql)));
      issued++; return { accessToken: 'test-access', refreshToken: 'test-refresh' };
    },
  });
  return { res, queries, issued, receivedTemplate };
}

test('first login enrolls only the challenge owner and audits before issuing a session', async t => {
  const f = await flow(t);
  assert.equal(f.res.statusCode, 200); assert.equal(f.issued, 1);
  const insert = f.queries.find(q => /INSERT INTO admin_face_templates/.test(q.sql));
  assert.equal(insert.params[0], 9);
  assert.ok(!/ON CONFLICT/.test(insert.sql));
  assert.ok(f.queries.some(q => q.sql === 'COMMIT'));
  assert.equal(f.res.body.embedding, undefined);
});
test('existing account verifies its own template and never overwrites it', async t => {
  const f = await flow(t, { enrolled: true });
  assert.equal(f.res.statusCode, 200);
  assert.deepEqual(f.receivedTemplate.embedding, ['account-9-only']);
  assert.ok(!f.queries.some(q => /INSERT INTO admin_face_templates|UPDATE admin_face_templates/.test(q.sql)));
});
test('duplicate enrollment rolls back, preserves retry and never stores a template or issues a session', async t => {
  const f = await flow(t, { duplicate: true });
  assert.equal(f.res.statusCode, 409);
  assert.equal(f.res.body.code, 'FACE_ALREADY_ENROLLED');
  assert.equal(f.res.body.attemptsRemaining, 2);
  assert.equal(f.issued, 0);
  assert.ok(f.queries.some(q => q.sql === 'ROLLBACK'));
  assert.ok(!f.queries.some(q => /INSERT INTO admin_face_templates|UPDATE users|INSERT INTO audit_logs/.test(q.sql)));
  assert.ok(f.queries.findIndex(q => /pg_advisory_xact_lock/.test(q.sql)) < f.queries.findIndex(q => /FOR UPDATE/.test(q.sql)));
  assert.ok(f.queries.findIndex(q => /pg_advisory_xact_lock/.test(q.sql)) < f.queries.findIndex(q => /user_id <>/.test(q.sql)));
});
test('Windows runtime block returns a specific error, restores the attempt and issues no session', async t => {
  const f = await flow(t, { modelError: Object.assign(new Unavailable(), { code: 'FACE_RUNTIME_BLOCKED' }) });
  assert.equal(f.res.statusCode, 503);
  assert.equal(f.res.body.code, 'FACE_RUNTIME_BLOCKED');
  assert.equal(f.issued, 0);
  assert.ok(f.queries.some(q => /attempts=GREATEST/.test(q.sql)));
});

for (const [name, options, status] of [
  ['wrong face', { enrolled: true, accepted: false }, 401],
  ['mixed enrollment faces', { accepted: false }, 401],
  ['expired/foreign challenge', { claimMissing: true }, 401],
  ['replayed challenge', { consumed: false }, 401],
  ['password changed', { userChange: { token_version: 4 } }, 401],
  ['reset before inference', { enrolled: true, userChange: { face_version: 4 } }, 401],
  ['reset during inference', { enrolled: true, finalChange: { face_version: 4, face_enrolled: false } }, 401],
  ['another enrollment won', { finalChange: { face_enrolled: true, face_version: 4 } }, 401],
  ['disabled during inference', { finalChange: { is_active: false } }, 401],
  ['email unverified', { userChange: { is_verified: false } }, 401],
  ['missing template', { enrolled: true, missingTemplate: true }, 503],
  ['bad quality', { modelError: new TypeError('multiple faces') }, 400],
  ['model unavailable', { modelError: new Unavailable() }, 503],
  ['audit failure', { auditError: true }, 500],
]) {
  test(`${name} cannot issue a session`, async t => {
    const f = await flow(t, options);
    assert.equal(f.res.statusCode, status); assert.equal(f.issued, 0);
    assert.equal(f.res.body.accessToken, undefined);
  });
}
