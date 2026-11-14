const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { once } = require('node:events');
const express = require('express');

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

async function fixture(t, handler, finish = async sql => ({ command: sql })) {
  const queries = [], releases = [];
  const client = {
    async query(sql) {
      queries.push(sql);
      if (sql === 'COMMIT' || sql === 'ROLLBACK') return finish(sql);
      return { rows: [{ device_id: 1 }] };
    },
    release(error) { releases.push(error); },
  };
  const box = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/middlewares/rls.middleware.js'), 'utf8'), {
    module: box, require: () => ({ backendPool: { connect: async () => client } }),
    console: { error() {} }, Promise,
  });
  const app = express();
  app.use((req, res, next) => { req.user = { user_id: 1 }; next(); });
  app.use(box.exports);
  app.use(handler);
  app.use((err, req, res, next) => res.status(500).json({ message: 'Internal server error' }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { url: `http://127.0.0.1:${server.address().port}`, queries, releases };
}

test('success headers and body wait until COMMIT completes', { timeout: 5000 }, async (t) => {
  const commit = deferred(), entered = deferred();
  let response;
  const f = await fixture(t, (req, res) => { response = res; res.status(201).json({ saved: true }); },
    () => { entered.resolve(); return commit.promise; });
  const pending = fetch(f.url);
  await entered.promise;
  assert.equal(response.headersSent, false);
  assert.equal(f.releases.length, 0);
  commit.resolve({ command: 'COMMIT' });
  const result = await pending;
  assert.equal(result.status, 201);
  assert.deepEqual(await result.json(), { saved: true });
  assert.equal(f.releases.length, 1);
});

test('failed COMMIT replaces success body and discards the connection', async (t) => {
  const failure = new Error('database disconnected');
  const f = await fixture(t, (req, res) => res.status(201).json({ saved: true, id: 42 }),
    async () => { throw failure; });
  const result = await fetch(f.url);
  assert.equal(result.status, 500);
  const body = await result.text();
  assert.deepEqual(JSON.parse(body), { message: 'Internal server error' });
  assert.equal(Number(result.headers.get('content-length')), Buffer.byteLength(body));
  assert.deepEqual(f.releases, [failure]);
  assert.equal(f.queries.filter(sql => sql === 'COMMIT').length, 1);
});

test('COMMIT reported as ROLLBACK cannot produce success', async (t) => {
  const f = await fixture(t, (req, res) => res.json({ saved: true }), async () => ({ command: 'ROLLBACK' }));
  assert.equal((await fetch(f.url)).status, 500);
  assert.ok(f.releases[0]);
});

test('error response rolls back and releases once', async (t) => {
  const f = await fixture(t, (req, res) => res.status(400).json({ message: 'Invalid input' }));
  const result = await fetch(f.url);
  assert.equal(result.status, 400);
  assert.deepEqual(await result.json(), { message: 'Invalid input' });
  assert.equal(f.queries.at(-1), 'ROLLBACK');
  assert.equal(f.releases.length, 1);
});

test('concurrent early releases await one commit', { timeout: 5000 }, async (t) => {
  const commit = deferred(), entered = deferred();
  let continued = false;
  const f = await fixture(t, async (req, res) => {
    const first = req.releaseRls(true), second = req.releaseRls(true);
    assert.equal(first, second);
    await Promise.all([first, second]);
    continued = true;
    res.status(204).end();
  }, () => { entered.resolve(); return commit.promise; });
  const pending = fetch(f.url);
  await entered.promise;
  assert.equal(continued, false);
  commit.resolve({ command: 'COMMIT' });
  assert.equal((await pending).status, 204);
  assert.equal(f.queries.filter(sql => sql === 'COMMIT').length, 1);
  assert.equal(f.releases.length, 1);
});

test('early release failure reaches caller and returns 500', async (t) => {
  let caught = false;
  const f = await fixture(t, async (req, res) => {
    try { await req.releaseRls(true); } catch (_) { caught = true; }
    res.status(500).json({ message: 'Commit failed' });
  }, async () => { throw new Error('commit failed'); });
  assert.equal((await fetch(f.url)).status, 500);
  assert.equal(caught, true);
  assert.equal(f.releases.length, 1);
});

test('disconnect before response rolls back and releases', { timeout: 5000 }, async (t) => {
  const entered = deferred(), released = deferred();
  const f = await fixture(t, () => entered.resolve(), async sql => {
    released.resolve(sql);
    return { command: sql };
  });
  const req = http.get(f.url);
  req.on('error', () => {});
  await entered.promise;
  req.destroy();
  assert.equal(await released.promise, 'ROLLBACK');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.releases.length, 1);
  assert.equal(f.queries.includes('COMMIT'), false);
});
