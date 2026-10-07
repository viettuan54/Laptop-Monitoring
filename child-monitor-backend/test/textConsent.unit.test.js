const test = require('node:test');
const assert = require('node:assert/strict');
const { adminPool } = require('../src/config/db');
const service = require('../src/services/textModeration.service');
const notifications = require('../src/services/notification.service');
const originalPush = notifications.sendPushNotification;
let pushes = [];
notifications.sendPushNotification = async (...args) => { pushes.push(args); };
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
notifications.sendPushNotification = originalPush;

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
  const savedEnvironment = { ...process.env };
  Object.assign(process.env, {
    TEXT_MODERATION_MODE: options.mode || 'alerts',
    LOCAL_MODERATION_EXPECTED_MODEL: 'vi-school-violence-char-nb-v3',
    LOCAL_MODERATION_EXPECTED_SHA256: 'a'.repeat(64),
  });
  const originalQuery = adminPool.query;
  const originalConnect = adminPool.connect;
  let enabled = options.enabled ?? true;
  let revision = options.revision;
  let inferenceCount = 0;
  let released = false;
  const writes = [];
  const alertWrites = [];
  const queries = [];
  pushes = [];
  adminPool.query = async (sql) => {
    if (sql.includes('FROM settings')) return { rows: [{ enable_text_moderation: enabled, updated_at: revision }] };
    if (sql.includes('FROM text_moderation_events')) {
      if (options.disableBeforeSend) enabled = false;
      return { rows: [] };
    }
    if (sql.includes('FROM children')) return { rows: [{ user_id: 10 }] };
    return { rows: [] };
  };
  adminPool.connect = async () => ({
    async query(sql, params) {
      queries.push(sql);
      if (sql.includes('FROM settings')) return { rows: [{ enable_text_moderation: enabled, updated_at: revision }] };
      if (sql.includes('INSERT INTO text_moderation_events')) {
        writes.push(params); return { rows: options.duplicateEvent ? [] : [{ event_id: 1 }] };
      }
      if (sql.includes('SELECT alert_id FROM alerts')) {
        return { rows: options.recentAlertType === params[1] ? [{ alert_id: 2 }] : [] };
      }
      if (sql.includes('INSERT INTO alerts')) {
        alertWrites.push(params); return { rows: [{ alert_id: 1 }] };
      }
      return { rows: [] };
    }, release() { released = true; },
  });
  inference = async () => {
    inferenceCount += 1;
    if (options.disableDuringModel) enabled = false;
    if (options.newWindowDuringModel) revision = '2026-09-26T08:01:00Z';
    if (options.modeDuringModel) process.env.TEXT_MODERATION_MODE = options.modeDuringModel;
    const label = options.label || 'HIGH_RISK';
    return { model: 'vi-school-violence-char-nb-v3', modelSha256: 'a'.repeat(64), results: [{ label,
      flagged: label !== 'SAFE', confidence: 0.9,
      scores: Object.fromEntries(['SAFE', 'RISK', 'HIGH_RISK'].map((key) => [key, key === label ? 0.9 : 0.05])) }] };
  };
  try {
    const res = response();
    await controller.moderateTextBatch(request(options.text, options.source), res);
    return { res, inferenceCount, writes, alertWrites, pushes, queries, released };
  } finally {
    adminPool.query = originalQuery; adminPool.connect = originalConnect;
    for (const key of Object.keys(process.env)) if (!(key in savedEnvironment)) delete process.env[key];
    Object.assign(process.env, savedEnvironment);
  }
}

test('shadow persists all three labels and pinned metadata without querying alerts or sending push', async () => {
  for (const label of ['SAFE', 'RISK', 'HIGH_RISK']) {
    const result = await scenario({ label, mode: 'shadow' });
    assert.equal(result.res.statusCode, 201);
    assert.equal(result.res.body.moderation_mode, 'shadow');
    assert.equal(result.res.body.flagged_count, 0);
    assert.equal(result.res.body.observed_count, 1);
    assert.equal(result.writes[0][5], label);
    assert.equal(result.writes[0][11], 'shadow');
    assert.equal(result.writes[0][12], 'a'.repeat(64));
    assert.ok(Number.isInteger(result.writes[0][13]) && result.writes[0][13] >= 0);
    assert.equal(result.queries.some(sql => sql.includes('FROM alerts') || sql.includes('INTO alerts')), false);
    assert.equal(result.pushes.length, 0);
  }
});

test('shadow remains silent if server mode changes while inference runs', async () => {
  const result = await scenario({ mode: 'shadow', modeDuringModel: 'alerts' });
  assert.equal(result.writes[0][11], 'shadow');
  assert.equal(result.alertWrites.length, 0);
  assert.equal(result.pushes.length, 0);
});

test('shadow respects consent revocation and duplicate insertion', async () => {
  for (const option of [{ disableDuringModel: true }, { duplicateEvent: true }]) {
    const result = await scenario({ mode: 'shadow', ...option });
    assert.equal(result.res.statusCode, 201);
    assert.equal(result.res.body.observed_count || 0, 0);
    assert.equal(result.alertWrites.length, 0);
    assert.equal(result.pushes.length, 0);
  }
});

test('invalid mode rejects pending queries before inference and persistence', async () => {
  const result = await scenario({ mode: 'shdaow' });
  assert.equal(result.res.statusCode, 503);
  assert.equal(result.inferenceCount, 0);
  assert.equal(result.writes.length, 0);
});

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

test('RISK creates an observation alert and parent push without the original query', async () => {
  const text = 'hướng dẫn phòng chống bạo lực học đường';
  const result = await scenario({ text, label: 'RISK' });
  assert.equal(result.res.statusCode, 201);
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0][5], 'RISK');
  assert.ok(!JSON.stringify(result.writes).includes(text));
  assert.equal(result.res.body.flagged_count, 1);
  assert.equal(result.alertWrites.length, 1);
  assert.equal(result.alertWrites[0][1], 'text_risk');
  assert.match(result.alertWrites[0][2], /quan sát, trò chuyện và quan tâm bé trong thời gian này/);
  assert.equal(result.pushes.length, 1);
  assert.equal(result.pushes[0][0], 10);
  assert.equal(result.pushes[0][1], 'Cần quan sát bé trong thời gian này');
  assert.equal(result.pushes[0][3].route, 'alerts');
  assert.ok(!JSON.stringify([result.alertWrites, result.pushes]).includes(text));
});

test('HIGH_RISK creates the violence warning even after a recent RISK alert', async () => {
  const result = await scenario({ label: 'HIGH_RISK', recentAlertType: 'text_risk' });
  assert.equal(result.res.statusCode, 201);
  assert.equal(result.alertWrites.length, 1);
  assert.equal(result.alertWrites[0][1], 'text_violence');
  assert.match(result.alertWrites[0][2], /^Bé có dấu hiệu bị bạo lực/);
  assert.equal(result.pushes[0][1], 'Bé có dấu hiệu bị bạo lực');
  assert.equal(result.pushes[0][3].alert_type, 'text_violence');
});

test('SAFE stores the classification without an alert or push', async () => {
  const result = await scenario({ label: 'SAFE' });
  assert.equal(result.writes[0][5], 'SAFE');
  assert.equal(result.res.body.flagged_count, 0);
  assert.equal(result.alertWrites.length, 0);
  assert.equal(result.pushes.length, 0);
});

test('duplicate records and cooldown suppress repeated alerts at each level', async () => {
  for (const [label, alertType] of [['RISK', 'text_risk'], ['HIGH_RISK', 'text_violence']]) {
    for (const option of [{ duplicateEvent: true }, { recentAlertType: alertType }]) {
      const result = await scenario({ label, ...option });
      assert.equal(result.res.statusCode, 201);
      assert.equal(result.alertWrites.length, 0);
      assert.equal(result.pushes.length, 0);
    }
  }
});

test('privacy-invalid text and deferred page/chat sources never reach model or DB', async () => {
  for (const options of [{ text: 'token: private-secret' }, { source: 'chat_received' },
    { source: 'chat_authored' }, { source: 'page_content' }]) {
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
