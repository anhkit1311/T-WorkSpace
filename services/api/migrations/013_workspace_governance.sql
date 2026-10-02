ALTER TABLE workspaces ADD COLUMN description varchar(1000) NOT NULL DEFAULT '';
ALTER TABLE workspaces ADD COLUMN archived_at timestamptz;
ALTER TABLE channels ADD COLUMN description varchar(500) NOT NULL DEFAULT '';
ALTER TABLE channels ADD COLUMN is_private boolean NOT NULL DEFAULT false;
ALTER TABLE channels ADD COLUMN archived_at timestamptz;
ALTER TABLE channels ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE channel_memberships (
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(channel_id,user_id)
);
CREATE INDEX channel_memberships_user_idx ON channel_memberships(user_id,channel_id);

CREATE VIEW channel_access AS
SELECT c.id AS channel_id, c.workspace_id, m.user_id, m.role,
  c.type, (w.archived_at IS NULL AND c.archived_at IS NULL) AS can_write
FROM channels c
JOIN workspaces w ON w.id=c.workspace_id
JOIN memberships m ON m.workspace_id=c.workspace_id
WHERE NOT c.is_private OR EXISTS (
  SELECT 1 FROM channel_memberships cm WHERE cm.channel_id=c.id AND cm.user_id=m.user_id
);

CREATE TABLE workspace_invitations (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  email varchar(320),
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NULL OR email=lower(email)),
  CHECK (expires_at>created_at),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX invitations_workspace_idx ON workspace_invitations(workspace_id,created_at DESC);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(80) NOT NULL,
  target_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_workspace_idx ON audit_events(workspace_id,created_at DESC,id DESC);
