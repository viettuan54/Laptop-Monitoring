const MAX_IMAGE_BYTES = 400 * 1024;
const MAX_THUMBNAIL_BYTES = 40 * 1024;
const RETENTION_DAYS = 7;
const POLICY_LEASE_SECONDS = 180;

function captureIntervalSeconds() {
  const value = Number(process.env.SCREENSHOT_INTERVAL_SECONDS || 300);
  return Number.isInteger(value) && value >= 60 && value <= 3600 ? value : 300;
}

function decodeJpeg(value, maxBytes, maxDimension) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(maxBytes / 3) * 4
      || value.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('Invalid screenshot image encoding or size');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maxBytes || bytes.length < 20 || bytes.toString('base64') !== value
      || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) {
    throw new Error('Screenshot must be a bounded JPEG image');
  }
  // Inspect marker lengths and dimensions without allocating a decoded bitmap.
  let dimensions;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) break;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (marker === 0xda) {
      if (dimensions && length >= 6 && offset + length < bytes.length - 2) return { bytes, ...dimensions };
      break;
    }
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (length < 8 || dimensions) break;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (!width || !height || width > maxDimension || height > maxDimension) break;
      dimensions = { width, height };
    }
    offset += length;
  }
  throw new Error('Invalid JPEG dimensions or structure');
}

function normalizeScreenshot(body, now = Date.now()) {
  if (!body || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.client_record_id || '')) {
    throw new Error('Invalid screenshot record ID');
  }
  const capturedAt = Date.parse(body.captured_at);
  if (typeof body.captured_at !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(body.captured_at)
      || !Number.isFinite(capturedAt) || capturedAt > now + 30_000 || capturedAt < now - POLICY_LEASE_SECONDS * 1000) {
    throw new Error('Screenshot capture time is invalid or expired');
  }
  if (typeof body.policy_revision !== 'string' || !Number.isFinite(Date.parse(body.policy_revision))) {
    throw new Error('Screenshot policy revision is required');
  }
  return {
    clientRecordId: body.client_record_id,
    capturedAt: new Date(capturedAt).toISOString(),
    policyRevision: body.policy_revision,
    image: decodeJpeg(body.image_base64, MAX_IMAGE_BYTES, 1920),
    thumbnail: decodeJpeg(body.thumbnail_base64, MAX_THUMBNAIL_BYTES, 480),
  };
}

async function pendingScreenshotRequest(db, deviceId) {
  const result = await db.query(
    `SELECT d.screenshot_request_id AS id,
            d.screenshot_requested_at + INTERVAL '3 minutes' AS expires_at
     FROM devices d JOIN settings s ON s.child_id = d.child_id
     WHERE d.device_id = $1 AND s.enable_screenshot_review = TRUE
       AND d.screenshot_requested_at >= s.updated_at
       AND d.screenshot_requested_at > NOW() - INTERVAL '3 minutes'
       AND NOT EXISTS (SELECT 1 FROM screenshots i
         WHERE i.device_id = d.device_id AND i.client_record_id = d.screenshot_request_id)`,
    [deviceId]
  );
  return result.rows[0] || null;
}

module.exports = { captureIntervalSeconds, normalizeScreenshot, decodeJpeg, RETENTION_DAYS, pendingScreenshotRequest };
