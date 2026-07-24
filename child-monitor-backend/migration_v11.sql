-- =========================================================
-- MIGRATION V11: Audit log cho hành động quản trị nhạy cảm
-- =========================================================

BEGIN;

CREATE TABLE IF NOT EXISTS audit_logs (
    audit_id       BIGSERIAL PRIMARY KEY,
    actor_user_id  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    actor_role     VARCHAR(30) NOT NULL,
    action         VARCHAR(100) NOT NULL,
    target_type    VARCHAR(50) NOT NULL,
    target_id      VARCHAR(200),
    metadata       JSONB NOT NULL DEFAULT '{}'::JSONB,
    ip_address     TEXT,
    user_agent     VARCHAR(500),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
    ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target
    ON audit_logs(target_type, target_id, created_at DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_insert_own ON audit_logs;
CREATE POLICY audit_logs_insert_own ON audit_logs
    FOR INSERT
    WITH CHECK (
      actor_user_id = current_setting('app.current_user_id', true)::INTEGER
    );

-- app_backend chỉ cần INSERT. Việc đọc audit log chỉ dành cho adminPool.
REVOKE ALL ON audit_logs FROM app_backend;
GRANT INSERT ON audit_logs TO app_backend;
GRANT USAGE, SELECT ON SEQUENCE audit_logs_audit_id_seq TO app_backend;

COMMIT;
