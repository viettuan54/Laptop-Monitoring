-- =========================================================
-- MIGRATION V15: Bổ sung nhóm trình duyệt cho ứng dụng
-- =========================================================

BEGIN;

ALTER TYPE app_category
    ADD VALUE IF NOT EXISTS 'browsers' BEFORE 'unknown';

COMMIT;
