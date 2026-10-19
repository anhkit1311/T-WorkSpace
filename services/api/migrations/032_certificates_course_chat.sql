-- EL-8: chứng nhận hoàn thành, có mã tra cứu công khai (in kèm QR).
CREATE TABLE course_certificates (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code varchar(16) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{8,16}$'),
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, user_id)
);

-- EL-7: mỗi khóa học có một nhóm làm việc riêng để thảo luận (tái dùng chat nhóm) và tổ chức buổi live.
ALTER TABLE courses ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL;
