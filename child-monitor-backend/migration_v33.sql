BEGIN;
-- The service role bypasses RLS but still needs object privileges.
GRANT SELECT, INSERT, DELETE ON TABLE audit_logs TO app_admin;
GRANT USAGE, SELECT ON SEQUENCE audit_logs_audit_id_seq TO app_admin;
COMMIT;
