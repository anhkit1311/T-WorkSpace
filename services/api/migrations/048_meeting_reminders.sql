-- NV-MT1: each schedule is reminded once, 15 minutes before it starts; moving the start re-arms it.
ALTER TABLE meeting_schedules ADD COLUMN reminded_at timestamptz;
CREATE INDEX meeting_schedules_reminder_due ON meeting_schedules(starts_at)
  WHERE reminded_at IS NULL AND canceled_at IS NULL;
