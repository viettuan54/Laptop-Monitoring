const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEvents, saveEvents } = require('../src/services/appEnforcement.service');

const event = () => ({
  client_record_id: '0356bc31-5a4c-4e85-99c0-01697d0f1352',
  app_name: 'Game.exe', category: 'entertainment', classification_source: 'trained_model',
  requested_at: '2026-01-01T00:00:00Z', occurred_at: '2026-01-01T00:00:10Z',
  outcome: 'closed', reason: 'terminated',
});

test('enforcement receipts normalize names and reject unconfirmed or inconsistent outcomes', () => {
  assert.equal(validateEvents([event()])[0].app_name, 'game.exe');
  for (const changes of [
    { app_name: 'C:\\Private\\game.exe' }, { classification_source: 'pending' },
    { outcome: 'closed', reason: 'access_denied' }, { outcome: 'blocked' },
    { occurred_at: '2025-01-01T00:00:00Z' }, { requested_at: 'not a date' },
    { client_record_id: 'invalid' }, { category: 'unsafe' },
  ]) assert.throws(() => validateEvents([{ ...event(), ...changes }]), TypeError);
  assert.throws(() => validateEvents([event(), event()]), TypeError);
  assert.throws(() => validateEvents([]), TypeError);
});

test('receipts are atomically scoped to the authenticated device and acknowledged on retry', async () => {
  const calls = [];
  const db = { query: async (...args) => calls.push(args) };
  const records = validateEvents([{ ...event(), device_id: 999 }]);
  assert.deepEqual(await saveEvents(db, 6, records), [event().client_record_id]);
  assert.equal(calls[0][1][0], 6);
  assert.equal(JSON.parse(calls[0][1][1])[0].device_id, undefined);
  assert.match(calls[0][0], /ON CONFLICT \(device_id, client_record_id\) DO NOTHING/);
});
