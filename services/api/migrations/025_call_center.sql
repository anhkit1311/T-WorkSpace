-- Call center (VoIP) schema: departments on the shared unit tree, hotlines + IVR, agents and
-- supervisors, SIP extensions synced to Asterisk over ARI, call detail records, agent states,
-- disposition codes, voicemails and support tickets. Plan items NT-2, CC-2..CC-9.

-- One unit tree for faculties and administrative offices (phòng ban); the call center hangs off it.
ALTER TABLE academic_units
  ADD COLUMN kind varchar(10) NOT NULL DEFAULT 'faculty' CHECK (kind IN ('faculty', 'office'));

-- Caller identification: an inbound number is matched against users.phone.
ALTER TABLE users ADD COLUMN phone varchar(16) CHECK (phone ~ '^\+?[0-9]{8,15}$');
CREATE UNIQUE INDEX users_phone_unique ON users (phone) WHERE phone IS NOT NULL;

CREATE TABLE cc_departments (
  unit_id uuid PRIMARY KEY REFERENCES academic_units(id) ON DELETE RESTRICT,
  -- Extensions of this department are numbered inside this range, e.g. 1100..1199.
  extension_from integer NOT NULL CHECK (extension_from BETWEEN 100 AND 999999),
  extension_to integer NOT NULL,
  strategy varchar(16) NOT NULL DEFAULT 'longest_idle' CHECK (strategy IN ('longest_idle', 'round_robin')),
  ring_seconds smallint NOT NULL DEFAULT 20 CHECK (ring_seconds BETWEEN 5 AND 120),
  max_wait_seconds smallint NOT NULL DEFAULT 300 CHECK (max_wait_seconds BETWEEN 30 AND 3600),
  wrap_up_seconds smallint NOT NULL DEFAULT 15 CHECK (wrap_up_seconds BETWEEN 0 AND 600),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (extension_to >= extension_from)
);

CREATE TABLE cc_members (
  department_id uuid NOT NULL REFERENCES cc_departments(unit_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(12) NOT NULL CHECK (role IN ('agent', 'supervisor')),
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, user_id, role)
);
CREATE INDEX cc_members_user_idx ON cc_members (user_id);

CREATE TABLE cc_hotlines (
  id uuid PRIMARY KEY,
  number varchar(16) NOT NULL UNIQUE CHECK (number ~ '^\+?[0-9]{3,15}$'),
  name varchar(120) NOT NULL CHECK (length(trim(name)) > 0),
  -- PJSIP endpoint name of the SIP trunk that delivers this number.
  trunk varchar(40) NOT NULL DEFAULT 'trunk' CHECK (trunk ~ '^[a-z0-9_-]{2,40}$'),
  -- Calls outside business hours of every option go here (voicemail of this department).
  fallback_department_id uuid REFERENCES cc_departments(unit_id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cc_ivr_options (
  hotline_id uuid NOT NULL REFERENCES cc_hotlines(id) ON DELETE CASCADE,
  digit char(1) NOT NULL CHECK (digit ~ '^[0-9]$'),
  department_id uuid NOT NULL REFERENCES cc_departments(unit_id) ON DELETE CASCADE,
  PRIMARY KEY (hotline_id, digit),
  UNIQUE (hotline_id, department_id)
);

CREATE TABLE cc_business_hours (
  department_id uuid NOT NULL REFERENCES cc_departments(unit_id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday, as in extract(dow)
  opens time NOT NULL,
  closes time NOT NULL,
  CHECK (opens < closes),
  PRIMARY KEY (department_id, weekday, opens)
);

CREATE TABLE cc_extensions (
  id uuid PRIMARY KEY,
  number varchar(6) NOT NULL UNIQUE CHECK (number ~ '^[0-9]{3,6}$'),
  department_id uuid NOT NULL REFERENCES cc_departments(unit_id) ON DELETE RESTRICT,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  label varchar(80) NOT NULL DEFAULT '',
  -- webrtc: JsSIP in the browser over WSS; sip: Zoiper/Linphone/IP phone over UDP.
  transport varchar(8) NOT NULL DEFAULT 'webrtc' CHECK (transport IN ('webrtc', 'sip')),
  -- Kept in clear: Asterisk's in-memory sorcery store loses it on restart and the API re-pushes
  -- every extension over ARI. Generated, at least 16 characters, never shown after creation.
  sip_secret text NOT NULL CHECK (length(sip_secret) >= 16),
  active boolean NOT NULL DEFAULT true,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cc_extensions_user_idx ON cc_extensions (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE cc_dispositions (
  id uuid PRIMARY KEY,
  department_id uuid REFERENCES cc_departments(unit_id) ON DELETE CASCADE, -- NULL = every department
  code varchar(20) NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,20}$'),
  label varchar(120) NOT NULL CHECK (length(trim(label)) > 0),
  active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX cc_dispositions_code_unique
  ON cc_dispositions (COALESCE(department_id, '00000000-0000-0000-0000-000000000000'), code);

CREATE TABLE cc_calls (
  id uuid PRIMARY KEY,
  -- Asterisk linkedid: one id for every channel of the same call.
  linkedid varchar(64) NOT NULL UNIQUE,
  direction varchar(10) NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal')),
  hotline_id uuid REFERENCES cc_hotlines(id) ON DELETE SET NULL,
  department_id uuid REFERENCES cc_departments(unit_id) ON DELETE SET NULL,
  caller_number varchar(32) NOT NULL,
  callee_number varchar(32) NOT NULL,
  caller_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  agent_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  extension_id uuid REFERENCES cc_extensions(id) ON DELETE SET NULL,
  transferred_from uuid REFERENCES cc_calls(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  queued_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  outcome varchar(12) CHECK (outcome IN ('answered', 'abandoned', 'missed', 'voicemail', 'busy', 'failed', 'transferred')),
  disposition_id uuid REFERENCES cc_dispositions(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  recording_key text,
  CHECK (queued_at IS NULL OR queued_at >= started_at),
  CHECK (answered_at IS NULL OR answered_at >= started_at),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK ((ended_at IS NULL) = (outcome IS NULL)),
  CHECK (outcome IS DISTINCT FROM 'answered' OR answered_at IS NOT NULL)
);
CREATE INDEX cc_calls_department_time_idx ON cc_calls (department_id, started_at DESC);
CREATE INDEX cc_calls_agent_time_idx ON cc_calls (agent_user_id, started_at DESC) WHERE agent_user_id IS NOT NULL;
CREATE INDEX cc_calls_caller_idx ON cc_calls (caller_number, started_at DESC);

CREATE TABLE cc_agent_states (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state varchar(10) NOT NULL CHECK (state IN ('offline', 'ready', 'not_ready', 'ringing', 'on_call', 'wrap_up')),
  reason varchar(80) NOT NULL DEFAULT '',
  call_id uuid REFERENCES cc_calls(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
-- An agent is in exactly one open state at a time.
CREATE UNIQUE INDEX cc_agent_states_open ON cc_agent_states (user_id) WHERE ended_at IS NULL;
CREATE INDEX cc_agent_states_user_time_idx ON cc_agent_states (user_id, started_at DESC);

CREATE TABLE cc_voicemails (
  id uuid PRIMARY KEY,
  department_id uuid REFERENCES cc_departments(unit_id) ON DELETE SET NULL,
  call_id uuid REFERENCES cc_calls(id) ON DELETE SET NULL,
  caller_number varchar(32) NOT NULL,
  duration_seconds integer NOT NULL CHECK (duration_seconds >= 0),
  recording_key text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  listened_by uuid REFERENCES users(id) ON DELETE SET NULL,
  listened_at timestamptz,
  CHECK (listened_by IS NULL OR listened_at IS NOT NULL)
);
CREATE INDEX cc_voicemails_department_idx ON cc_voicemails (department_id, received_at DESC);

CREATE TABLE cc_tickets (
  id uuid PRIMARY KEY,
  number bigserial UNIQUE, -- shown as TK-000123
  department_id uuid NOT NULL REFERENCES cc_departments(unit_id) ON DELETE RESTRICT,
  source varchar(12) NOT NULL CHECK (source IN ('call', 'missed_call', 'voicemail', 'manual')),
  call_id uuid REFERENCES cc_calls(id) ON DELETE SET NULL,
  voicemail_id uuid REFERENCES cc_voicemails(id) ON DELETE SET NULL,
  caller_number varchar(32),
  caller_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  subject varchar(200) NOT NULL CHECK (length(trim(subject)) > 0),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 8000),
  status varchar(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting', 'resolved', 'closed')),
  priority varchar(8) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL, -- NULL = created by the system (missed call)
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK ((status IN ('resolved', 'closed')) = (resolved_at IS NOT NULL)),
  CHECK (source <> 'voicemail' OR voicemail_id IS NOT NULL)
);
CREATE INDEX cc_tickets_department_status_idx ON cc_tickets (department_id, status, created_at DESC);
CREATE INDEX cc_tickets_assignee_idx ON cc_tickets (assignee_id, status) WHERE assignee_id IS NOT NULL;

CREATE TABLE cc_ticket_events (
  id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES cc_tickets(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  kind varchar(10) NOT NULL CHECK (kind IN ('comment', 'status', 'assign', 'callback')),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  from_status varchar(12),
  to_status varchar(12),
  call_id uuid REFERENCES cc_calls(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'status') = (to_status IS NOT NULL))
);
CREATE INDEX cc_ticket_events_ticket_idx ON cc_ticket_events (ticket_id, created_at);

-- Ticket history is evidence for KPI reports: events are never edited (deleting the ticket removes them).
CREATE FUNCTION cc_ticket_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'cc_ticket_events is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER cc_ticket_events_append_only BEFORE UPDATE ON cc_ticket_events
  FOR EACH ROW EXECUTE FUNCTION cc_ticket_events_append_only();
