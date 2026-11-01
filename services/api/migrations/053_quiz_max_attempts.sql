-- NV-EL1: a quiz sets how many times it may be taken (null: no limit); BR-15 keeps the best attempt.
ALTER TABLE course_lessons ADD COLUMN max_attempts smallint CHECK (max_attempts BETWEEN 1 AND 100);
