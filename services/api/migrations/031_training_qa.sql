-- LT-4 / E1: khóa đào tạo bắt buộc trước khi tổng đài viên được bật "Sẵn sàng".
-- V7 / E2: phiếu chấm điểm cuộc gọi; điểm dưới ngưỡng thì tự gán khóa bồi dưỡng.

ALTER TABLE cc_departments
  ADD COLUMN training_course_id uuid REFERENCES courses(id) ON DELETE SET NULL,
  ADD COLUMN coaching_course_id uuid REFERENCES courses(id) ON DELETE SET NULL,
  ADD COLUMN qa_threshold smallint NOT NULL DEFAULT 70 CHECK (qa_threshold BETWEEN 0 AND 100);

-- Tiêu chí chấm của từng phòng ban; mỗi tiêu chí chấm 0..10, nhân trọng số.
CREATE TABLE cc_qa_criteria (
  id uuid PRIMARY KEY,
  department_id uuid NOT NULL REFERENCES cc_departments(unit_id) ON DELETE CASCADE,
  label varchar(160) NOT NULL,
  weight smallint NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 10),
  position integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX cc_qa_criteria_department_idx ON cc_qa_criteria(department_id, position);

-- Một phiếu chấm cho mỗi cuộc gọi; điểm theo tiêu chí giữ nguyên nhãn và trọng số lúc chấm.
CREATE TABLE cc_qa_reviews (
  id uuid PRIMARY KEY,
  call_id uuid NOT NULL UNIQUE REFERENCES cc_calls(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES cc_departments(unit_id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_id uuid REFERENCES users(id) ON DELETE SET NULL,
  scores jsonb NOT NULL,
  percent numeric(5,2) NOT NULL CHECK (percent BETWEEN 0 AND 100),
  comment varchar(2000) NOT NULL DEFAULT '',
  coaching_assigned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cc_qa_reviews_agent_idx ON cc_qa_reviews(agent_id, created_at DESC);
CREATE INDEX cc_qa_reviews_department_idx ON cc_qa_reviews(department_id, created_at DESC);
