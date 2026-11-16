const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { functionSource } = require('./queryAlertRenderer');
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function setup({ edit = false, mismatch = false, fail = false } = {}) {
  const requests = [], messages = [];
  let closed = false, reset = false, refreshed = false;
  class Form {
    constructor() {
      this.id = edit ? 'admin-user-form' : 'admin-create-user-form';
      this.dataset = { id: '7' };
      this.elements = { is_verified: { checked: true }, is_active: { checked: true } };
      this.submit = { disabled: false };
    }
    querySelector() { return this.submit; }
    reset() { reset = true; }
  }
  const form = new Form();
  const values = { name: 'New Admin', email: 'new@example.test', role: 'admin', password: 'Secret1!', confirm_password: mismatch ? 'wrong' : 'Secret1!' };
  const context = vm.createContext({ HTMLFormElement: Form,
    FormData: class { constructor() { return Object.entries(values); } },
    state: {}, document: { querySelector: () => ({}) },
    api: async (url, options) => { requests.push({ url, options }); if (fail) throw Error('Email already exists'); return { role: 'admin', is_verified: true }; },
    closeModal: () => { closed = true; }, toast: (...args) => messages.push(args),
    localizeError: message => message, renderUsers: async () => { refreshed = true; },
  });
  vm.runInContext(functionSource(source, 'handleSubmit'), context);
  return { form, requests, messages, run: () => context.handleSubmit({ target: form, preventDefault() {} }),
    result: () => ({ closed, reset, refreshed }) };
}

test('create account submits explicit fields, clears password form and refreshes users', async () => {
  const fixture = setup();
  await fixture.run();
  assert.equal(fixture.requests[0].url, '/admin/users');
  assert.equal(fixture.requests[0].options.method, 'POST');
  assert.equal(fixture.requests[0].options.body.role, 'admin');
  assert.equal(fixture.requests[0].options.body.is_verified, true);
  assert.equal(fixture.requests[0].options.body.confirm_password, undefined);
  assert.deepEqual(fixture.result(), { closed: true, reset: true, refreshed: true });
});

test('mismatched passwords never send a create request', async () => {
  const fixture = setup({ mismatch: true });
  await fixture.run();
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.result().closed, false);
  assert.equal(fixture.form.submit.disabled, false);
});

test('failed creation preserves the form and displays the error', async () => {
  const fixture = setup({ fail: true });
  await fixture.run();
  assert.equal(fixture.result().closed, false);
  assert.equal(fixture.result().reset, false);
  assert.equal(fixture.messages[0][1], 'Email already exists');
  assert.equal(fixture.form.dataset.pending, undefined);
});

test('editing a user no longer sends a role change', async () => {
  const fixture = setup({ edit: true });
  await fixture.run();
  assert.equal(fixture.requests[0].options.method, 'PATCH');
  assert.equal(fixture.requests[0].options.body.role, undefined);
  assert.equal(fixture.requests[0].options.body.is_active, true);
});
