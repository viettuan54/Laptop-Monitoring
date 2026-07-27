const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  decodeFaceFrames,
  parseModelResult,
} = require('../src/services/faceAuth.service');

function jpegFrame(marker) {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, marker, 0x00, 0x01, 0xff, 0xd9]);
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

test('accepts exactly three distinct bounded camera frames', () => {
  const decoded = decodeFaceFrames([jpegFrame(1), jpegFrame(2), jpegFrame(3)]);
  assert.equal(decoded.length, 3);
  assert.ok(decoded.every((frame) => frame.mime === 'jpeg'));
});

test('rejects duplicate, malformed, and wrong-count face frames', () => {
  assert.throws(
    () => decodeFaceFrames([jpegFrame(1), jpegFrame(1), jpegFrame(2)]),
    /separate live camera captures/
  );
  assert.throws(
    () => decodeFaceFrames([jpegFrame(1)]),
    /Exactly 3/
  );
  assert.throws(
    () => decodeFaceFrames([jpegFrame(1), jpegFrame(2), 'data:text/plain;base64,SGVsbG8=']),
    /JPEG, PNG, or WebP/
  );
});

test('parses only the prefixed model result protocol', () => {
  const result = parseModelResult(
    `TensorFlow startup log\nSAFENEST_FACE_RESULT:{"label":"admin","confidence":0.91,"matched_frames":3,"required_frames":2}\n`
  );
  assert.deepEqual(result, {
    label: 'admin',
    confidence: 0.91,
    matched_frames: 3,
    required_frames: 2,
  });
  assert.throws(() => parseModelResult('admin'), /invalid response/);
});
