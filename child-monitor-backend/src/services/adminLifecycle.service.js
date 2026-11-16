// All account removal/role changes must acquire this transaction-scoped lock
// before locking user rows. It prevents concurrent operations removing the
// final administrator after both have counted the other one.
async function lockAdminLifecycle(client) {
  await client.query('SELECT pg_advisory_xact_lock(1279479630, 1)');
}

async function hasOtherEligibleAdmin(client, userId) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM users
       WHERE role = 'admin' AND is_active AND is_verified AND user_id <> $1
     ) AS has_other_admin`,
    [userId]
  );
  return result.rows[0]?.has_other_admin === true;
}

const LAST_ADMIN_MESSAGE = 'At least one active verified admin must remain';

module.exports = { lockAdminLifecycle, hasOtherEligibleAdmin, LAST_ADMIN_MESSAGE };
