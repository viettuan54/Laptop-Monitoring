-- Query shadow observations. Apply before deploying the updated backend.
-- Include the v23 prerequisite for databases upgraded directly from v22.
-- Otherwise a RISK result fails with 22P02 and rolls back the entire batch.
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'text_risk';

BEGIN;
ALTER TABLE text_moderation_events
  ADD COLUMN IF NOT EXISTS moderation_mode VARCHAR(6) NOT NULL DEFAULT 'alerts',
  ADD COLUMN IF NOT EXISTS model_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS batch_inference_ms INTEGER;

ALTER TABLE text_moderation_events DROP CONSTRAINT IF EXISTS text_moderation_mode_check;
ALTER TABLE text_moderation_events ADD CONSTRAINT text_moderation_mode_check
  CHECK (moderation_mode IN ('alerts', 'shadow'));
ALTER TABLE text_moderation_events DROP CONSTRAINT IF EXISTS text_model_sha256_check;
ALTER TABLE text_moderation_events ADD CONSTRAINT text_model_sha256_check
  CHECK (model_sha256 IS NULL OR model_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE text_moderation_events DROP CONSTRAINT IF EXISTS text_shadow_pin_check;
ALTER TABLE text_moderation_events ADD CONSTRAINT text_shadow_pin_check
  CHECK (moderation_mode <> 'shadow' OR model_sha256 IS NOT NULL);
ALTER TABLE text_moderation_events DROP CONSTRAINT IF EXISTS text_batch_inference_ms_check;
ALTER TABLE text_moderation_events ADD CONSTRAINT text_batch_inference_ms_check
  CHECK (batch_inference_ms IS NULL OR batch_inference_ms >= 0);

COMMENT ON COLUMN text_moderation_events.batch_inference_ms IS
  'Whole provider batch duration including consent checks and retries; repeated on each event, not per-query latency.';
COMMIT;
