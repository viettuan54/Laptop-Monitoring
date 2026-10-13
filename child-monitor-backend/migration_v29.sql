-- Break reminders replace the unused key logging control. Preserve the legacy
-- column for older installations, but never copy its value into the new opt-in.
BEGIN;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS enable_break_reminders BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS break_interval_minutes INTEGER NOT NULL DEFAULT 30
    CHECK (break_interval_minutes BETWEEN 5 AND 180);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS break_duration_minutes INTEGER NOT NULL DEFAULT 5
    CHECK (break_duration_minutes BETWEEN 1 AND 30);
UPDATE settings SET enable_keylog = FALSE WHERE enable_keylog IS DISTINCT FROM FALSE;

CREATE TABLE IF NOT EXISTS break_reminder_events (
    event_id BIGSERIAL PRIMARY KEY,
    device_id INTEGER NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    client_record_id UUID NOT NULL,
    reminder_id UUID NOT NULL,
    event_type VARCHAR(16) NOT NULL CHECK (event_type IN ('shown', 'acknowledged', 'snoozed')),
    interval_minutes INTEGER NOT NULL CHECK (interval_minutes BETWEEN 5 AND 180),
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 30),
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (device_id, client_record_id),
    UNIQUE (device_id, reminder_id, event_type)
);
CREATE INDEX IF NOT EXISTS idx_break_reminder_device_time ON break_reminder_events(device_id, occurred_at DESC);
ALTER TABLE break_reminder_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE break_reminder_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS break_reminder_owner ON break_reminder_events;
CREATE POLICY break_reminder_owner ON break_reminder_events USING (device_id IN (
    SELECT d.device_id FROM devices d JOIN children c ON c.child_id = d.child_id
    WHERE c.user_id = NULLIF(current_setting('app.current_user_id', true), '')::INTEGER
));
GRANT SELECT ON break_reminder_events TO app_backend;
GRANT ALL PRIVILEGES ON break_reminder_events TO app_admin;
GRANT USAGE, SELECT ON SEQUENCE break_reminder_events_event_id_seq TO app_admin;
COMMIT;
