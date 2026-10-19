-- E-learning (EL-1..EL-6, LT-1, LT-2). Courses belong to an academic unit: the unit's admins manage
-- its catalogue and, when the unit runs a call-center department, its hotline answers "Cần hỗ trợ".

CREATE TABLE courses (
  id uuid PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES academic_units(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  code varchar(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  title varchar(160) NOT NULL CHECK (length(trim(title)) > 0),
  description varchar(4000) NOT NULL DEFAULT '',
  status varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  -- open: anyone may enroll once published; assigned: only learners the staff assigns.
  enrollment varchar(10) NOT NULL DEFAULT 'open' CHECK (enrollment IN ('open','assigned')),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Co-teachers: see every learner's progress and edit the course like the owner.
CREATE TABLE course_instructors (
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (course_id, user_id)
);

CREATE TABLE course_chapters (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title varchar(160) NOT NULL CHECK (length(trim(title)) > 0),
  position integer NOT NULL DEFAULT 0
);
CREATE INDEX course_chapters_course_idx ON course_chapters(course_id, position);

CREATE TABLE course_lessons (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES course_chapters(id) ON DELETE CASCADE,
  title varchar(160) NOT NULL CHECK (length(trim(title)) > 0),
  kind varchar(10) NOT NULL CHECK (kind IN ('video','document','quiz','live')),
  status varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  position integer NOT NULL DEFAULT 0,
  -- document: text shown on the page; any lesson may also carry an uploaded file (PDF for documents).
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 50000),
  -- video: an uploaded file converted to HLS (EL-3), or a meeting recording (LT-2 replay).
  media_status varchar(12) NOT NULL DEFAULT 'none' CHECK (media_status IN ('none','processing','ready','failed')),
  media_name varchar(200),
  media_error varchar(500),
  duration_seconds integer CHECK (duration_seconds >= 0),
  recording_id uuid REFERENCES meeting_recordings(id) ON DELETE SET NULL,
  -- quiz (EL-4)
  time_limit_seconds integer CHECK (time_limit_seconds BETWEEN 60 AND 14400),
  pass_percent smallint NOT NULL DEFAULT 50 CHECK (pass_percent BETWEEN 0 AND 100),
  -- live (EL-6): the meeting schedule of the class; attendance is closed once (LT-2).
  schedule_id uuid REFERENCES meeting_schedules(id) ON DELETE SET NULL,
  attendance_closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind = 'video' OR recording_id IS NULL),
  CHECK (kind = 'live' OR schedule_id IS NULL)
);
CREATE INDEX course_lessons_chapter_idx ON course_lessons(chapter_id, position);
CREATE INDEX course_lessons_course_idx ON course_lessons(course_id);
CREATE UNIQUE INDEX course_lessons_schedule_idx ON course_lessons(schedule_id) WHERE schedule_id IS NOT NULL;

CREATE TABLE course_enrollments (
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source varchar(10) NOT NULL CHECK (source IN ('self','assigned')),
  assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (course_id, user_id)
);
CREATE INDEX course_enrollments_user_idx ON course_enrollments(user_id);

-- EL-4 question bank, per course. options: [{id,text}]; answer: option ids (single/multiple) or [true|false].
CREATE TABLE course_questions (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  kind varchar(10) NOT NULL CHECK (kind IN ('single','multiple','true_false')),
  prompt varchar(2000) NOT NULL CHECK (length(trim(prompt)) > 0),
  options jsonb NOT NULL DEFAULT '[]',
  answer jsonb NOT NULL,
  explanation varchar(2000) NOT NULL DEFAULT '',
  points smallint NOT NULL DEFAULT 1 CHECK (points BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX course_questions_course_idx ON course_questions(course_id);

CREATE TABLE course_quiz_questions (
  lesson_id uuid NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES course_questions(id) ON DELETE RESTRICT,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (lesson_id, question_id)
);

CREATE TABLE course_quiz_attempts (
  id uuid PRIMARY KEY,
  lesson_id uuid NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz,
  submitted_at timestamptz,
  answers jsonb,
  score numeric(7,2),
  max_score numeric(7,2),
  passed boolean,
  CHECK ((submitted_at IS NULL) = (score IS NULL))
);
-- One attempt in progress per learner and quiz.
CREATE UNIQUE INDEX course_quiz_attempts_open_idx ON course_quiz_attempts(lesson_id, user_id) WHERE submitted_at IS NULL;

-- EL-5: a lesson is done when watched/read (marked by the learner), its quiz passed, or the live class attended.
CREATE TABLE course_lesson_progress (
  lesson_id uuid NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, user_id)
);

-- EL-6: attendance of a live class, from the meeting's join/leave records; attended = present >= 70%.
CREATE TABLE course_live_attendance (
  lesson_id uuid NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  present_seconds integer NOT NULL CHECK (present_seconds >= 0),
  ratio numeric(5,4) NOT NULL CHECK (ratio BETWEEN 0 AND 1),
  attended boolean NOT NULL,
  PRIMARY KEY (lesson_id, user_id)
);

-- LT-1: "Cần hỗ trợ" from a lesson opens a ticket in the unit's call-center department.
ALTER TABLE cc_tickets DROP CONSTRAINT cc_tickets_source_check;
ALTER TABLE cc_tickets ADD CONSTRAINT cc_tickets_source_check CHECK (source IN ('call', 'missed_call', 'voicemail', 'manual', 'elearning'));
ALTER TABLE cc_tickets ADD COLUMN lesson_id uuid REFERENCES course_lessons(id) ON DELETE SET NULL;
