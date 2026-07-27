const { test } = require('node:test');
const assert = require('node:assert/strict');

const { adminPool } = require('../src/config/db');
const {
  validatePushToken,
  _private,
} = require('../src/services/notification.service');

test('validates Expo and FCM token formats without accepting control characters', () => {
  assert.equal(validatePushToken('expo', 'ExponentPushToken[abcdefghijklmnopqrstuv]'), true);
  assert.equal(validatePushToken('expo', 'ExpoPushToken[abcdefghijklmnopqrstuv]'), true);
  assert.equal(validatePushToken('fcm', 'abcDEF1234567890_token:value.more'), true);

  assert.equal(validatePushToken('expo', 'ExponentPushToken[bad token]'), false);
  assert.equal(validatePushToken('expo', 'ExponentPushToken[abc]\nInjected'), false);
  assert.equal(validatePushToken('fcm', 'abc\nInjected-token-value'), false);
  assert.equal(validatePushToken('unknown', 'abcDEF1234567890_token:value'), false);
});

test('normalizes a bounded provider-compatible payload', () => {
  const result = _private.normalizeNotification(
    '  SafeNest alert  ',
    '  A warning was detected.  ',
    { alert_id: 12, route: 'alerts', ignored: null }
  );

  assert.equal(result.title, 'SafeNest alert');
  assert.equal(result.message, 'A warning was detected.');
  assert.deepEqual(result.data, { alert_id: '12', route: 'alerts' });
  assert.throws(
    () => _private.normalizeNotification('', 'message'),
    /required/
  );
});

test('Expo delivery stores receipt IDs and marks accepted tokens successful', async () => {
  const originalQuery = adminPool.query;
  const queries = [];
  adminPool.query = async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [], rowCount: 0 };
  };

  try {
    const result = await _private.sendExpoNotifications(
      [
        {
          push_token_id: 11,
          token: 'ExponentPushToken[abcdefghijklmnopqrstuv]',
        },
      ],
      _private.normalizeNotification('Test', 'Delivered', { route: 'alerts' }),
      async () => ({
        ok: true,
        async json() {
          return { data: [{ status: 'ok', id: 'receipt-id-1' }] };
        },
      })
    );

    assert.deepEqual(result, { sent: 1, failed: 0 });
    assert.ok(queries.some(({ sql }) => /UPDATE push_tokens/.test(sql)));
    const receiptQuery = queries.find(({ sql }) => /INSERT INTO push_receipts/.test(sql));
    assert.deepEqual(receiptQuery.params, [['receipt-id-1'], [11]]);
  } finally {
    adminPool.query = originalQuery;
  }
});
