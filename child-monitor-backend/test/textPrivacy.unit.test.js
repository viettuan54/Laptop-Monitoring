const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanText, safeWebMetadata } = require('../src/services/textPrivacy.service');
const { adminPool } = require('../src/config/db');
const logs = require('../src/controllers/logs.controller');

test('text privacy rejects obvious identifiers, secrets, URLs and hidden controls without echo', () => {
  assert.equal(cleanText('  tôi\u200b không\nmuốn chết '), 'tôi không muốn chết');
  for (const text of ['abc@example.com', '0901234567', 'mật khẩu=private',
    'token: secret', 'Bearer secret', 'https://example.com/?token=private',
    'ａｂｃ＠ｅｘａｍｐｌｅ．ｃｏｍ', 'private\x00text', 'x'.repeat(1001)]) {
    assert.throws(() => cleanText(text), (error) => !error.message.includes(text));
  }
});

test('website metadata includes only origin and hostname, never title, credentials or query', () => {
  assert.deepEqual(safeWebMetadata('https://user:password@example.com/private?q=secret#token'),
    { url: 'https://example.com/', domain: 'example.com', page_title: 'example.com' });
  assert.throws(() => safeWebMetadata('file:///private'));
  assert.throws(() => safeWebMetadata('invalid'));
});

test('backend website batch sanitizes metadata even from a legacy Agent', async () => {
  const originalQuery = adminPool.query;
  let params;
  adminPool.query = async (_sql, values) => { params = values; return { rowCount: 1 }; };
  try {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; } };
    await logs.logWebBatch({ device: { device_id: 1 }, body: { records: [{
      client_record_id: '70a37d33-24fd-4dbf-a788-e3aa836eef32',
      url: 'https://www.google.com/search?q=private-query', domain: 'www.google.com',
      page_title: 'private-query - Search', visit_time: '2026-09-26T08:00:00Z',
    }] } }, res);
    assert.equal(res.statusCode, 201);
    assert.deepEqual(params[2], ['https://www.google.com/']);
    assert.deepEqual(params[9], ['www.google.com']);
    assert.ok(!JSON.stringify(params).includes('private-query'));
  } finally { adminPool.query = originalQuery; }
});
