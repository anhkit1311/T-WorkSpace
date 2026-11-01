-- 2.1: what the language model made of a finished transcript (SUMMARY_URL). Suggestions only:
-- people still write the minutes and choose the call's disposition.
ALTER TABLE meeting_recordings ADD COLUMN ai_summary varchar(4000), ADD COLUMN ai_actions jsonb;
ALTER TABLE cc_calls ADD COLUMN ai_summary varchar(2000),
  ADD COLUMN ai_disposition_id uuid REFERENCES cc_dispositions(id) ON DELETE SET NULL;
