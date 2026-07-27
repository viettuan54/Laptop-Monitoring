const { adminPool } = require('../config/db');
const {
  sendPushNotification,
  validatePushToken,
} = require('../services/notification.service');

const VALID_PROVIDERS = new Set(['fcm', 'expo']);
const VALID_PLATFORMS = new Set(['android', 'ios', 'web']);

function serializeToken(row) {
  const token = String(row.token || '');
  const tokenHint = token.length > 14
    ? `${token.slice(0, 7)}…${token.slice(-6)}`
    : '••••••';
  return {
    push_token_id: row.push_token_id,
    provider: row.provider,
    platform: row.platform,
    device_name: row.device_name,
    token_hint: tokenHint,
    is_active: row.is_active,
    failure_count: row.failure_count,
    last_error: row.last_error,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

exports.getTokens = async (req, res) => {
  try {
    const result = await adminPool.query(
      `SELECT push_token_id, provider, platform, device_name, token,
              is_active, failure_count, last_error, last_used_at, created_at, updated_at
       FROM push_tokens
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [req.user.user_id]
    );
    res.json({ data: result.rows.map(serializeToken) });
  } catch (error) {
    console.error('Get push tokens error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.registerToken = async (req, res) => {
  const body = req.body || {};
  const provider = typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : '';
  const platform = typeof body.platform === 'string' ? body.platform.trim().toLowerCase() : '';
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const deviceName = typeof body.device_name === 'string' ? body.device_name.trim() : '';

  if (!VALID_PROVIDERS.has(provider)) {
    return res.status(400).json({ message: 'provider must be fcm or expo' });
  }
  if (!VALID_PLATFORMS.has(platform)) {
    return res.status(400).json({ message: 'platform must be android, ios, or web' });
  }
  if (provider === 'expo' && platform === 'web') {
    return res.status(400).json({ message: 'Expo push tokens only support android or ios' });
  }
  if (!validatePushToken(provider, token)) {
    return res.status(400).json({ message: `Invalid ${provider.toUpperCase()} push token` });
  }
  if (deviceName.length > 100) {
    return res.status(400).json({ message: 'device_name must not exceed 100 characters' });
  }

  try {
    const result = await adminPool.query(
      `INSERT INTO push_tokens(user_id, provider, platform, token, device_name)
       VALUES($1, $2, $3, $4, NULLIF($5, ''))
       ON CONFLICT (provider, token) DO UPDATE
       SET platform = EXCLUDED.platform,
           device_name = EXCLUDED.device_name,
           is_active = TRUE,
           failure_count = 0,
           last_error = NULL
       WHERE push_tokens.user_id = EXCLUDED.user_id
       RETURNING push_token_id, provider, platform, device_name, token,
                 is_active, failure_count, last_error, last_used_at, created_at, updated_at`,
      [req.user.user_id, provider, platform, token, deviceName]
    );

    if (!result.rows.length) {
      return res.status(409).json({ message: 'This push token is already registered to another account' });
    }
    res.status(201).json({
      message: 'Push token registered',
      token: serializeToken(result.rows[0]),
    });
  } catch (error) {
    console.error('Register push token error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.deleteToken = async (req, res) => {
  const tokenId = Number(req.params.id);
  if (!Number.isInteger(tokenId) || tokenId <= 0) {
    return res.status(400).json({ message: 'Invalid push token id' });
  }

  try {
    const result = await adminPool.query(
      `DELETE FROM push_tokens
       WHERE push_token_id = $1 AND user_id = $2
       RETURNING push_token_id`,
      [tokenId, req.user.user_id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ message: 'Push token not found' });
    }
    res.json({ message: 'Push token removed' });
  } catch (error) {
    console.error('Delete push token error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

exports.sendTest = async (req, res) => {
  try {
    const result = await sendPushNotification(
      req.user.user_id,
      'Thông báo thử nghiệm SafeNest',
      'Thiết bị của bạn đã kết nối nhận thông báo thành công.',
      { type: 'test', route: 'alerts' }
    );

    if (!result.enabled) {
      return res.status(503).json({
        message: 'Push notifications are disabled on the server',
        delivery: result,
      });
    }
    if (result.requested === 0) {
      return res.status(404).json({
        message: 'No active push token is registered',
        delivery: result,
      });
    }

    const status = result.sent > 0 ? (result.failed > 0 || result.skipped > 0 ? 207 : 200) : 502;
    return res.status(status).json({
      message: result.sent > 0 ? 'Test notification accepted by push provider' : 'Push provider rejected the test notification',
      delivery: result,
    });
  } catch (error) {
    console.error('Send test notification error:', error);
    res.status(502).json({ message: 'Push provider is unavailable' });
  }
};

module.exports._private = { serializeToken };
