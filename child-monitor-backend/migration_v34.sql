-- Per-child periodic screenshot interval. Manual requests do not enable it.
BEGIN;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS screenshot_interval_minutes INTEGER NOT NULL DEFAULT 5
  CHECK (screenshot_interval_minutes BETWEEN 1 AND 60);
COMMIT;
