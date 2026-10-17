-- One-to-one chat (plan CH-1..CH-3). A direct conversation is a channel of kind 'direct' outside any
-- workspace, so messages, files, reactions, read state, search and socket events keep running on the
-- group chat pipeline unchanged. Group channels keep kind 'workspace' and their existing access path.

ALTER TABLE channels
  ADD COLUMN kind varchar(10) NOT NULL DEFAULT 'workspace' CHECK (kind IN ('workspace', 'direct')),
  ALTER COLUMN workspace_id DROP NOT NULL,
  ADD CONSTRAINT channels_kind_workspace CHECK ((kind = 'direct') = (workspace_id IS NULL));

-- The pair is stored ordered so two people can only ever share one conversation.
CREATE TABLE direct_conversations (
  channel_id uuid PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  user_low uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_low < user_high),
  UNIQUE (user_low, user_high)
);
CREATE INDEX direct_conversations_high_idx ON direct_conversations (user_high);

-- Same columns as before, plus exactly two rows per direct channel (one per participant).
CREATE OR REPLACE VIEW channel_access AS
SELECT c.id AS channel_id, c.workspace_id, m.user_id, m.role,
  c.type, (w.archived_at IS NULL AND c.archived_at IS NULL) AS can_write
FROM channels c
JOIN workspaces w ON w.id=c.workspace_id
JOIN memberships m ON m.workspace_id=c.workspace_id
WHERE NOT c.is_private OR EXISTS (
  SELECT 1 FROM channel_memberships cm WHERE cm.channel_id=c.id AND cm.user_id=m.user_id
)
UNION ALL
SELECT c.id, NULL::uuid, p.user_id, 'member'::varchar(20), c.type, c.archived_at IS NULL
FROM channels c
JOIN direct_conversations d ON d.channel_id=c.id
CROSS JOIN LATERAL (VALUES (d.user_low), (d.user_high)) AS p(user_id);

ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('mention', 'thread', 'direct'));
