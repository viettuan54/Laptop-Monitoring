import { escapeHtml } from './format.js';

const USAGE_TIME_ZONE = 'Asia/Ho_Chi_Minh';

function formatDate(value, withTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: USAGE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function localMonthKey(date = new Date()) {
  return localDateKey(date).slice(0, 7);
}

function localDateFromKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day, 12));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === monthIndex
    && date.getUTCDate() === day
    ? date
    : null;
}

function shiftLocalDateKey(value, days) {
  const date = localDateFromKey(value);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + days);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyUsageSummary(month = localMonthKey()) {
  return {
    month,
    timezone: '',
    daily: [],
    recent_daily: [],
    month_total_seconds: 0,
    today_seconds: 0,
    ignored_segment_count: 0,
    max_valid_agent_segment_seconds: 0,
  };
}

function currentDateLabel(date = new Date()) {
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export {
  currentDateLabel,
  emptyUsageSummary,
  formatDate,
  localDateFromKey,
  localDateKey,
  localMonthKey,
  shiftLocalDateKey,
};
