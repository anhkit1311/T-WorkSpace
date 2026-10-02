-- 1. Cho phép password_hash là NULL đối với tài khoản chỉ dùng Google OAuth
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 2. Bổ sung các cột phục vụ Google OAuth và xác thực tài khoản
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id varchar(128) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider varchar(32) NOT NULL DEFAULT 'local';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;

CREATE INDEX IF NOT EXISTS users_google_id_idx ON users(google_id);

-- Cập nhật toàn bộ người dùng hiện tại (như tài khoản demo seed) thành email_verified = true
UPDATE users SET email_verified = true WHERE email_verified IS FALSE;

-- 3. Tạo bảng lưu trữ mã OTP xác thực email
CREATE TABLE IF NOT EXISTS email_otps (
  id uuid PRIMARY KEY,
  email varchar(320) NOT NULL,
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  resend_count integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_otps_email_normalized CHECK (email = lower(email))
);

CREATE INDEX IF NOT EXISTS email_otps_email_idx ON email_otps(email);
