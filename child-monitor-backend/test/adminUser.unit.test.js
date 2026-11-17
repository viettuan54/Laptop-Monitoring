const { test } = require('node:test');
const assert = require('node:assert/strict');

const { adminPool } = require('../src/config/db');
const adminController = require('../src/controllers/admin.controller');

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('admin cannot demote or disable their own account', async () => {
  for (const body of [{ role: 'parent' }, { is_active: false }]) {
    const req = {
      params: { id: '7' },
      body,
      currentUser: { user_id: 7, role: 'admin' },
    };
    const res = response();

    await adminController.updateUser(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /cannot demote or disable/i);
  }
});

test('admin user update validates id and editable fields before querying DB', async () => {
  const invalidRequests = [
    { params: { id: 'abc' }, body: { role: 'parent' } },
    { params: { id: '8' }, body: {} },
    { params: { id: '8' }, body: { role: 'owner' } },
    { params: { id: '8' }, body: { is_active: 'false' } },
    { params: { id: '8' }, body: { is_verified: 1 } },
  ];

  for (const req of invalidRequests) {
    req.currentUser = { user_id: 7, role: 'admin' };
    const res = response();

    await adminController.updateUser(req, res);

    assert.equal(res.statusCode, 400);
    assert.ok(res.body.message);
  }
});

test('admin cannot delete their own account', async () => {
  const req = {
    params: { id: '7' },
    currentUser: { user_id: 7, role: 'admin' },
  };
  const res = response();

  await adminController.deleteUser(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /cannot delete your own/i);
});

test('admin getUsers and getBlacklist clamp negative limits to at least 1', async (t) => {
  const capturedParams = [];
  t.mock.method(adminPool, 'query', async (_sql, params) => {
    capturedParams.push(params);
    return { rows: [{ total: '0', data: [] }] };
  });

  const usersRes = response();
  await adminController.getUsers({ query: { limit: '-10', offset: '-5' } }, usersRes);
  assert.equal(usersRes.statusCode, 200);
  assert.equal(usersRes.body.limit, 1);
  assert.equal(usersRes.body.offset, 0);
  assert.deepEqual(capturedParams[0], [1, 0]);

  const blacklistRes = response();
  await adminController.getBlacklist({ query: { limit: '-1', offset: '-2' } }, blacklistRes);
  assert.equal(blacklistRes.statusCode, 200);
  assert.equal(blacklistRes.body.limit, 1);
  assert.equal(blacklistRes.body.offset, 0);
  assert.deepEqual(capturedParams[1], [1, 0]);
});

test('admin addBlacklist rejects non-string reason and deleteBlacklist rejects invalid id before querying DB', async (t) => {
  t.mock.method(adminPool, 'connect', async () => {
    throw new Error('Unexpected database access');
  });

  for (const reason of [123, true, {}, ['bad']]) {
    const res = response();
    await adminController.addBlacklist(
      { body: { domain: 'example.com', reason }, currentUser: { user_id: 7, role: 'admin' } },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /reason must be a string/i);
  }

  for (const id of ['abc', '0', '-5', '1.5']) {
    const res = response();
    await adminController.deleteBlacklist(
      { params: { id }, currentUser: { user_id: 7, role: 'admin' } },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /positive integer/i);
  }
});
