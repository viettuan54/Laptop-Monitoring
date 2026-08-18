-- =========================================================
-- MIGRATION V17: Trạng thái phân loại website và backfill
-- =========================================================

BEGIN;

ALTER TABLE website_logs
    ADD COLUMN IF NOT EXISTS classification_source VARCHAR(24) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS classification_confidence DOUBLE PRECISION;

UPDATE website_logs
SET classification_source = 'legacy_agent'
WHERE category <> 'unknown'
  AND classification_source = 'pending';

ALTER TABLE website_logs
    DROP CONSTRAINT IF EXISTS chk_website_logs_classification_source,
    DROP CONSTRAINT IF EXISTS chk_website_logs_classification_confidence;

ALTER TABLE website_logs
    ADD CONSTRAINT chk_website_logs_classification_source CHECK (
        classification_source IN (
            'pending', 'disabled', 'trained_model', 'gemini', 'legacy_agent'
        )
    ),
    ADD CONSTRAINT chk_website_logs_classification_confidence CHECK (
        classification_confidence IS NULL
        OR (classification_confidence >= 0 AND classification_confidence <= 1)
    );

CREATE INDEX IF NOT EXISTS idx_website_logs_pending_classification
    ON website_logs(device_id, domain)
    WHERE category = 'unknown'
      AND classification_source IN ('pending', 'disabled');

COMMIT;
