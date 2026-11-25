-- A reader's heart ("like") and bookmark ("save") on an announcement.
CREATE TABLE IF NOT EXISTS announcement_marks (
  announcement_id uuid NOT NULL REFERENCES portal_announcements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(4) NOT NULL CHECK (kind IN ('like', 'save')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id, kind)
);
