import { randomUUID } from "node:crypto";
import type {
  AgentState,
  CallCenterRole,
  CallOutcome,
  CcCaller,
  CcCallerProfile,
  CcCallRecord,
  CcCallTranscript,
  CcDepartment,
  CcDisposition,
  CcExtension,
  CcHotline,
  CcTicket,
  CcTicketEvent,
  DistributionStrategyName,
  ExtensionTransport,
  TicketPriority,
  TicketSource,
  TicketStatus,
} from "@doan/shared";
import type { PoolClient } from "pg";
import { query, withTransaction } from "../../../infrastructure/database/db.js";
import type { Segment } from "../../../infrastructure/speech/transcribe.js";
import type { KpiCall } from "../domain/kpi.js";
import type { AcdStore, AgentRecord, CallPatch, DepartmentSettings, HotlineRoute } from "../domain/ports.js";

const TICKET_COLUMNS = `t.id,'TK-'||lpad(t.number::text,6,'0') AS code,t.department_id,du.name AS department_name,t.source,t.call_id,
  t.voicemail_id,t.caller_number,cu.display_name AS caller_name,t.subject,t.description,t.status,t.priority,t.assignee_id,
  au.display_name AS assignee_name,t.due_at,t.created_at,t.updated_at
  FROM cc_tickets t JOIN academic_units du ON du.id=t.department_id
  LEFT JOIN users cu ON cu.id=t.caller_user_id LEFT JOIN users au ON au.id=t.assignee_id`;

interface TicketRow {
  id: string;
  code: string;
  department_id: string;
  department_name: string;
  source: TicketSource;
  call_id: string | null;
  voicemail_id: string | null;
  caller_number: string | null;
  caller_name: string | null;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee_id: string | null;
  assignee_name: string | null;
  due_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const toTicket = (row: TicketRow): CcTicket => ({
  id: row.id,
  code: row.code,
  departmentId: row.department_id,
  departmentName: row.department_name,
  source: row.source,
  callId: row.call_id,
  voicemailId: row.voicemail_id,
  callerNumber: row.caller_number,
  callerName: row.caller_name,
  subject: row.subject,
  description: row.description,
  status: row.status,
  priority: row.priority,
  assigneeId: row.assignee_id,
  assigneeName: row.assignee_name,
  dueAt: row.due_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

const time = (value: string) => value.slice(0, 5);

/** PostgreSQL access for the call center (Repository pattern). No business rules live here. */
export class CallCenterRepository implements AcdStore {
  // ---- ACD -----------------------------------------------------------------------------------

  async hotline(number: string | null): Promise<HotlineRoute | null> {
    const hotline = await query<{ id: string; number: string; fallback_department_id: string | null }>(
      number === null
        ? `SELECT id,number,fallback_department_id FROM cc_hotlines WHERE active ORDER BY created_at LIMIT 1`
        : `SELECT id,number,fallback_department_id FROM cc_hotlines WHERE active AND number=$1`,
      number === null ? [] : [number],
    );
    const row = hotline.rows[0];
    if (!row) return null;
    const options = await query<{ digit: string; department_id: string }>(
      `SELECT digit,department_id FROM cc_ivr_options WHERE hotline_id=$1 ORDER BY digit`,
      [row.id],
    );
    return {
      id: row.id,
      number: row.number,
      fallbackDepartmentId: row.fallback_department_id,
      options: options.rows.map((option) => ({ digit: option.digit, departmentId: option.department_id })),
    };
  }

  async department(id: string): Promise<DepartmentSettings | null> {
    const department = (await this.departments([id]))[0];
    return department
      ? {
          id: department.id,
          name: department.name,
          strategy: department.strategy,
          ringSeconds: department.ringSeconds,
          maxWaitSeconds: department.maxWaitSeconds,
          wrapUpSeconds: department.wrapUpSeconds,
          active: department.active,
          hours: department.hours,
        }
      : null;
  }

  async caller(number: string): Promise<CcCaller> {
    const result = await query<{ id: string; display_name: string; email: string; recent: string }>(
      `SELECT u.id,u.display_name,u.email,
         (SELECT count(*) FROM cc_calls c WHERE c.caller_number=$1 AND c.started_at > now()-interval '30 days') AS recent
       FROM (SELECT 1) one LEFT JOIN users u ON u.phone=$1`,
      [number],
    );
    const row = result.rows[0];
    return {
      number,
      userId: row?.id ?? null,
      displayName: row?.display_name ?? null,
      email: row?.email ?? null,
      recentCalls: Number(row?.recent ?? 0),
    };
  }

  /** The caller's account details when known; for outside callers only the history of their number. */
  async callerProfile(number: string, userId: string | null): Promise<CcCallerProfile> {
    const [student, tickets, courses, calls] = await Promise.all([
      query<{ student_code: string; class_name: string; faculty: string }>(
        `SELECT e.student_code,e.class_name,u.name AS faculty FROM thesis_enrollments e
           JOIN thesis_terms t ON t.id=e.term_id JOIN academic_units u ON u.id=t.unit_id
         WHERE e.student_id=$1::uuid ORDER BY t.registration_opens_at DESC LIMIT 1`,
        [userId],
      ),
      query<{ id: string; code: string; subject: string; status: TicketStatus; updated_at: Date }>(
        `SELECT id,'TK-'||lpad(number::text,6,'0') AS code,subject,status,updated_at FROM cc_tickets
         WHERE caller_user_id=$1::uuid OR ($1::uuid IS NULL AND caller_number=$2) ORDER BY (status IN ('resolved','closed')),updated_at DESC LIMIT 5`,
        [userId, number],
      ),
      query<{ code: string; title: string; completed: boolean }>(
        `SELECT c.code,c.title,e.completed_at IS NOT NULL AS completed FROM course_enrollments e JOIN courses c ON c.id=e.course_id
         WHERE e.user_id=$1::uuid ORDER BY e.enrolled_at DESC LIMIT 5`,
        [userId],
      ),
      query<{ started_at: Date; outcome: CallOutcome | null; department_name: string | null; agent_name: string | null; notes: string }>(
        `SELECT c.started_at,c.outcome,du.name AS department_name,au.display_name AS agent_name,c.notes FROM cc_calls c
           LEFT JOIN academic_units du ON du.id=c.department_id LEFT JOIN users au ON au.id=c.agent_user_id
         WHERE c.ended_at IS NOT NULL AND (c.caller_user_id=$1::uuid OR c.caller_number=$2) ORDER BY c.started_at DESC LIMIT 5`,
        [userId, number],
      ),
    ]);
    const row = student.rows[0];
    return {
      student: row ? { code: row.student_code, className: row.class_name, faculty: row.faculty } : null,
      tickets: tickets.rows.map((item) => ({ id: item.id, code: item.code, subject: item.subject, status: item.status, updatedAt: item.updated_at.toISOString() })),
      courses: courses.rows,
      calls: calls.rows.map((item) => ({
        startedAt: item.started_at.toISOString(),
        outcome: item.outcome,
        departmentName: item.department_name,
        agentName: item.agent_name,
        notes: item.notes,
      })),
    };
  }

  async createCall(input: Parameters<AcdStore["createCall"]>[0]): Promise<void> {
    await query(
      `INSERT INTO cc_calls(id,linkedid,direction,hotline_id,caller_number,callee_number,caller_user_id,transferred_from)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (linkedid) DO NOTHING`,
      [
        input.id,
        input.linkedId,
        input.direction,
        input.hotlineId,
        input.callerNumber,
        input.calleeNumber,
        input.callerUserId,
        input.transferredFrom ?? null,
      ],
    );
  }

  async updateCall(id: string, patch: CallPatch): Promise<void> {
    const columns: Record<keyof CallPatch, string> = {
      departmentId: "department_id",
      queuedAt: "queued_at",
      answeredAt: "answered_at",
      endedAt: "ended_at",
      outcome: "outcome",
      agentUserId: "agent_user_id",
      recordingKey: "recording_key",
    };
    const entries = (Object.keys(patch) as (keyof CallPatch)[]).filter((key) => patch[key] !== undefined);
    if (!entries.length) return;
    await query(
      `UPDATE cc_calls SET ${entries.map((key, index) => `${columns[key]}=$${index + 2}`).join(",")} WHERE id=$1`,
      [id, ...entries.map((key) => patch[key])],
    );
  }

  async saveVoicemail(input: Parameters<AcdStore["saveVoicemail"]>[0]): Promise<void> {
    const voicemailId = randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO cc_voicemails(id,department_id,call_id,caller_number,duration_seconds,recording_key)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [voicemailId, input.departmentId, input.callId, input.callerNumber, Math.round(input.durationSeconds), input.recordingKey],
      );
      if (input.departmentId)
        await this.followUp(client, {
          source: "voicemail",
          departmentId: input.departmentId,
          callId: input.callId,
          voicemailId,
          callerNumber: input.callerNumber,
          callerUserId: input.callerUserId,
          subject: `Thư thoại từ ${input.callerNumber}`,
          note: `Thư thoại mới (${Math.round(input.durationSeconds)} giây).`,
        });
    });
  }

  async missedCall(input: Parameters<AcdStore["missedCall"]>[0]): Promise<void> {
    await withTransaction((client) =>
      this.followUp(client, {
        source: "missed_call",
        departmentId: input.departmentId,
        callId: input.callId,
        voicemailId: null,
        callerNumber: input.callerNumber,
        callerUserId: input.callerUserId,
        subject: `Gọi lại cho ${input.callerNumber} (cuộc gọi nhỡ)`,
        note: "Người gọi gác máy khi đang chờ trong hàng đợi.",
      }),
    );
  }

  /**
   * One open follow-up ticket per caller and department: a repeated miss or voicemail is appended to
   * it instead of flooding the queue with duplicates. Anonymous callers always get their own ticket.
   */
  private async followUp(
    client: PoolClient,
    input: {
      source: "missed_call" | "voicemail";
      departmentId: string;
      callId: string;
      voicemailId: string | null;
      callerNumber: string;
      callerUserId: string | null;
      subject: string;
      note: string;
    },
  ) {
    const open =
      input.callerNumber === "anonymous"
        ? undefined
        : (
            await client.query<{ id: string }>(
              `SELECT id FROM cc_tickets WHERE department_id=$1 AND caller_number=$2 AND status IN ('open','in_progress','waiting')
               AND source IN ('missed_call','voicemail') ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
              [input.departmentId, input.callerNumber],
            )
          ).rows[0];
    if (open) {
      await client.query(`UPDATE cc_tickets SET updated_at=now() WHERE id=$1`, [open.id]);
      await client.query(`INSERT INTO cc_ticket_events(created_at,id,ticket_id,kind,body,call_id) VALUES(clock_timestamp(),$1,$2,'comment',$3,$4)`, [
        randomUUID(),
        open.id,
        input.note,
        input.callId,
      ]);
      return;
    }
    await client.query(
      `INSERT INTO cc_tickets(id,department_id,source,call_id,voicemail_id,caller_number,caller_user_id,subject,description)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [randomUUID(), input.departmentId, input.source, input.callId, input.voicemailId, input.callerNumber, input.callerUserId, input.subject, input.note],
    );
  }

  async agentRoster(): Promise<AgentRecord[]> {
    const result = await query<{
      id: string;
      display_name: string;
      departments: string[];
      extension: string | null;
      state: AgentState | null;
      reason: string | null;
      started_at: Date | null;
    }>(
      `SELECT u.id,u.display_name,array_agg(m.department_id ORDER BY m.department_id) AS departments,
         (SELECT e.number FROM cc_extensions e WHERE e.user_id=u.id AND e.active ORDER BY e.created_at LIMIT 1) AS extension,
         s.state,s.reason,s.started_at
       FROM cc_members m JOIN users u ON u.id=m.user_id
       LEFT JOIN cc_agent_states s ON s.user_id=u.id AND s.ended_at IS NULL
       WHERE m.role='agent'
       GROUP BY u.id,s.state,s.reason,s.started_at`,
    );
    return result.rows.map((row) => ({
      userId: row.id,
      displayName: row.display_name,
      departments: row.departments,
      extension: row.extension,
      state: row.state ?? "offline",
      reason: row.reason ?? "",
      since: row.started_at,
    }));
  }

  async recordAgentState(userId: string, state: AgentState, reason: string, callId: string | null) {
    await withTransaction(async (client) => {
      await client.query(`UPDATE cc_agent_states SET ended_at=now() WHERE user_id=$1 AND ended_at IS NULL`, [userId]);
      await client.query(
        `INSERT INTO cc_agent_states(id,user_id,state,reason,call_id) VALUES($1,$2,$3,$4,$5)`,
        [randomUUID(), userId, state, reason.slice(0, 80), callId],
      );
    });
  }

  async closeDanglingCalls(): Promise<number> {
    const result = await query(`UPDATE cc_calls SET ended_at=now(), outcome='failed' WHERE ended_at IS NULL`);
    return result.rowCount ?? 0;
  }

  // ---- access ----------------------------------------------------------------------------------

  async access(userId: string): Promise<{ isAdmin: boolean; roles: Map<string, Set<CallCenterRole>> }> {
    const [admin, members] = await Promise.all([
      query(`SELECT 1 FROM academic_role_grants WHERE user_id=$1 AND role='system_admin'`, [userId]),
      query<{ department_id: string; role: CallCenterRole }>(
        `SELECT department_id,role FROM cc_members WHERE user_id=$1`,
        [userId],
      ),
    ]);
    const roles = new Map<string, Set<CallCenterRole>>();
    for (const row of members.rows)
      (roles.get(row.department_id) ?? roles.set(row.department_id, new Set()).get(row.department_id)!).add(row.role);
    return { isAdmin: Boolean(admin.rowCount), roles };
  }

  /** Users who must hear about a department's live board: its members and every system admin. */
  async liveAudience(departmentId: string): Promise<string[]> {
    const result = await query<{ user_id: string }>(
      `SELECT user_id FROM cc_members WHERE department_id=$1
       UNION SELECT user_id FROM academic_role_grants WHERE role='system_admin'`,
      [departmentId],
    );
    return result.rows.map((row) => row.user_id);
  }

  // ---- departments -------------------------------------------------------------------------

  async departments(ids: string[] | null): Promise<CcDepartment[]> {
    const departments = await query<{
      unit_id: string;
      code: string;
      name: string;
      extension_from: number;
      extension_to: number;
      strategy: DistributionStrategyName;
      ring_seconds: number;
      max_wait_seconds: number;
      wrap_up_seconds: number;
      active: boolean;
      training_course_id: string | null;
      coaching_course_id: string | null;
      qa_threshold: number;
    }>(
      `SELECT d.*,u.code,u.name FROM cc_departments d JOIN academic_units u ON u.id=d.unit_id
       WHERE $1::uuid[] IS NULL OR d.unit_id=ANY($1::uuid[]) ORDER BY u.name`,
      [ids],
    );
    const unitIds = departments.rows.map((row) => row.unit_id);
    const [hours, members] = await Promise.all([
      query<{ department_id: string; weekday: number; opens: string; closes: string }>(
        `SELECT department_id,weekday,opens::text,closes::text FROM cc_business_hours
         WHERE department_id=ANY($1::uuid[]) ORDER BY weekday,opens`,
        [unitIds],
      ),
      query<{ department_id: string; user_id: string; display_name: string; email: string; role: CallCenterRole }>(
        `SELECT m.department_id,m.user_id,u.display_name,u.email,m.role FROM cc_members m JOIN users u ON u.id=m.user_id
         WHERE m.department_id=ANY($1::uuid[]) ORDER BY m.role DESC,u.display_name`,
        [unitIds],
      ),
    ]);
    return departments.rows.map((row) => ({
      id: row.unit_id,
      code: row.code,
      name: row.name,
      extensionFrom: row.extension_from,
      extensionTo: row.extension_to,
      strategy: row.strategy,
      ringSeconds: row.ring_seconds,
      maxWaitSeconds: row.max_wait_seconds,
      wrapUpSeconds: row.wrap_up_seconds,
      active: row.active,
      trainingCourseId: row.training_course_id,
      coachingCourseId: row.coaching_course_id,
      qaThreshold: row.qa_threshold,
      hours: hours.rows
        .filter((hour) => hour.department_id === row.unit_id)
        .map((hour) => ({ weekday: hour.weekday, opens: time(hour.opens), closes: time(hour.closes) })),
      members: members.rows
        .filter((member) => member.department_id === row.unit_id)
        .map((member) => ({ userId: member.user_id, displayName: member.display_name, email: member.email, role: member.role })),
    }));
  }

  async rangeOverlaps(from: number, to: number, exceptId: string | null): Promise<boolean> {
    const result = await query(
      `SELECT 1 FROM cc_departments WHERE int4range(extension_from,extension_to,'[]') && int4range($1,$2,'[]')
       AND ($3::uuid IS NULL OR unit_id<>$3)`,
      [from, to, exceptId],
    );
    return Boolean(result.rowCount);
  }

  async createDepartment(input: {
    code: string;
    name: string;
    extensionFrom: number;
    extensionTo: number;
    strategy: DistributionStrategyName;
    ringSeconds: number;
    maxWaitSeconds: number;
    wrapUpSeconds: number;
  }): Promise<string> {
    const id = randomUUID();
    await withTransaction(async (client) => {
      await client.query(`INSERT INTO academic_units(id,code,name,kind) VALUES($1,$2,$3,'office')`, [id, input.code, input.name]);
      await client.query(
        `INSERT INTO cc_departments(unit_id,extension_from,extension_to,strategy,ring_seconds,max_wait_seconds,wrap_up_seconds)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [id, input.extensionFrom, input.extensionTo, input.strategy, input.ringSeconds, input.maxWaitSeconds, input.wrapUpSeconds],
      );
    });
    return id;
  }

  async updateDepartment(
    id: string,
    input: {
      name: string;
      strategy: DistributionStrategyName;
      ringSeconds: number;
      maxWaitSeconds: number;
      wrapUpSeconds: number;
      active: boolean;
      trainingCourseId: string | null;
      coachingCourseId: string | null;
      qaThreshold: number;
    },
  ) {
    await withTransaction(async (client) => {
      await client.query(`UPDATE academic_units SET name=$2 WHERE id=$1`, [id, input.name]);
      await client.query(
        `UPDATE cc_departments SET strategy=$2,ring_seconds=$3,max_wait_seconds=$4,wrap_up_seconds=$5,active=$6,
           training_course_id=$7,coaching_course_id=$8,qa_threshold=$9 WHERE unit_id=$1`,
        [id, input.strategy, input.ringSeconds, input.maxWaitSeconds, input.wrapUpSeconds, input.active,
          input.trainingCourseId, input.coachingCourseId, input.qaThreshold],
      );
    });
  }

  // ---- LT-4 training gate -------------------------------------------------------------------------

  /** Published required courses of the agent's departments that the agent has not completed. */
  async pendingTraining(userId: string): Promise<{ courseId: string; code: string; title: string; percent: number }[]> {
    return (
      await query<{ courseId: string; code: string; title: string; percent: number }>(
        `SELECT DISTINCT c.id AS "courseId",c.code,c.title,
           COALESCE((SELECT round(100.0*count(p.lesson_id)/NULLIF(count(*),0)) FROM course_lessons l
             LEFT JOIN course_lesson_progress p ON p.lesson_id=l.id AND p.user_id=$1
             WHERE l.course_id=c.id AND l.status='published'),0)::int AS percent
         FROM cc_members m JOIN cc_departments d ON d.unit_id=m.department_id JOIN courses c ON c.id=d.training_course_id
         LEFT JOIN course_enrollments e ON e.course_id=c.id AND e.user_id=$1
         WHERE m.user_id=$1 AND m.role='agent' AND c.status='published' AND e.completed_at IS NULL
         ORDER BY c.code`,
        [userId],
      )
    ).rows;
  }

  /** Enrolls the department's agents (or one of them) in a course; existing enrollments stay. */
  async enrollAgents(departmentId: string, courseId: string, assignedBy: string | null, userId: string | null = null) {
    await query(
      `INSERT INTO course_enrollments(course_id,user_id,source,assigned_by)
       SELECT $2,m.user_id,'assigned',$3 FROM cc_members m
       WHERE m.department_id=$1 AND m.role='agent' AND ($4::uuid IS NULL OR m.user_id=$4)
       ON CONFLICT DO NOTHING`,
      [departmentId, courseId, assignedBy, userId],
    );
  }

  async publishedCourses(): Promise<{ id: string; code: string; title: string }[]> {
    return (await query<{ id: string; code: string; title: string }>(`SELECT id,code,title FROM courses WHERE status='published' ORDER BY code`)).rows;
  }

  async replaceHours(id: string, hours: { weekday: number; opens: string; closes: string }[]) {
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM cc_business_hours WHERE department_id=$1`, [id]);
      for (const hour of hours)
        await client.query(
          `INSERT INTO cc_business_hours(department_id,weekday,opens,closes) VALUES($1,$2,$3,$4)`,
          [id, hour.weekday, hour.opens, hour.closes],
        );
    });
  }

  async userByEmail(email: string): Promise<{ id: string; displayName: string } | null> {
    const result = await query<{ id: string; display_name: string }>(
      `SELECT id,display_name FROM users WHERE lower(email)=lower($1)`,
      [email],
    );
    return result.rows[0] ? { id: result.rows[0].id, displayName: result.rows[0].display_name } : null;
  }

  async addMember(departmentId: string, userId: string, role: CallCenterRole, grantedBy: string) {
    const result = await query(
      `INSERT INTO cc_members(department_id,user_id,role,granted_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [departmentId, userId, role, grantedBy],
    );
    return Boolean(result.rowCount);
  }

  async removeMember(departmentId: string, userId: string, role: CallCenterRole) {
    const result = await query(`DELETE FROM cc_members WHERE department_id=$1 AND user_id=$2 AND role=$3`, [
      departmentId,
      userId,
      role,
    ]);
    return Boolean(result.rowCount);
  }

  // ---- extensions --------------------------------------------------------------------------

  async extensions(departmentIds: string[] | null): Promise<CcExtension[]> {
    const result = await query<{
      id: string;
      number: string;
      department_id: string;
      user_id: string | null;
      display_name: string | null;
      label: string;
      transport: ExtensionTransport;
      active: boolean;
      synced_at: Date | null;
      can_call_out: boolean;
    }>(
      `SELECT e.id,e.number,e.department_id,e.user_id,u.display_name,e.label,e.transport,e.active,e.synced_at,e.can_call_out
       FROM cc_extensions e LEFT JOIN users u ON u.id=e.user_id
       WHERE $1::uuid[] IS NULL OR e.department_id=ANY($1::uuid[]) ORDER BY e.number`,
      [departmentIds],
    );
    return result.rows.map((row) => ({
      id: row.id,
      number: row.number,
      departmentId: row.department_id,
      userId: row.user_id,
      userName: row.display_name,
      label: row.label,
      transport: row.transport,
      active: row.active,
      syncedAt: row.synced_at?.toISOString() ?? null,
      canCallOut: row.can_call_out,
    }));
  }

  async extensionNumbers(): Promise<string[]> {
    return (await query<{ number: string }>(`SELECT number FROM cc_extensions`)).rows.map((row) => row.number);
  }

  /** Everything needed to (re)create extensions in Asterisk, secrets included. Server-side only. */
  async extensionSecrets(ids: string[] | null) {
    const result = await query<{
      id: string;
      number: string;
      sip_secret: string;
      transport: ExtensionTransport;
      label: string;
      display_name: string | null;
      can_call_out: boolean;
    }>(
      `SELECT e.id,e.number,e.sip_secret,e.transport,e.label,u.display_name,e.can_call_out FROM cc_extensions e
       LEFT JOIN users u ON u.id=e.user_id WHERE e.active AND ($1::uuid[] IS NULL OR e.id=ANY($1::uuid[]))`,
      [ids],
    );
    return result.rows;
  }

  async createExtension(input: {
    number: string;
    departmentId: string;
    userId: string | null;
    label: string;
    transport: ExtensionTransport;
    secret: string;
  }): Promise<string> {
    const id = randomUUID();
    await query(
      // BR-20: an agent's extension may call requesters back through the trunk.
      `INSERT INTO cc_extensions(id,number,department_id,user_id,label,transport,sip_secret,can_call_out)
       VALUES($1,$2,$3,$4,$5,$6,$7,EXISTS (SELECT 1 FROM cc_members WHERE user_id=$4 AND role='agent'))`,
      [id, input.number, input.departmentId, input.userId, input.label, input.transport, input.secret],
    );
    return id;
  }

  async extension(id: string) {
    const result = await query<{ id: string; number: string; department_id: string; user_id: string | null }>(
      `SELECT id,number,department_id,user_id FROM cc_extensions WHERE id=$1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async updateExtension(id: string, input: { userId: string | null; label: string | undefined; active: boolean; canCallOut?: boolean }) {
    await query(
      `UPDATE cc_extensions SET user_id=$2, label=COALESCE($3,label), active=$4, can_call_out=COALESCE($5,can_call_out), synced_at=NULL WHERE id=$1`,
      [id, input.userId, input.label ?? null, input.active, input.canCallOut ?? null],
    );
  }

  /** Lets the user's extensions dial out; returns the ids that changed. */
  async grantCallOut(userId: string): Promise<string[]> {
    const result = await query<{ id: string }>(
      `UPDATE cc_extensions SET can_call_out=true, synced_at=NULL WHERE user_id=$1 AND NOT can_call_out RETURNING id`,
      [userId],
    );
    return result.rows.map((row) => row.id);
  }

  async setExtensionSecret(id: string, secret: string) {
    await query(`UPDATE cc_extensions SET sip_secret=$2, synced_at=NULL WHERE id=$1`, [id, secret]);
  }

  async markSynced(ids: string[]) {
    await query(`UPDATE cc_extensions SET synced_at=now() WHERE id=ANY($1::uuid[])`, [ids]);
  }

  async deleteExtension(id: string) {
    await query(`DELETE FROM cc_extensions WHERE id=$1`, [id]);
  }

  async ownExtension(userId: string) {
    const result = await query<{ number: string; sip_secret: string; transport: ExtensionTransport }>(
      `SELECT number,sip_secret,transport FROM cc_extensions WHERE user_id=$1 AND active ORDER BY created_at LIMIT 1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  // ---- hotlines ----------------------------------------------------------------------------

  async hotlines(): Promise<CcHotline[]> {
    const [hotlines, options] = await Promise.all([
      query<{ id: string; number: string; name: string; trunk: string; fallback_department_id: string | null; active: boolean }>(
        `SELECT id,number,name,trunk,fallback_department_id,active FROM cc_hotlines ORDER BY created_at`,
      ),
      query<{ hotline_id: string; digit: string; department_id: string }>(
        `SELECT hotline_id,digit,department_id FROM cc_ivr_options ORDER BY digit`,
      ),
    ]);
    return hotlines.rows.map((row) => ({
      id: row.id,
      number: row.number,
      name: row.name,
      trunk: row.trunk,
      fallbackDepartmentId: row.fallback_department_id,
      active: row.active,
      options: options.rows
        .filter((option) => option.hotline_id === row.id)
        .map((option) => ({ digit: option.digit, departmentId: option.department_id })),
    }));
  }

  async saveHotline(input: {
    id: string | null;
    number: string;
    name: string;
    fallbackDepartmentId: string | null;
    active: boolean;
    options: { digit: string; departmentId: string }[];
  }): Promise<string> {
    const id = input.id ?? randomUUID();
    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO cc_hotlines(id,number,name,fallback_department_id,active) VALUES($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET number=$2,name=$3,fallback_department_id=$4,active=$5`,
        [id, input.number, input.name, input.fallbackDepartmentId, input.active],
      );
      await client.query(`DELETE FROM cc_ivr_options WHERE hotline_id=$1`, [id]);
      for (const option of input.options)
        await client.query(`INSERT INTO cc_ivr_options(hotline_id,digit,department_id) VALUES($1,$2,$3)`, [
          id,
          option.digit,
          option.departmentId,
        ]);
    });
    return id;
  }

  // ---- calls ---------------------------------------------------------------------------------

  async calls(filter: { departmentIds: string[] | null; agentUserId: string | null; limit: number }): Promise<CcCallRecord[]> {
    const result = await query<{
      id: string;
      direction: CcCallRecord["direction"];
      department_id: string | null;
      department_name: string | null;
      caller_number: string;
      caller_name: string | null;
      agent_user_id: string | null;
      agent_name: string | null;
      started_at: Date;
      queued_at: Date | null;
      answered_at: Date | null;
      ended_at: Date | null;
      outcome: CcCallRecord["outcome"];
      disposition_id: string | null;
      notes: string;
      recording_key: string | null;
      transcript_status: CcCallRecord["transcriptStatus"];
    }>(
      `SELECT c.id,c.direction,c.department_id,du.name AS department_name,c.caller_number,cu.display_name AS caller_name,
         c.agent_user_id,au.display_name AS agent_name,c.started_at,c.queued_at,c.answered_at,c.ended_at,c.outcome,
         c.disposition_id,c.notes,c.recording_key,c.transcript_status
       FROM cc_calls c
       LEFT JOIN academic_units du ON du.id=c.department_id
       LEFT JOIN users cu ON cu.id=c.caller_user_id
       LEFT JOIN users au ON au.id=c.agent_user_id
       WHERE $1::uuid[] IS NULL OR c.department_id=ANY($1::uuid[]) OR c.agent_user_id=$2::uuid
       ORDER BY c.started_at DESC LIMIT $3`,
      [filter.departmentIds, filter.agentUserId, filter.limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      direction: row.direction,
      departmentId: row.department_id,
      departmentName: row.department_name,
      callerNumber: row.caller_number,
      callerName: row.caller_name,
      agentUserId: row.agent_user_id,
      agentName: row.agent_name,
      startedAt: row.started_at.toISOString(),
      queuedAt: row.queued_at?.toISOString() ?? null,
      answeredAt: row.answered_at?.toISOString() ?? null,
      endedAt: row.ended_at?.toISOString() ?? null,
      outcome: row.outcome,
      dispositionId: row.disposition_id,
      notes: row.notes,
      hasRecording: Boolean(row.recording_key),
      transcriptStatus: row.transcript_status,
    }));
  }

  async call(id: string) {
    const result = await query<{
      id: string;
      department_id: string | null;
      agent_user_id: string | null;
      recording_key: string | null;
      caller_number: string;
      caller_user_id: string | null;
      caller_name: string | null;
      video_workspace_id: string | null;
    }>(
      `SELECT c.id,c.department_id,c.agent_user_id,c.recording_key,c.caller_number,c.caller_user_id,u.display_name AS caller_name,c.video_workspace_id
       FROM cc_calls c LEFT JOIN users u ON u.id=c.caller_user_id WHERE c.id=$1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async setCallTranscript(id: string, status: "processing" | "ready" | "failed", segments: Segment[] | null) {
    await query(`UPDATE cc_calls SET transcript_status=$2, transcript=$3 WHERE id=$1`, [id, status, segments && JSON.stringify(segments)]);
  }

  async callTranscript(id: string) {
    const result = await query<{ transcript_status: CcCallTranscript["status"]; transcript: Segment[] | null }>(
      `SELECT transcript_status,transcript FROM cc_calls WHERE id=$1`,
      [id],
    );
    const row = result.rows[0];
    return { status: row?.transcript_status ?? null, segments: row?.transcript ?? [] } satisfies CcCallTranscript;
  }

  async setCallVideo(id: string, workspaceId: string) {
    await query(`UPDATE cc_calls SET video_workspace_id=$2 WHERE id=$1`, [id, workspaceId]);
  }

  async saveWrapUp(id: string, dispositionId: string | null, notes: string) {
    await query(`UPDATE cc_calls SET disposition_id=$2, notes=$3 WHERE id=$1`, [id, dispositionId, notes]);
  }

  async dispositions(departmentIds: string[] | null): Promise<CcDisposition[]> {
    const result = await query<{ id: string; department_id: string | null; code: string; label: string }>(
      `SELECT id,department_id,code,label FROM cc_dispositions
       WHERE active AND (department_id IS NULL OR $1::uuid[] IS NULL OR department_id=ANY($1::uuid[]))
       ORDER BY department_id NULLS FIRST,code`,
      [departmentIds],
    );
    return result.rows.map((row) => ({ id: row.id, departmentId: row.department_id, code: row.code, label: row.label }));
  }

  async createDisposition(departmentId: string | null, code: string, label: string): Promise<string> {
    const id = randomUUID();
    await query(`INSERT INTO cc_dispositions(id,department_id,code,label) VALUES($1,$2,$3,$4)`, [id, departmentId, code, label]);
    return id;
  }

  async disposition(id: string) {
    const result = await query<{ id: string; department_id: string | null }>(
      `SELECT id,department_id FROM cc_dispositions WHERE id=$1 AND active`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  // ---- tickets (CC-8) ------------------------------------------------------------------------

  async tickets(filter: { departmentIds: string[] | null; status: TicketStatus | null; assigneeId: string | null; limit: number }) {
    const result = await query<TicketRow>(
      `SELECT ${TICKET_COLUMNS}
       WHERE ($1::uuid[] IS NULL OR t.department_id=ANY($1::uuid[]))
         AND ($2::text IS NULL OR t.status=$2) AND ($3::uuid IS NULL OR t.assignee_id=$3)
       ORDER BY (t.status IN ('resolved','closed')),
         CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.updated_at DESC
       LIMIT $4`,
      [filter.departmentIds, filter.status, filter.assigneeId, filter.limit],
    );
    return result.rows.map(toTicket);
  }

  async ticket(id: string): Promise<CcTicket | null> {
    const result = await query<TicketRow>(`SELECT ${TICKET_COLUMNS} WHERE t.id=$1`, [id]);
    return result.rows[0] ? toTicket(result.rows[0]) : null;
  }

  async ticketEvents(id: string): Promise<CcTicketEvent[]> {
    const result = await query<{
      id: string;
      kind: CcTicketEvent["kind"];
      display_name: string | null;
      body: string;
      from_status: TicketStatus | null;
      to_status: TicketStatus | null;
      created_at: Date;
    }>(
      `SELECT e.id,e.kind,u.display_name,e.body,e.from_status,e.to_status,e.created_at
       FROM cc_ticket_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.ticket_id=$1 ORDER BY e.created_at`,
      [id],
    );
    return result.rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      actorName: row.display_name,
      body: row.body,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async createTicket(input: {
    departmentId: string;
    source: "call" | "manual";
    callId: string | null;
    callerNumber: string | null;
    subject: string;
    description: string;
    priority: TicketPriority;
    assigneeId: string | null;
    dueAt: Date | null;
    createdBy: string;
  }): Promise<string> {
    const id = randomUUID();
    await query(
      `INSERT INTO cc_tickets(id,department_id,source,call_id,caller_number,caller_user_id,subject,description,priority,assignee_id,due_at,created_by)
       VALUES($1,$2,$3,$4,$5::varchar,(SELECT id FROM users WHERE phone=$5::varchar),$6,$7,$8,$9,$10,$11)`,
      [
        id,
        input.departmentId,
        input.source,
        input.callId,
        input.callerNumber,
        input.subject,
        input.description,
        input.priority,
        input.assigneeId,
        input.dueAt,
        input.createdBy,
      ],
    );
    return id;
  }

  /** Applies the changes and appends one event per change, atomically (history is append-only). */
  async updateTicket(
    current: CcTicket,
    actorId: string,
    change: { status?: TicketStatus; priority?: TicketPriority; assignee?: { id: string | null; name: string }; dueAt?: Date | null },
  ) {
    await withTransaction(async (client) => {
      await client.query(
        `UPDATE cc_tickets SET status=COALESCE($2,status), priority=COALESCE($3,priority),
           assignee_id=CASE WHEN $4 THEN $5::uuid ELSE assignee_id END,
           due_at=CASE WHEN $6 THEN $7::timestamptz ELSE due_at END,
           resolved_at=CASE WHEN COALESCE($2,status) IN ('resolved','closed') THEN COALESCE(resolved_at,now()) END,
           updated_at=now()
         WHERE id=$1`,
        [
          current.id,
          change.status ?? null,
          change.priority ?? null,
          change.assignee !== undefined,
          change.assignee?.id ?? null,
          change.dueAt !== undefined,
          change.dueAt ?? null,
        ],
      );
      if (change.status && change.status !== current.status)
        await client.query(
          `INSERT INTO cc_ticket_events(created_at,id,ticket_id,actor_id,kind,from_status,to_status) VALUES(clock_timestamp(),$1,$2,$3,'status',$4,$5)`,
          [randomUUID(), current.id, actorId, current.status, change.status],
        );
      if (change.assignee && change.assignee.id !== current.assigneeId)
        await client.query(`INSERT INTO cc_ticket_events(created_at,id,ticket_id,actor_id,kind,body) VALUES(clock_timestamp(),$1,$2,$3,'assign',$4)`, [
          randomUUID(),
          current.id,
          actorId,
          change.assignee.name,
        ]);
    });
  }

  async addTicketEvent(id: string, actorId: string, kind: "comment" | "callback", body: string) {
    await withTransaction(async (client) => {
      await client.query(`INSERT INTO cc_ticket_events(created_at,id,ticket_id,actor_id,kind,body) VALUES(clock_timestamp(),$1,$2,$3,$4,$5)`, [
        randomUUID(),
        id,
        actorId,
        kind,
        body,
      ]);
      await client.query(`UPDATE cc_tickets SET updated_at=now() WHERE id=$1`, [id]);
    });
  }

  async voicemail(id: string) {
    const result = await query<{ id: string; department_id: string | null; recording_key: string }>(
      `SELECT id,department_id,recording_key FROM cc_voicemails WHERE id=$1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async markVoicemailListened(id: string, userId: string) {
    await query(`UPDATE cc_voicemails SET listened_by=$2, listened_at=now() WHERE id=$1 AND listened_at IS NULL`, [id, userId]);
  }

  // ---- KPI (CC-9) ----------------------------------------------------------------------------

  async kpiCalls(departmentId: string, start: Date, end: Date) {
    const result = await query<{
      id: string;
      caller_number: string;
      agent_user_id: string | null;
      display_name: string | null;
      started_at: Date;
      queued_at: Date | null;
      answered_at: Date | null;
      ended_at: Date | null;
      outcome: string | null;
      notes: string;
      disposition: string | null;
    }>(
      `SELECT c.id,c.caller_number,c.agent_user_id,u.display_name,c.started_at,c.queued_at,c.answered_at,c.ended_at,c.outcome,
         c.notes,d.label AS disposition
       FROM cc_calls c LEFT JOIN users u ON u.id=c.agent_user_id LEFT JOIN cc_dispositions d ON d.id=c.disposition_id
       WHERE c.department_id=$1 AND c.started_at>=$2 AND c.started_at<$3 ORDER BY c.started_at`,
      [departmentId, start, end],
    );
    return result.rows.map((row) => ({
      id: row.id,
      callerNumber: row.caller_number,
      agentUserId: row.agent_user_id,
      agentName: row.display_name,
      startedAt: row.started_at,
      queuedAt: row.queued_at,
      answeredAt: row.answered_at,
      endedAt: row.ended_at,
      outcome: row.outcome,
      notes: row.notes,
      disposition: row.disposition,
    })) satisfies KpiCall[];
  }

  /** Wrap-up periods of the department's agents in the period (for AHT). */
  async wrapUpSeconds(departmentId: string, start: Date, end: Date): Promise<number[]> {
    const result = await query<{ seconds: number }>(
      `SELECT extract(epoch FROM s.ended_at-s.started_at)::float AS seconds FROM cc_agent_states s
       WHERE s.state='wrap_up' AND s.ended_at IS NOT NULL AND s.started_at>=$2 AND s.started_at<$3
         AND s.user_id IN (SELECT user_id FROM cc_members WHERE department_id=$1 AND role='agent')`,
      [departmentId, start, end],
    );
    return result.rows.map((row) => row.seconds);
  }
}
