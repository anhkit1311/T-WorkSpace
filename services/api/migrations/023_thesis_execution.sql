-- Academic module, phase 2: milestones, immutable submissions, supervision logs.
CREATE TABLE thesis_milestones (
  id uuid PRIMARY KEY,
  term_id uuid NOT NULL REFERENCES thesis_terms(id) ON DELETE RESTRICT,
  code varchar(20) NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  name varchar(160) NOT NULL CHECK (length(trim(name)) > 0),
  kind varchar(10) NOT NULL CHECK (kind IN ('proposal','progress','final')),
  due_at timestamptz NOT NULL,
  required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term_id, code)
);
-- One proposal and one final milestone per term; progress milestones are unbounded.
CREATE UNIQUE INDEX thesis_milestones_single_kind ON thesis_milestones (term_id, kind)
  WHERE kind IN ('proposal','final');

CREATE TABLE thesis_submissions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES thesis_projects(id) ON DELETE RESTRICT,
  milestone_id uuid NOT NULL REFERENCES thesis_milestones(id) ON DELETE RESTRICT,
  version_no smallint NOT NULL CHECK (version_no BETWEEN 1 AND 100),
  attachment_id uuid NOT NULL REFERENCES message_attachments(id) ON DELETE RESTRICT,
  file_name varchar(180) NOT NULL,
  file_size integer NOT NULL CHECK (file_size > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  note varchar(2000) NOT NULL DEFAULT '',
  submitted_by uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  is_late boolean NOT NULL,
  review_status varchar(20) NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending','accepted','revision_requested','superseded')),
  feedback varchar(4000),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  UNIQUE (project_id, milestone_id, version_no),
  CHECK ((review_status IN ('pending','superseded')) OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX thesis_submissions_project_idx ON thesis_submissions (project_id, milestone_id, version_no DESC);

-- Submitted bytes and metadata never change; only the single review decision may be recorded,
-- and a pending version may be superseded by a newer one.
CREATE FUNCTION thesis_submission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Submissions cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF (NEW.project_id, NEW.milestone_id, NEW.version_no, NEW.attachment_id, NEW.file_name, NEW.file_size,
      NEW.sha256, NEW.note, NEW.submitted_by, NEW.submitted_at, NEW.is_late)
     IS DISTINCT FROM
     (OLD.project_id, OLD.milestone_id, OLD.version_no, OLD.attachment_id, OLD.file_name, OLD.file_size,
      OLD.sha256, OLD.note, OLD.submitted_by, OLD.submitted_at, OLD.is_late) THEN
    RAISE EXCEPTION 'Submission content is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.review_status <> 'pending' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Submission review is final' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER thesis_submissions_guard BEFORE UPDATE OR DELETE ON thesis_submissions
  FOR EACH ROW EXECUTE FUNCTION thesis_submission_guard();

CREATE TABLE thesis_supervision_logs (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES thesis_projects(id) ON DELETE RESTRICT,
  held_at timestamptz NOT NULL,
  mode varchar(8) NOT NULL CHECK (mode IN ('online','offline')),
  meeting_session_id uuid REFERENCES meeting_sessions(id) ON DELETE SET NULL,
  content text NOT NULL CHECK (length(trim(content)) BETWEEN 20 AND 6000),
  next_actions text NOT NULL DEFAULT '' CHECK (length(next_actions) <= 3000),
  created_by uuid NOT NULL REFERENCES users(id),
  supervisor_confirmed_by uuid REFERENCES users(id),
  supervisor_confirmed_at timestamptz,
  student_confirmed_by uuid REFERENCES users(id),
  student_confirmed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((supervisor_confirmed_by IS NULL) = (supervisor_confirmed_at IS NULL)),
  CHECK ((student_confirmed_by IS NULL) = (student_confirmed_at IS NULL)),
  CHECK (mode = 'online' OR meeting_session_id IS NULL)
);
CREATE INDEX thesis_supervision_logs_project_idx ON thesis_supervision_logs (project_id, held_at DESC);
-- A meeting session can back at most one log.
CREATE UNIQUE INDEX thesis_supervision_logs_session_unique ON thesis_supervision_logs (meeting_session_id)
  WHERE meeting_session_id IS NOT NULL;

CREATE FUNCTION thesis_supervision_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.supervisor_confirmed_at IS NOT NULL OR OLD.student_confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Confirmed logs cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.supervisor_confirmed_at IS NOT NULL AND OLD.student_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Fully confirmed logs are locked' USING ERRCODE = '23514';
  END IF;
  IF (OLD.supervisor_confirmed_at IS NOT NULL OR OLD.student_confirmed_at IS NOT NULL)
     AND (NEW.held_at, NEW.mode, NEW.meeting_session_id, NEW.content, NEW.next_actions)
         IS DISTINCT FROM (OLD.held_at, OLD.mode, OLD.meeting_session_id, OLD.content, OLD.next_actions) THEN
    RAISE EXCEPTION 'Log content is locked after the first confirmation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER thesis_supervision_logs_guard BEFORE UPDATE OR DELETE ON thesis_supervision_logs
  FOR EACH ROW EXECUTE FUNCTION thesis_supervision_log_guard();
