-- Meeting outcomes: agenda, shared notes, tasks created in a meeting and one summary per session.
-- Tasks live on text-channel boards while meetings run in voice/video rooms, so each session
-- records the text channel that receives its tasks and summary.
ALTER TABLE meeting_sessions ADD COLUMN outcome_channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;

CREATE TABLE meeting_agenda_items (
 id uuid PRIMARY KEY,
 schedule_id uuid REFERENCES meeting_schedules(id) ON DELETE CASCADE,
 session_id uuid REFERENCES meeting_sessions(id) ON DELETE CASCADE,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
 position integer NOT NULL DEFAULT 0,
 done boolean NOT NULL DEFAULT false,
 done_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(num_nonnulls(schedule_id,session_id)=1)
);
CREATE INDEX meeting_agenda_schedule_idx ON meeting_agenda_items(schedule_id,position,id) WHERE schedule_id IS NOT NULL;
CREATE INDEX meeting_agenda_session_idx ON meeting_agenda_items(session_id,position,id) WHERE session_id IS NOT NULL;

CREATE TABLE meeting_notes (
 session_id uuid PRIMARY KEY REFERENCES meeting_sessions(id) ON DELETE CASCADE,
 content text NOT NULL DEFAULT '' CHECK(length(content)<=20000),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tasks ADD COLUMN meeting_session_id uuid REFERENCES meeting_sessions(id) ON DELETE SET NULL;
CREATE INDEX tasks_meeting_idx ON tasks(meeting_session_id) WHERE meeting_session_id IS NOT NULL;

ALTER TABLE messages ADD COLUMN kind text NOT NULL DEFAULT 'user' CHECK(kind IN ('user','meeting_summary'));
ALTER TABLE messages ADD COLUMN meeting_session_id uuid REFERENCES meeting_sessions(id) ON DELETE SET NULL;
-- Exactly one summary per session, even when several API nodes end the same session.
CREATE UNIQUE INDEX messages_meeting_summary_idx ON messages(meeting_session_id) WHERE kind='meeting_summary';
