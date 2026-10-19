-- M1: gọi vào phòng họp bằng điện thoại — quay số họp (7000) rồi nhập mã 6 chữ số của kênh.
CREATE TABLE meeting_dial_codes (
  channel_id uuid PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  code char(6) NOT NULL UNIQUE CHECK (code ~ '^[0-9]{6}$'),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
