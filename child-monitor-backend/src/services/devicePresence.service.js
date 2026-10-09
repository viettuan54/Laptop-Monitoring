// All device surfaces use the database clock and the same heartbeat window.
// The Agent sends a heartbeat every 60 seconds; allow five minutes for retries.
const DEVICE_ONLINE_SECONDS = 5 * 60;

function deviceOnlineSql(alias = '') {
  if (alias && !/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new TypeError('Invalid SQL alias');
  const column = `${alias ? `${alias}.` : ''}last_seen_at`;
  return `COALESCE(${column} > NOW() - INTERVAL '${DEVICE_ONLINE_SECONDS} seconds', FALSE)`;
}

module.exports = { DEVICE_ONLINE_SECONDS, deviceOnlineSql };
