const assert = require('node:assert/strict');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

// Load the actual HTML entry and its imports over HTTP. The VM supplies the DOM
// surfaces used at startup, while native ESM handles linking and evaluation.
async function verifyDashboardEntry(pageUrl) {
  const html = await (await fetch(pageUrl)).text();
  const script = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"/);
  assert.ok(script, 'Dashboard HTML must load its ES module entry');
  const app = {};
  const roots = new Map([['#app', app], ['#modal-root', {}], ['#toast-root', {}]]);
  const clicks = [];
  const context = vm.createContext({
    crypto: webcrypto,
    document: {
      querySelector: selector => roots.get(selector),
      addEventListener(type, handler) { if (type === 'click') clicks.push(handler); },
    },
    window: { addEventListener() {} },
    sessionStorage: { getItem() { return null; } },
    location: new URL(pageUrl),
    URLSearchParams,
    MutationObserver: class { observe() {} },
  });

  const modules = new Map();
  async function fetchModule(url) {
    const response = await fetch(url);
    assert.equal(response.status, 200, url);
    assert.match(response.headers.get('content-type'), /javascript/, url);
    return new vm.SourceTextModule(await response.text(), { context, identifier: url });
  }
  function load(specifier, parentUrl) {
    const url = new URL(specifier, parentUrl).href;
    if (!modules.has(url)) modules.set(url, fetchModule(url));
    return modules.get(url);
  }
  const entry = await load(script[1], pageUrl);
  await entry.link((specifier, parent) => load(specifier, parent.identifier));
  await entry.evaluate();
  assert.match(app.innerHTML, /id="login-form"/);

  const tab = { dataset: { authMode: 'register' } };
  const target = { closest: selector => selector === '[data-auth-mode]' ? tab : null };
  for (const handler of clicks) await handler({ target });
  assert.match(app.innerHTML, /id="register-form"/);
}

if (require.main === module && process.argv[2]) {
  verifyDashboardEntry(process.argv[2]).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
