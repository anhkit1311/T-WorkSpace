-- EL-4 (nâng cấp): rút ngẫu nhiên N câu, xáo trộn thứ tự, lưu nháp câu trả lời trong lúc làm bài.

ALTER TABLE course_lessons
  ADD COLUMN draw_count smallint CHECK (draw_count BETWEEN 1 AND 200),
  ADD COLUMN shuffle boolean NOT NULL DEFAULT false;

-- The questions of one attempt, in the order the learner sees them. NULL for attempts made before
-- this migration: they use every question of the quiz in its own order.
ALTER TABLE course_quiz_attempts
  ADD COLUMN question_ids uuid[],
  ADD COLUMN saved_at timestamptz;
