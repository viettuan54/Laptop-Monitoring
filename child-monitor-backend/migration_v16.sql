-- =========================================================
-- MIGRATION V16: Cấu hình AI phân loại và chính sách truy cập
-- =========================================================

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'classification_resource_type') THEN
        CREATE TYPE classification_resource_type AS ENUM ('app', 'web');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'access_action') THEN
        CREATE TYPE access_action AS ENUM ('allow', 'block');
    END IF;
END $$;

ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS enable_app_classification BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS enable_web_classification BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS child_category_policies (
    child_id      INTEGER NOT NULL REFERENCES children(child_id) ON DELETE CASCADE,
    resource_type classification_resource_type NOT NULL,
    category      VARCHAR(30) NOT NULL,
    action        access_action NOT NULL DEFAULT 'allow',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (child_id, resource_type, category),
    CONSTRAINT chk_child_category_policy_category CHECK (
        (resource_type = 'app' AND category IN (
            'learning', 'entertainment', 'browsers', 'unknown'
        ))
        OR
        (resource_type = 'web' AND category IN (
            'education', 'entertainment', 'social', 'unsafe', 'unknown'
        ))
    )
);

CREATE INDEX IF NOT EXISTS idx_child_category_policies_lookup
    ON child_category_policies(child_id, resource_type, action);

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

-- Khởi tạo chính sách cho các hồ sơ trẻ đã tồn tại trước migration.
INSERT INTO child_category_policies(child_id, resource_type, category, action)
SELECT c.child_id, defaults.resource_type, defaults.category, defaults.action
FROM children c
CROSS JOIN (
    VALUES
        ('app'::classification_resource_type, 'learning',      'allow'::access_action),
        ('app'::classification_resource_type, 'entertainment', 'block'::access_action),
        ('app'::classification_resource_type, 'browsers',      'allow'::access_action),
        ('app'::classification_resource_type, 'unknown',       'allow'::access_action),
        ('web'::classification_resource_type, 'education',     'allow'::access_action),
        ('web'::classification_resource_type, 'entertainment', 'block'::access_action),
        ('web'::classification_resource_type, 'social',        'block'::access_action),
        ('web'::classification_resource_type, 'unsafe',        'block'::access_action),
        ('web'::classification_resource_type, 'unknown',       'allow'::access_action)
) AS defaults(resource_type, category, action)
ON CONFLICT (child_id, resource_type, category) DO NOTHING;

ALTER TABLE child_category_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS child_category_policies_owner ON child_category_policies;
CREATE POLICY child_category_policies_owner ON child_category_policies
    USING (child_id IN (
        SELECT child_id FROM children
        WHERE user_id = current_setting('app.current_user_id', true)::INTEGER
    ))
    WITH CHECK (child_id IN (
        SELECT child_id FROM children
        WHERE user_id = current_setting('app.current_user_id', true)::INTEGER
    ));

GRANT USAGE ON TYPE classification_resource_type, access_action TO app_backend, app_admin;
GRANT SELECT, INSERT, UPDATE ON child_category_policies TO app_backend;
REVOKE DELETE ON child_category_policies FROM app_backend;
GRANT ALL PRIVILEGES ON child_category_policies TO app_admin;

COMMIT;
