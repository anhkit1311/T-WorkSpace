-- Academic module, phase 1: organisation, terms, enrolment, topics, groups,
-- registrations and the project state machine. See docs/academic/01-dac-ta-nghiep-vu.md.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE academic_units (
  id uuid PRIMARY KEY,
  code varchar(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  name varchar(160) NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE academic_departments (
  id uuid PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES academic_units(id) ON DELETE CASCADE,
  code varchar(20) NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,20}$'),
  name varchar(160) NOT NULL CHECK (length(trim(name)) > 0),
  UNIQUE (unit_id, code),
  UNIQUE (id, unit_id)
);

CREATE TABLE academic_staff (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  unit_id uuid NOT NULL REFERENCES academic_units(id) ON DELETE RESTRICT,
  department_id uuid,
  staff_code varchar(20) NOT NULL,
  academic_rank varchar(8) NOT NULL CHECK (academic_rank IN ('cn','ths','ts','pgs','gs')),
  default_quota smallint NOT NULL DEFAULT 8 CHECK (default_quota BETWEEN 0 AND 30),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, staff_code),
  FOREIGN KEY (department_id, unit_id) REFERENCES academic_departments(id, unit_id)
);

CREATE TABLE academic_role_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL CHECK (role IN ('system_admin','unit_admin','unit_head')),
  unit_id uuid REFERENCES academic_units(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'system_admin') = (unit_id IS NULL))
);
CREATE UNIQUE INDEX academic_role_grants_unique
  ON academic_role_grants (user_id, role, COALESCE(unit_id, '00000000-0000-0000-0000-000000000000'));

CREATE TABLE thesis_terms (
  id uuid PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES academic_units(id) ON DELETE RESTRICT,
  code varchar(30) NOT NULL CHECK (code ~ '^[A-Z0-9_.-]{2,30}$'),
  name varchar(160) NOT NULL CHECK (length(trim(name)) > 0),
  status varchar(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','registration','execution','review','defense','grading','closed')),
  registration_opens_at timestamptz NOT NULL,
  registration_closes_at timestamptz NOT NULL,
  final_due_at timestamptz NOT NULL,
  defense_starts_on date NOT NULL,
  defense_ends_on date NOT NULL,
  min_credits smallint NOT NULL DEFAULT 120 CHECK (min_credits BETWEEN 0 AND 300),
  min_gpa numeric(3,2) NOT NULL DEFAULT 2.00 CHECK (min_gpa BETWEEN 0 AND 4),
  min_group_size smallint NOT NULL DEFAULT 1,
  max_group_size smallint NOT NULL DEFAULT 3,
  max_preferences smallint NOT NULL DEFAULT 3 CHECK (max_preferences BETWEEN 1 AND 5),
  min_supervision_logs smallint NOT NULL DEFAULT 6 CHECK (min_supervision_logs BETWEEN 0 AND 30),
  late_policy varchar(16) NOT NULL DEFAULT 'allow_flagged' CHECK (late_policy IN ('reject','allow_flagged')),
  supervisor_weight smallint NOT NULL DEFAULT 20,
  reviewer_weight smallint NOT NULL DEFAULT 20,
  committee_weight smallint NOT NULL DEFAULT 60,
  max_score_deviation numeric(3,1) NOT NULL DEFAULT 2.0 CHECK (max_score_deviation BETWEEN 0.5 AND 5),
  pass_score numeric(3,1) NOT NULL DEFAULT 5.0 CHECK (pass_score BETWEEN 0 AND 10),
  appeal_window_days smallint NOT NULL DEFAULT 7 CHECK (appeal_window_days BETWEEN 1 AND 30),
  supervisor_in_committee boolean NOT NULL DEFAULT false,
  grades_published_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, code),
  CHECK (registration_opens_at < registration_closes_at),
  CHECK (registration_closes_at < final_due_at),
  CHECK (final_due_at::date <= defense_starts_on),
  CHECK (defense_starts_on <= defense_ends_on),
  CHECK (min_group_size BETWEEN 1 AND max_group_size AND max_group_size <= 5),
  CHECK (supervisor_weight >= 0 AND reviewer_weight >= 0 AND committee_weight > 0
         AND supervisor_weight + reviewer_weight + committee_weight = 100)
);

-- Per-term supervision quota override, counted in students.
CREATE TABLE thesis_term_supervisors (
  term_id uuid NOT NULL REFERENCES thesis_terms(id) ON DELETE CASCADE,
  lecturer_id uuid NOT NULL REFERENCES academic_staff(user_id),
  quota smallint NOT NULL CHECK (quota BETWEEN 0 AND 30),
  PRIMARY KEY (term_id, lecturer_id)
);

CREATE TABLE thesis_enrollments (
  term_id uuid NOT NULL REFERENCES thesis_terms(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  student_code varchar(20) NOT NULL CHECK (student_code ~ '^[A-Za-z0-9]{4,20}$'),
  class_name varchar(40) NOT NULL DEFAULT '',
  credits smallint NOT NULL CHECK (credits BETWEEN 0 AND 300),
  gpa numeric(3,2) NOT NULL CHECK (gpa BETWEEN 0 AND 4),
  eligible boolean NOT NULL,
  eligibility_override_reason varchar(500),
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (term_id, student_id),
  UNIQUE (term_id, student_code)
);

CREATE TABLE thesis_topics (
  id uuid PRIMARY KEY,
  term_id uuid NOT NULL REFERENCES thesis_terms(id) ON DELETE RESTRICT,
  code varchar(12) NOT NULL,
  title varchar(300) NOT NULL CHECK (length(trim(title)) >= 10),
  summary text NOT NULL CHECK (length(summary) BETWEEN 50 AND 8000),
  requirements text NOT NULL DEFAULT '' CHECK (length(requirements) <= 4000),
  expected_outcomes text NOT NULL DEFAULT '' CHECK (length(expected_outcomes) <= 4000),
  keywords text[] NOT NULL DEFAULT '{}' CHECK (cardinality(keywords) <= 10),
  proposed_by uuid NOT NULL REFERENCES users(id),
  proposer_kind varchar(10) NOT NULL CHECK (proposer_kind IN ('lecturer','student')),
  supervisor_id uuid NOT NULL REFERENCES academic_staff(user_id),
  co_supervisor_id uuid REFERENCES academic_staff(user_id),
  max_students smallint NOT NULL CHECK (max_students BETWEEN 1 AND 5),
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft','awaiting_supervisor','submitted','revision_requested','approved','rejected','closed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term_id, code),
  CHECK (co_supervisor_id IS NULL OR co_supervisor_id <> supervisor_id)
);
CREATE INDEX thesis_topics_term_status_idx ON thesis_topics (term_id, status, code);
CREATE INDEX thesis_topics_supervisor_idx ON thesis_topics (supervisor_id, term_id);

CREATE TABLE thesis_topic_decisions (
  id uuid PRIMARY KEY,
  topic_id uuid NOT NULL REFERENCES thesis_topics(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES users(id),
  decision varchar(20) NOT NULL CHECK (decision IN
    ('submit','supervisor_accept','supervisor_decline','approve','reject','request_revision','close')),
  note varchar(2000) NOT NULL DEFAULT '',
  from_status varchar(20) NOT NULL,
  to_status varchar(20) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX thesis_topic_decisions_idx ON thesis_topic_decisions (topic_id, created_at);

CREATE TABLE thesis_groups (
  id uuid PRIMARY KEY,
  term_id uuid NOT NULL REFERENCES thesis_terms(id) ON DELETE RESTRICT,
  leader_id uuid NOT NULL REFERENCES users(id),
  status varchar(12) NOT NULL DEFAULT 'forming' CHECK (status IN ('forming','assigned','dissolved')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, term_id),
  FOREIGN KEY (term_id, leader_id) REFERENCES thesis_enrollments(term_id, student_id)
);

CREATE TABLE thesis_group_members (
  group_id uuid NOT NULL,
  term_id uuid NOT NULL,
  student_id uuid NOT NULL,
  status varchar(10) NOT NULL CHECK (status IN ('invited','active','declined','left')),
  invited_by uuid NOT NULL REFERENCES users(id),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, student_id),
  FOREIGN KEY (group_id, term_id) REFERENCES thesis_groups(id, term_id) ON DELETE CASCADE,
  FOREIGN KEY (term_id, student_id) REFERENCES thesis_enrollments(term_id, student_id)
);
-- A student belongs to at most one active group per term.
CREATE UNIQUE INDEX thesis_group_members_one_active
  ON thesis_group_members (term_id, student_id) WHERE status = 'active';
CREATE INDEX thesis_group_members_student_idx ON thesis_group_members (student_id, status);

CREATE TABLE thesis_registrations (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES thesis_groups(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES thesis_topics(id) ON DELETE RESTRICT,
  rank smallint NOT NULL CHECK (rank BETWEEN 1 AND 5),
  status varchar(10) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','rejected','withdrawn','expired')),
  note varchar(1000) NOT NULL DEFAULT '',
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, topic_id)
);
CREATE UNIQUE INDEX thesis_registrations_rank_live
  ON thesis_registrations (group_id, rank) WHERE status IN ('pending','accepted');
CREATE UNIQUE INDEX thesis_registrations_one_accepted
  ON thesis_registrations (group_id) WHERE status = 'accepted';
CREATE INDEX thesis_registrations_topic_idx ON thesis_registrations (topic_id, status);

CREATE TABLE thesis_project_transitions (
  from_status varchar(20) NOT NULL,
  to_status varchar(20) NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
INSERT INTO thesis_project_transitions VALUES
  ('proposal','in_progress'),
  ('in_progress','final_submitted'),
  ('final_submitted','in_progress'),
  ('final_submitted','defense_approved'),
  ('defense_approved','under_review'),
  ('under_review','review_passed'),
  ('under_review','review_failed'),
  ('review_passed','scheduled'),
  ('scheduled','review_passed'),
  ('scheduled','defended'),
  ('defended','graded'),
  ('graded','completed'),
  ('graded','failed'),
  ('review_failed','failed'),
  ('proposal','withdrawn'),('in_progress','withdrawn'),('final_submitted','withdrawn'),
  ('proposal','suspended'),('in_progress','suspended'),('final_submitted','suspended'),
  ('defense_approved','suspended'),('under_review','suspended'),('review_passed','suspended'),
  ('scheduled','suspended');

CREATE TABLE thesis_projects (
  id uuid PRIMARY KEY,
  term_id uuid NOT NULL REFERENCES thesis_terms(id) ON DELETE RESTRICT,
  code varchar(16) NOT NULL,
  group_id uuid NOT NULL UNIQUE REFERENCES thesis_groups(id),
  topic_id uuid NOT NULL REFERENCES thesis_topics(id),
  supervisor_id uuid NOT NULL REFERENCES academic_staff(user_id),
  co_supervisor_id uuid REFERENCES academic_staff(user_id),
  student_count smallint NOT NULL CHECK (student_count BETWEEN 1 AND 5),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'proposal' CHECK (status IN
    ('proposal','in_progress','final_submitted','defense_approved','under_review','review_passed',
     'review_failed','scheduled','defended','graded','completed','failed','withdrawn','suspended')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term_id, code)
);
CREATE INDEX thesis_projects_term_status_idx ON thesis_projects (term_id, status);
CREATE INDEX thesis_projects_supervisor_idx ON thesis_projects (supervisor_id, term_id);
CREATE INDEX thesis_projects_topic_idx ON thesis_projects (topic_id);

CREATE TABLE thesis_project_events (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES thesis_projects(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES users(id),
  from_status varchar(20),
  to_status varchar(20) NOT NULL,
  note varchar(2000) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX thesis_project_events_idx ON thesis_project_events (project_id, created_at);

CREATE TABLE academic_audit_events (
  id uuid PRIMARY KEY,
  unit_id uuid REFERENCES academic_units(id) ON DELETE RESTRICT,
  term_id uuid REFERENCES thesis_terms(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES users(id),
  entity varchar(30) NOT NULL,
  entity_id uuid NOT NULL,
  action varchar(60) NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX academic_audit_term_idx ON academic_audit_events (term_id, created_at DESC, id DESC);
CREATE INDEX academic_audit_entity_idx ON academic_audit_events (entity, entity_id, created_at);

CREATE TABLE academic_notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(40) NOT NULL,
  entity varchar(30) NOT NULL,
  entity_id uuid NOT NULL,
  title varchar(300) NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX academic_notifications_user_idx ON academic_notifications (user_id, created_at DESC, id DESC);
CREATE INDEX academic_notifications_unread_idx ON academic_notifications (user_id) WHERE read_at IS NULL;

-- Append-only guard shared by every history/ledger table of the module.
CREATE FUNCTION academic_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER thesis_topic_decisions_append_only BEFORE UPDATE OR DELETE ON thesis_topic_decisions
  FOR EACH ROW EXECUTE FUNCTION academic_append_only();
CREATE TRIGGER thesis_project_events_append_only BEFORE UPDATE OR DELETE ON thesis_project_events
  FOR EACH ROW EXECUTE FUNCTION academic_append_only();
CREATE TRIGGER academic_audit_events_append_only BEFORE UPDATE OR DELETE ON academic_audit_events
  FOR EACH ROW EXECUTE FUNCTION academic_append_only();

-- The project lifecycle is enforced by the database, not only by the service layer.
CREATE FUNCTION thesis_project_guard_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposal' THEN
      RAISE EXCEPTION 'Projects start in the proposal state' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
    SELECT 1 FROM thesis_project_transitions WHERE from_status = OLD.status AND to_status = NEW.status
  ) THEN
    RAISE EXCEPTION 'Illegal project transition % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  IF NEW.term_id <> OLD.term_id OR NEW.group_id <> OLD.group_id OR NEW.topic_id <> OLD.topic_id THEN
    RAISE EXCEPTION 'Project identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER thesis_projects_transition_guard BEFORE INSERT OR UPDATE ON thesis_projects
  FOR EACH ROW EXECUTE FUNCTION thesis_project_guard_transition();
CREATE TRIGGER thesis_project_transitions_frozen BEFORE INSERT OR UPDATE OR DELETE ON thesis_project_transitions
  FOR EACH STATEMENT EXECUTE FUNCTION academic_append_only();

-- Terms move forward one phase at a time.
CREATE FUNCTION thesis_term_guard_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  phases text[] := ARRAY['draft','registration','execution','review','defense','grading','closed'];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND array_position(phases, NEW.status) <> array_position(phases, OLD.status) + 1 THEN
    RAISE EXCEPTION 'Illegal term transition % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'Closed terms are read-only' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER thesis_terms_status_guard BEFORE UPDATE ON thesis_terms
  FOR EACH ROW EXECUTE FUNCTION thesis_term_guard_status();
