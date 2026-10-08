-- Screenshots are private, opt-in activity records. Never serve them statically.
BEGIN;
CREATE TABLE IF NOT EXISTS screenshots (
    screenshot_id BIGSERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    client_record_id UUID NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 1920),
    height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 1920),
    image_data BYTEA NOT NULL CHECK (octet_length(image_data) BETWEEN 1 AND 409600),
    thumbnail_data BYTEA NOT NULL CHECK (octet_length(thumbnail_data) BETWEEN 1 AND 40960),
    UNIQUE (device_id, client_record_id)
);
CREATE INDEX IF NOT EXISTS idx_screenshots_device_time ON screenshots(device_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_screenshots_retention ON screenshots(created_at);
ALTER TABLE screenshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE screenshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS screenshots_owner ON screenshots;
CREATE POLICY screenshots_owner ON screenshots
    USING (device_id IN (
        SELECT d.device_id FROM devices d JOIN children c ON c.child_id = d.child_id
        WHERE c.user_id = current_setting('app.current_user_id', true)::INTEGER
    ));
GRANT SELECT, DELETE ON screenshots TO app_backend;
GRANT ALL PRIVILEGES ON screenshots TO app_admin;
GRANT USAGE, SELECT ON SEQUENCE screenshots_screenshot_id_seq TO app_admin;
COMMIT;
