const test = require('node:test');
const assert = require('node:assert/strict');

const devicesController = require('../src/controllers/devices.controller');

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

test('device list exposes last heartbeat for Dashboard online status', async () => {
  const lastSeenAt = '2026-08-17T09:00:00.000Z';
  const req = {
    query: {},
    db: {
      async query(sql, params) {
        assert.match(sql, /last_seen_at/);
        assert.deepEqual(params, [50, 0]);
        return {
          rows: [{
            device_id: 7,
            child_id: 3,
            device_name: 'VMware Windows',
            device_uid: 'BIMPOP-VM',
            last_seen_at: lastSeenAt,
            created_at: '2026-08-01T00:00:00.000Z',
          }],
        };
      },
    },
  };
  const res = responseRecorder();

  await devicesController.getDevices(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data[0].last_seen_at, lastSeenAt);
  assert.equal(res.body.count, 1);
});
