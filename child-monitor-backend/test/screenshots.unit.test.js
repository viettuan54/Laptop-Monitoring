const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { normalizeScreenshot, decodeJpeg } = require('../src/services/screenshot.service');
const image = fs.readFileSync(path.join(__dirname, 'fixtures/screenshot.jpg')).toString('base64');
const thumbnail = fs.readFileSync(path.join(__dirname, 'fixtures/screenshot-thumb.jpg')).toString('base64');
const now = Date.parse('2026-10-08T05:00:00Z');
const record = () => ({ client_record_id: crypto.randomUUID(), captured_at: new Date(now).toISOString(),
  policy_revision: '2026-10-08T04:59:00.000Z', image_base64: image, thumbnail_base64: thumbnail });

test('accepts bounded JPEGs and derives dimensions from the bytes', () => {
  const result = normalizeScreenshot(record(), now);
  assert.equal(result.image.width, 960);
  assert.equal(result.image.height, 540);
  assert.equal(result.thumbnail.width, 480);
  assert.equal(result.thumbnail.height, 270);
});

test('rejects stale/future/unzoned screenshots and malformed IDs or revisions', () => {
  for (const change of [
    { captured_at: '2026-10-08T04:56:59Z' }, { captured_at: '2026-10-08T05:00:31Z' },
    { captured_at: '2026-10-08T05:00:00' }, { client_record_id: 'invalid' }, { policy_revision: '' },
  ]) assert.throws(() => normalizeScreenshot({ ...record(), ...change }, now));
});

test('rejects non-images, oversized images, bad base64 and forged dimensions', () => {
  for (const value of ['', '<svg onload="alert(1)">', 'AAAA', image + '====', image.slice(0, -8)]) {
    assert.throws(() => decodeJpeg(value, 400 * 1024, 1920));
  }
  assert.throws(() => decodeJpeg(image, 10, 1920));
  assert.throws(() => decodeJpeg(image, 400 * 1024, 480));
  const bytes = Buffer.from(image, 'base64');
  const frame = bytes.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(frame > 0);
  bytes.writeUInt16BE(10000, frame + 7);
  assert.throws(() => decodeJpeg(bytes.toString('base64'), 400 * 1024, 1920));
});
