CREATE INDEX messages_channel_timeline_idx ON messages(channel_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE TABLE meeting_participations (
  id uuid PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  socket_id text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  CONSTRAINT meeting_dates_check CHECK (left_at IS NULL OR left_at >= joined_at)
);
CREATE INDEX meeting_participations_channel_idx ON meeting_participations(channel_id, joined_at DESC);

INSERT INTO channels (id, workspace_id, created_by, name, type, position)
SELECT gen_random_uuid(), w.id, w.owner_id, 'phong-hop', 'video', 5
FROM workspaces w WHERE NOT EXISTS (
  SELECT 1 FROM channels c WHERE c.workspace_id = w.id AND c.type IN ('voice', 'video')
) ON CONFLICT (workspace_id, name) DO NOTHING;
