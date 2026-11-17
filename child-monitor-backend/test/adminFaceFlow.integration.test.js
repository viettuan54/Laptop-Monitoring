const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const bcrypt = require('bcrypt');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.test') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const facePath = require.resolve('../src/services/faceAuth.service');
const realFace = require(facePath);
const policy = require('../AI/face_verification_policy.json');
const vector = index => Array.from({ length: 128 }, (_, i) => i === index ? 1 : 0);
let probe = vector(0);
require.cache[facePath].exports = { ...realFace,
  verifyAdminFace: async (_, template) => realFace.evaluateEmbeddings({ model_id: policy.model_id, embeddings: [probe, probe, probe, probe, probe] }, template) };
const { adminPool } = require('../src/config/db');
const auth = require('../src/controllers/auth.controller');
const resetFace = require('../src/controllers/adminFaceReset.controller');
const res = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const req = body => ({ body, ip: '127.0.0.1', get: () => 'integration-test' });

test('real PostgreSQL: enrollment, account-specific verification, replay and reset', async t => {
  for (const key of ['TEST_DB_HOST', 'TEST_DB_NAME', 'TEST_DB_ADMIN_USER', 'TEST_DB_ADMIN_PASSWORD']) assert.ok(process.env[key], key);
  assert.notEqual(process.env.TEST_DB_NAME, process.env.DB_NAME);
  const db = new Client({ host: process.env.TEST_DB_HOST, port: Number(process.env.TEST_DB_PORT || 5432),
    database: process.env.TEST_DB_NAME, user: process.env.TEST_DB_ADMIN_USER, password: process.env.TEST_DB_ADMIN_PASSWORD });
  await db.connect();
  t.mock.method(adminPool, 'query', (...args) => db.query(...args));
  t.mock.method(adminPool, 'connect', async () => ({ query: (...args) => db.query(...args), release() {} }));
  try {
    // Temporary fixtures hide real tables for this connection and disappear on disconnect.
    await db.query(`
      CREATE TEMP TABLE users(user_id integer PRIMARY KEY, name text, email text, password text,
        role text, is_active boolean DEFAULT true, is_verified boolean DEFAULT true,
        token_version integer DEFAULT 0, face_version integer DEFAULT 0, face_enrolled boolean DEFAULT false);
      CREATE TEMP TABLE admin_face_templates(user_id integer PRIMARY KEY REFERENCES users(user_id), embedding jsonb, model_id text);
      CREATE TEMP TABLE admin_face_challenges(challenge_hash text PRIMARY KEY, user_id integer REFERENCES users(user_id),
        ip_address text, user_agent_hash text, expires_at timestamptz, attempts integer DEFAULT 0,
        purpose text, face_version integer, token_version integer);
      CREATE TEMP TABLE refresh_tokens(token_id serial, user_id integer, token_hash text, expires_at timestamptz);
      CREATE TEMP TABLE failed_login_attempts(email text PRIMARY KEY,attempt_count integer,last_attempt timestamptz,lock_until timestamptz);
      CREATE TEMP TABLE audit_logs(actor_user_id integer,actor_role text,action text,target_type text,target_id text,
        metadata jsonb,ip_address text,user_agent text);
    `);
    const password = await bcrypt.hash('Integration1!', 4);
    await db.query("INSERT INTO users(user_id,name,email,password,role) VALUES(1,'One','one@example.test',$1,'admin'),(2,'Two','two@example.test',$1,'admin')", [password]);
    const login = async email => {
      const result = res(); await auth.login(req({ email, password: 'Integration1!' }), result);
      assert.equal(result.statusCode, 202); return result.body;
    };
    const complete = async challenge => {
      const result = res(); await auth.verifyAdminFace(req({ challenge, frames: ['a','b','c','d','e'], user_id: 2, mode: 'enroll' }), result); return result;
    };
    const first = await login('one@example.test');
    assert.equal(first.faceMode, 'enroll');
    assert.equal(first.accessToken, undefined);
    assert.equal((await complete(first.faceChallenge)).statusCode, 200);
    assert.equal((await complete(first.faceChallenge)).statusCode, 401);
    const enrolled = (await db.query('SELECT * FROM admin_face_templates WHERE user_id=1')).rows[0];
    assert.deepEqual(enrolled.embedding, vector(0));
    assert.equal((await db.query('SELECT face_enrolled FROM users WHERE user_id=1')).rows[0].face_enrolled, true);
    const second = await login('two@example.test');
    const duplicate = await complete(second.faceChallenge);
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.body.code, 'FACE_ALREADY_ENROLLED');
    assert.equal(duplicate.body.attemptsRemaining, 2);
    assert.equal((await db.query('SELECT face_enrolled FROM users WHERE user_id=2')).rows[0].face_enrolled, false);
    assert.equal((await db.query('SELECT * FROM refresh_tokens WHERE user_id=2')).rowCount, 0);
    assert.equal((await db.query('SELECT * FROM admin_face_templates WHERE user_id=2')).rowCount, 0);
    // A different identity can retry the same challenge after the rollback.
    probe = vector(1);
    assert.equal((await complete(second.faceChallenge)).statusCode, 200);
    const next = await login('one@example.test');
    assert.equal(next.faceMode, 'verify');
    assert.equal((await complete(next.faceChallenge)).statusCode, 401); // user 2's face is not user 1
    probe = vector(0);
    assert.equal((await complete(next.faceChallenge)).statusCode, 200);
    const pending = await login('one@example.test');
    const reset = res();
    await resetFace({ ...req({ password: 'Integration1!' }), params: { id: '1' },
      currentUser: { user_id: 2, role: 'admin' }, user: { token_version: 0 } }, reset);
    assert.equal(reset.statusCode, 200);
    assert.equal((await db.query('SELECT * FROM admin_face_templates WHERE user_id=1')).rowCount, 0);
    assert.equal((await db.query('SELECT * FROM refresh_tokens WHERE user_id=1')).rowCount, 0);
    assert.equal((await complete(pending.faceChallenge)).statusCode, 401);
    assert.equal((await login('one@example.test')).faceMode, 'enroll');
    const actions = (await db.query('SELECT action,metadata FROM audit_logs')).rows;
    for (const action of ['auth.admin_face_enrolled','auth.admin_face_verified','user.face_reset']) assert.ok(actions.some(row => row.action === action));
    assert.ok(!JSON.stringify(actions).includes('embedding'));
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.end();
  }
});
