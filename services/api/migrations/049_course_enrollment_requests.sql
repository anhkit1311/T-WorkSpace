-- NV-EL2: a course "cần duyệt" takes requests that an instructor approves or rejects.
ALTER TABLE courses DROP CONSTRAINT courses_enrollment_check;
ALTER TABLE courses ADD CONSTRAINT courses_enrollment_check CHECK (enrollment IN ('open','assigned','approval'));

CREATE TABLE course_enrollment_requests (
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, user_id)
);
