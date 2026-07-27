-- =========================================================
-- MIGRATION V14: Xác thực khuôn mặt bước hai cho admin
-- =========================================================

BEGIN;

CREATE TABLE IF NOT EXISTS admin_face_challenges (
    challenge_hash  CHAR(64) PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    ip_address      TEXT NOT NULL,
    user_agent_hash CHAR(64) NOT NULL,
    attempts        SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_face_challenges_user
    ON admin_face_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_face_challenges_expiry
    ON admin_face_challenges(expires_at);

ALTER TABLE admin_face_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_face_challenges FROM app_backend;
GRANT ALL PRIVILEGES ON admin_face_challenges TO app_admin;

COMMIT;
