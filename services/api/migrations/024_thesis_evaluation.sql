-- Academic module, phase 3: review, committees, defense schedule, grading, ledger, appeals.
CREATE TABLE thesis_reviews (
  project_id uuid PRIMARY KEY REFERENCES thesis_projects(id) ON DELETE RESTRICT,
  reviewer_id uuid NOT NULL REFERENCES academic_staff(user_id),
  assigned_by uuid NOT NULL REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  recommendation varchar(8) CHECK (recommendation IN ('approve','reject')),
  comments text CHECK (comments IS NULL OR length(trim(comments)) BETWEEN 50 AND 10000),
  questions text CHECK (questions IS NULL OR length(questions) <= 4000),
  submitted_at timestamptz,
  CHECK ((submitted_at IS NULL) = (recommendation IS NULL)),
  CHECK (submitted_at IS NULL OR comments IS NOT NULL)
);
CREATE INDEX thesis_reviews_reviewer_idx ON thesis_reviews (reviewer_id);

-- Reviewer must differ from both supervisors; enforced in the database as well.
CREATE FUNCTION thesis_review_conflict_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM thesis_projects p WHERE p.id = NEW.project_id
             AND NEW.reviewer_id IN (p.supervisor_id, COALESCE(p.co_supervisor_id, p.supervisor_id))) THEN
    RAISE EXCEPTION 'Reviewer cannot supervise the same project' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Submitted reviews are final' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER thesis_reviews_conflict_guard BEFORE INSERT OR UPDATE ON thesis_reviews
  FOR EACH ROW EXECUTE FUNCTION thesis_review_conflict_guard();

CREATE TABLE thesis_committees (
  id uuid PRIMARY KEY,
  term_id uuid NOT NULL REFERENCES thesis_terms(id) ON DELETE RESTRICT,
  code varchar(20) NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  name varchar(160) NOT NULL,
  room varchar(60) NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','closed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term_id, code)
);

CREATE TABLE thesis_committee_members (
  committee_id uuid NOT NULL REFERENCES thesis_committees(id) ON DELETE CASCADE,
  lecturer_id uuid NOT NULL REFERENCES academic_staff(user_id),
  role varchar(10) NOT NULL CHECK (role IN ('chair','secretary','member')),
  PRIMARY KEY (committee_id, lecturer_id)
);
CREATE UNIQUE INDEX thesis_committee_one_chair ON thesis_committee_members (committee_id) WHERE role = 'chair';
CREATE UNIQUE INDEX thesis_committee_one_secretary ON thesis_committee_members (committee_id) WHERE role = 'secretary';

CREATE FUNCTION thesis_committee_member_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid := COALESCE(NEW.committee_id, OLD.committee_id);
BEGIN
  IF (SELECT status FROM thesis_committees WHERE id = target) <> 'draft' THEN
    RAISE EXCEPTION 'Committee membership is frozen after confirmation' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.role = 'chair'
     AND (SELECT academic_rank FROM academic_staff WHERE user_id = NEW.lecturer_id) NOT IN ('ts','pgs','gs') THEN
    RAISE EXCEPTION 'Committee chair must hold a doctorate' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER thesis_committee_members_guard BEFORE INSERT OR UPDATE OR DELETE ON thesis_committee_members
  FOR EACH ROW EXECUTE FUNCTION thesis_committee_member_guard();

CREATE TABLE thesis_defense_slots (
  id uuid PRIMARY KEY,
  committee_id uuid NOT NULL REFERENCES thesis_committees(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL UNIQUE REFERENCES thesis_projects(id) ON DELETE RESTRICT,
  during tstzrange NOT NULL CHECK (NOT isempty(during) AND lower_inc(during) AND NOT upper_inc(during)),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (upper(during) - lower(during) BETWEEN interval '15 minutes' AND interval '3 hours'),
  EXCLUDE USING gist (committee_id WITH =, during WITH &&)
);

-- Materialised per-lecturer bookings: a lecturer cannot sit two overlapping defenses anywhere.
CREATE TABLE thesis_lecturer_bookings (
  slot_id uuid NOT NULL REFERENCES thesis_defense_slots(id) ON DELETE CASCADE,
  lecturer_id uuid NOT NULL REFERENCES academic_staff(user_id),
  during tstzrange NOT NULL,
  PRIMARY KEY (slot_id, lecturer_id),
  EXCLUDE USING gist (lecturer_id WITH =, during WITH &&)
);

CREATE FUNCTION thesis_slot_bookings() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  allow_supervisor boolean;
BEGIN
  SELECT t.supervisor_in_committee INTO allow_supervisor
    FROM thesis_committees c JOIN thesis_terms t ON t.id = c.term_id WHERE c.id = NEW.committee_id;
  IF (SELECT status FROM thesis_committees WHERE id = NEW.committee_id) <> 'confirmed' THEN
    RAISE EXCEPTION 'Only confirmed committees can hold defenses' USING ERRCODE = '23514';
  END IF;
  IF NOT allow_supervisor AND EXISTS (
    SELECT 1 FROM thesis_committee_members m JOIN thesis_projects p ON p.id = NEW.project_id
     WHERE m.committee_id = NEW.committee_id
       AND m.lecturer_id IN (p.supervisor_id, COALESCE(p.co_supervisor_id, p.supervisor_id))) THEN
    RAISE EXCEPTION 'A supervisor cannot sit on the committee of their own project' USING ERRCODE = '23514';
  END IF;
  DELETE FROM thesis_lecturer_bookings WHERE slot_id = NEW.id;
  INSERT INTO thesis_lecturer_bookings (slot_id, lecturer_id, during)
    SELECT NEW.id, lecturer_id, NEW.during FROM thesis_committee_members WHERE committee_id = NEW.committee_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER thesis_defense_slots_bookings AFTER INSERT OR UPDATE OF during, committee_id ON thesis_defense_slots
  FOR EACH ROW EXECUTE FUNCTION thesis_slot_bookings();

CREATE TABLE thesis_rubric_criteria (
  id uuid PRIMARY KEY,
  term_id uuid NOT NULL REFERENCES thesis_terms(id) ON DELETE CASCADE,
  grader_role varchar(10) NOT NULL CHECK (grader_role IN ('supervisor','reviewer','committee')),
  code varchar(10) NOT NULL,
  name varchar(200) NOT NULL,
  weight numeric(5,2) NOT NULL CHECK (weight > 0 AND weight <= 100),
  position smallint NOT NULL DEFAULT 0,
  UNIQUE (term_id, grader_role, code)
);

CREATE TABLE thesis_score_sheets (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES thesis_projects(id) ON DELETE RESTRICT,
  grader_id uuid NOT NULL REFERENCES academic_staff(user_id),
  grader_role varchar(10) NOT NULL CHECK (grader_role IN ('supervisor','reviewer','committee')),
  total numeric(4,2) CHECK (total BETWEEN 0 AND 10),
  comment varchar(4000) NOT NULL DEFAULT '',
  submitted_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (project_id, grader_id, grader_role),
  CHECK ((submitted_at IS NULL) = (total IS NULL))
);
-- Supervisor and reviewer each grade once per project.
CREATE UNIQUE INDEX thesis_score_sheets_single_role ON thesis_score_sheets (project_id, grader_role)
  WHERE grader_role IN ('supervisor','reviewer');

CREATE TABLE thesis_score_items (
  sheet_id uuid NOT NULL REFERENCES thesis_score_sheets(id) ON DELETE CASCADE,
  criterion_id uuid NOT NULL REFERENCES thesis_rubric_criteria(id) ON DELETE RESTRICT,
  score numeric(4,2) NOT NULL CHECK (score BETWEEN 0 AND 10 AND score * 4 = trunc(score * 4)),
  PRIMARY KEY (sheet_id, criterion_id)
);

CREATE TABLE thesis_results (
  project_id uuid PRIMARY KEY REFERENCES thesis_projects(id) ON DELETE RESTRICT,
  supervisor_score numeric(4,2) NOT NULL,
  reviewer_score numeric(4,2) NOT NULL,
  committee_score numeric(4,2) NOT NULL,
  committee_spread numeric(4,2) NOT NULL,
  deviation_note varchar(4000),
  final_score numeric(3,1) NOT NULL CHECK (final_score BETWEEN 0 AND 10),
  letter varchar(2) NOT NULL CHECK (letter IN ('A','B+','B','C+','C','D+','D','F')),
  passed boolean NOT NULL,
  finalized_by uuid NOT NULL REFERENCES users(id),
  finalized_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  adjusted_by_appeal boolean NOT NULL DEFAULT false
);

-- Score sheets are locked once a result exists for the project, and each sheet is final once submitted.
CREATE FUNCTION thesis_score_sheet_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM thesis_results WHERE project_id = COALESCE(NEW.project_id, OLD.project_id)) THEN
    RAISE EXCEPTION 'Scores are locked after finalisation' USING ERRCODE = '23514';
  END IF;
  IF TG_OP <> 'INSERT' AND OLD.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Submitted score sheets are final' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER thesis_score_sheets_lock BEFORE INSERT OR UPDATE OR DELETE ON thesis_score_sheets
  FOR EACH ROW EXECUTE FUNCTION thesis_score_sheet_guard();

CREATE FUNCTION thesis_score_item_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sheet record;
BEGIN
  SELECT project_id, submitted_at INTO sheet FROM thesis_score_sheets WHERE id = COALESCE(NEW.sheet_id, OLD.sheet_id);
  IF EXISTS (SELECT 1 FROM thesis_results WHERE project_id = sheet.project_id) THEN
    RAISE EXCEPTION 'Scores are locked after finalisation' USING ERRCODE = '23514';
  END IF;
  IF sheet.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Submitted score sheets are final' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER thesis_score_items_lock BEFORE INSERT OR UPDATE OR DELETE ON thesis_score_items
  FOR EACH ROW EXECUTE FUNCTION thesis_score_item_guard();

-- Results only change through publication or an appeal decision, never silently.
CREATE FUNCTION thesis_result_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Results cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF (NEW.supervisor_score, NEW.reviewer_score, NEW.committee_score, NEW.committee_spread, NEW.finalized_by, NEW.finalized_at)
     IS DISTINCT FROM
     (OLD.supervisor_score, OLD.reviewer_score, OLD.committee_score, OLD.committee_spread, OLD.finalized_by, OLD.finalized_at) THEN
    RAISE EXCEPTION 'Component scores are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.final_score IS DISTINCT FROM OLD.final_score AND NOT NEW.adjusted_by_appeal THEN
    RAISE EXCEPTION 'Final score changes only through an appeal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER thesis_results_guard BEFORE UPDATE OR DELETE ON thesis_results
  FOR EACH ROW EXECUTE FUNCTION thesis_result_guard();

-- Tamper-evident grade ledger: hash = sha256(prev_hash || canonical payload).
CREATE TABLE thesis_grade_ledger (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  term_id uuid NOT NULL REFERENCES thesis_terms(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES thesis_projects(id) ON DELETE RESTRICT,
  event varchar(20) NOT NULL CHECK (event IN ('finalized','appeal_adjusted')),
  payload text NOT NULL,
  prev_hash char(64) NOT NULL,
  hash char(64) NOT NULL UNIQUE,
  actor_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX thesis_grade_ledger_term_idx ON thesis_grade_ledger (term_id, seq);
CREATE TRIGGER thesis_grade_ledger_append_only BEFORE UPDATE OR DELETE ON thesis_grade_ledger
  FOR EACH ROW EXECUTE FUNCTION academic_append_only();

CREATE TABLE thesis_appeals (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL UNIQUE REFERENCES thesis_projects(id) ON DELETE RESTRICT,
  filed_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 30 AND 4000),
  status varchar(10) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','upheld','adjusted')),
  decision_note varchar(4000),
  new_score numeric(3,1) CHECK (new_score BETWEEN 0 AND 10),
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'submitted') = (decided_at IS NULL)),
  CHECK ((status = 'adjusted') = (new_score IS NOT NULL))
);

-- An appeal may flip the published outcome in either direction.
ALTER TABLE thesis_project_transitions DISABLE TRIGGER thesis_project_transitions_frozen;
INSERT INTO thesis_project_transitions VALUES ('completed','failed'),('failed','completed');
ALTER TABLE thesis_project_transitions ENABLE TRIGGER thesis_project_transitions_frozen;
