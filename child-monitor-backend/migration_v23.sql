-- Search-query RISK alerts have their own type so the five-minute cooldown
-- never suppresses a subsequent HIGH_RISK alert (text_violence).
ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'text_risk';
