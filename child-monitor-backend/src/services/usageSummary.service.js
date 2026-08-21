'use strict';

const { MAX_APP_USAGE_SEGMENT_SECONDS } = require('../utils/validation');

const USAGE_TIME_ZONE = 'Asia/Ho_Chi_Minh';

// AppTracker flushes the current foreground application every 30 seconds.
// Four flush windows allow for normal scheduler/IPC delays. Historical Agent
// rows produced during suspend/lock, including Windows lock-screen processes,
// are excluded from summaries while their raw records remain preserved.
const MAX_VALID_AGENT_SEGMENT_SECONDS = MAX_APP_USAGE_SEGMENT_SECONDS;
const MAX_POSTGRES_INTEGER = 2147483647;
const IGNORED_LOCK_SCREEN_APPS = Object.freeze(['lockapp.exe', 'logonui.exe']);
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;

class UsageSummaryValidationError extends Error {}

function currentMonthInTimeZone(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: USAGE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}`;
}

function parseOptionalPositiveInteger(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value) || !POSITIVE_INTEGER_PATTERN.test(String(value))) {
    throw new UsageSummaryValidationError(`${fieldName} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_POSTGRES_INTEGER) {
    throw new UsageSummaryValidationError(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function parseUsageSummaryFilters(query = {}, now = new Date()) {
  const month = query.month === undefined || query.month === ''
    ? currentMonthInTimeZone(now)
    : String(query.month);
  const monthMatch = Array.isArray(query.month) ? null : MONTH_PATTERN.exec(month);
  const year = monthMatch ? Number(monthMatch[1]) : 0;
  if (!monthMatch || year < 2000 || year > 2100) {
    throw new UsageSummaryValidationError(
      'month must use YYYY-MM format with year between 2000 and 2100'
    );
  }

  return {
    month,
    deviceId: parseOptionalPositiveInteger(query.device_id, 'device_id'),
    childId: parseOptionalPositiveInteger(query.child_id, 'child_id'),
  };
}

// Build local civil-day boundaries and convert each one to an absolute instant.
// Each foreground segment is intersected with every day it overlaps, so a segment
// crossing 00:00 is divided instead of being assigned wholly to its start date.
const USAGE_SUMMARY_SQL = `
  WITH input AS (
    SELECT
      to_date($1 || '-01', 'YYYY-MM-DD') AS month_start,
      (to_date($1 || '-01', 'YYYY-MM-DD') + INTERVAL '1 month')::date AS month_end
  ), bounds AS (
    SELECT
      input.*,
      timezone($2, input.month_start::timestamp) AS month_start_utc,
      timezone($2, input.month_end::timestamp) AS month_end_utc
    FROM input
  ), days AS (
    SELECT
      generated.day_local::date AS usage_date,
      timezone($2, generated.day_local) AS day_start,
      timezone($2, generated.day_local + INTERVAL '1 day') AS day_end
    FROM bounds
    CROSS JOIN LATERAL generate_series(
      bounds.month_start::timestamp,
      (bounds.month_end - 1)::timestamp,
      INTERVAL '1 day'
    ) AS generated(day_local)
  ), raw_segments AS (
    SELECT
      usage.start_time AS segment_start,
      usage.start_time + usage.duration_seconds * INTERVAL '1 second' AS segment_end,
      (
        usage.duration_seconds > $5::int
        OR lower(usage.app_name) = ANY($6::text[])
      ) AS is_ignored
    FROM app_usage AS usage
    JOIN devices AS device ON device.device_id = usage.device_id
    CROSS JOIN bounds
    WHERE usage.duration_seconds > 0
      AND ($3::int IS NULL OR usage.device_id = $3::int)
      AND ($4::int IS NULL OR device.child_id = $4::int)
      AND usage.start_time < bounds.month_end_utc
      AND usage.start_time + usage.duration_seconds * INTERVAL '1 second'
            > bounds.month_start_utc
  ), valid_segments AS (
    SELECT segment_start, segment_end
    FROM raw_segments
    WHERE NOT is_ignored
  ), daily AS (
    SELECT
      day.usage_date,
      COALESCE(
        ROUND(SUM(EXTRACT(EPOCH FROM (
          LEAST(segment.segment_end, day.day_end)
          - GREATEST(segment.segment_start, day.day_start)
        ))) FILTER (WHERE segment.segment_start IS NOT NULL)),
        0
      )::bigint AS duration_seconds
    FROM days AS day
    LEFT JOIN valid_segments AS segment
      ON segment.segment_start < day.day_end
     AND segment.segment_end > day.day_start
    GROUP BY day.usage_date
  ), quality AS (
    SELECT COUNT(*) FILTER (WHERE is_ignored)::int AS ignored_segment_count
    FROM raw_segments
  )
  SELECT
    to_char(daily.usage_date, 'YYYY-MM-DD') AS date,
    daily.duration_seconds,
    SUM(daily.duration_seconds) OVER ()::bigint AS month_total_seconds,
    to_char(CURRENT_TIMESTAMP AT TIME ZONE $2, 'YYYY-MM-DD') AS local_today,
    quality.ignored_segment_count
  FROM daily
  CROSS JOIN quality
  ORDER BY daily.usage_date
`;

async function getUsageSummary(db, filters) {
  const result = await db.query(USAGE_SUMMARY_SQL, [
    filters.month,
    USAGE_TIME_ZONE,
    filters.deviceId,
    filters.childId,
    MAX_VALID_AGENT_SEGMENT_SECONDS,
    IGNORED_LOCK_SCREEN_APPS,
  ]);

  const daily = result.rows.map((row) => ({
    date: row.date,
    duration_seconds: Number(row.duration_seconds) || 0,
  }));
  const firstRow = result.rows[0];
  const localToday = firstRow?.local_today;

  return {
    month: filters.month,
    timezone: USAGE_TIME_ZONE,
    device_id: filters.deviceId,
    child_id: filters.childId,
    daily,
    month_total_seconds: Number(firstRow?.month_total_seconds) || 0,
    today_seconds: daily.find((item) => item.date === localToday)?.duration_seconds || 0,
    ignored_segment_count: Number(firstRow?.ignored_segment_count) || 0,
    max_valid_agent_segment_seconds: MAX_VALID_AGENT_SEGMENT_SECONDS,
  };
}

module.exports = {
  USAGE_TIME_ZONE,
  MAX_VALID_AGENT_SEGMENT_SECONDS,
  IGNORED_LOCK_SCREEN_APPS,
  USAGE_SUMMARY_SQL,
  UsageSummaryValidationError,
  currentMonthInTimeZone,
  parseUsageSummaryFilters,
  getUsageSummary,
};
