ALTER TABLE messages ADD COLUMN thread_root_id uuid REFERENCES messages(id) ON DELETE CASCADE;
CREATE INDEX messages_thread_cursor ON messages(thread_root_id,created_at,id) WHERE deleted_at IS NULL;

CREATE TABLE thread_reads (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  root_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,root_id)
);
CREATE TABLE message_mentions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(message_id,user_id)
);
CREATE TABLE message_pins (
  message_id uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE message_bookmarks (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(message_id,user_id)
);
CREATE TABLE workspace_notification_preferences (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted boolean NOT NULL DEFAULT false,
  PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL CHECK(kind IN ('mention','thread')),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,message_id)
);
CREATE INDEX notifications_user_cursor ON notifications(user_id,created_at DESC,id DESC);
CREATE INDEX notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;

CREATE FUNCTION verify_message_thread() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.thread_root_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM messages root WHERE root.id=NEW.thread_root_id AND root.channel_id=NEW.channel_id AND root.thread_root_id IS NULL AND root.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Thread root must be an active root in the same channel' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER messages_thread_integrity BEFORE INSERT OR UPDATE OF thread_root_id,channel_id ON messages FOR EACH ROW EXECUTE FUNCTION verify_message_thread();
