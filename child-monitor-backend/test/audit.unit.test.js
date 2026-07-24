const { test } = require('node:test');
const assert = require('node:assert/strict');

const { recordAudit } = require('../src/services/audit.service');

test('records authenticated actor and bounded request metadata', async () => {
  let captured;
  const db = {
    async query(sql, params) {
      captured = { sql, params };
    },
  };
  const req = {
    currentUser: { user_id: 7, role: 'parent' },
    ip: '127.0.0.1',
    get(header) {
      return header === 'user-agent' ? 'test-agent' : undefined;
    },
  };

  await recordAudit(db, req, {
    action: 'device.rotate_secret',
    targetType: 'device',
    targetId: 42,
    metadata: { changed_fields: ['device_secret'] },
  });

  assert.match(captured.sql, /INSERT INTO audit_logs/);
  assert.equal(captured.params[0], 7);
  assert.equal(captured.params[1], 'parent');
  assert.equal(captured.params[2], 'device.rotate_secret');
  assert.equal(captured.params[4], '42');
  assert.deepEqual(JSON.parse(captured.params[5]), {
    changed_fields: ['device_secret'],
  });
  assert.equal(captured.params[6], '127.0.0.1');
});

test('refuses to write an audit record without an authenticated actor', async () => {
  await assert.rejects(
    recordAudit({ query: async () => {} }, {}, {
      action: 'blacklist.delete',
      targetType: 'blacklist_domain',
    }),
    /Authenticated actor/
  );
});
