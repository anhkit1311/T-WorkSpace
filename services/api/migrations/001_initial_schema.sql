CREATE TABLE users (
  id uuid PRIMARY KEY,
  email varchar(320) NOT NULL,
  password_hash text NOT NULL,
  display_name varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized CHECK (email = lower(email))
);

CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  name varchar(100) NOT NULL,
  slug varchar(80) NOT NULL UNIQUE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id),
  CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'admin', 'member'))
);

CREATE INDEX memberships_user_id_idx ON memberships(user_id);

CREATE TABLE channels (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name varchar(80) NOT NULL,
  type varchar(16) NOT NULL DEFAULT 'text',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT channels_type_check CHECK (type IN ('text', 'voice', 'video')),
  CONSTRAINT channels_name_unique UNIQUE (workspace_id, name)
);

CREATE INDEX channels_workspace_position_idx ON channels(workspace_id, position);

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT messages_content_check CHECK (char_length(content) BETWEEN 1 AND 4000)
);

CREATE INDEX messages_channel_created_idx ON messages(channel_id, created_at DESC);

CREATE TABLE refresh_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent varchar(500),
  ip_address varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refresh_sessions_user_id_idx ON refresh_sessions(user_id);
CREATE INDEX refresh_sessions_expires_at_idx ON refresh_sessions(expires_at);
