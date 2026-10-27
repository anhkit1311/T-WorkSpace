-- Mã số sinh viên / giảng viên: each person's school ID, unique, usable instead of email to sign in.
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_code varchar(20)
  CHECK (user_code ~ '^[A-Z0-9]{4,20}$');
CREATE UNIQUE INDEX IF NOT EXISTS users_user_code_key ON users (user_code);
