-- NV-CC5: an extension's own voicemail (no answer, busy or not registered). Department voicemails
-- keep extension_id NULL.
ALTER TABLE cc_voicemails ADD COLUMN extension_id uuid REFERENCES cc_extensions(id) ON DELETE CASCADE;
ALTER TABLE cc_voicemails ADD COLUMN caller_name varchar(120);
CREATE INDEX cc_voicemails_extension_idx ON cc_voicemails (extension_id, received_at DESC) WHERE extension_id IS NOT NULL;

-- BR-20: only granted extensions reach the SIP trunk. Agents already called back from tickets.
ALTER TABLE cc_extensions ADD COLUMN can_call_out boolean NOT NULL DEFAULT false;
UPDATE cc_extensions e SET can_call_out = true
WHERE EXISTS (SELECT 1 FROM cc_members m WHERE m.user_id = e.user_id AND m.role = 'agent');

-- NV-CC3: the requester rates a resolved ticket; BR-08 closes it after 3 quiet days.
ALTER TABLE cc_tickets ADD COLUMN satisfaction smallint CHECK (satisfaction BETWEEN 1 AND 5);
ALTER TABLE cc_tickets ADD COLUMN rated_at timestamptz;

-- "Liên hệ phòng ban": a short-lived WebRTC endpoint that may only call one department's queue.
CREATE TABLE cc_web_calls (
  endpoint varchar(40) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES cc_departments(unit_id) ON DELETE CASCADE,
  context varchar(500) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX cc_web_calls_expiry_idx ON cc_web_calls (expires_at);
