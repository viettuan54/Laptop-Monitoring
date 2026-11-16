const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./queryAlertRenderer');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function setup({ status = 403, error = 'Email not verified. Please verify your email first.', resend } = {}) {
  const requests = [];
  const button = { disabled: false, textContent: '' };
  const message = { textContent: '' };
  const classes = new Set(['hidden']);
  const notice = { dataset: {}, classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
    querySelector: selector => selector === 'button' ? button : message };
  class Form {
    constructor() {
      this.id = 'login-form'; this.dataset = {}; this.isConnected = true;
      this.elements = { email: { value: 'parent@example.test' }, password: { value: 'Secret1!' } };
    }
    reportValidity() { return true; }
    querySelector(selector) { return selector === '#login-verification' ? notice : { disabled: false }; }
  }
  const form = new Form();
  const context = vm.createContext({ HTMLFormElement: Form,
    FormData: class { constructor() { return [['email', form.elements.email.value], ['password', form.elements.password.value]]; } },
    api: async (url, options) => {
      requests.push({ url, options });
      if (url === '/auth/login') throw Object.assign(Error(error), { status });
      return resend ? resend() : {};
    },
    toast() {}, localizeError: text => text,
  });
  for (const name of ['showLoginVerification', 'sendLoginVerification', 'handleSubmit']) {
    vm.runInContext(functionSource(source, name), context);
  }
  return { form, notice, classes, button, message, requests,
    login: () => context.handleSubmit({ target: form, preventDefault() {} }),
    send: () => context.sendLoginVerification(form) };
}

test('unverified email response shows an inline verification action', async () => {
  const f = setup(); await f.login();
  assert.equal(f.classes.has('hidden'), false);
  assert.equal(f.button.textContent, 'Xác minh email ngay');
  assert.equal(f.notice.dataset.email, 'parent@example.test');
});

for (const [status, error] of [[401, 'Invalid email or password'], [403, 'Account has been disabled. Contact an administrator.'], [500, 'Internal server error']]) {
  test(`does not offer email verification for ${error}`, async () => {
    const f = setup({ status, error }); await f.login();
    assert.equal(f.classes.has('hidden'), true);
  });
}

test('verification sends existing credentials to the resend endpoint and shows mailbox instructions', async () => {
  const f = setup(); await f.login(); await f.send();
  const request = f.requests[1];
  assert.equal(request.url, '/auth/resend-verification');
  assert.equal(request.options.noAuth, true);
  assert.equal(request.options.body.email, 'parent@example.test');
  assert.equal(request.options.body.password, 'Secret1!');
  assert.match(f.message.textContent, /hộp thư/);
  assert.equal(f.button.disabled, false);
  assert.ok(!f.message.textContent.includes('Secret1!'));
});

test('failed send keeps the action retryable', async () => {
  const f = setup({ resend: async () => { throw Error('Too many requests'); } });
  await f.login(); await f.send();
  assert.equal(f.message.textContent, 'Too many requests');
  assert.equal(f.button.disabled, false);
  assert.equal(f.form.dataset.verificationPending, undefined);
});

test('changed email cannot reuse the previous unverified-account action', async () => {
  const f = setup(); await f.login();
  f.form.elements.email.value = 'another@example.test';
  await f.send();
  assert.equal(f.requests.length, 1);
});

test('repeated clicks while sending cause only one request', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const f = setup({ resend: () => waiting }); await f.login();
  const sending = f.send(); await f.send();
  assert.equal(f.requests.length, 2);
  assert.equal(f.button.disabled, true);
  release({}); await sending;
  assert.equal(f.button.disabled, false);
});
