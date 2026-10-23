-- EL-5: a video lesson is done when the learner has played most of it. Which stretches they played
-- ([from, to] in seconds, merged) and where they stopped, so the player resumes there.
CREATE TABLE course_video_watch (
  lesson_id uuid NOT NULL REFERENCES course_lessons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ranges jsonb NOT NULL DEFAULT '[]',
  position_seconds integer NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, user_id)
);
