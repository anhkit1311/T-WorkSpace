-- 2.4: a waiting caller presses * to be called back: the call ends as 'callback' (neither answered nor
-- abandoned in the KPIs) and opens a high-priority 'callback' ticket.
ALTER TABLE cc_calls DROP CONSTRAINT cc_calls_outcome_check;
ALTER TABLE cc_calls ADD CONSTRAINT cc_calls_outcome_check
  CHECK (outcome IN ('answered', 'abandoned', 'missed', 'voicemail', 'callback', 'busy', 'failed', 'transferred'));
ALTER TABLE cc_tickets DROP CONSTRAINT cc_tickets_source_check;
ALTER TABLE cc_tickets ADD CONSTRAINT cc_tickets_source_check
  CHECK (source IN ('call', 'missed_call', 'voicemail', 'callback', 'manual', 'elearning'));
