CREATE TABLE IF NOT EXISTS request_rate_limits (
  bucket_key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts >= 0)
);
CREATE INDEX IF NOT EXISTS request_rate_limits_window_start_idx ON request_rate_limits(window_start);
