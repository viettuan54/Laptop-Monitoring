const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validateEvents, saveEvents } = require('../src/services/breakReminder.service');
const { getAgentPolicyConfig } = require('../src/services/agentPolicy.service');

const event = () => ({ client_record_id: crypto.randomUUID(), reminder_id: crypto.randomUUID(),
  event_type: 'shown', interval_minutes: 30, duration_minutes: 5, occurred_at: new Date().toISOString() });

test('break receipts accept responses but reject invented rest completion, invalid settings and duplicate IDs', () => {
  for (const event_type of ['shown', 'acknowledged', 'snoozed']) {
    assert.equal(validateEvents([{ ...event(), event_type }])[0].event_type, event_type);
  }
  for (const bad of [{ event_type: 'rest_completed' }, { duration_minutes: 0 }, { interval_minutes: '30' },
    { interval_minutes: 181 }, { occurred_at: 'yesterday' }, { reminder_id: 'bad' }]) {
    assert.throws(() => validateEvents([{ ...event(), ...bad }]), TypeError);
  }
  const row = event();
  assert.throws(() => validateEvents([row, row]), TypeError);
});

test('break receipts use authenticated device and strip unknown content', async () => {
  let args;
  const records = validateEvents([{ ...event(), device_id: 999, text: 'not allowed' }]);
  const accepted = await saveEvents({ query: async (...input) => { args = input; } }, 42, records);
  assert.deepEqual(accepted, [records[0].client_record_id]);
  assert.equal(args[1][0], 42);
  assert.equal(records[0].device_id, undefined);
  assert.equal(records[0].text, undefined);
});

test('reminders default off and retiring key logging never opts a family into reminders', async () => {
  for (const stored of [{}, { enable_keylog: true }, { enable_break_reminders: true, break_interval_minutes: 45, break_duration_minutes: 10 }]) {
    const config = await getAgentPolicyConfig({ query: async sql => ({ rows: /FROM settings/.test(sql) ? [stored] : [] }) }, 1);
    assert.equal(config.enable_keylog, false);
    assert.equal(config.enable_break_reminders, stored.enable_break_reminders === true);
    assert.equal(config.break_interval_minutes, stored.break_interval_minutes ?? 30);
    assert.equal(config.break_duration_minutes, stored.break_duration_minutes ?? 5);
  }
});
