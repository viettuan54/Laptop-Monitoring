const {test} = require('node:test');
const assert = require('node:assert/strict');
const {PolicyController, blockedHost, validatePolicy} = require('../browser-extension/policy.js');

function fixture() {
  const tabs = new Map([[1, {id: 1, url: 'https://gamevui.vn/game'}],
                        [2, {id: 2, url: 'https://school.example/'}]]);
  let rules = [];
  let fail = false;
  const api = {
    declarativeNetRequest: {
      getDynamicRules: async () => rules,
      updateDynamicRules: async update => {
        if (fail) throw new Error('browser rejected update');
        rules = update.addRules;
      },
    },
    storage: {local: {set: async () => {}}},
    tabs: {
      query: async () => [...tabs.values()],
      get: async id => tabs.get(id),
      update: async (id, value) => tabs.set(id, {...tabs.get(id), ...value}),
    },
    runtime: {getURL: file => 'chrome-extension://test/' + file},
  };
  return {controller: new PolicyController(api), tabs, api,
    rules: () => rules, fail: value => { fail = value; }};
}
const snapshot = (revision, domains) => ({version: 1, revision, blocked_domains: domains});

test('block -> allow -> block replaces rules and redirects an already-open cached tab', async () => {
  const f = fixture();
  for (let iteration = 0; iteration < 3; iteration++) {
    await f.controller.apply(snapshot('allow', []));
    assert.deepEqual(f.rules(), []);
    f.tabs.get(1).url = 'https://gamevui.vn/game';
    await f.controller.apply(snapshot('block', ['gamevui.vn']));
    assert.match(f.tabs.get(1).url, /blocked.html#host=gamevui.vn/);
    assert.equal(f.tabs.get(2).url, 'https://school.example/');
    assert.deepEqual(f.rules()[0].condition.requestDomains, ['gamevui.vn']);
    assert.ok(f.rules()[0].condition.resourceTypes.includes('main_frame'));
  }
});
test('same policy still handles restored/back-forward tabs', async () => {
  const f = fixture();
  const p = snapshot('a', ['gamevui.vn']);
  await f.controller.apply(p);
  f.tabs.get(1).url = 'https://gamevui.vn/cached';
  await f.controller.apply(p);
  assert.match(f.tabs.get(1).url, /blocked.html/);
});
test('failed update retains old applied revision and is retryable', async () => {
  const f = fixture();
  await f.controller.apply(snapshot('a', ['gamevui.vn']));
  f.fail(true);
  await assert.rejects(f.controller.apply(snapshot('b', [])));
  assert.equal(f.controller.revision, 'a');
  assert.equal(f.rules().length, 2);
  f.fail(false);
  await f.controller.apply(snapshot('b', []));
  assert.equal(f.controller.revision, 'b');
  assert.deepEqual(f.rules(), []);
});
test('domain matching covers subdomains but not lookalikes or extension pages', () => {
  for (const url of ['https://gamevui.vn', 'https://www.gamevui.vn', 'https://m.gamevui.vn.']) {
    assert.ok(blockedHost(url, ['gamevui.vn']));
  }
  for (const url of ['https://notgamevui.vn', 'https://gamevui.vn.evil.test',
    'chrome-extension://test/blocked.html', 'javascript:alert(1)']) {
    assert.equal(blockedHost(url, ['gamevui.vn']), null);
  }
});
test('malformed snapshots never silently clear rules', () => {
  for (const p of [null, {}, snapshot('a', ['*']), snapshot('a', ['x..test']),
    snapshot('a', ['https://gamevui.vn'])]) assert.throws(() => validatePolicy(p));
});
test('tab navigation uses current URL rather than stale query results', async () => {
  const f = fixture();
  f.api.tabs.query = async () => {
    const stale = {...f.tabs.get(1)};
    f.tabs.get(1).url = 'https://school.example/new';
    return [stale];
  };
  await f.controller.apply(snapshot('a', ['gamevui.vn']));
  assert.equal(f.tabs.get(1).url, 'https://school.example/new');
});
