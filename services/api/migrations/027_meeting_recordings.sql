-- MT-1: meeting recordings. While the meeting runs the SFU feeds FFmpeg over RTP and FFmpeg only
-- copies the streams into parts (audio of everyone + video of the current speaker); the HLS
-- transcode runs once the recording stops, so recording does not compete with the call for CPU.
CREATE TABLE meeting_recordings (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  started_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status varchar(16) NOT NULL DEFAULT 'recording' CHECK (status IN ('recording','processing','ready','failed')),
  -- false: only the session's host, co-hosts and attendees; true: everyone with access to the room.
  shared boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  duration_seconds integer,
  error varchar(500),
  CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);
-- One recording at a time per session.
CREATE UNIQUE INDEX meeting_recordings_active_idx ON meeting_recordings(session_id) WHERE status='recording';
CREATE INDEX meeting_recordings_session_idx ON meeting_recordings(session_id, started_at);
