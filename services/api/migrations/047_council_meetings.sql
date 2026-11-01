-- NV-MT3 / BR-12: họp hội đồng. Một lịch họp có thể là hội đồng: thành viên (một chủ tịch), tiêu
-- chí chấm có trọng số, danh sách người trình bày. Mỗi thành viên nộp một phiếu cho mỗi người trình
-- bày (điểm 0–10 theo tiêu chí); chủ tịch chốt khi mọi thành viên có mặt đã nộp.
CREATE TABLE council_members (
  schedule_id uuid NOT NULL REFERENCES meeting_schedules(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('chair','member')),
  absent boolean NOT NULL DEFAULT false,
  PRIMARY KEY (schedule_id, user_id)
);
CREATE UNIQUE INDEX council_members_one_chair_idx ON council_members(schedule_id) WHERE role = 'chair';

CREATE TABLE council_criteria (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES meeting_schedules(id) ON DELETE CASCADE,
  label varchar(120) NOT NULL,
  weight smallint NOT NULL CHECK (weight BETWEEN 1 AND 100),
  position smallint NOT NULL
);
CREATE INDEX council_criteria_schedule_idx ON council_criteria(schedule_id, position);

CREATE TABLE council_presenters (
  id uuid PRIMARY KEY,
  schedule_id uuid NOT NULL REFERENCES meeting_schedules(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic varchar(200) NOT NULL,
  position smallint NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','presenting','done')),
  final_score numeric(4,2) CHECK (final_score BETWEEN 0 AND 10),
  conclusion varchar(2000),
  finalized_at timestamptz,
  finalized_by uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (schedule_id, user_id)
);
CREATE INDEX council_presenters_schedule_idx ON council_presenters(schedule_id, position);

CREATE TABLE council_sheets (
  presenter_id uuid NOT NULL REFERENCES council_presenters(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- {criterionId: điểm 0..10}; tiêu chí bị khóa khi đã có phiếu nên khóa trong jsonb luôn hợp lệ.
  scores jsonb NOT NULL,
  comment varchar(2000) NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (presenter_id, member_id)
);
