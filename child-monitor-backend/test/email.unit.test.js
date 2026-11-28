const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(send, configured = true) {
  const context = vm.createContext({
    module: { exports: {} }, console: { log() {}, error() {} },
    process: { env: configured ? { NODE_ENV: 'development', SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '587', SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'test-only' } : {} },
    require: () => ({ createTransport: () => ({ sendMail: send }) }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/utils/email.js'), 'utf8'), context);
  context.module.exports.initTransporter();
  return () => context.module.exports.sendMail({ to: 'parent@example.test', subject: 'Test', textFallback: 'Test' });
}

test('accepted SMTP mail reports sent', async () => {
  assert.equal((await setup(async () => ({ accepted: ['parent@example.test'], rejected: [] }))()).sent, true);
});

test('SMTP failure is propagated even in development', async () => {
  await assert.rejects(setup(async () => { throw Error('Authentication failed'); })(), /Authentication failed/);
});

test('SMTP recipient rejection is not reported as success', async () => {
  await assert.rejects(setup(async () => ({ accepted: [], rejected: ['parent@example.test'] }))(), /did not accept/);
});

test('console-only development email is explicitly marked unsent', async () => {
  assert.equal((await setup(async () => { throw Error('Unexpected transport call'); }, false)()).sent, false);
});
