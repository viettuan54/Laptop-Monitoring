-- Three-label school-violence classification. Historical moderation columns and
-- rows remain readable; new writes use classification_label/label_scores only.
BEGIN;

ALTER TABLE text_moderation_events
    ADD COLUMN IF NOT EXISTS classification_label VARCHAR(10),
    ADD COLUMN IF NOT EXISTS label_scores JSONB;

-- The legacy risk_type column is retained for old rows but not populated by
-- the new single-label model.
ALTER TABLE text_moderation_events ALTER COLUMN risk_type DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_text_classification_label'
    ) THEN
        ALTER TABLE text_moderation_events
            ADD CONSTRAINT chk_text_classification_label CHECK (
                classification_label IS NULL
                OR classification_label IN ('SAFE', 'RISK', 'HIGH_RISK')
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_text_label_scores_object'
    ) THEN
        ALTER TABLE text_moderation_events
            ADD CONSTRAINT chk_text_label_scores_object CHECK (
                label_scores IS NULL OR jsonb_typeof(label_scores) = 'object'
            );
    END IF;
END $$;

COMMENT ON COLUMN text_moderation_events.classification_label IS
    'Single school-violence label for v22+ events. NULL on historical records.';
COMMENT ON COLUMN text_moderation_events.label_scores IS
    'Three class scores only; never raw text. NULL on historical records.';

COMMIT;
