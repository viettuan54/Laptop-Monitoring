const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { source, functionSource } = require('./dashboardSource');

function setup(status, message, payload = {}) {
  const notifications = [];
  const screens = [];
  const submit = { disabled: false };
  class Form {
    constructor() { this.id = 'register-form'; }
    querySelector() { return submit; }
  }
  const form = new Form();
  const values = { name: 'Parent', email: 'parent@example.test', password: 'ExamplePass1!' };
  const context = vm.createContext({
    HTMLFormElement: Form,
    FormData: class { constructor() { return Object.entries(values); } },
    state: {}, document: { querySelector: () => null },
    fetch: async () => ({ status, ok: status < 400,
      headers: { get: () => 'application/json' }, json: async () => ({ message, ...payload }) }),
    toast: (...args) => notifications.push(args), renderAuth: mode => screens.push(mode),
  });
  vm.runInContext("const API = '/api';", context);
  for (const name of ['updateConnectionIndicator', 'api', 'localizeError', 'localizeMessage', 'handleSubmit']) {
    vm.runInContext(functionSource(source, name), context);
  }
  return { notifications, screens, submit, values,
    register: () => context.handleSubmit({ target: form, preventDefault() {} }) };
}

test('duplicate email shows the requested Vietnamese error and keeps registration retryable', async () => {
  const f = setup(409, 'Email is already registered to another account');
  await f.register();
  assert.deepEqual(f.notifications, [['Không thể hoàn tất',
    'Email của bạn đã được cài đặt cho tài khoản khác, vui lòng kiểm tra lại.', 'error']]);
  assert.deepEqual(f.screens, []);
  assert.equal(f.values.email, 'parent@example.test');
  assert.equal(f.submit.disabled, false);
});

test('successful registration still moves to email verification', async () => {
  const f = setup(201, 'Registration successful. Please check your email to verify your account.');
  await f.register();
  assert.deepEqual(f.screens, ['verify']);
  assert.equal(f.notifications[0][0], 'Đã gửi yêu cầu đăng ký');
  assert.equal(f.submit.disabled, false);
});

test('email delivery failure explains the account exists and offers resend instead of claiming success', async () => {
  const f = setup(201, 'Account created, but verification email could not be sent. Please try resending it.',
    { verificationEmailSent: false });
  await f.register();
  assert.deepEqual(f.screens, ['resend']);
  assert.equal(f.notifications.length, 1);
  assert.equal(f.notifications[0][2], 'error');
  assert.match(f.notifications[0][1], /Tài khoản đã được tạo nhưng chưa gửi được email xác minh/);
  assert.equal(f.submit.disabled, false);
});
