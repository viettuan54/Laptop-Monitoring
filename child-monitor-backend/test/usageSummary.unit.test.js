const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  USAGE_TIME_ZONE,
  MAX_VALID_AGENT_SEGMENT_SECONDS,
  IGNORED_LOCK_SCREEN_APPS,
  UsageSummaryValidationError,
  currentMonthInTimeZone,
  parseUsageSummaryFilters,
  getUsageSummary,
} = require('../src/services/usageSummary.service');

test('usage summary validates month and optional identifiers', () => {
  assert.deepEqual(parseUsageSummaryFilters({
    month: '2026-08',
    device_id: '7',
    child_id: '3',
  }), {
    month: '2026-08',
    deviceId: 7,
    childId: 3,
  });

  for (const month of ['0000-01', '1999-12', '2026-00', '2026-13', '2101-01', '26-08']) {
    assert.throws(
      () => parseUsageSummaryFilters({ month }),
      UsageSummaryValidationError,
      `expected invalid month: ${month}`
    );
  }
  for (const device_id of ['0', '-1', '1.5', 'abc', '2147483648', ['1', '2']]) {
    assert.throws(
      () => parseUsageSummaryFilters({ month: '2026-08', device_id }),
      UsageSummaryValidationError,
      `expected invalid device_id: ${device_id}`
    );
  }
});

test('usage summary defaults month using the Vietnam calendar', () => {
  const instant = new Date('2026-08-31T18:00:00.000Z');
  assert.equal(currentMonthInTimeZone(instant), '2026-09');
  assert.equal(parseUsageSummaryFilters({}, instant).month, '2026-09');
});

test('usage summary maps zero-filled daily rows and exposes ignored Agent segments', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [
          {
            date: '2026-08-01',
            duration_seconds: '0',
            month_total_seconds: '90',
            local_today: '2026-08-02',
            ignored_segment_count: 2,
          },
          {
            date: '2026-08-02',
            duration_seconds: '90',
            month_total_seconds: '90',
            local_today: '2026-08-02',
            ignored_segment_count: 2,
          },
        ],
      };
    },
  };

  const summary = await getUsageSummary(db, {
    month: '2026-08',
    deviceId: 7,
    childId: null,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [
    '2026-08',
    USAGE_TIME_ZONE,
    7,
    null,
    MAX_VALID_AGENT_SEGMENT_SECONDS,
    IGNORED_LOCK_SCREEN_APPS,
  ]);
  assert.match(calls[0].sql, /generate_series/i);
  assert.match(calls[0].sql, /LEAST\(segment\.segment_end, day\.day_end\)/);
  assert.match(calls[0].sql, /FROM app_usage/);
  assert.match(calls[0].sql, /lower\(usage\.app_name\) = ANY/);
  assert.doesNotMatch(calls[0].sql, /website_logs/);
  assert.deepEqual(summary.daily, [
    { date: '2026-08-01', duration_seconds: 0 },
    { date: '2026-08-02', duration_seconds: 90 },
  ]);
  assert.equal(summary.month_total_seconds, 90);
  assert.equal(summary.today_seconds, 90);
  assert.equal(summary.ignored_segment_count, 2);
  assert.equal(summary.max_valid_agent_segment_seconds, 120);
});
