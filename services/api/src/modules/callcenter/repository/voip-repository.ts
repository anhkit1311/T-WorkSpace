import { randomUUID } from "node:crypto";
import type { CcContactDepartment, CcPersonalVoicemail, CcTicket } from "@doan/shared";
import { query } from "../../../infrastructure/database/db.js";

/**
 * PostgreSQL access for the parts of the call center every user touches: their own voicemail
 * (NV-CC5), calling a department from the browser and following their own tickets (NV-CC3),
 * plus the retention jobs (BR-08, BR-17). No business rules live here.
 */
export class VoipRepository {
  // ---- personal voicemail ------------------------------------------------------------------

  /** The extension behind `number` and who owns it; null when it does not exist or is disabled. */
  async mailbox(number: string) {
    const result = await query<{ id: string; user_id: string | null; display_name: string | null; email: string | null }>(
      `SELECT e.id,e.user_id,u.display_name,u.email FROM cc_extensions e LEFT JOIN users u ON u.id=e.user_id
       WHERE e.number=$1 AND e.active`,
      [number],
    );
    return result.rows[0] ?? null;
  }

  /** A readable name for a caller: the owner of an internal extension, else a user with that phone. */
  async callerName(number: string): Promise<string | null> {
    const result = await query<{ name: string | null }>(
      `SELECT COALESCE(
         (SELECT COALESCE(u.display_name, NULLIF(e.label,'')) FROM cc_extensions e LEFT JOIN users u ON u.id=e.user_id WHERE e.number=$1),
         (SELECT display_name FROM users WHERE phone=$1 LIMIT 1)) AS name`,
      [number],
    );
    return result.rows[0]?.name ?? null;
  }

  async savePersonalVoicemail(input: {
    extensionId: string;
    callerNumber: string;
    callerName: string | null;
    durationSeconds: number;
    recordingKey: string;
  }): Promise<string> {
    const id = randomUUID();
    await query(
      `INSERT INTO cc_voicemails(id,extension_id,caller_number,caller_name,duration_seconds,recording_key) VALUES($1,$2,$3,$4,$5,$6)`,
      [id, input.extensionId, input.callerNumber.slice(0, 32), input.callerName?.slice(0, 120) ?? null, Math.round(input.durationSeconds), input.recordingKey],
    );
    return id;
  }

  async personalVoicemails(userId: string): Promise<CcPersonalVoicemail[]> {
    const result = await query<{
      id: string;
      caller_number: string;
      caller_name: string | null;
      duration_seconds: number;
      received_at: Date;
      listened_at: Date | null;
    }>(
      `SELECT v.id,v.caller_number,v.caller_name,v.duration_seconds,v.received_at,v.listened_at
       FROM cc_voicemails v JOIN cc_extensions e ON e.id=v.extension_id
       WHERE e.user_id=$1 ORDER BY v.received_at DESC LIMIT 50`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      callerNumber: row.caller_number,
      callerName: row.caller_name,
      durationSeconds: row.duration_seconds,
      receivedAt: row.received_at.toISOString(),
      listened: row.listened_at !== null,
    }));
  }

  /** The owner of a personal voicemail, or null for a department voicemail / unknown id. */
  async personalVoicemail(id: string) {
    const result = await query<{ id: string; owner_id: string | null; recording_key: string }>(
      `SELECT v.id,e.user_id AS owner_id,v.recording_key FROM cc_voicemails v JOIN cc_extensions e ON e.id=v.extension_id WHERE v.id=$1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async deleteVoicemail(id: string) {
    await query(`DELETE FROM cc_voicemails WHERE id=$1`, [id]);
  }

  // ---- calling a department from the browser ------------------------------------------------

  async contactDepartments(): Promise<(Omit<CcContactDepartment, "open"> & { hours: { weekday: number; opens: string; closes: string }[] })[]> {
    const [departments, hours] = await Promise.all([
      query<{ id: string; name: string; hotline: string | null }>(
        `SELECT d.unit_id AS id,u.name,
           (SELECT h.number FROM cc_hotlines h WHERE h.active AND (h.fallback_department_id=d.unit_id
              OR EXISTS (SELECT 1 FROM cc_ivr_options o WHERE o.hotline_id=h.id AND o.department_id=d.unit_id)) ORDER BY h.number LIMIT 1) AS hotline
         FROM cc_departments d JOIN academic_units u ON u.id=d.unit_id WHERE d.active ORDER BY u.name`,
      ),
      query<{ department_id: string; weekday: number; opens: string; closes: string }>(
        `SELECT department_id,weekday,opens::text,closes::text FROM cc_business_hours`,
      ),
    ]);
    return departments.rows.map((row) => ({
      ...row,
      hours: hours.rows
        .filter((item) => item.department_id === row.id)
        .map((item) => ({ weekday: item.weekday, opens: item.opens.slice(0, 5), closes: item.closes.slice(0, 5) })),
    }));
  }

  async ownerEmail(userId: string): Promise<string | null> {
    return (await query<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [userId])).rows[0]?.email ?? null;
  }

  async displayName(userId: string): Promise<string | null> {
    return (await query<{ display_name: string }>(`SELECT display_name FROM users WHERE id=$1`, [userId])).rows[0]?.display_name ?? null;
  }

  async createWebCall(input: { endpoint: string; userId: string; departmentId: string; context: string; expiresAt: Date }) {
    await query(
      `INSERT INTO cc_web_calls(endpoint,user_id,department_id,context,expires_at) VALUES($1,$2,$3,$4,$5)`,
      [input.endpoint, input.userId, input.departmentId, input.context.slice(0, 500), input.expiresAt],
    );
  }

  /** The session behind a browser endpoint, while it is valid. */
  async webCall(endpoint: string) {
    const result = await query<{ user_id: string; department_id: string; context: string; display_name: string; phone: string | null }>(
      `SELECT w.user_id,w.department_id,w.context,u.display_name,u.phone FROM cc_web_calls w JOIN users u ON u.id=w.user_id
       WHERE w.endpoint=$1 AND w.expires_at > now()`,
      [endpoint],
    );
    return result.rows[0] ?? null;
  }

  /** Removes expired sessions (and any other the caller names); returns their endpoints. */
  async takeWebCalls(endpoints: string[] = []): Promise<string[]> {
    const result = await query<{ endpoint: string }>(
      `DELETE FROM cc_web_calls WHERE expires_at <= now() OR endpoint=ANY($1::varchar[]) RETURNING endpoint`,
      [endpoints],
    );
    return result.rows.map((row) => row.endpoint);
  }

  // ---- the requester's own tickets (NV-CC3) ------------------------------------------------

  async myTickets(userId: string): Promise<CcTicket[]> {
    const result = await query<{
      id: string;
      code: string;
      department_id: string;
      department_name: string;
      source: CcTicket["source"];
      subject: string;
      description: string;
      status: CcTicket["status"];
      priority: CcTicket["priority"];
      assignee_name: string | null;
      created_at: Date;
      updated_at: Date;
      satisfaction: number | null;
    }>(
      `SELECT t.id,'TK-'||lpad(t.number::text,6,'0') AS code,t.department_id,du.name AS department_name,t.source,t.subject,
         t.description,t.status,t.priority,au.display_name AS assignee_name,t.created_at,t.updated_at,t.satisfaction
       FROM cc_tickets t JOIN academic_units du ON du.id=t.department_id LEFT JOIN users au ON au.id=t.assignee_id
       WHERE t.caller_user_id=$1 ORDER BY (t.status IN ('resolved','closed')), t.updated_at DESC LIMIT 100`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      code: row.code,
      departmentId: row.department_id,
      departmentName: row.department_name,
      source: row.source,
      callId: null,
      voicemailId: null,
      callerNumber: null,
      callerName: null,
      subject: row.subject,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assigneeId: null,
      assigneeName: row.assignee_name,
      dueAt: null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      satisfaction: row.satisfaction,
    }));
  }

  /** The requester of a ticket and its state, for permission checks. */
  async ticketOwner(id: string) {
    const result = await query<{ id: string; caller_user_id: string | null; status: CcTicket["status"]; department_id: string; satisfaction: number | null }>(
      `SELECT id,caller_user_id,status,department_id,satisfaction FROM cc_tickets WHERE id=$1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async createOwnTicket(input: { userId: string; departmentId: string; subject: string; description: string }): Promise<string> {
    const id = randomUUID();
    await query(
      `INSERT INTO cc_tickets(id,department_id,source,caller_number,caller_user_id,subject,description,created_by)
       VALUES($1,$2,'manual',(SELECT phone FROM users WHERE id=$3),$3,$4,$5,$3)`,
      [id, input.departmentId, input.userId, input.subject, input.description],
    );
    return id;
  }

  /** A requester's reply; a ticket waiting for them goes back to the department. */
  async reply(ticketId: string, userId: string, body: string) {
    await query(
      `WITH before AS (SELECT id,status FROM cc_tickets WHERE id=$1),
       reopened AS (
         UPDATE cc_tickets SET status=CASE WHEN status='waiting' THEN 'in_progress' ELSE status END, updated_at=now()
         WHERE id=$1 RETURNING id
       ),
       moved AS (
         INSERT INTO cc_ticket_events(created_at,id,ticket_id,actor_id,kind,from_status,to_status)
         SELECT clock_timestamp(),gen_random_uuid(),id,$3,'status','waiting','in_progress' FROM before WHERE status='waiting'
       )
       INSERT INTO cc_ticket_events(created_at,id,ticket_id,actor_id,kind,body) SELECT clock_timestamp(),$2,id,$3,'comment',$4 FROM reopened`,
      [ticketId, randomUUID(), userId, body],
    );
  }

  async rate(ticketId: string, score: number) {
    await query(`UPDATE cc_tickets SET satisfaction=$2, rated_at=now(), updated_at=now() WHERE id=$1`, [ticketId, score]);
  }

  // ---- retention ------------------------------------------------------------------------------

  /** BR-08: resolved tickets with no activity for `days` days are closed; returns how many. */
  async closeQuietTickets(days: number): Promise<number> {
    const result = await query(
      `WITH closed AS (
         UPDATE cc_tickets SET status='closed', updated_at=now()
         WHERE status='resolved' AND updated_at < now() - make_interval(days => $1) RETURNING id
       )
       INSERT INTO cc_ticket_events(created_at,id,ticket_id,actor_id,kind,from_status,to_status)
       SELECT clock_timestamp(),gen_random_uuid(),id,NULL,'status','resolved','closed' FROM closed`,
      [days],
    );
    return result.rowCount ?? 0;
  }

  /** BR-17: call recordings and voicemails older than `days` days; their keys are cleared. */
  async expireRecordings(days: number): Promise<string[]> {
    const calls = await query<{ key: string }>(
      `UPDATE cc_calls c SET recording_key=NULL FROM (SELECT id,recording_key FROM cc_calls
         WHERE recording_key IS NOT NULL AND started_at < now() - make_interval(days => $1) LIMIT 500) old
       WHERE c.id=old.id RETURNING old.recording_key AS key`,
      [days],
    );
    // A voicemail a ticket points to keeps its row (the ticket requires it) and only loses the audio.
    const voicemails = await query<{ key: string }>(
      `DELETE FROM cc_voicemails v WHERE received_at < now() - make_interval(days => $1)
         AND NOT EXISTS (SELECT 1 FROM cc_tickets t WHERE t.voicemail_id=v.id)
       RETURNING recording_key AS key`,
      [days],
    );
    const linked = await query<{ key: string }>(
      `UPDATE cc_voicemails v SET recording_key='' FROM (SELECT id,recording_key FROM cc_voicemails
         WHERE recording_key<>'' AND received_at < now() - make_interval(days => $1)) old
       WHERE v.id=old.id RETURNING old.recording_key AS key`,
      [days],
    );
    return [...calls.rows, ...voicemails.rows, ...linked.rows].map((row) => row.key);
  }
}
