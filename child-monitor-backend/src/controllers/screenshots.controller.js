const { adminPool } = require('../config/db');
const { randomUUID } = require('node:crypto');
const { deviceOnlineSql } = require('../services/devicePresence.service');
const { normalizeScreenshot, captureIntervalSeconds, RETENTION_DAYS } = require('../services/screenshot.service');

exports.upload = async (req, res) => {
  let record;
  try { record = normalizeScreenshot(req.body); }
  catch (error) { return res.status(400).json({ message: error.message }); }
  let client;
  try {
    client = await adminPool.connect();
    await client.query('BEGIN');
    // Lock against disabling consent, and serialize concurrent uploads per device.
    const settings = await client.query(
      'SELECT enable_screenshot_review, updated_at FROM settings WHERE child_id = $1 FOR SHARE',
      [req.device.child_id]
    );
    const policy = settings.rows[0];
    if (policy?.enable_screenshot_review !== true
        || new Date(policy.updated_at).toISOString() !== record.policyRevision) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Screenshot monitoring is disabled or its policy has changed' });
    }
    const device = await client.query(
      `SELECT screenshot_request_id, screenshot_requested_at,
              screenshot_requested_at > NOW() - INTERVAL '3 minutes' AS request_fresh
       FROM devices WHERE device_id = $1 FOR UPDATE`, [req.device.device_id]);
    const existing = await client.query(
      'SELECT screenshot_id, deleted_at FROM screenshots WHERE device_id = $1 AND client_record_id = $2',
      [req.device.device_id, record.clientRecordId]
    );
    if (existing.rows.length) {
      await client.query('COMMIT');
      if (existing.rows[0].deleted_at) return res.status(410).json({ message: 'Screenshot was deleted' });
      return res.status(200).json({ screenshot_id: existing.rows[0].screenshot_id, accepted_client_record_id: record.clientRecordId });
    }
    const recent = await client.query(
      "SELECT 1 FROM screenshots WHERE device_id = $1 AND created_at > NOW() - INTERVAL '55 seconds' LIMIT 1",
      [req.device.device_id]
    );
    const requested = device.rows[0];
    const isRequested = requested?.screenshot_request_id === record.clientRecordId
      && requested.request_fresh && new Date(requested.screenshot_requested_at) >= new Date(policy.updated_at);
    if (recent.rows.length && !isRequested) {
      await client.query('ROLLBACK');
      return res.status(429).json({ message: 'Screenshot capture interval has not elapsed' });
    }
    const result = await client.query(
      `INSERT INTO screenshots(device_id, client_record_id, captured_at, width, height, image_data, thumbnail_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING screenshot_id`,
      [req.device.device_id, record.clientRecordId, record.capturedAt,
        record.image.width, record.image.height, record.image.bytes, record.thumbnail.bytes]
    );
    await client.query('COMMIT');
    return res.status(201).json({ screenshot_id: result.rows[0].screenshot_id, accepted_client_record_id: record.clientRecordId });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Screenshot upload failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to store screenshot' });
  } finally { client?.release(); }
};

exports.list = async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const limit = Math.max(1, Math.min(Number.parseInt(req.query.limit, 10) || 12, 24));
  const offset = Math.max(0, Math.min(Number.parseInt(req.query.offset, 10) || 0, 100000));
  const values = [];
  const conditions = ["created_at > NOW() - INTERVAL '7 days'", 'deleted_at IS NULL'];
  if (req.query.device_id) {
    if (!/^[1-9]\d*$/.test(req.query.device_id)) return res.status(400).json({ message: 'Invalid device ID' });
    values.push(req.query.device_id);
    conditions.push(`device_id = $${values.length}`);
  }
  for (const [key, operator] of [['start', '>='], ['end', '<=']]) {
    if (!req.query[key]) continue;
    const value = new Date(req.query[key]);
    if (!Number.isFinite(value.getTime())) return res.status(400).json({ message: 'Invalid screenshot date filter' });
    values.push(value.toISOString());
    conditions.push(`captured_at ${operator} $${values.length}`);
  }
  try {
    const where = conditions.join(' AND ');
    const count = await req.db.query(`SELECT COUNT(*)::int AS total, MAX(screenshot_id)::text AS latest_id FROM screenshots WHERE ${where}`, values);
    const scope = await req.db.query(
      `SELECT COUNT(*)::int AS total, MAX(screenshot_id)::text AS latest_id FROM screenshots
       WHERE deleted_at IS NULL AND created_at > NOW() - INTERVAL '7 days'${req.query.device_id ? ' AND device_id = $1' : ''}`,
      req.query.device_id ? [req.query.device_id] : []);
    const rows = req.query.metadata === '1' ? { rows: [] } : await req.db.query(
      `SELECT screenshot_id, device_id, captured_at, width, height,
              encode(thumbnail_data, 'base64') AS thumbnail_base64
       FROM screenshots WHERE ${where}
       ORDER BY captured_at DESC, screenshot_id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    const monitors = await req.db.query(
      `SELECT d.device_id, COALESCE(s.enable_screenshot_review, FALSE) AS enabled,
              ${deviceOnlineSql('d')} AS online,
              (d.screenshot_requested_at <= NOW() - INTERVAL '3 minutes'
                AND NOT EXISTS (SELECT 1 FROM screenshots i WHERE i.device_id = d.device_id
                  AND i.client_record_id = d.screenshot_request_id)) AS request_expired,
              CASE WHEN s.enable_screenshot_review AND d.screenshot_requested_at >= s.updated_at
                AND d.screenshot_requested_at > NOW() - INTERVAL '3 minutes'
                AND NOT EXISTS (SELECT 1 FROM screenshots i WHERE i.device_id = d.device_id
                  AND i.client_record_id = d.screenshot_request_id)
              THEN d.screenshot_request_id ELSE NULL END AS pending_request_id
       FROM devices d LEFT JOIN settings s ON s.child_id = d.child_id ORDER BY d.device_id`
    );
    return res.json({ data: rows.rows, total: count.rows[0].total, latest_id: count.rows[0].latest_id,
      scope_total: scope.rows[0].total, scope_latest_id: scope.rows[0].latest_id, limit, offset,
      devices: monitors.rows,
      retention_days: RETENTION_DAYS, capture_interval_seconds: captureIntervalSeconds() });
  } catch (error) {
    console.error('Screenshot list failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to load screenshots' });
  }
};

exports.requestCapture = async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const deviceId = String(req.body?.device_id || '');
  if (!/^[1-9]\d*$/.test(deviceId)) return res.status(400).json({ message: 'Hãy chọn thiết bị cần chụp ảnh.' });
  try {
    const owned = await req.db.query('SELECT child_id FROM devices WHERE device_id = $1', [deviceId]);
    if (!owned.rows.length) return res.status(404).json({ message: 'Không tìm thấy thiết bị.' });
    // Use the same lock order as upload so revoking consent cannot race this request.
    const settings = await req.db.query(
      'SELECT enable_screenshot_review, updated_at FROM settings WHERE child_id = $1 FOR SHARE', [owned.rows[0].child_id]);
    if (settings.rows[0]?.enable_screenshot_review !== true) {
      return res.status(409).json({ message: 'Giám sát màn hình chưa bật cho thiết bị này. Hãy bật trong Điều khiển thiết bị.' });
    }
    const device = await req.db.query(
      `SELECT screenshot_request_id, screenshot_requested_at,
        ${deviceOnlineSql()} AS online,
        screenshot_requested_at > NOW() - INTERVAL '10 seconds' AS too_recent,
        screenshot_requested_at > NOW() - INTERVAL '3 minutes' AS fresh
       FROM devices WHERE device_id = $1 FOR UPDATE`, [deviceId]);
    const current = device.rows[0];
    if (!current) return res.status(404).json({ message: 'Không tìm thấy thiết bị.' });
    const completed = current.screenshot_request_id ? await req.db.query(
      'SELECT 1 FROM screenshots WHERE device_id = $1 AND client_record_id = $2',
      [deviceId, current.screenshot_request_id]) : { rows: [] };
    if (current.fresh && new Date(current.screenshot_requested_at) >= new Date(settings.rows[0].updated_at)
        && !completed.rows.length) {
      await req.releaseRls(true);
      return res.status(202).json({ request_id: current.screenshot_request_id, online: current.online, pending: true });
    }
    if (current.too_recent) return res.status(429).json({ message: 'Vui lòng chờ 10 giây trước khi yêu cầu ảnh tiếp theo.' });
    const requestId = randomUUID();
    await req.db.query('UPDATE devices SET screenshot_request_id = $2, screenshot_requested_at = clock_timestamp() WHERE device_id = $1', [deviceId, requestId]);
    await req.releaseRls(true);
    return res.status(202).json({ request_id: requestId, online: current.online, pending: true });
  } catch (error) {
    console.error('Screenshot request failed:', error.code || error.name);
    return res.status(500).json({ message: 'Chưa gửi được yêu cầu chụp ảnh. Hãy thử lại.' });
  }
};

exports.getImage = async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ message: 'Invalid screenshot ID' });
  try {
    const result = await req.db.query(
      `SELECT screenshot_id, device_id, captured_at, width, height, encode(image_data, 'base64') AS image_base64
       FROM screenshots WHERE screenshot_id = $1 AND deleted_at IS NULL AND created_at > NOW() - INTERVAL '7 days'`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Screenshot not found' });
    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Screenshot read failed:', error.code || error.name);
    return res.status(500).json({ message: 'Unable to load screenshot' });
  }
};

exports.removeOne = async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ message: 'Mã ảnh không hợp lệ.' });
  try {
    const result = await req.db.query(
      `UPDATE screenshots SET image_data = NULL, thumbnail_data = NULL, deleted_at = clock_timestamp()
       WHERE screenshot_id = $1 AND deleted_at IS NULL RETURNING screenshot_id`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ message: 'Ảnh đã bị xóa hoặc không còn tồn tại.' });
    await req.releaseRls(true);
    return res.json({ deleted: result.rowCount });
  } catch (error) {
    console.error('Screenshot delete failed:', error.code || error.name);
    return res.status(500).json({ message: 'Chưa xóa được ảnh. Hãy thử lại.' });
  }
};

exports.removeAll = async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  // A snapshot bound keeps photos arriving during confirmation out of this delete.
  const throughId = String(req.body?.through_id || '');
  if (req.body?.confirm_all !== true || !/^[1-9]\d*$/.test(throughId)) {
    return res.status(400).json({ message: 'Hãy xác nhận phạm vi ảnh cần xóa.' });
  }
  const deviceId = req.query.device_id;
  if (deviceId !== undefined && !/^[1-9]\d*$/.test(deviceId)) {
    return res.status(400).json({ message: 'Thiết bị không hợp lệ.' });
  }
  try {
    if (deviceId && !(await req.db.query('SELECT 1 FROM devices WHERE device_id = $1', [deviceId])).rowCount) {
      return res.status(404).json({ message: 'Không tìm thấy thiết bị.' });
    }
    const result = await req.db.query(
      `UPDATE screenshots SET image_data = NULL, thumbnail_data = NULL, deleted_at = clock_timestamp()
       WHERE deleted_at IS NULL AND screenshot_id <= $1${deviceId ? ' AND device_id = $2' : ''}`,
      deviceId ? [throughId, deviceId] : [throughId]);
    await req.releaseRls(true);
    return res.json({ deleted: result.rowCount });
  } catch (error) {
    console.error('Screenshot clear failed:', error.code || error.name);
    return res.status(500).json({ message: 'Chưa xóa được dữ liệu ảnh. Hãy thử lại.' });
  }
};
