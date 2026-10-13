const { adminPool } = require('../config/db');
const { validateEvents, saveEvents } = require('../services/breakReminder.service');

exports.ingest = async (req, res) => {
  let records;
  try { records = validateEvents(req.body?.records); }
  catch (error) { return res.status(400).json({ message: error.message }); }
  try {
    const accepted = await saveEvents(adminPool, req.device.device_id, records);
    return res.status(201).json({ accepted_client_record_ids: accepted });
  } catch (error) {
    console.error('Break reminder receipt failed:', error.code || error.name);
    return res.status(500).json({ message: 'Could not save break reminders' });
  }
};

exports.list = async (req, res) => {
  const { child_id } = req.query;
  if (typeof child_id !== 'string' || !/^\d+$/.test(child_id) || !Number.isSafeInteger(Number(child_id)) || Number(child_id) <= 0) {
    return res.status(400).json({ message: 'Invalid child_id' });
  }
  try {
    const result = await req.db.query(`SELECT e.event_id, e.device_id, d.device_name, e.reminder_id,
        e.event_type, e.interval_minutes, e.duration_minutes, e.occurred_at
      FROM break_reminder_events e JOIN devices d ON d.device_id = e.device_id
      WHERE d.child_id = $1 ORDER BY e.occurred_at DESC, e.event_id DESC LIMIT 10`, [child_id]);
    return res.json({ data: result.rows });
  } catch (error) {
    console.error('Break reminder history failed:', error.code || error.name);
    return res.status(500).json({ message: 'Could not load break reminders' });
  }
};
