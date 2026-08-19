-- =========================================================
-- MIGRATION V18: Tăng tốc snapshot domain theo policy AI
-- =========================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_website_logs_device_domain_latest
    ON website_logs(device_id, lower(domain), visit_time DESC, log_id DESC)
    WHERE domain IS NOT NULL;

COMMIT;
