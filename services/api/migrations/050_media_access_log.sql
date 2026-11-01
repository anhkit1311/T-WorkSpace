-- Spec "Quy tắc bảo vệ dữ liệu": every listen to a call recording / voicemail and every view of a meeting recording.
CREATE TABLE media_access_log (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  kind varchar(12) NOT NULL CHECK (kind IN ('call','voicemail','meeting')),
  ref_id uuid NOT NULL,
  accessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_access_log_time_idx ON media_access_log(accessed_at DESC, id DESC);
