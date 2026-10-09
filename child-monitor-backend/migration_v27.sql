-- Remove image bytes immediately while retaining the receipt for retry deduplication.
BEGIN;
ALTER TABLE screenshots ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE screenshots ALTER COLUMN image_data DROP NOT NULL;
ALTER TABLE screenshots ALTER COLUMN thumbnail_data DROP NOT NULL;
ALTER TABLE screenshots DROP CONSTRAINT IF EXISTS screenshots_image_lifecycle;
ALTER TABLE screenshots ADD CONSTRAINT screenshots_image_lifecycle CHECK (
    (deleted_at IS NULL AND image_data IS NOT NULL AND thumbnail_data IS NOT NULL)
    OR (deleted_at IS NOT NULL AND image_data IS NULL AND thumbnail_data IS NULL)
);
GRANT UPDATE (image_data, thumbnail_data, deleted_at) ON screenshots TO app_backend;
COMMIT;
