-- Bell entries that are not chat messages: meeting invitations/reminders (NV-MT1) and enrollment (NV-EL2).
ALTER TABLE notifications ALTER COLUMN message_id DROP NOT NULL;
ALTER TABLE notifications
  ADD COLUMN title varchar(200),
  ADD COLUMN body varchar(500),
  ADD COLUMN link jsonb,
  ADD CONSTRAINT notifications_source_check CHECK ((message_id IS NULL) = (title IS NOT NULL));
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('mention', 'thread', 'direct', 'meeting', 'course'));
