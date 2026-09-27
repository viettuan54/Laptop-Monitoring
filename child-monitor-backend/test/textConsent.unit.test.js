const test = require('node:test');
const assert = require('node:assert/strict');
const { adminPool } = require('../src/config/db');
const service = require('../src/services/textModeration.service');
let inference;
const originalModerate = service.moderateRecords;
service.moderateRecords = async (records, options) => {
  if (!(await options.beforeSend())) {
    const error = new Error('Disabled'); error.code = 'TEXT_MODERATION_DISABLED'; throw error;
  }
  return inference(records);
};
const controller = require('../src/controllers/agent.controller');
service.moderateRecords = originalModerate;

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
}
function request(text = 'tôi cần giúp đỡ', source = 'search_query') {
  return { device: { child_id: 1, device_id: 2 }, body: { records: [{
    client_record_id: '70a37d33-24fd-4dbf-a788-e3aa836eef32', source_type: source,
    text, domain: 'www.google.com', occurred_at: '2026-09-26T08:00:00Z',
  }] } };
}

async function scenario(options = {}) {
  const originalQuery = adminPool.query;
  const originalConnect = adminPool.connect;
  let enabled = options.enabled ?? true;
  let revision = options.revision;
  let inferenceCount = 0;
  let released = false;
  const writes = [];
  const queries = [];
  adminPool.query = async (sql) => {
    if (sql.includes('FROM settings')) return { rows: [{ enable_text_moderation: enabled, updated_at: revision }] };
    if (sql.includes('FROM text_moderation_events')) {
      if (options.disableBeforeSend) enabled = false;
      return { rows: [] };
    }
    return { rows: [] };
  };
  adminPool.connect = async () => ({
    async query(sql, params) {
      queries.push(sql);
      if (sql.includes('FROM settings')) return { rows: [{ enable_text_moderation: enabled, updated_at: revision }] };
      if (sql.includes('INSERT INTO text_moderation_events')) {
        writes.push(params); return { rows: [{ event_id: 1 }] };
      }
      if (sql.includes('INSERT INTO alerts')) return { rows: [{ alert_id: 1 }] };
      return { rows: [] };
    }, release() { released = true; },
  });
  inference = async () => {
    inferenceCount += 1;
    if (options.disableDuringModel) enabled = false;
    if (options.newWindowDuringModel) revision = '2026-09-26T08:01:00Z';
    const label = options.label || 'HIGH_RISK';
    return { model: 'vi-school-violence-char-nb-v2', results: [{ label,
      flagged: label !== 'SAFE', confidence: 0.9,
      scores: { SAFE: 0.05, RISK: 0.05, HIGH_RISK: 0.9 } }] };
  };
  try {
    const res = response();
    await controller.moderateTextBatch(request(options.text, options.source), res);
    return { res, inferenceCount, writes, queries, released };
  } finally { adminPool.query = originalQuery; adminPool.connect = originalConnect; }
}

test('disabled or missing consent acknowledges discard without calling model or storing events', async () => {
  const result = await scenario({ enabled: false });
  assert.equal(result.res.statusCode, 201);
  assert.equal(result.res.body.enabled, false);
  assert.equal(result.inferenceCount, 0);
  assert.equal(result.writes.length, 0);
  assert.equal(result.res.body.accepted_client_record_ids.length, 1);
});

test('off between deduplication and dispatch prevents model call', async () => {
  const result = await scenario({ disableBeforeSend: true });
  assert.equal(result.res.body.enabled, false);
  assert.equal(result.inferenceCount, 0);
  assert.equal(result.writes.length, 0);
});

test('off while inference runs discards results and alerts under a transaction lock', async () => {
  const result = await scenario({ disableDuringModel: true });
  assert.equal(result.res.statusCode, 201);
  assert.equal(result.res.body.enabled, false);
  assert.equal(result.inferenceCount, 1);
  assert.equal(result.writes.length, 0);
  assert.ok(result.queries.some((sql) => sql.includes('FOR SHARE')));
  assert.equal(result.queries.at(-1), 'COMMIT');
  assert.equal(result.released, true);
});

test('events store labels and scores but no original text; RISK creates no alert', async () => {
  const text = 'hướng dẫn phòng chống bạo lực học đường';
  const result = await scenario({ text, label: 'RISK' });
  assert.equal(result.res.statusCode, 201);
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0][5], 'RISK');
  assert.ok(!JSON.stringify(result.writes).includes(text));
  assert.ok(!result.queries.some((sql) => sql.includes('INSERT INTO alerts')));
});

test('privacy-invalid text and deferred chat sources never reach model or DB', async () => {
  for (const options of [{ text: 'token: private-secret' }, { source: 'chat_received' },
    { source: 'chat_authored' }]) {
    const result = await scenario(options);
    assert.equal(result.res.statusCode, 400);
    assert.equal(result.inferenceCount, 0);
    assert.equal(result.writes.length, 0);
  }
});

test('records older than settings revision are acknowledged and discarded without model dispatch', async () => {
  const result = await scenario({ revision: '2026-09-26T08:01:00Z' });
  assert.equal(result.res.statusCode, 201);
  assert.equal(result.inferenceCount, 0);
  assert.equal(result.writes.length, 0);
});

test('a new consent window while model runs discards old results even if flag is true again', async () => {
  const result = await scenario({ newWindowDuringModel: true });
  assert.equal(result.res.statusCode, 201);
  assert.equal(result.res.body.enabled, false);
  assert.equal(result.inferenceCount, 1);
  assert.equal(result.writes.length, 0);
  assert.equal(result.released, true);
});
