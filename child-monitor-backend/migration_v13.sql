-- =========================================================
-- MIGRATION V13: FCM / Expo Push Notification
-- =========================================================

BEGIN;

CREATE TABLE IF NOT EXISTS push_tokens (
    push_token_id BIGSERIAL PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    provider      VARCHAR(10) NOT NULL CHECK (provider IN ('fcm', 'expo')),
    platform      VARCHAR(10) NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
    token         TEXT NOT NULL,
    device_name   VARCHAR(100),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
    last_error    VARCHAR(500),
    last_used_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (provider, token)
);

CREATE TABLE IF NOT EXISTS push_receipts (
    receipt_id    VARCHAR(100) PRIMARY KEY,
    push_token_id BIGINT NOT NULL REFERENCES push_tokens(push_token_id) ON DELETE CASCADE,
    status        VARCHAR(12) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'delivered', 'failed', 'expired')),
    error_code    VARCHAR(100),
    error_message VARCHAR(500),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active
    ON push_tokens(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_push_receipts_pending
    ON push_receipts(created_at)
    WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_push_tokens_updated ON push_tokens;
CREATE TRIGGER trg_push_tokens_updated
BEFORE UPDATE ON push_tokens
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_tokens_owner ON push_tokens;
CREATE POLICY push_tokens_owner ON push_tokens
    USING (user_id = current_setting('app.current_user_id', true)::INTEGER)
    WITH CHECK (user_id = current_setting('app.current_user_id', true)::INTEGER);

DROP POLICY IF EXISTS push_receipts_owner ON push_receipts;
CREATE POLICY push_receipts_owner ON push_receipts
    USING (
      EXISTS (
        SELECT 1
        FROM push_tokens pt
        WHERE pt.push_token_id = push_receipts.push_token_id
          AND pt.user_id = current_setting('app.current_user_id', true)::INTEGER
      )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON push_tokens TO app_backend;
GRANT USAGE, SELECT ON SEQUENCE push_tokens_push_token_id_seq TO app_backend;
REVOKE ALL ON push_receipts FROM app_backend;

GRANT ALL PRIVILEGES ON push_tokens, push_receipts TO app_admin;
GRANT ALL PRIVILEGES ON SEQUENCE push_tokens_push_token_id_seq TO app_admin;

COMMIT;
