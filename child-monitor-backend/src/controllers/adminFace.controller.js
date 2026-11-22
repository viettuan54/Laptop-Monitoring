const crypto = require('crypto');
const { adminPool } = require('../config/db');
const { recordAudit } = require('../services/audit.service');
const { verifyAdminFace, hasDuplicateFace, REQUIRED_FRAME_COUNT, FaceAuthUnavailableError } = require('../services/faceAuth.service');
const { lockAdminLifecycle } = require('../services/adminLifecycle.service');

const fingerprint = req => ({
  ip: String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 200),
  ua: crypto.createHash('sha256').update(req.get?.('user-agent') || '').digest('hex'),
});

// Browser-supplied user_id/mode/embedding are deliberately ignored.
exports.completeFaceLogin = async (req, res, { issueSession, handleFailedAttempt }) => {
  const { challenge, frames } = req.body || {};
  if (typeof challenge !== 'string' || !/^[a-f0-9]{64}$/i.test(challenge)) {
    return res.status(400).json({ message: 'Invalid face verification challenge' });
  }
  if (!Array.isArray(frames) || frames.length !== REQUIRED_FRAME_COUNT) {
    return res.status(400).json({ message: `Exactly ${REQUIRED_FRAME_COUNT} camera frames are required` });
  }
  const hash = crypto.createHash('sha256').update(challenge).digest('hex');
  const { ip, ua } = fingerprint(req);
  let client;
  try {
    const claimed = await adminPool.query(
      `UPDATE admin_face_challenges SET attempts=attempts+1
       WHERE challenge_hash=$1 AND expires_at>NOW() AND attempts<3
         AND ip_address=$2 AND user_agent_hash=$3
       RETURNING user_id, purpose, face_version, token_version, attempts`, [hash, ip, ua]
    );
    const claim = claimed.rows[0];
    if (!claim) return res.status(401).json({ message: 'Face verification challenge is invalid or expired' });
    const snapshot = (await adminPool.query(
      `SELECT user_id, email, role, is_active, is_verified, token_version, face_version, face_enrolled
       FROM users WHERE user_id=$1`, [claim.user_id]
    )).rows[0];
    const eligible = user => user && user.role === 'admin' && user.is_active && user.is_verified
      && user.token_version === claim.token_version && user.face_version === claim.face_version
      && claim.purpose === (user.face_enrolled ? 'verify' : 'enroll');
    if (!eligible(snapshot)) return res.status(401).json({ message: 'Face verification challenge is invalid or expired' });
    let template = null;
    if (claim.purpose === 'verify') {
      template = (await adminPool.query('SELECT embedding, model_id FROM admin_face_templates WHERE user_id=$1', [claim.user_id])).rows[0];
      if (!template) throw new FaceAuthUnavailableError('Face template missing');
    }
    let result;
    try {
      result = await verifyAdminFace(frames, template);
    } catch (error) {
      if (error instanceof TypeError) return res.status(400).json({ message: 'Invalid camera frames', attemptsRemaining: Math.max(0, 3 - claim.attempts) });
      if (error instanceof FaceAuthUnavailableError) {
        await adminPool.query('UPDATE admin_face_challenges SET attempts=GREATEST(0,attempts-1) WHERE challenge_hash=$1', [hash]);
      }
      throw error;
    }
    if (!result.accepted) {
      await handleFailedAttempt(snapshot.email);
      return res.status(401).json({ message: 'Face verification failed', attemptsRemaining: Math.max(0, 3 - claim.attempts) });
    }
    client = await adminPool.connect();
    await client.query('BEGIN');
    // Serialize cross-account enrollment checks with enrollment/reset/deletion.
    // Without this lock two accounts could both see no matching template.
    if (claim.purpose === 'enroll') await lockAdminLifecycle(client);
    // Lock owner before challenge/template; reset and enrollment follow this order.
    const user = (await client.query(
      `SELECT user_id, email, role, is_active, is_verified, token_version, face_version, face_enrolled
       FROM users WHERE user_id=$1 FOR UPDATE`, [claim.user_id]
    )).rows[0];
    if (!eligible(user)) {
      await client.query('ROLLBACK');
      return res.status(401).json({ message: 'Face verification challenge is invalid or expired' });
    }
    const consumed = await client.query(
      `DELETE FROM admin_face_challenges WHERE challenge_hash=$1 AND user_id=$2
        AND expires_at>NOW() AND purpose=$3 AND face_version=$4 AND token_version=$5
       RETURNING user_id`, [hash, user.user_id, claim.purpose, claim.face_version, claim.token_version]
    );
    if (!consumed.rows.length) {
      await client.query('ROLLBACK');
      return res.status(401).json({ message: 'Face verification challenge has already been used' });
    }
    if (claim.purpose === 'enroll') {
      const others = await client.query(
        'SELECT embedding, model_id FROM admin_face_templates WHERE user_id <> $1', [user.user_id]
      );
      if (hasDuplicateFace(result, others.rows)) {
        // Restore the consumed challenge so a different face can be captured.
        // The attempt increment was committed before inference and remains counted.
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'FACE_ALREADY_ENROLLED',
          message: 'Face already enrolled on another account',
          attemptsRemaining: Math.max(0, 3 - claim.attempts),
        });
      }
      // INSERT only: never upsert/overwrite a previously enrolled identity.
      await client.query('INSERT INTO admin_face_templates(user_id,embedding,model_id) VALUES($1,$2::jsonb,$3)',
        [user.user_id, JSON.stringify(result.embedding), result.model_id]);
      await client.query('UPDATE users SET face_enrolled=true,face_version=face_version+1 WHERE user_id=$1', [user.user_id]);
    }
    await recordAudit(client, req, {
      action: claim.purpose === 'enroll' ? 'auth.admin_face_enrolled' : 'auth.admin_face_verified',
      targetType: 'user', targetId: user.user_id, actorUserId: user.user_id, actorRole: 'admin',
      metadata: { method: 'facenet_cosine_1to1', frames: REQUIRED_FRAME_COUNT },
    });
    const session = await issueSession(user, client);
    await client.query('DELETE FROM failed_login_attempts WHERE email=$1', [user.email]);
    await client.query('COMMIT');
    return res.json({ ...session, faceVerified: true, faceEnrolled: true });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error instanceof FaceAuthUnavailableError) return res.status(503).json({
      code: error.code === 'FACE_RUNTIME_BLOCKED' ? 'FACE_RUNTIME_BLOCKED' : 'FACE_AUTH_UNAVAILABLE',
      message: error.code === 'FACE_RUNTIME_BLOCKED'
        ? 'Face recognition runtime is blocked by Windows Application Control'
        : 'Face recognition service is unavailable',
    });
    console.error('Face login failed:', error.code || error.name);
    return res.status(500).json({ message: 'Internal server error' });
  } finally {
    client?.release();
  }
};
