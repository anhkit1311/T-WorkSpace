ALTER TABLE users
  ADD COLUMN bio varchar(280) NOT NULL DEFAULT '',
  ADD COLUMN cover_url text,
  ADD COLUMN contact_text varchar(160) NOT NULL DEFAULT '',
  ADD COLUMN profile_visibility varchar(16) NOT NULL DEFAULT 'workspace',
  ADD COLUMN show_activity boolean NOT NULL DEFAULT true,
  ADD COLUMN show_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN notifications_enabled boolean NOT NULL DEFAULT true,
  ADD CONSTRAINT users_profile_visibility_check CHECK (profile_visibility IN ('workspace', 'private'));

ALTER TABLE messages
  ADD COLUMN reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN attachment_id uuid;

CREATE TABLE channel_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  pinned boolean NOT NULL DEFAULT false,
  muted boolean NOT NULL DEFAULT false,
  last_read_at timestamptz,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE message_reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji varchar(12) NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE message_attachments (
  id uuid PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  file_name varchar(180) NOT NULL,
  mime_type varchar(100) NOT NULL,
  file_size integer NOT NULL CHECK (file_size BETWEEN 1 AND 8000000),
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE messages ADD CONSTRAINT messages_attachment_fk
  FOREIGN KEY (attachment_id) REFERENCES message_attachments(id) ON DELETE SET NULL;
CREATE INDEX message_attachments_pending_idx ON message_attachments(created_at) WHERE message_id IS NULL;
CREATE INDEX messages_reply_to_idx ON messages(reply_to_id);
