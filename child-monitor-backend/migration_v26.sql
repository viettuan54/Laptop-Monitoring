-- One short-lived capture request per device. Existing device RLS applies.
BEGIN;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS screenshot_request_id UUID;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS screenshot_requested_at TIMESTAMPTZ;
COMMIT;
