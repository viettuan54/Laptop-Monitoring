const test = require('node:test');
const assert = require('node:assert/strict');

const { adminPool } = require('../src/config/db');
const logsController = require('../src/controllers/logs.controller');

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('app batch persists executable metadata and exact-lookup provenance', async () => {
  const originalQuery = adminPool.query;
  let captured;
  adminPool.query = async (sql, params) => {
    captured = { sql, params };
    return { rowCount: 1 };
  };
  try {
    const req = {
      device: { device_id: 7 },
      body: { records: [{
        client_record_id: '70a37d33-24fd-4dbf-a788-e3aa836eef32',
        app_name: 'msedge.exe',
        category: 'browsers',
        product_name: 'Microsoft Edge',
        file_description: 'Microsoft Edge',
        classification_source: 'exact_lookup',
        classification_confidence: 1,
        start_time: '2026-08-22T08:00:00+07:00',
        end_time: '2026-08-22T08:00:30+07:00',
        duration_seconds: 30,
      }] },
    };
    const res = responseRecorder();

    await logsController.logAppBatch(req, res);

    assert.equal(res.statusCode, 201);
    assert.match(captured.sql, /classification_source/);
    assert.deepEqual(captured.params[4], ['Microsoft Edge']);
    assert.deepEqual(captured.params[6], ['exact_lookup']);
    assert.deepEqual(captured.params[7], [1]);
  } finally {
    adminPool.query = originalQuery;
  }
});

test('app batch rejects uncalibrated trained-model provenance', async () => {
  const originalQuery = adminPool.query;
  let queried = false;
  adminPool.query = async () => {
    queried = true;
    return { rowCount: 1 };
  };
  try {
    const req = {
      device: { device_id: 7 },
      body: { records: [{
        client_record_id: '9d59b46a-343f-4027-8365-b05c8009613f',
        app_name: 'study.exe',
        category: 'learning',
        classification_source: 'trained_model',
        classification_confidence: 0.69,
        start_time: '2026-08-22T08:00:00+07:00',
        duration_seconds: 30,
      }] },
    };
    const res = responseRecorder();

    await logsController.logAppBatch(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(queried, false);
    assert.match(res.body.skipped_reasons[0], /at least 0\.7/);
  } finally {
    adminPool.query = originalQuery;
  }
});

test('app batch rejects executable paths in names and metadata', async () => {
  const originalQuery = adminPool.query;
  let queried = false;
  adminPool.query = async () => {
    queried = true;
    return { rowCount: 1 };
  };
  try {
    const baseRecord = {
      client_record_id: '9d59b46a-343f-4027-8365-b05c8009613f',
      app_name: 'study.exe',
      category: 'unknown',
      classification_source: 'pending',
      start_time: '2026-08-22T08:00:00+07:00',
      duration_seconds: 30,
    };
    for (const record of [
      { ...baseRecord, app_name: 'C:\\Apps\\study.exe' },
      { ...baseRecord, product_name: 'C:\\Apps\\Study' },
    ]) {
      const res = responseRecorder();
      await logsController.logAppBatch({
        device: { device_id: 7 },
        body: { records: [record] },
      }, res);
      assert.equal(res.statusCode, 400);
    }
    assert.equal(queried, false);
  } finally {
    adminPool.query = originalQuery;
  }
});
