const { adminPool } = require('../config/db');
const { normalizeDomain } = require('../utils/domain');
const { recordAudit } = require('../services/audit.service');
const { deviceOnlineSql } = require('../services/devicePresence.service');

/**
 * GET /api/admin/users
 * Lấy danh sách toàn bộ users trong hệ thống.
 * Chỉ admin mới có quyền truy cập (được enforce bởi requireRole('admin')).
 */
exports.getUsers = async (req, res) => {
  let { limit, offset, search, role, status } = req.query;

  limit = Math.min(parseInt(limit) || 50, 500);
  offset = Math.max(parseInt(offset) || 0, 0);

  const conditions = [];
  const params = [];
  if (search) {
    const normalizedSearch = String(search).trim().substring(0, 100);
    params.push(`%${normalizedSearch}%`);
    conditions.push(`(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  if (role) {
    if (!['parent', 'admin'].includes(role)) {
      return res.status(400).json({ message: 'role must be parent or admin' });
    }
    params.push(role);
    conditions.push(`u.role = $${params.length}::user_role`);
  }
  if (status) {
    if (!['active', 'disabled'].includes(status)) {
      return res.status(400).json({ message: 'status must be active or disabled' });
    }
    params.push(status === 'active');
    conditions.push(`u.is_active = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  const limitPosition = params.length;
  params.push(offset);
  const offsetPosition = params.length;

  try {
    const result = await adminPool.query(
      `SELECT u.user_id, u.name, u.email, u.role, u.is_verified, u.is_active,
              u.created_at,
              (SELECT COUNT(*)::INTEGER FROM children c WHERE c.user_id = u.user_id) AS child_count,
              (SELECT COUNT(*)::INTEGER
                 FROM devices d
                 JOIN children c ON c.child_id = d.child_id
                WHERE c.user_id = u.user_id) AS device_count,
              COUNT(*) OVER()::INTEGER AS total_count
         FROM users u
         ${where}
        ORDER BY u.created_at DESC
        LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
      params
    );

    res.json({
      data: result.rows.map(({ total_count, ...user }) => user),
      total: result.rows[0]?.total_count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Admin getUsers error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * GET /api/admin/stats
 * Thống kê tổng quan hệ thống dành cho admin dashboard.
 * Trả về: tổng users, tổng children, tổng devices, số alerts hôm nay,
 *          số thiết bị đang online (heartbeat trong 5 phút qua).
 */
exports.getStats = async (req, res) => {
  try {
    const result = await adminPool.query(`
      SELECT
        (SELECT COUNT(*) FROM users)    AS total_users,
        (SELECT COUNT(*) FROM children) AS total_children,
        (SELECT COUNT(*) FROM devices)  AS total_devices,
        (SELECT COUNT(*) FROM alerts  WHERE created_at >= CURRENT_DATE) AS alerts_today,
        (SELECT COUNT(*) FROM devices WHERE ${deviceOnlineSql()}) AS devices_online,
        (SELECT COUNT(*) FROM website_blacklist) AS blacklist_count
    `);

    const stats = result.rows[0];

    res.json({
      total_users:     parseInt(stats.total_users)     || 0,
      total_children:  parseInt(stats.total_children)  || 0,
      total_devices:   parseInt(stats.total_devices)   || 0,
      alerts_today:    parseInt(stats.alerts_today)    || 0,
      devices_online:  parseInt(stats.devices_online)  || 0,
      blacklist_count: parseInt(stats.blacklist_count) || 0,
    });
  } catch (error) {
    console.error('Admin getStats error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * GET /api/admin/blacklist
 * Lấy danh sách website blacklist toàn cục (có phân trang).
 * ?search=domain&limit=50&offset=0
 */
exports.getBlacklist = async (req, res) => {
  let { limit, offset, search } = req.query;

  limit  = Math.min(parseInt(limit) || 50, 500);
  offset = Math.max(parseInt(offset) || 0, 0);

  try {
    let result;
    if (search) {
      result = await adminPool.query(
        `SELECT 
           (SELECT COUNT(*) FROM website_blacklist WHERE domain ILIKE $1) AS total,
           COALESCE(json_agg(t), '[]'::json) AS data
         FROM (
           SELECT b.blacklist_id, b.domain, b.reason, b.created_at,
                  u.name AS added_by_name
           FROM website_blacklist b
           LEFT JOIN users u ON b.added_by = u.user_id
           WHERE b.domain ILIKE $1
           ORDER BY b.created_at DESC
           LIMIT $2 OFFSET $3
         ) t`,
        [`%${search}%`, limit, offset]
      );
    } else {
      result = await adminPool.query(
        `SELECT 
           (SELECT COUNT(*) FROM website_blacklist) AS total,
           COALESCE(json_agg(t), '[]'::json) AS data
         FROM (
           SELECT b.blacklist_id, b.domain, b.reason, b.created_at,
                  u.name AS added_by_name
           FROM website_blacklist b
           LEFT JOIN users u ON b.added_by = u.user_id
           ORDER BY b.created_at DESC
           LIMIT $1 OFFSET $2
         ) t`,
        [limit, offset]
      );
    }

    const { total, data } = result.rows[0];

    res.json({
      data,
      total: parseInt(total) || 0,
      limit,
      offset
    });
  } catch (error) {
    console.error('Admin getBlacklist error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * POST /api/admin/blacklist
 * Thêm domain vào danh sách đen toàn cục.
 * Body: { domain, reason }
 */
exports.addBlacklist = async (req, res) => {
  const { domain, reason } = req.body;
  const adminUserId = req.currentUser.user_id;

  if (!domain || typeof domain !== 'string' || domain.trim().length === 0) {
    return res.status(400).json({ message: 'domain is required' });
  }

  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) {
    return res.status(400).json({ message: 'Invalid domain format' });
  }

  if (reason && reason.length > 500) {
    return res.status(400).json({ message: 'Reason cannot exceed 500 characters' });
  }

  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO website_blacklist(domain, reason, added_by)
       VALUES($1, $2, $3)
       RETURNING blacklist_id, domain, reason, created_at`,
      [normalizedDomain, reason?.trim() || null, adminUserId]
    );

    await recordAudit(client, req, {
      action: 'blacklist.add',
      targetType: 'blacklist_domain',
      targetId: result.rows[0].blacklist_id,
      metadata: { domain: result.rows[0].domain },
    });
    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Domain already in blacklist' });
    }
    console.error('Admin addBlacklist error:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
};

const parseUserId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/**
 * GET /api/admin/users/:id
 * Hồ sơ quản trị tổng hợp, không trả password/token/secret.
 */
exports.getUserDetails = async (req, res) => {
  const userId = parseUserId(req.params.id);
  if (!userId) {
    return res.status(400).json({ message: 'User id must be a positive integer' });
  }

  try {
    const [userResult, childrenResult, devicesResult] = await Promise.all([
      adminPool.query(
        `SELECT user_id, name, email, role, is_verified, is_active, created_at
           FROM users WHERE user_id = $1`,
        [userId]
      ),
      adminPool.query(
        `SELECT c.child_id, c.name, c.age, c.created_at,
                COUNT(d.device_id)::INTEGER AS device_count
           FROM children c
           LEFT JOIN devices d ON d.child_id = c.child_id
          WHERE c.user_id = $1
          GROUP BY c.child_id
          ORDER BY c.created_at DESC`,
        [userId]
      ),
      adminPool.query(
        `SELECT d.device_id, d.child_id, d.device_name, d.device_uid,
                d.last_seen_at, d.created_at
           FROM devices d
           JOIN children c ON c.child_id = d.child_id
          WHERE c.user_id = $1
          ORDER BY d.created_at DESC`,
        [userId]
      ),
    ]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      user: userResult.rows[0],
      children: childrenResult.rows,
      devices: devicesResult.rows,
    });
  } catch (error) {
    console.error('Admin getUserDetails error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

/**
 * PATCH /api/admin/users/:id
 * Body cho phép: { role, is_active, is_verified }.
 */
exports.updateUser = async (req, res) => {
  const userId = parseUserId(req.params.id);
  if (!userId) {
    return res.status(400).json({ message: 'User id must be a positive integer' });
  }

  const body = req.body || {};
  const hasRole = Object.prototype.hasOwnProperty.call(body, 'role');
  const hasActive = Object.prototype.hasOwnProperty.call(body, 'is_active');
  const hasVerified = Object.prototype.hasOwnProperty.call(body, 'is_verified');
  const { role, is_active, is_verified } = body;

  if (!hasRole && !hasActive && !hasVerified) {
    return res.status(400).json({ message: 'At least one editable field is required' });
  }
  if (hasRole && !['parent', 'admin'].includes(role)) {
    return res.status(400).json({ message: 'role must be parent or admin' });
  }
  if (hasActive && typeof is_active !== 'boolean') {
    return res.status(400).json({ message: 'is_active must be a boolean' });
  }
  if (hasVerified && typeof is_verified !== 'boolean') {
    return res.status(400).json({ message: 'is_verified must be a boolean' });
  }
  if (userId === req.currentUser.user_id && ((hasRole && role !== 'admin') || (hasActive && !is_active))) {
    return res.status(400).json({ message: 'You cannot demote or disable your own admin account' });
  }

  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query(
      `SELECT user_id, name, email, role, is_verified, is_active
         FROM users WHERE user_id = $1 FOR UPDATE`,
      [userId]
    );
    if (currentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }

    const current = currentResult.rows[0];
    const nextRole = hasRole ? role : current.role;
    const nextActive = hasActive ? is_active : current.is_active;
    const nextVerified = hasVerified ? is_verified : current.is_verified;
    const revokeSessions = nextRole !== current.role || nextActive !== current.is_active;

    const updatedResult = await client.query(
      `UPDATE users
          SET role = $1::user_role,
              is_active = $2,
              is_verified = $3,
              token_version = token_version + $4
        WHERE user_id = $5
        RETURNING user_id, name, email, role, is_verified, is_active, created_at`,
      [nextRole, nextActive, nextVerified, revokeSessions ? 1 : 0, userId]
    );

    if (revokeSessions) {
      await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    }

    const changes = {};
    for (const field of ['role', 'is_active', 'is_verified']) {
      if (current[field] !== updatedResult.rows[0][field]) {
        changes[field] = { from: current[field], to: updatedResult.rows[0][field] };
      }
    }
    await recordAudit(client, req, {
      action: 'user.update',
      targetType: 'user',
      targetId: userId,
      metadata: { email: current.email, changes, sessions_revoked: revokeSessions },
    });
    await client.query('COMMIT');
    res.json(updatedResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Admin updateUser error:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
};

exports.revokeUserSessions = async (req, res) => {
  const userId = parseUserId(req.params.id);
  if (!userId) {
    return res.status(400).json({ message: 'User id must be a positive integer' });
  }

  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE users SET token_version = token_version + 1
        WHERE user_id = $1
        RETURNING user_id, email`,
      [userId]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }
    await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
    await recordAudit(client, req, {
      action: 'user.revoke_sessions',
      targetType: 'user',
      targetId: userId,
      metadata: { email: result.rows[0].email },
    });
    await client.query('COMMIT');
    res.json({ message: 'All user sessions have been revoked', user_id: userId });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Admin revokeUserSessions error:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
};

exports.deleteUser = async (req, res) => {
  const userId = parseUserId(req.params.id);
  if (!userId) {
    return res.status(400).json({ message: 'User id must be a positive integer' });
  }
  if (userId === req.currentUser.user_id) {
    return res.status(400).json({ message: 'You cannot delete your own admin account' });
  }

  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT user_id, name, email, role FROM users WHERE user_id = $1 FOR UPDATE',
      [userId]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }

    const target = result.rows[0];
    await recordAudit(client, req, {
      action: 'user.delete',
      targetType: 'user',
      targetId: userId,
      metadata: { email: target.email, name: target.name, role: target.role },
    });
    await client.query('DELETE FROM users WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
    res.json({ message: 'User and associated data deleted', user_id: userId });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Admin deleteUser error:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
};

/**
 * DELETE /api/admin/blacklist/:id
 * Xóa domain khỏi danh sách đen.
 */
exports.deleteBlacklist = async (req, res) => {
  const { id } = req.params;

  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'DELETE FROM website_blacklist WHERE blacklist_id = $1 RETURNING blacklist_id, domain',
      [id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Blacklist entry not found' });
    }

    await recordAudit(client, req, {
      action: 'blacklist.delete',
      targetType: 'blacklist_domain',
      targetId: result.rows[0].blacklist_id,
      metadata: { domain: result.rows[0].domain },
    });
    await client.query('COMMIT');
    res.json({ message: 'Removed from blacklist', ...result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Admin deleteBlacklist error:', error);
    res.status(500).json({ message: 'Internal server error' });
  } finally {
    client.release();
  }
};

/**
 * GET /api/admin/audit-logs
 * Chỉ admin được phép xem lịch sử hành động nhạy cảm.
 */
exports.getAuditLogs = async (req, res) => {
  let { limit, offset, action, actor_user_id } = req.query;
  limit = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
  offset = Math.max(parseInt(offset) || 0, 0);

  const conditions = [];
  const params = [];
  if (action) {
    params.push(action);
    conditions.push(`action = $${params.length}`);
  }
  if (actor_user_id) {
    const actorId = Number(actor_user_id);
    if (!Number.isInteger(actorId) || actorId <= 0) {
      return res.status(400).json({ message: 'actor_user_id must be a positive integer' });
    }
    params.push(actorId);
    conditions.push(`actor_user_id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  const limitPosition = params.length;
  params.push(offset);
  const offsetPosition = params.length;

  try {
    const result = await adminPool.query(
      `SELECT audit_id, actor_user_id, actor_role, action, target_type,
              target_id, metadata, ip_address, user_agent, created_at,
              COUNT(*) OVER()::INTEGER AS total_count
       FROM audit_logs
       ${where}
       ORDER BY created_at DESC
       LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
      params
    );

    res.json({
      data: result.rows.map(({ total_count, ...row }) => row),
      total: result.rows[0]?.total_count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Admin getAuditLogs error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
