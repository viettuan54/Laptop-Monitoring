const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  decodeFaceFrames,
  parseModelResult,
  evaluateEmbeddings,
  normalizeEmbedding,
  hasDuplicateFace,
  pythonRuntimeError,
} = require('../src/services/faceAuth.service');

test('runtime failure identifies Windows policy blocks without exposing diagnostic details', () => {
  const error = pythonRuntimeError({ stderr: 'private path\nImportError: An Application Control policy has blocked this file.' });
  assert.equal(error.code, 'FACE_RUNTIME_BLOCKED');
  assert.equal(error.message, 'Face recognition service is unavailable');
  assert.equal(pythonRuntimeError({ stderr: 'oneDNN custom operations are on' }).code, 'FACE_AUTH_UNAVAILABLE');
});

function jpegFrame(marker) {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, marker, 0x00, 0x01, 0xff, 0xd9]);
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

test('accepts exactly five distinct bounded camera frames', () => {
  const decoded = decodeFaceFrames([jpegFrame(1), jpegFrame(2), jpegFrame(3), jpegFrame(4), jpegFrame(5)]);
  assert.equal(decoded.length, 5);
  assert.ok(decoded.every((frame) => frame.mime === 'jpeg'));
});

test('enrollment duplicate detection compares normalized templates across accounts', () => {
  const { model_id } = require('../AI/face_verification_policy.json');
  const a = Array.from({ length: 128 }, (_, i) => i === 0 ? 1 : 0);
  const b = Array.from({ length: 128 }, (_, i) => i === 1 ? 1 : 0);
  const candidate = { model_id, embedding: a };
  assert.equal(hasDuplicateFace(candidate, []), false);
  assert.equal(hasDuplicateFace(candidate, [{ model_id, embedding: a.map(v => v * 2) }]), true);
  assert.equal(hasDuplicateFace(candidate, [{ model_id, embedding: b }]), false);
  assert.throws(() => hasDuplicateFace(candidate, [{ model_id: 'incompatible', embedding: a }]));
});

test('rejects duplicate, malformed, and wrong-count face frames', () => {
  assert.throws(
    () => decodeFaceFrames([jpegFrame(1), jpegFrame(1), jpegFrame(2), jpegFrame(3), jpegFrame(4)]),
    /separate live camera captures/
  );
  assert.throws(
    () => decodeFaceFrames([jpegFrame(1)]),
    /Exactly 5/
  );
  assert.throws(
    () => decodeFaceFrames([jpegFrame(1), jpegFrame(2), jpegFrame(3), jpegFrame(4), 'data:text/plain;base64,SGVsbG8=']),
    /JPEG, PNG, or WebP/
  );
});

test('parses only the prefixed model result protocol', () => {
  const policy = require('../AI/face_verification_policy.json');
  const payload = { ok: true, model_id: policy.model_id, embeddings: Array.from({ length: 5 }, () => Array(128).fill(1)) };
  const result = parseModelResult('startup\nSAFENEST_FACE_RESULT:' + JSON.stringify(payload));
  assert.equal(result.embeddings.length, 5);
  assert.ok(Math.abs(Math.hypot(...result.embeddings[0]) - 1) < 1e-8);
  assert.throws(() => parseModelResult('SAFENEST_FACE_RESULT:{"label":"admin"}'));
  assert.throws(() => parseModelResult('admin'), /invalid response/);
});

test('1:1 cosine rejects other identities, mixed frames and invalid embeddings', () => {
  const { model_id } = require('../AI/face_verification_policy.json');
  const a = Array.from({ length: 128 }, (_, i) => i === 0 ? 1 : 0);
  const b = Array.from({ length: 128 }, (_, i) => i === 1 ? 1 : 0);
  const enrollment = evaluateEmbeddings({ model_id, embeddings: [a,a,a,a,a] });
  assert.equal(enrollment.accepted, true);
  assert.equal(evaluateEmbeddings({ model_id, embeddings: [a,a,a,a,a] }, enrollment).accepted, true);
  assert.equal(evaluateEmbeddings({ model_id, embeddings: [b,b,b,b,b] }, enrollment).accepted, false);
  assert.equal(evaluateEmbeddings({ model_id, embeddings: [a,a,a,a,b] }).accepted, false);
  assert.throws(() => evaluateEmbeddings({ model_id: 'old-model', embeddings: [a,a,a,a,a] }, enrollment));
  for (const bad of [[], Array(128).fill(0), Array(128).fill(NaN), Array(128).fill('1')]) assert.throws(() => normalizeEmbedding(bad));
});
