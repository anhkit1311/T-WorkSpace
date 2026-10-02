CREATE TABLE meeting_schedules (
  id uuid PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title varchar(120) NOT NULL,
  description varchar(1000) NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meeting_schedules_time_check CHECK (ends_at > starts_at)
);

CREATE INDEX meeting_schedules_channel_start_idx
  ON meeting_schedules(channel_id, starts_at) WHERE canceled_at IS NULL;
