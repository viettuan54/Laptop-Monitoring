-- =========================================================
-- FULL SETUP DATABASE
-- HỆ THỐNG GIÁM SÁT LAPTOP TRẺ EM (PostgreSQL)
--
-- LƯU Ý QUAN TRỌNG:
-- File này chứa schema đầy đủ cho quá trình cài đặt mới từ đầu (fresh install).
-- Đối với các môi trường đã chạy Data.sql cũ và đã áp dụng migration.sql thành công,
-- KHÔNG cần thiết và KHÔNG chạy lại file này để tránh mất mát dữ liệu.
-- =========================================================

BEGIN;

-- =========================================================
-- 0. EXTENSIONS
-- =========================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- 1. ENUM TYPES
-- =========================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('parent', 'admin');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_category') THEN
        CREATE TYPE app_category AS ENUM ('learning', 'entertainment', 'browsers', 'unknown');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'web_category') THEN
        CREATE TYPE web_category AS ENUM ('education', 'entertainment', 'social', 'unsafe', 'unknown');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'classification_resource_type') THEN
        CREATE TYPE classification_resource_type AS ENUM ('app', 'web');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'access_action') THEN
        CREATE TYPE access_action AS ENUM ('allow', 'block');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'behavior_type') THEN
        CREATE TYPE behavior_type AS ENUM ('learning', 'entertainment', 'risk', 'normal');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'risk_level') THEN
        CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'alert_type') THEN
        CREATE TYPE alert_type AS ENUM ('time_exceeded', 'unsafe_website', 'app_overuse', 'night_usage', 'posture_warning', 'stranger_detected', 'eye_distance_warning');
    END IF;
END $$;

-- =========================================================
-- 2. TABLES
-- =========================================================
CREATE TABLE IF NOT EXISTS users (
    user_id     SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    email       VARCHAR(150) NOT NULL,
    password    VARCHAR(255) NOT NULL,
    role        user_role DEFAULT 'parent',
    is_verified BOOLEAN DEFAULT FALSE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    verification_token VARCHAR(64),
    verification_token_expires TIMESTAMP,
    reset_token VARCHAR(64),
    reset_token_expires TIMESTAMP,
    token_version INT DEFAULT 1 NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS children (
    child_id    SERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    age         INT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS devices (
    device_id    SERIAL PRIMARY KEY,
    child_id     INT NOT NULL REFERENCES children(child_id) ON DELETE CASCADE,
    device_name  VARCHAR(100) NOT NULL,
    device_uid   VARCHAR(150) UNIQUE,
    device_secret VARCHAR(64) DEFAULT encode(digest(gen_random_uuid()::text, 'sha256'), 'hex') NOT NULL,
    last_seen_at TIMESTAMP,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_usage (
    log_id      BIGSERIAL PRIMARY KEY,
    device_id   INT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    app_name    VARCHAR(150) NOT NULL,
    category    app_category DEFAULT 'unknown',
    start_time  TIMESTAMPTZ NOT NULL,
    end_time    TIMESTAMPTZ,
    duration_seconds INT
);

CREATE TABLE IF NOT EXISTS website_logs (
    log_id      BIGSERIAL PRIMARY KEY,
    device_id   INT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    url         VARCHAR(500) NOT NULL,
    domain      VARCHAR(200),
    category    web_category DEFAULT 'unknown',
    visit_time  TIMESTAMPTZ NOT NULL,
    duration_seconds INT,
    page_title  VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS settings (
    setting_id          SERIAL PRIMARY KEY,
    child_id            INT NOT NULL UNIQUE REFERENCES children(child_id) ON DELETE CASCADE,
    daily_limit_minutes INT DEFAULT 120,
    allowed_start_time  TIME DEFAULT '07:00:00',
    allowed_end_time    TIME DEFAULT '21:00:00',
    is_locked           BOOLEAN DEFAULT FALSE,
    enable_webcam_monitoring   BOOLEAN DEFAULT FALSE,
    enable_screenshot_review   BOOLEAN DEFAULT FALSE,
    enable_keylog              BOOLEAN DEFAULT FALSE,
    enable_app_classification  BOOLEAN NOT NULL DEFAULT FALSE,
    enable_web_classification  BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS child_category_policies (
    child_id      INT NOT NULL REFERENCES children(child_id) ON DELETE CASCADE,
    resource_type classification_resource_type NOT NULL,
    category      VARCHAR(30) NOT NULL,
    action        access_action NOT NULL DEFAULT 'allow',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (child_id, resource_type, category),
    CONSTRAINT chk_child_category_policy_category CHECK (
        (resource_type = 'app' AND category IN ('learning', 'entertainment', 'browsers', 'unknown'))
        OR
        (resource_type = 'web' AND category IN ('education', 'entertainment', 'social', 'unsafe', 'unknown'))
    )
);

CREATE TABLE IF NOT EXISTS ai_analysis (
    analysis_id   BIGSERIAL PRIMARY KEY,
    device_id     INT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    behavior_type behavior_type DEFAULT 'normal',
    risk_level    risk_level DEFAULT 'low',
    suggestion    TEXT,
    analyzed_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alerts (
    alert_id    BIGSERIAL PRIMARY KEY,
    device_id   INT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    alert_type  alert_type NOT NULL,
    message     VARCHAR(500) NOT NULL,
    is_read     BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS token_blacklist (
    jti        VARCHAR(36) PRIMARY KEY,
    expires_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS website_blacklist (
    blacklist_id  SERIAL PRIMARY KEY,
    domain        VARCHAR(200) NOT NULL UNIQUE,
    reason        VARCHAR(500),
    added_by      INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS push_tokens (
    push_token_id BIGSERIAL PRIMARY KEY,
    user_id       INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    provider      VARCHAR(10) NOT NULL CHECK (provider IN ('fcm', 'expo')),
    platform      VARCHAR(10) NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
    token         TEXT NOT NULL,
    device_name   VARCHAR(100),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    failure_count INT NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
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

CREATE TABLE IF NOT EXISTS admin_face_challenges (
    challenge_hash  CHAR(64) PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    ip_address      TEXT NOT NULL,
    user_agent_hash CHAR(64) NOT NULL,
    attempts        SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- 3. INDEXES
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_appusage_device_time ON app_usage(device_id, start_time);
CREATE INDEX IF NOT EXISTS idx_weblogs_device_time  ON website_logs(device_id, visit_time);
CREATE INDEX IF NOT EXISTS idx_analysis_device_time ON ai_analysis(device_id, analyzed_at);
CREATE INDEX IF NOT EXISTS idx_alerts_device_time   ON alerts(device_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_secret ON devices(device_secret);
CREATE INDEX IF NOT EXISTS idx_token_blacklist_expires ON token_blacklist(expires_at);
CREATE INDEX IF NOT EXISTS idx_children_user        ON children(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_blacklist_domain ON website_blacklist(domain);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_active ON push_tokens(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_push_receipts_pending ON push_receipts(created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_admin_face_challenges_user ON admin_face_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_face_challenges_expiry ON admin_face_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_child_category_policies_lookup
    ON child_category_policies(child_id, resource_type, action);

-- =========================================================
-- 4. TRIGGER updated_at
-- =========================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_settings_updated ON settings;
CREATE TRIGGER trg_settings_updated
BEFORE UPDATE ON settings
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_push_tokens_updated ON push_tokens;
CREATE TRIGGER trg_push_tokens_updated
BEFORE UPDATE ON push_tokens
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_child_category_policies_updated ON child_category_policies;
CREATE TRIGGER trg_child_category_policies_updated
BEFORE UPDATE ON child_category_policies
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION initialize_child_category_policies()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO child_category_policies(child_id, resource_type, category, action)
    VALUES
        (NEW.child_id, 'app', 'learning',      'allow'),
        (NEW.child_id, 'app', 'entertainment', 'block'),
        (NEW.child_id, 'app', 'browsers',      'allow'),
        (NEW.child_id, 'app', 'unknown',       'allow'),
        (NEW.child_id, 'web', 'education',     'allow'),
        (NEW.child_id, 'web', 'entertainment', 'block'),
        (NEW.child_id, 'web', 'social',        'block'),
        (NEW.child_id, 'web', 'unsafe',        'block'),
        (NEW.child_id, 'web', 'unknown',       'allow')
    ON CONFLICT (child_id, resource_type, category) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_children_initialize_category_policies ON children;
CREATE TRIGGER trg_children_initialize_category_policies
AFTER INSERT ON children
FOR EACH ROW
EXECUTE FUNCTION initialize_child_category_policies();

-- =========================================================
-- 5. ROLES & PERMISSIONS
-- =========================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backend') THEN
        CREATE ROLE app_backend LOGIN PASSWORD 'CHANGE_ME_BACKEND';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
        CREATE ROLE app_admin LOGIN PASSWORD 'CHANGE_ME_ADMIN';
    END IF;
END $$;

GRANT CONNECT ON DATABASE child_monitor_db TO app_backend, app_admin;
GRANT USAGE ON SCHEMA public TO app_backend, app_admin;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    users, children, devices, app_usage, website_logs,
    settings, ai_analysis, alerts, token_blacklist, refresh_tokens, website_blacklist,
    push_tokens
TO app_backend;

GRANT SELECT, INSERT, UPDATE ON child_category_policies TO app_backend;
REVOKE DELETE ON child_category_policies FROM app_backend;

REVOKE ALL ON push_receipts FROM app_backend;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_admin;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_backend;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_backend;

ALTER ROLE app_admin BYPASSRLS;

-- =========================================================
-- 6. ROW LEVEL SECURITY (RLS)
-- =========================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE children ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_face_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_category_policies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON admin_face_challenges FROM app_backend;

CREATE POLICY users_self ON users
USING (user_id = current_setting('app.current_user_id', true)::INT);

CREATE POLICY children_owner ON children
USING (user_id = current_setting('app.current_user_id', true)::INT);

CREATE POLICY devices_owner ON devices
USING (child_id IN (
    SELECT child_id FROM children
    WHERE user_id = current_setting('app.current_user_id', true)::INT
));

CREATE POLICY appusage_owner ON app_usage
USING (device_id IN (
    SELECT d.device_id FROM devices d
    JOIN children c ON d.child_id = c.child_id
    WHERE c.user_id = current_setting('app.current_user_id', true)::INT
));

CREATE POLICY weblogs_owner ON website_logs
USING (device_id IN (
    SELECT d.device_id FROM devices d
    JOIN children c ON d.child_id = c.child_id
    WHERE c.user_id = current_setting('app.current_user_id', true)::INT
));

CREATE POLICY settings_owner ON settings
USING (child_id IN (
    SELECT child_id FROM children
    WHERE user_id = current_setting('app.current_user_id', true)::INT
));

CREATE POLICY child_category_policies_owner ON child_category_policies
USING (child_id IN (
    SELECT child_id FROM children
    WHERE user_id = current_setting('app.current_user_id', true)::INT
))
WITH CHECK (child_id IN (
    SELECT child_id FROM children
    WHERE user_id = current_setting('app.current_user_id', true)::INT
));

CREATE POLICY analysis_owner ON ai_analysis
USING (device_id IN (
    SELECT d.device_id FROM devices d
    JOIN children c ON d.child_id = c.child_id
    WHERE c.user_id = current_setting('app.current_user_id', true)::INT
));

CREATE POLICY alerts_owner ON alerts
USING (device_id IN (
    SELECT d.device_id FROM devices d
    JOIN children c ON d.child_id = c.child_id
    WHERE c.user_id = current_setting('app.current_user_id', true)::INT
));

CREATE POLICY push_tokens_owner ON push_tokens
USING (user_id = current_setting('app.current_user_id', true)::INT)
WITH CHECK (user_id = current_setting('app.current_user_id', true)::INT);

CREATE POLICY push_receipts_owner ON push_receipts
USING (
    EXISTS (
        SELECT 1 FROM push_tokens pt
        WHERE pt.push_token_id = push_receipts.push_token_id
          AND pt.user_id = current_setting('app.current_user_id', true)::INT
    )
);

-- =========================================================
-- 7. DATA RETENTION
-- =========================================================
CREATE OR REPLACE FUNCTION cleanup_old_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM app_usage WHERE start_time < NOW() - INTERVAL '6 months';
    DELETE FROM website_logs WHERE visit_time < NOW() - INTERVAL '6 months';
    DELETE FROM ai_analysis WHERE analyzed_at < NOW() - INTERVAL '6 months';
    DELETE FROM alerts WHERE created_at < NOW() - INTERVAL '12 months' AND is_read = TRUE;
END;
$$ LANGUAGE plpgsql;

COMMIT;
