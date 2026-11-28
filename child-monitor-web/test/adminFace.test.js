const { source, functionSource } = require('./dashboardSource');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

test('camera captures all five frames with an interval between captures', async () => {
  let captures = 0, intervals = 0;
  const video = { readyState: 2, videoWidth: 640, videoHeight: 480 };
  const canvas = {
    getContext: () => ({ drawImage() {} }),
    toDataURL: () => `frame-${++captures}`,
  };
  const context = vm.createContext({ state: { faceRequiredFrames: 5 },
    document: { querySelector: selector => selector === '#face-video' ? video : canvas },
    setTimeout: callback => { intervals++; callback(); },
  });
  vm.runInContext(functionSource(source, 'captureAdminFaceFrames'), context);
  const frames = await context.captureAdminFaceFrames();
  assert.equal(frames.length, 5);
  assert.equal(new Set(frames).size, 5);
  assert.equal(intervals, 4);
});

for (const attemptsRemaining of [2, 0]) {
  test(`duplicate enrollment keeps camera open and handles ${attemptsRemaining} remaining attempts`, async () => {
    const button = { dataset: { action: 'verify-admin-face' }, disabled: false, textContent: '' };
    const status = { textContent: '' };
    let completed = false, stopped = false;
    const context = vm.createContext({ state: { faceChallenge: 'challenge' },
      document: { body: { contains: () => true }, querySelector: () => status },
      captureAdminFaceFrames: async () => ['a', 'b', 'c', 'd', 'e'],
      api: async () => { throw Object.assign(Error('Face already enrolled on another account'), {
        payload: { code: 'FACE_ALREADY_ENROLLED', attemptsRemaining },
      }); },
      localizeError: () => 'Khuôn mặt đã được đăng kí ở một tài khoản khác',
      toast() {}, stopFaceCamera: () => { stopped = true; }, completeLogin: async () => { completed = true; },
    });
    vm.runInContext(functionSource(source, 'handleClick'), context);
    await context.handleClick({ target: { closest: selector => selector === '[data-action]' ? button : null } });
    assert.equal(completed, false);
    assert.equal(stopped, false);
    assert.equal(button.textContent, 'Chụp lại khuôn mặt');
    assert.equal(button.disabled, attemptsRemaining === 0);
    assert.ok(status.textContent.includes('Khuôn mặt đã được đăng kí ở một tài khoản khác'));
    if (attemptsRemaining === 0) assert.ok(status.textContent.includes('đăng nhập lại'));
  });
}

for (const mode of ['enroll','verify']) {
  test(`face camera renders the ${mode} flow without a shared admin-label claim`, async () => {
    const app = { innerHTML: '' }, state = {};
    const status = { textContent: '', isConnected: true }, button = { disabled: true };
    const video = { async play() {} };
    const context = vm.createContext({ app, state, stopFaceCamera() {}, brandMarkup: () => '', toast() {},
      document: { title: '', querySelector: selector => selector === '#face-video' ? video : selector === '#face-camera-status' ? status : button },
      navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
    });
    vm.runInContext(functionSource(source, 'renderAdminFaceVerification'), context);
    await context.renderAdminFaceVerification({ faceChallenge: 'challenge', faceMode: mode, requiredFrames: 5 });
    assert.equal(button.disabled, false);
    assert.ok(app.innerHTML.includes(mode === 'enroll' ? 'Đăng ký và đăng nhập' : 'Xác thực và đăng nhập'));
    assert.ok(app.innerHTML.includes('vector đặc trưng'));
    assert.ok(!app.innerHTML.includes('nhãn khuôn mặt'));
  });
}

test('camera permission resolving after cancellation stops the returned stream', async () => {
  let resolve, stopped = false;
  const pending = new Promise(yes => { resolve = yes; });
  const state = {}, status = { isConnected: true }, button = {};
  const context = vm.createContext({ state, app: {}, stopFaceCamera() {}, brandMarkup: () => '', toast() {},
    document: { querySelector: selector => selector === '#face-camera-status' ? status : button },
    navigator: { mediaDevices: { getUserMedia: () => pending } } });
  vm.runInContext(functionSource(source, 'renderAdminFaceVerification'), context);
  const rendering = context.renderAdminFaceVerification({ faceChallenge: 'a', faceMode: 'enroll' });
  state.faceChallenge = ''; status.isConnected = false;
  resolve({ getTracks: () => [{ stop() { stopped = true; } }] });
  await rendering;
  assert.equal(stopped, true);
  assert.equal(state.faceStream, undefined);
});
