ALTER TABLE users
  ADD COLUMN status_text varchar(100) NOT NULL DEFAULT '',
  ADD COLUMN pronouns varchar(40) NOT NULL DEFAULT '',
  ADD COLUMN location varchar(80) NOT NULL DEFAULT '',
  ADD COLUMN interests text[] NOT NULL DEFAULT '{}',
  ADD COLUMN favorite_music varchar(160) NOT NULL DEFAULT '';

ALTER TABLE users ADD CONSTRAINT users_interests_limit CHECK (cardinality(interests) <= 8);
