const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const path = require('node:path');

function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: requestPath }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', reject);
    });
    req.setTimeout(3000, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });
}

test('malformed static URLs return 400 and leave the web server running', { timeout: 15000 }, async (t) => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, WEB_PORT: '0', API_TARGET: 'http://127.0.0.1:3000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  });
  const port = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Server startup timed out')), 5000);
    const fail = (error) => { clearTimeout(timer); reject(error); };
    child.once('error', fail);
    child.once('exit', (code) => fail(new Error(`Server exited: ${code}; ${stderr}`)));
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/SafeNest dashboard: http:\/\/localhost:(\d+)/);
      if (match) { clearTimeout(timer); resolve(Number(match[1])); }
    });
  });

  for (const malformed of ['/%ZZ', '/%', '/%2', '/%E0%A4%A', '/%FF', '/%00']) {
    const response = await request(port, malformed);
    assert.equal(response.status, 400, malformed);
    assert.equal(response.body, 'Bad request');
    assert.equal((await request(port, '/healthz')).status, 200);
    const home = await request(port, '/');
    assert.equal(home.status, 200);
    assert.match(home.body, /<html/i);
  }

  assert.equal((await request(port, '/%61pp.js')).status, 200);
  assert.equal((await request(port, '/?q=%ZZ')).status, 200);
  assert.equal((await request(port, '/missing-file.css')).status, 404);
  assert.equal((await request(port, '/%2e%2e/README.md')).status, 403);
  assert.equal(child.exitCode, null);
  assert.equal(stderr, '');
});
