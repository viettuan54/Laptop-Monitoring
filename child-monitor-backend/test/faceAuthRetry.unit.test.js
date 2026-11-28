const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const servicePath = path.resolve(__dirname, '../src/services/faceAuth.service.js');
const serviceRequire = createRequire(servicePath);
const policy = require('../AI/face_verification_policy.json');
const blocked = () => Object.assign(new Error('Python failed'), {
  stderr: 'ImportError: An Application Control policy has blocked this file.',
});
const success = () => ({ stderr: '', stdout: 'SAFENEST_FACE_RESULT:' + JSON.stringify({
  ok: true, model_id: policy.model_id, embeddings: Array.from({ length: 5 }, () => Array(128).fill(1)),
}) });
const frames = Array.from({ length: 5 }, (_, index) =>
  'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, index]).toString('base64'));

function setup(execute, wait = async () => {}) {
  const calls = [];
  const delays = [];
  const removed = [];
  const writes = [];
  const logs = [];
  const context = vm.createContext({
    module: { exports: {} }, __dirname: path.dirname(servicePath), Buffer,
    process: { env: { FACE_PYTHON_BIN: 'demo-python', FACE_AUTH_TIMEOUT_MS: '20000' } },
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(args)])),
    require(name) {
      if (name === 'util') return { promisify: () => async (...args) => {
        calls.push(args);
        return execute(calls.length);
      } };
      if (name === 'timers/promises') return { setTimeout: async ms => { delays.push(ms); await wait(); } };
      if (name === 'fs/promises') return {
        access: async () => {}, mkdtemp: async () => 'mock-face-temp', mkdir: async () => {},
        writeFile: async (...args) => { writes.push(args); },
        rm: async dir => { removed.push(dir); },
      };
      return serviceRequire(name);
    },
  });
  vm.runInContext(fs.readFileSync(servicePath, 'utf8'), context);
  return { service: context.module.exports, calls, delays, removed, writes, logs };
}

for (const failures of [1, 3]) {
  test(`face verification recovers after ${failures} transient Windows policy blocks`, async () => {
    const f = setup(attempt => { if (attempt <= failures) throw blocked(); return success(); });
    const result = await f.service.verifyAdminFace(frames);
    assert.equal(result.accepted, true);
    assert.equal(f.calls.length, failures + 1);
    assert.deepEqual(f.delays, Array(failures).fill(1500));
    for (const [binary, args, options] of f.calls) {
      assert.equal(binary, 'demo-python');
      assert.equal(args.length, 6);
      assert.deepEqual(args, f.calls[0][1]);
      assert.equal(options.windowsHide, true);
      assert.equal(options.timeout, 20000);
      assert.equal(options.env.PYTHONUNBUFFERED, '1');
    }
    assert.deepEqual(f.removed, ['mock-face-temp']);
    assert.equal(f.writes.length, 5, 'temporary failures do not write a final error diagnostic');
  });
}

test('persistent policy blocks stop after three retries, report the final error and clean up', async () => {
  const f = setup(() => { throw blocked(); });
  await assert.rejects(f.service.verifyAdminFace(frames), { code: 'FACE_RUNTIME_BLOCKED' });
  assert.equal(f.calls.length, 4);
  assert.deepEqual(f.delays, [1500, 1500, 1500]);
  assert.deepEqual(f.removed, ['mock-face-temp']);
  assert.equal(f.writes.length, 6);
});

test('policy errors written to stderr with exit code zero are retried', async () => {
  const f = setup(attempt => attempt === 1
    ? { stderr: blocked().stderr, stdout: 'SAFENEST_FACE_RESULT:{"ok":false,"reason":"model_error"}' }
    : success());
  assert.equal((await f.service.verifyAdminFace(frames)).accepted, true);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.delays, [1500]);
});

test('unrelated Python failures are not retried', async () => {
  const f = setup(() => { throw Object.assign(new Error('Python failed'), { stderr: 'ModuleNotFoundError: missing dependency' }); });
  await assert.rejects(f.service.verifyAdminFace(frames), { code: 'FACE_AUTH_UNAVAILABLE' });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.delays, []);
  assert.deepEqual(f.removed, ['mock-face-temp']);
});

test('face quality rejection is preserved without retries', async () => {
  const f = setup(() => ({ stderr: '', stdout: 'SAFENEST_FACE_RESULT:{"ok":false,"reason":"exactly_one_face_required"}' }));
  await assert.rejects(f.service.verifyAdminFace(frames), /exactly_one_face_required/);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.delays, []);
});

test('warm-up imports the runtime and initializes both models with the same retry policy', async () => {
  const f = setup(attempt => { if (attempt === 1) throw blocked(); return { stdout: '', stderr: '' }; });
  assert.equal(await f.service.warmUpFaceRuntime(), true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0][1][0], '-c');
  assert.match(f.calls[0][1][1], /from facenet_runtime import DeepFace, MTCNN/);
  assert.match(f.calls[0][1][1], /MTCNN\(\); DeepFace.build_model\("Facenet"\)/);
  assert.deepEqual(f.delays, [1500]);
  assert.equal(f.writes.length, 0);
});

test('failed background warm-up resolves without an unhandled rejection', async () => {
  const f = setup(() => { throw blocked(); });
  assert.equal(await f.service.warmUpFaceRuntime(), false);
  assert.equal(f.calls.length, 4);
  assert.equal(f.writes.length, 1);
});

test('retry wait is asynchronous and keeps the verification concurrency limit', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const f = setup(attempt => { if (attempt === 1) throw blocked(); return success(); }, () => waiting);
  const verification = f.service.verifyAdminFace(frames);
  while (!f.delays.length) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.service.verifyAdminFace(frames), /service is busy/);
  release();
  assert.equal((await verification).accepted, true);
  assert.equal((await f.service.verifyAdminFace(frames)).accepted, true);
});
