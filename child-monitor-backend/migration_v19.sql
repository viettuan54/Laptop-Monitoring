-- =========================================================
-- MIGRATION V19: Calendar-day usage summaries
--
-- Historical Agent timestamps were written as Vietnam local wall-clock values
-- into TIMESTAMP columns. Convert them explicitly with Asia/Ho_Chi_Minh so the
-- instant is not interpreted using whichever timezone runs this migration.
-- =========================================================

BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'app_usage'
          AND column_name = 'start_time'
          AND data_type = 'timestamp without time zone'
    ) THEN
        ALTER TABLE app_usage
            ALTER COLUMN start_time TYPE TIMESTAMPTZ
            USING start_time AT TIME ZONE 'Asia/Ho_Chi_Minh';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'app_usage'
          AND column_name = 'end_time'
          AND data_type = 'timestamp without time zone'
    ) THEN
        ALTER TABLE app_usage
            ALTER COLUMN end_time TYPE TIMESTAMPTZ
            USING end_time AT TIME ZONE 'Asia/Ho_Chi_Minh';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'website_logs'
          AND column_name = 'visit_time'
          AND data_type = 'timestamp without time zone'
    ) THEN
        ALTER TABLE website_logs
            ALTER COLUMN visit_time TYPE TIMESTAMPTZ
            USING visit_time AT TIME ZONE 'Asia/Ho_Chi_Minh';
    END IF;
END $$;

COMMENT ON COLUMN app_usage.start_time IS
    'Absolute start instant. Calendar usage reports use Asia/Ho_Chi_Minh.';
COMMENT ON COLUMN app_usage.end_time IS
    'Absolute end instant. Screen-time duration is measured by duration_seconds.';
COMMENT ON COLUMN website_logs.visit_time IS
    'Absolute visit instant stored with timezone.';

-- Keep enough raw telemetry for complete current and historical monthly reports.
CREATE OR REPLACE FUNCTION cleanup_old_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM app_usage WHERE start_time < NOW() - INTERVAL '6 months';
    DELETE FROM website_logs WHERE visit_time < NOW() - INTERVAL '6 months';
    DELETE FROM ai_analysis WHERE analyzed_at < NOW() - INTERVAL '6 months';
    DELETE FROM alerts WHERE created_at < NOW() - INTERVAL '12 months' AND is_read = TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_logs() IS
    'Retains usage telemetry for six months so calendar-month summaries remain complete.';

-- No historical rows are deleted or rewritten as remediation. Older Agent
-- versions could record suspend/lock gaps as a single segment. The usage-summary
-- API preserves those rows for audit but excludes Agent rows longer than 120s
-- and rows attributed to LockApp.exe/LogonUI.exe, then reports
-- ignored_segment_count to the caller.

COMMIT;
