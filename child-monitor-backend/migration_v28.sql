-- Agent-confirmed application closure receipts; policy selection is not a receipt.
BEGIN;
CREATE TABLE IF NOT EXISTS app_enforcement_events (
    event_id BIGSERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    client_record_id UUID NOT NULL,
    app_name VARCHAR(150) NOT NULL,
    category VARCHAR(24) NOT NULL CHECK (category IN ('learning','entertainment','browsers','unknown')),
    classification_source VARCHAR(24) NOT NULL CHECK (classification_source IN ('exact_lookup','trained_model','gemini')),
    requested_at TIMESTAMPTZ NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL CHECK (occurred_at >= requested_at),
    outcome VARCHAR(12) NOT NULL CHECK (outcome IN ('closed','failed','cancelled')),
    reason VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (device_id, client_record_id)
);
CREATE INDEX IF NOT EXISTS idx_app_enforcement_device_time
    ON app_enforcement_events(device_id, occurred_at DESC);
ALTER TABLE app_enforcement_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_enforcement_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_enforcement_owner ON app_enforcement_events;
CREATE POLICY app_enforcement_owner ON app_enforcement_events
    USING (device_id IN (
        SELECT d.device_id FROM devices d JOIN children c ON c.child_id = d.child_id
        WHERE c.user_id = NULLIF(current_setting('app.current_user_id', true), '')::INTEGER
    ));
GRANT SELECT ON app_enforcement_events TO app_backend;
GRANT ALL PRIVILEGES ON app_enforcement_events TO app_admin;
GRANT USAGE, SELECT ON SEQUENCE app_enforcement_events_event_id_seq TO app_admin;
COMMIT;
