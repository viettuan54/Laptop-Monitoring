// PostgreSQL numeric values may arrive as strings. Missing or invalid durations
// must not become measured time or be inferred from the number of sessions.
function normalizeDurationSeconds(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function summarizeActivityDurations(logs, categories) {
  const groups = new Map(categories.map((category) => [category, {
    category,
    session_count: 0,
    sessions_without_duration: 0,
    duration_seconds: 0,
  }]));
  let totalDuration = 0;
  let sessionsWithoutDuration = 0;

  // Aggregate every row before selecting representative sessions for the prompt.
  for (const log of logs) {
    const group = groups.get(log.category) || groups.get('unknown');
    const duration = normalizeDurationSeconds(log.duration_seconds);
    group.session_count++;
    if (duration === null) {
      group.sessions_without_duration++;
      sessionsWithoutDuration++;
    } else {
      group.duration_seconds += duration;
      totalDuration += duration;
    }
  }

  return {
    session_count: logs.length,
    sessions_without_duration: sessionsWithoutDuration,
    total_duration_seconds: totalDuration,
    categories: [...groups.values()].map((group) => ({
      ...group,
      // Include every category in the denominator, including unknown/browsers.
      percentage_of_total_duration: totalDuration > 0
        ? Math.round(group.duration_seconds / totalDuration * 1000) / 10
        : null,
    })),
  };
}

module.exports = { normalizeDurationSeconds, summarizeActivityDurations };
