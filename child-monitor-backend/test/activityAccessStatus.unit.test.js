const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ACCESS_STATUS,
  appendAccessStatuses,
  buildDevicePolicyMap,
  normalizeActivityDomain,
  resolveAccessStatus,
  sanitizeActivityPresentation,
} = require('../src/services/activityAccessStatus.service');


test('normalizes website domains consistently with Agent hosts rules', () => {
  assert.equal(normalizeActivityDomain('WWW.GameVui.VN.'), 'gamevui.vn');
  assert.equal(normalizeActivityDomain(''), null);
  assert.equal(normalizeActivityDomain(null), null);
});


test('resolves exactly blocked and open states from current category policies', () => {
  const policies = buildDevicePolicyMap([
    {
      device_id: 7,
      enable_app_classification: true,
      enable_web_classification: true,
      resource_type: 'app',
      category: 'entertainment',
    },
    {
      device_id: 7,
      enable_app_classification: true,
      enable_web_classification: true,
      resource_type: 'web',
      category: 'entertainment',
    },
  ]);

  assert.equal(
    resolveAccessStatus({ device_id: 7, category: 'entertainment' }, 'app', policies),
    ACCESS_STATUS.BLOCKED
  );
  assert.equal(
    resolveAccessStatus({ device_id: 7, category: 'learning' }, 'app', policies),
    ACCESS_STATUS.OPEN
  );
  assert.equal(
    resolveAccessStatus(
      { device_id: 7, domain: 'youtube.com', category: 'entertainment' },
      'web',
      policies
    ),
    ACCESS_STATUS.BLOCKED
  );
  assert.equal(
    resolveAccessStatus(
      { device_id: 7, domain: 'school.example', category: 'education' },
      'web',
      policies
    ),
    ACCESS_STATUS.OPEN
  );
});


test('global blacklist blocks a website even when AI classification is disabled', () => {
  const policies = buildDevicePolicyMap([{
    device_id: 9,
    enable_app_classification: false,
    enable_web_classification: false,
    resource_type: null,
    category: null,
  }]);
  const status = resolveAccessStatus(
    { device_id: 9, url: 'https://www.blocked.example/path', category: 'unknown' },
    'web',
    policies,
    new Set(['blocked.example'])
  );
  assert.equal(status, ACCESS_STATUS.BLOCKED);
});


test('removes the legacy Agent block marker from website presentation', () => {
  const row = sanitizeActivityPresentation({
    domain: 'gamevui.vn',
    page_title: 'Truy cập bị Agent chặn',
  }, 'web');

  assert.equal(row.page_title, null);
  assert.equal(row.domain, 'gamevui.vn');
});


test('appends access_status to existing activity rows without removing them', async () => {
  const queries = [];
  const db = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM devices')) {
        return { rows: [{
          device_id: 6,
          enable_app_classification: false,
          enable_web_classification: true,
          resource_type: 'web',
          category: 'entertainment',
        }] };
      }
      return { rows: [] };
    },
  };
  const rows = await appendAccessStatuses(db, [{
    log_id: 1,
    device_id: 6,
    domain: 'gamevui.vn',
    category: 'entertainment',
  }], 'web');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].log_id, 1);
  assert.equal(rows[0].access_status, 'blocked');
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].params, [[6]]);
});
