CREATE TABLE meeting_sessions (
 id uuid PRIMARY KEY,
 channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
 schedule_id uuid REFERENCES meeting_schedules(id) ON DELETE SET NULL,
 host_id uuid NOT NULL REFERENCES users(id),
 waiting_enabled boolean NOT NULL DEFAULT false,
 locked boolean NOT NULL DEFAULT false,
 started_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 CHECK(ended_at IS NULL OR ended_at>=started_at)
);
CREATE UNIQUE INDEX meeting_sessions_active_idx ON meeting_sessions(channel_id) WHERE ended_at IS NULL;
CREATE TABLE meeting_attendees (
 session_id uuid NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role text NOT NULL DEFAULT 'member' CHECK(role IN ('host','cohost','member')),
 state text NOT NULL CHECK(state IN ('waiting','admitted','kicked')),
 raised_hand boolean NOT NULL DEFAULT false,
 joined_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(session_id,user_id)
);
CREATE TABLE meeting_connections (
 socket_id text PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 instance_id text NOT NULL,
 joined_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meeting_connections_session_user_idx ON meeting_connections(session_id,user_id);
ALTER TABLE meeting_participations ADD COLUMN session_id uuid REFERENCES meeting_sessions(id) ON DELETE SET NULL;
