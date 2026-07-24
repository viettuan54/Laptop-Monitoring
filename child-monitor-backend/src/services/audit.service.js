const MAX_USER_AGENT_LENGTH = 500;

async function recordAudit(db, req, {
  action,
  targetType,
  targetId = null,
  metadata = {},
  actorUserId = null,
  actorRole = null,
}) {
  const actor = req.currentUser || req.user;
  const resolvedActorId = actorUserId || actor?.user_id;
  const resolvedActorRole = actorRole || actor?.role || req.currentUser?.role;
  if (!resolvedActorId) {
    throw new Error('Authenticated actor is required for audit logging');
  }

  await db.query(
    `INSERT INTO audit_logs(
       actor_user_id, actor_role, action, target_type, target_id,
       metadata, ip_address, user_agent
     )
     VALUES($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [
      resolvedActorId,
      resolvedActorRole || 'unknown',
      action,
      targetType,
      targetId === null ? null : String(targetId).substring(0, 200),
      JSON.stringify(metadata || {}),
      req.ip || null,
      req.get?.('user-agent')?.substring(0, MAX_USER_AGENT_LENGTH) || null,
    ]
  );
}

module.exports = { recordAudit };
