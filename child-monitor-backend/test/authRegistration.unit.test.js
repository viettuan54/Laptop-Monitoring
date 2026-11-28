const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { validatePassword } = require('../src/utils/validation');

function setup(scenario, delivery = async () => ({ sent: true })) {
  const queries = [];
  const emails = [];
  const context = vm.createContext({
    exports: {}, process: { env: {} }, console: { log() {}, error() {} },
    require(name) {
      if (name === 'crypto') return crypto;
      if (name === '../utils/validation') return { validatePassword };
      if (name === 'bcrypt') return { hash: async () => 'hashed-password', compare: async () => true };
      if (name === '../utils/email') return { sendMail: async mail => { emails.push(mail); return delivery(); } };
      if (name === '../config/db') return { adminPool: { async query(sql, params) {
        queries.push({ sql, params });
        if (sql.startsWith('SELECT')) return { rows: ['existing', 'resend'].includes(scenario)
          ? [{ user_id: 1, name: 'Parent', password: 'hash', is_verified: false }] : [] };
        if (scenario === 'race') throw Object.assign(Error('Duplicate email'), { code: '23505' });
        return { rows: [] };
      } } };
      return {};
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/controllers/auth.controller.js'), 'utf8'), context);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  return { queries, emails, res, resend: () => context.exports.resendVerification({ body: {
    email: 'parent@example.test', password: 'ExamplePass1!',
  } }, res), register: () => context.exports.register({ body: {
    name: 'Parent', email: 'PARENT@Example.test', password: 'ExamplePass1!',
  } }, res) };
}

for (const scenario of ['existing', 'race']) {
  test(`registration reports duplicate email for ${scenario} account conflict`, async () => {
    const f = setup(scenario);
    await f.register();
    assert.equal(f.res.statusCode, 409);
    assert.equal(f.res.body.code, 'EMAIL_ALREADY_EXISTS');
    assert.equal(f.res.body.message, 'Email is already registered to another account');
    assert.equal(f.queries[0].params[0], 'parent@example.test');
    assert.equal(f.emails.length, 0);
    if (scenario === 'existing') assert.equal(f.queries.length, 1);
  });
}

test('new email still creates an account and sends verification mail', async () => {
  const f = setup('new');
  await f.register();
  assert.equal(f.res.statusCode, 201);
  assert.equal(f.res.body.message, 'Registration successful. Please check your email to verify your account.');
  assert.equal(f.queries.length, 2);
  assert.equal(f.emails.length, 1);
  assert.equal(f.emails[0].to, 'parent@example.test');
  assert.equal(f.res.body.verificationEmailSent, true);
});

for (const failure of ['smtp', 'mock']) {
  const delivery = async () => { if (failure === 'smtp') throw Error('SMTP unavailable'); return { sent: false }; };
  test(`registration keeps the account but reports ${failure} email delivery failure`, async () => {
    const f = setup('new', delivery);
    await f.register();
    assert.equal(f.res.statusCode, 201);
    assert.equal(f.res.body.verificationEmailSent, false);
    assert.match(f.res.body.message, /Account created, but verification email could not be sent/);
    assert.equal(f.queries.length, 2);
  });
  test(`resend reports ${failure} email delivery failure instead of success`, async () => {
    const f = setup('resend', delivery);
    await f.resend();
    assert.equal(f.res.statusCode, 503);
    assert.equal(f.res.body.code, 'EMAIL_DELIVERY_FAILED');
  });
}

test('resend waits until SMTP accepts the message before reporting success', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = setup('resend', () => pending);
  const sending = f.resend();
  while (!f.emails.length) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.res.body, undefined);
  release({ sent: true });
  await sending;
  assert.equal(f.res.body.message, 'Verification email resent successfully');
});
