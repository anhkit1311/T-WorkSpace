CREATE TABLE tasks (
 id uuid PRIMARY KEY,
 channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
 created_by uuid NOT NULL REFERENCES users(id),
 client_task_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=8000),
 status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','doing','done')),
 priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
 due_at timestamptz,
 assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
 source_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
 position bigint NOT NULL DEFAULT 0,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(created_by,client_task_id)
);
CREATE INDEX tasks_board_idx ON tasks(channel_id,archived_at,status,position,id);
CREATE INDEX tasks_assignee_idx ON tasks(assignee_id,due_at) WHERE archived_at IS NULL;
CREATE TABLE task_checklist (
 id uuid PRIMARY KEY,
 task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 200),
 done boolean NOT NULL DEFAULT false,
 position integer NOT NULL DEFAULT 0
);
CREATE TABLE task_comments (
 id uuid PRIMARY KEY,
 task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 author_id uuid NOT NULL REFERENCES users(id),
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_comments_timeline_idx ON task_comments(task_id,created_at,id);
CREATE TABLE task_attachments (
 task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 attachment_id uuid NOT NULL REFERENCES message_attachments(id),
 attached_by uuid NOT NULL REFERENCES users(id),
 PRIMARY KEY(task_id,attachment_id)
);
CREATE TABLE task_activity (
 id uuid PRIMARY KEY,
 task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES users(id),
 action text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_activity_timeline_idx ON task_activity(task_id,created_at DESC,id DESC);
