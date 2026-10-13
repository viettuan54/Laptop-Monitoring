const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set(['shown', 'acknowledged', 'snoozed']);

function validateEvents(records) {
  if (!Array.isArray(records) || !records.length || records.length > 100) {
    throw new TypeError('records must contain 1 to 100 break reminder events');
  }
  const seen = new Set();
  return records.map(row => {
    if (!row || typeof row !== 'object' || !UUID.test(row.client_record_id)
        || !UUID.test(row.reminder_id) || seen.has(row.client_record_id.toLowerCase())) {
      throw new TypeError('Invalid or duplicate reminder identifier');
    }
    seen.add(row.client_record_id.toLowerCase());
    if (!EVENT_TYPES.has(row.event_type)
        || !Number.isInteger(row.interval_minutes) || row.interval_minutes < 5 || row.interval_minutes > 180
        || !Number.isInteger(row.duration_minutes) || row.duration_minutes < 1 || row.duration_minutes > 30) {
      throw new TypeError('Invalid break reminder event');
    }
    if (typeof row.occurred_at !== 'string' || row.occurred_at.length > 64
        || !/(Z|[+-]\d\d:\d\d)$/.test(row.occurred_at)
        || !Number.isFinite(Date.parse(row.occurred_at)) || Date.parse(row.occurred_at) > Date.now() + 300000) {
      throw new TypeError('Invalid reminder time');
    }
    return { client_record_id: row.client_record_id.toLowerCase(), reminder_id: row.reminder_id.toLowerCase(),
      event_type: row.event_type, interval_minutes: row.interval_minutes,
      duration_minutes: row.duration_minutes, occurred_at: new Date(row.occurred_at).toISOString() };
  });
}

async function saveEvents(db, deviceId, records) {
  await db.query(`INSERT INTO break_reminder_events
    (device_id, client_record_id, reminder_id, event_type, interval_minutes, duration_minutes, occurred_at)
    SELECT $1, r.client_record_id, r.reminder_id, r.event_type, r.interval_minutes, r.duration_minutes, r.occurred_at
    FROM jsonb_to_recordset($2::jsonb) AS r(client_record_id UUID, reminder_id UUID,
      event_type TEXT, interval_minutes INTEGER, duration_minutes INTEGER, occurred_at TIMESTAMPTZ)
    ON CONFLICT DO NOTHING`, [deviceId, JSON.stringify(records)]);
  return records.map(row => row.client_record_id);
}

module.exports = { validateEvents, saveEvents };
