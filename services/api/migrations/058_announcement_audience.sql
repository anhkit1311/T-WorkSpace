-- Who may read an announcement: everyone, or staff only (students never receive 'staff' posts).
ALTER TABLE portal_announcements
  ADD COLUMN IF NOT EXISTS audience varchar(10) NOT NULL DEFAULT 'all'
  CHECK (audience IN ('all', 'staff'));
