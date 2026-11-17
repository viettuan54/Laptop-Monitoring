const bcrypt = require('bcrypt');
const { adminPool } = require('../config/db');
const { lockAdminLifecycle } = require('../services/adminLifecycle.service');
const { recordAudit } = require('../services/audit.service');

module.exports = async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0 || id === req.currentUser.user_id) {
    return res.status(400).json({ message: 'Only another admin can reset your face data' });
  }
  if (typeof req.body?.password !== 'string' || !req.body.password || req.body.password.length > 128) {
    return res.status(400).json({ message: 'Your password is required to reset face data' });
  }
  let client;
  try {
    client = await adminPool.connect();
    await client.query('BEGIN');
    await lockAdminLifecycle(client);
    const actor = (await client.query(
      `SELECT password, role, is_active, is_verified, face_enrolled, token_version
       FROM users WHERE user_id=$1 FOR UPDATE`, [req.currentUser.user_id]
    )).rows[0];
    if (!actor || actor.role !== 'admin' || !actor.is_active || !actor.is_verified || !actor.face_enrolled
        || actor.token_version !== req.user.token_version || !(await bcrypt.compare(req.body.password, actor.password))) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'Password or admin session is invalid' });
    }
    const target = await client.query(
      `UPDATE users SET face_enrolled=false, face_version=face_version+1, token_version=token_version+1
       WHERE user_id=$1 AND role='admin' RETURNING user_id`, [id]
    );
    if (!target.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Admin account not found' });
    }
    await client.query('DELETE FROM admin_face_templates WHERE user_id=$1', [id]);
    await client.query('DELETE FROM admin_face_challenges WHERE user_id=$1', [id]);
    await client.query('DELETE FROM refresh_tokens WHERE user_id=$1', [id]);
    await recordAudit(client, req, {
      action: 'user.face_reset', targetType: 'user', targetId: id,
      metadata: { sessions_revoked: true, reenrollment_required: true },
    });
    await client.query('COMMIT');
    return res.json({ user_id: id, face_enrolled: false, message: 'Face data reset. Enrollment required at next login' });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('Face reset failed:', error.code || error.name);
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    client?.release();
  }
};
