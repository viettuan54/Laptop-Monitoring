BEGIN;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS vision_session_minutes INTEGER NOT NULL DEFAULT 5
 CHECK (vision_session_minutes BETWEEN 1 AND 60);
ALTER TABLE settings ADD COLUMN IF NOT EXISTS vision_session_id UUID;
-- Existing switches are selections, not an instruction to open a new session.
-- A parent starts the first bounded session explicitly after upgrading.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS vision_session_id UUID;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS vision_session_status TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS vision_session_reported_at TIMESTAMPTZ;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS vision_session_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS alerts_vision_session_unique
 ON alerts(device_id, vision_session_id) WHERE vision_session_id IS NOT NULL;
COMMIT;
