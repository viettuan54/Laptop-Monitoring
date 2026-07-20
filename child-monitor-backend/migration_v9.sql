-- =========================================================
-- MIGRATION V9: Tạo DB user riêng (app_backend) để RLS hoạt động đúng
--
-- VẤN ĐỀ: Nếu DB_BACKEND_USER = DB_ADMIN_USER (postgres/superuser),
-- PostgreSQL bỏ qua tất cả RLS policy → phụ huynh có thể xem data của nhau.
--
-- GIẢI PHÁP: Tạo role app_backend non-superuser riêng biệt.
--
-- Chạy bằng tài khoản superuser (postgres):
-- psql -U postgres -d child_monitor_db -f migration_v9.sql
--
-- Sau đó cập nhật .env:
--   DB_BACKEND_USER=app_backend
--   DB_BACKEND_PASSWORD=<mật khẩu mạnh>
-- =========================================================

BEGIN;

-- =========================================================
-- 1. Tạo role app_backend nếu chưa tồn tại
--    (non-superuser để RLS có hiệu lực)
-- =========================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_backend') THEN
        -- ⚠️ Thay 'CHANGE_ME_BACKEND_PASSWORD' bằng mật khẩu thực tế mạnh của bạn
        CREATE ROLE app_backend LOGIN PASSWORD 'CHANGE_ME_BACKEND_PASSWORD';
        RAISE NOTICE 'Role app_backend đã được tạo.';
    ELSE
        RAISE NOTICE 'Role app_backend đã tồn tại, bỏ qua bước tạo.';
    END IF;
END $$;

-- =========================================================
-- 2. Cấp quyền kết nối và sử dụng schema
-- =========================================================
GRANT CONNECT ON DATABASE child_monitor_db TO app_backend;
GRANT USAGE ON SCHEMA public TO app_backend;

-- =========================================================
-- 3. Cấp quyền DML trên các bảng cần thiết cho app_backend
-- =========================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON
    users, children, devices, app_usage, website_logs,
    settings, ai_analysis, alerts, token_blacklist, refresh_tokens, website_blacklist,
    failed_login_attempts
TO app_backend;

-- Cấp quyền sử dụng sequences (để INSERT với SERIAL/BIGSERIAL columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_backend;

-- Đảm bảo các bảng/sequence tạo mới sau này cũng có quyền
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_backend;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_backend;

-- =========================================================
-- 4. Đảm bảo app_backend KHÔNG có BYPASSRLS
--    (đây là điều kiện bắt buộc để RLS có hiệu lực)
-- =========================================================
ALTER ROLE app_backend NOBYPASSRLS;

-- =========================================================
-- 5. Đảm bảo RLS được bật trên tất cả các bảng cần bảo vệ
--    (chạy lại không gây hại nếu đã bật)
-- =========================================================
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE children      ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_usage     ENABLE ROW LEVEL SECURITY;
ALTER TABLE website_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_analysis   ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts        ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- 6. Tạo lại RLS policies nếu chưa có
--    (IF NOT EXISTS tương đương – dùng DO block để check)
-- =========================================================

-- Bảng users: chỉ xem được bản ghi của chính mình
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='users' AND policyname='users_self') THEN
        CREATE POLICY users_self ON users
        USING (user_id = current_setting('app.current_user_id', true)::INT);
    END IF;
END $$;

-- Bảng children
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='children' AND policyname='children_owner') THEN
        CREATE POLICY children_owner ON children
        USING (user_id = current_setting('app.current_user_id', true)::INT);
    END IF;
END $$;

-- Bảng devices
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='devices' AND policyname='devices_owner') THEN
        CREATE POLICY devices_owner ON devices
        USING (child_id IN (
            SELECT child_id FROM children
            WHERE user_id = current_setting('app.current_user_id', true)::INT
        ));
    END IF;
END $$;

-- Bảng app_usage
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='app_usage' AND policyname='appusage_owner') THEN
        CREATE POLICY appusage_owner ON app_usage
        USING (device_id IN (
            SELECT d.device_id FROM devices d
            JOIN children c ON d.child_id = c.child_id
            WHERE c.user_id = current_setting('app.current_user_id', true)::INT
        ));
    END IF;
END $$;

-- Bảng website_logs
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='website_logs' AND policyname='weblogs_owner') THEN
        CREATE POLICY weblogs_owner ON website_logs
        USING (device_id IN (
            SELECT d.device_id FROM devices d
            JOIN children c ON d.child_id = c.child_id
            WHERE c.user_id = current_setting('app.current_user_id', true)::INT
        ));
    END IF;
END $$;

-- Bảng settings
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='settings' AND policyname='settings_owner') THEN
        CREATE POLICY settings_owner ON settings
        USING (child_id IN (
            SELECT child_id FROM children
            WHERE user_id = current_setting('app.current_user_id', true)::INT
        ));
    END IF;
END $$;

-- Bảng ai_analysis
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_analysis' AND policyname='analysis_owner') THEN
        CREATE POLICY analysis_owner ON ai_analysis
        USING (device_id IN (
            SELECT d.device_id FROM devices d
            JOIN children c ON d.child_id = c.child_id
            WHERE c.user_id = current_setting('app.current_user_id', true)::INT
        ));
    END IF;
END $$;

-- Bảng alerts
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='alerts' AND policyname='alerts_owner') THEN
        CREATE POLICY alerts_owner ON alerts
        USING (device_id IN (
            SELECT d.device_id FROM devices d
            JOIN children c ON d.child_id = c.child_id
            WHERE c.user_id = current_setting('app.current_user_id', true)::INT
        ));
    END IF;
END $$;

COMMIT;

-- =========================================================
-- Sau khi chạy xong, kiểm tra:
-- SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_backend';
-- -- Kết quả mong đợi: rolsuper=false, rolbypassrls=false
--
-- SELECT tablename, policyname FROM pg_policies ORDER BY tablename;
-- -- Kiểm tra các policy đã được tạo
-- =========================================================
