const { normalizeAppName, APP_CATEGORIES } = require('./contentClassification.service');

const REASONS = Object.freeze({
  closed: ['graceful_exit', 'terminated'],
  failed: ['access_denied', 'termination_timeout'],
  cancelled: ['policy_changed', 'session_changed', 'service_stopped'],
});
const SOURCES = new Set(['exact_lookup', 'trained_model', 'gemini']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateEvents(records) {
  if (!Array.isArray(records) || !records.length || records.length > 100) {
    throw new TypeError('records must contain 1 to 100 enforcement events');
  }
  const seen = new Set();
  return records.map((row) => {
    if (!row || typeof row !== 'object' || !UUID.test(row.client_record_id)
        || seen.has(row.client_record_id.toLowerCase())) {
      throw new TypeError('Invalid or duplicate client_record_id');
    }
    seen.add(row.client_record_id.toLowerCase());
    if (!APP_CATEGORIES.includes(row.category) || !SOURCES.has(row.classification_source)
        || !Object.hasOwn(REASONS, row.outcome) || !REASONS[row.outcome].includes(row.reason)) {
      throw new TypeError('Invalid enforcement classification or outcome');
    }
    const times = [row.requested_at, row.occurred_at].map((value) => {
      if (typeof value !== 'string' || value.length > 64 || !/(Z|[+-]\d\d:\d\d)$/.test(value)
          || !Number.isFinite(Date.parse(value))) throw new TypeError('Invalid enforcement time');
      return new Date(value);
    });
    if (times[1] < times[0] || times[1].getTime() > Date.now() + 300000) {
      throw new TypeError('Invalid enforcement time range');
    }
    return {
      client_record_id: row.client_record_id.toLowerCase(),
      app_name: normalizeAppName(row.app_name), category: row.category,
      classification_source: row.classification_source,
      requested_at: times[0].toISOString(), occurred_at: times[1].toISOString(),
      outcome: row.outcome, reason: row.reason,
    };
  });
}

async function saveEvents(db, deviceId, records) {
  // One atomic statement, including retries; receipts cannot name another device.
  await db.query(
    `INSERT INTO app_enforcement_events
       (device_id, client_record_id, app_name, category, classification_source,
        requested_at, occurred_at, outcome, reason)
     SELECT $1, r.client_record_id, r.app_name, r.category, r.classification_source,
            r.requested_at, r.occurred_at, r.outcome, r.reason
     FROM jsonb_to_recordset($2::jsonb) AS r(
       client_record_id UUID, app_name TEXT, category TEXT, classification_source TEXT,
       requested_at TIMESTAMPTZ, occurred_at TIMESTAMPTZ, outcome TEXT, reason TEXT)
     ON CONFLICT (device_id, client_record_id) DO NOTHING`,
    [deviceId, JSON.stringify(records)]
  );
  return records.map((row) => row.client_record_id);
}

module.exports = { validateEvents, saveEvents };
