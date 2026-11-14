const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const net = require('node:net');
const { once } = require('node:events');
const { spawn } = require('node:child_process');

function fixture(overrides = {}, env = {}) {
  let options;
  const client = {
    isOpen: false, destroyed: 0, connects: 0, pings: 0,
    on() {},
    async connect() { this.connects++; this.isOpen = true; },
    async ping() { this.pings++; return 'PONG'; },
    destroy() { this.destroyed++; this.isOpen = false; },
    ...overrides,
  };
  const box = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/config/redis.js'), 'utf8'), {
    module: box, process: { env: { REDIS_URL: 'redis://127.0.0.1:6379', REDIS_STARTUP_TIMEOUT_MS: '100', ...env } },
    require: name => name === 'redis' ? { createClient: config => { options = config; return client; } } : { RedisStore: class {} },
    console: { log() {}, warn() {}, error() {} }, URL, setTimeout, clearTimeout,
  });
  return { api: box.exports, client, options };
}

test('concurrent Redis initialization connects and pings once; runtime reconnect remains enabled', async () => {
  const { api, client, options } = fixture();
  assert.deepEqual(await Promise.all([api.initializeRedis(), api.initializeRedis()]), [true, true]);
  assert.equal(client.connects, 1);
  assert.equal(client.pings, 1);
  assert.equal(options.socket.reconnectStrategy(100), 3000);
  await api.closeRedis();
  await api.closeRedis();
  assert.equal(client.destroyed, 1);
  assert.equal(options.socket.reconnectStrategy(100), false);
});

test('startup deadline also covers an unresponsive PING and stops reconnects', async () => {
  const { api, client, options } = fixture({ ping: () => new Promise(() => {}) });
  await assert.rejects(api.initializeRedis(), /Redis startup timed out after 100ms/);
  assert.equal(client.destroyed, 1);
  assert.equal(options.socket.reconnectStrategy(0), false);
  await api.closeRedis();
  assert.equal(client.destroyed, 1);
});

test('immediate startup errors are propagated and cleaned up', async () => {
  const { api, client } = fixture({ async ping() { throw new Error('authentication rejected'); } });
  await assert.rejects(api.initializeRedis(), /authentication rejected/);
  assert.equal(client.destroyed, 1);
});

test('missing Redis configuration still fails in production and permits development fallback', async () => {
  await assert.rejects(fixture({}, { REDIS_URL: '', NODE_ENV: 'production' }).api.initializeRedis(), /required in production/);
  const { api } = fixture({}, { REDIS_URL: '', NODE_ENV: 'development' });
  assert.equal(await api.initializeRedis(), false);
  assert.equal(api.createRateLimitStore('test'), undefined);
});

test('invalid startup deadlines fail configuration validation', () => {
  for (const value of ['0', '-1', 'NaN', 'Infinity', '1.5', '120001']) {
    assert.throws(() => fixture({}, { REDIS_STARTUP_TIMEOUT_MS: value }), /must be an integer/);
  }
});

async function runUnavailableClient(port) {
  const child = spawn(process.execPath, ['-e', `
    const redis = require('./src/config/redis');
    redis.initializeRedis().then(() => { process.exitCode = 2; }).catch(async error => {
      console.error(error.message);
      await redis.closeRedis();
      process.exitCode = 1;
    });
  `], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, REDIS_URL: `redis://127.0.0.1:${port}`, REDIS_STARTUP_TIMEOUT_MS: '200', NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  let killed = false;
  const timer = setTimeout(() => { killed = true; child.kill(); }, 5000);
  try {
    const [code] = await once(child, 'exit');
    assert.equal(killed, false, 'Redis must not keep the process alive after startup failure');
    assert.equal(code, 1, output);
    assert.match(output, /Redis startup timed out after 200ms/);
    assert.doesNotMatch(output, /distributed rate limiting is active/);
  } finally { clearTimeout(timer); }
}

test('real Redis client exits when connection is refused', { timeout: 7000 }, async () => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  await runUnavailableClient(port);
});

test('real Redis client exits when TCP connects but Redis handshake never responds', { timeout: 7000 }, async (t) => {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('data', () => {});
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    for (const socket of sockets) socket.destroy();
    server.close(resolve);
  }));
  await runUnavailableClient(server.address().port);
});
