const test = require('node:test');
const assert = require('node:assert/strict');
const { adminPool } = require('../src/config/db');

test('analysis and summaries distinguish absent telemetry, invalid inference and alert-only periods', async (t) => {
  const provider = require('@google/genai');
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'fixture-only';
  t.after(() => {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  });
  let calls = 0;
  t.mock.method(provider, 'GoogleGenAI', class {
    models = { generateContent: async () => { calls++; return { text: '{}' }; } };
  });
  const service = require('../src/services/ai.service');
  let apps = [];
  t.mock.method(adminPool, 'query', async (sql) => {
    assert.match(sql, /^SELECT /);
    if (sql.includes('FROM app_usage')) return { rows: apps };
    if (sql.includes('FROM alerts')) return { rows: [{ message: 'fixture alert' }] };
    return { rows: [] };
  });
  t.mock.method(adminPool, 'connect', () => assert.fail('No assessment may be persisted'));
  assert.equal(await service.analyzeDeviceActivity(1), null);
  assert.match(await service.generateSummaryReport(1, 'daily'), /24 giờ qua.*1 cảnh báo.*fixture alert/);
  assert.equal(calls, 0);
  apps = [{ app_name: 'fixture.exe', start_time: new Date(), duration_seconds: 30 }];
  await assert.rejects(service.analyzeDeviceActivity(1), { code: 'INVALID_AI_RESULT' });
  assert.equal(calls, 1);
});
