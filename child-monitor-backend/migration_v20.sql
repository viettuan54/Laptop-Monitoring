-- =========================================================
-- MIGRATION V20: App classification provenance and backfill
-- =========================================================

BEGIN;

ALTER TABLE app_usage
    ADD COLUMN IF NOT EXISTS product_name VARCHAR(150),
    ADD COLUMN IF NOT EXISTS file_description VARCHAR(150),
    ADD COLUMN IF NOT EXISTS classification_source VARCHAR(24) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS classification_confidence DOUBLE PRECISION;

UPDATE app_usage
SET classification_source = 'legacy_agent'
WHERE category <> 'unknown'
  AND classification_source = 'pending';

ALTER TABLE app_usage
    DROP CONSTRAINT IF EXISTS chk_app_usage_classification_source,
    DROP CONSTRAINT IF EXISTS chk_app_usage_classification_confidence;

ALTER TABLE app_usage
    ADD CONSTRAINT chk_app_usage_classification_source CHECK (
        classification_source IN (
            'pending', 'disabled', 'exact_lookup', 'trained_model',
            'gemini', 'legacy_agent'
        )
    ),
    ADD CONSTRAINT chk_app_usage_classification_confidence CHECK (
        classification_confidence IS NULL
        OR (classification_confidence >= 0 AND classification_confidence <= 1)
    );

CREATE INDEX IF NOT EXISTS idx_app_usage_pending_classification
    ON app_usage(device_id, lower(app_name))
    WHERE category = 'unknown'
      AND classification_source IN ('pending', 'disabled');

CREATE INDEX IF NOT EXISTS idx_app_usage_device_name_latest
    ON app_usage(device_id, lower(app_name), start_time DESC, log_id DESC);

COMMENT ON COLUMN app_usage.product_name IS
    'Non-sensitive executable ProductName used only for app classification.';
COMMENT ON COLUMN app_usage.file_description IS
    'Non-sensitive executable FileDescription used only for app classification.';
COMMENT ON COLUMN app_usage.classification_source IS
    'Classification provenance: pending/disabled/exact_lookup/trained_model/gemini/legacy_agent.';

COMMIT;
