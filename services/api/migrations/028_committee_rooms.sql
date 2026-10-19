-- MT-3: a defense committee meets in a meeting room. A schedule names the committee; inside the
-- meeting the members score with the academic rubric and the chair records the conclusion.
ALTER TABLE meeting_schedules ADD COLUMN committee_id uuid REFERENCES thesis_committees(id) ON DELETE SET NULL;
CREATE INDEX meeting_schedules_committee_idx ON meeting_schedules(committee_id) WHERE committee_id IS NOT NULL;
ALTER TABLE thesis_results ADD COLUMN conclusion varchar(4000);
