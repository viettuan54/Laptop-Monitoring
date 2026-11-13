-- Separate webcam features, preserving existing consent. Safe to rerun.
BEGIN;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS enable_posture_monitoring BOOLEAN;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS enable_eye_distance_monitoring BOOLEAN;
UPDATE settings SET enable_posture_monitoring = COALESCE(enable_webcam_monitoring, FALSE)
 WHERE enable_posture_monitoring IS NULL;
UPDATE settings SET enable_eye_distance_monitoring = COALESCE(enable_webcam_monitoring, FALSE)
 WHERE enable_eye_distance_monitoring IS NULL;
ALTER TABLE settings ALTER COLUMN enable_posture_monitoring SET DEFAULT FALSE,
 ALTER COLUMN enable_posture_monitoring SET NOT NULL,
 ALTER COLUMN enable_eye_distance_monitoring SET DEFAULT FALSE,
 ALTER COLUMN enable_eye_distance_monitoring SET NOT NULL;
COMMIT;
