CREATE TABLE password_resets (
  email varchar(320) PRIMARY KEY,
  otp_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  sent_at timestamptz NOT NULL DEFAULT now()
);
