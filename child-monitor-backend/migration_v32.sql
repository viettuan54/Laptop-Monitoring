BEGIN;

-- A versioned, one-time cutover: old classifier sessions cannot bypass enrollment.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='users' AND column_name='face_enrolled') THEN
    ALTER TABLE users ADD COLUMN face_enrolled BOOLEAN NOT NULL DEFAULT FALSE;
    UPDATE users SET token_version=token_version+1 WHERE role='admin';
    DELETE FROM refresh_tokens WHERE user_id IN (SELECT user_id FROM users WHERE role='admin');
    DELETE FROM admin_face_challenges;
  END IF;
END $$;
ALTER TABLE users ADD COLUMN IF NOT EXISTS face_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS admin_face_templates (
  user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  embedding JSONB NOT NULL CHECK (jsonb_typeof(embedding)='array' AND jsonb_array_length(embedding)=128),
  model_id TEXT NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE admin_face_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_face_templates FROM PUBLIC, app_backend;
GRANT ALL ON admin_face_templates TO app_admin;

ALTER TABLE admin_face_challenges ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'verify'
  CHECK (purpose IN ('enroll','verify'));
ALTER TABLE admin_face_challenges ADD COLUMN IF NOT EXISTS face_version INTEGER NOT NULL DEFAULT 0;
-- -1 makes any surviving legacy challenge invalid, never an implicit enrollment token.
ALTER TABLE admin_face_challenges ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT -1;
COMMIT;
