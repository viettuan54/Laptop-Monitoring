const { adminPool } = require('../config/db');
const { validateEvents, saveEvents } = require('../services/appEnforcement.service');

exports.ingest = async (req, res) => {
  let records;
  try { records = validateEvents(req.body?.records); }
  catch (error) { return res.status(400).json({ message: error.message }); }
  try {
    const accepted = await saveEvents(adminPool, req.device.device_id, records);
    return res.status(201).json({ accepted_client_record_ids: accepted });
  } catch (error) {
    console.error('Application enforcement receipt failed:', error.code || error.name);
    return res.status(500).json({ message: 'Could not save enforcement results' });
  }
};

exports.list = async (req, res) => {
  const { device_id, start, end } = req.query;
  if (device_id !== undefined && (!/^\d+$/.test(device_id) || Number(device_id) <= 0)) {
    return res.status(400).json({ message: 'Invalid device_id' });
  }
  if ([start, end].some((value) => value !== undefined && (typeof value !== 'string' || !Number.isFinite(Date.parse(value))))) {
    return res.status(400).json({ message: 'Invalid date range' });
  }
  const limit = Math.max(1, Math.min(Number.parseInt(req.query.limit, 10) || 50, 200));
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
  try {
    const result = await req.db.query(
      `SELECT event_id, device_id, app_name, category, classification_source,
              requested_at, occurred_at, outcome, reason
       FROM app_enforcement_events
       WHERE ($1::int IS NULL OR device_id = $1)
         AND ($2::timestamptz IS NULL OR occurred_at >= $2)
         AND ($3::timestamptz IS NULL OR occurred_at <= $3)
       ORDER BY occurred_at DESC, event_id DESC LIMIT $4 OFFSET $5`,
      [device_id || null, start || null, end || null, limit, offset]
    );
    return res.json({ data: result.rows, limit, offset, count: result.rows.length });
  } catch (error) {
    console.error('Application enforcement history failed:', error.code || error.name);
    return res.status(500).json({ message: 'Could not load enforcement results' });
  }
};
