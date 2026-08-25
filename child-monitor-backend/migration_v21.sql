-- =========================================================
-- MIGRATION V21: Context-aware text safety moderation
-- Raw text is never persisted in PostgreSQL.
-- =========================================================

BEGIN;

ALTER TABLE settings
    ADD COLUMN IF NOT EXISTS enable_text_moderation BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'text_self_harm'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'alert_type')
    ) THEN
        ALTER TYPE alert_type ADD VALUE 'text_self_harm';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'text_harassment'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'alert_type')
    ) THEN
        ALTER TYPE alert_type ADD VALUE 'text_harassment';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'text_violence'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'alert_type')
    ) THEN
        ALTER TYPE alert_type ADD VALUE 'text_violence';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS text_moderation_events (
    event_id          BIGSERIAL PRIMARY KEY,
    device_id         INTEGER NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    client_record_id  UUID NOT NULL,
    source_type       VARCHAR(24) NOT NULL,
    status            VARCHAR(12) NOT NULL,
    risk_type         VARCHAR(20) NOT NULL,
    severity          VARCHAR(12) NOT NULL,
    primary_category  VARCHAR(40),
    confidence        DOUBLE PRECISION NOT NULL,
    category_scores   JSONB NOT NULL DEFAULT '{}'::JSONB,
    moderation_model  VARCHAR(64) NOT NULL,
    domain            VARCHAR(200),
    occurred_at       TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (device_id, client_record_id),
    CONSTRAINT chk_text_moderation_source CHECK (
        source_type IN ('search_query', 'page_content', 'chat_received', 'chat_authored')
    ),
    CONSTRAINT chk_text_moderation_status CHECK (status IN ('safe', 'flagged')),
    CONSTRAINT chk_text_moderation_risk CHECK (
        risk_type IN ('none', 'self_harm', 'harassment', 'violence')
    ),
    CONSTRAINT chk_text_moderation_severity CHECK (
        severity IN ('low', 'medium', 'high', 'critical')
    ),
    CONSTRAINT chk_text_moderation_confidence CHECK (
        confidence >= 0 AND confidence <= 1
    )
);

COMMENT ON TABLE text_moderation_events IS
    'Privacy-minimized moderation outcomes. Raw text is intentionally not stored.';

CREATE INDEX IF NOT EXISTS idx_text_moderation_device_occurred
    ON text_moderation_events(device_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_text_moderation_flagged
    ON text_moderation_events(device_id, severity, occurred_at DESC)
    WHERE status = 'flagged';

ALTER TABLE text_moderation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS text_moderation_events_owner ON text_moderation_events;
CREATE POLICY text_moderation_events_owner ON text_moderation_events
    USING (device_id IN (
        SELECT d.device_id FROM devices d
        JOIN children c ON d.child_id = c.child_id
        WHERE c.user_id = current_setting('app.current_user_id', true)::INTEGER
    ));

GRANT SELECT ON text_moderation_events TO app_backend;
GRANT ALL PRIVILEGES ON text_moderation_events TO app_admin;
GRANT USAGE, SELECT ON SEQUENCE text_moderation_events_event_id_seq TO app_admin;

CREATE OR REPLACE FUNCTION cleanup_old_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM app_usage WHERE start_time < NOW() - INTERVAL '6 months';
    DELETE FROM website_logs WHERE visit_time < NOW() - INTERVAL '6 months';
    DELETE FROM ai_analysis WHERE analyzed_at < NOW() - INTERVAL '6 months';
    DELETE FROM text_moderation_events WHERE created_at < NOW() - INTERVAL '30 days';
    DELETE FROM alerts WHERE created_at < NOW() - INTERVAL '12 months' AND is_read = TRUE;
END;
$$ LANGUAGE plpgsql;

COMMIT;
