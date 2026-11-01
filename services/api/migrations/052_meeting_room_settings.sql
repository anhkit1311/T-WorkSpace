-- NV-MT1: room settings chosen when scheduling, and the invite list (people, a whole class or unit).
ALTER TABLE meeting_schedules
  ADD COLUMN waiting_room boolean NOT NULL DEFAULT false,
  ADD COLUMN auto_record boolean NOT NULL DEFAULT false,
  ADD COLUMN mute_on_join boolean NOT NULL DEFAULT false;
ALTER TABLE meeting_sessions ADD COLUMN mute_on_join boolean NOT NULL DEFAULT false;

-- BR-10: people on the list go straight in; with the waiting room on, everyone else waits for the host.
CREATE TABLE meeting_invitees (
  schedule_id uuid NOT NULL REFERENCES meeting_schedules(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (schedule_id, user_id)
);
CREATE INDEX meeting_invitees_user_idx ON meeting_invitees(user_id);
