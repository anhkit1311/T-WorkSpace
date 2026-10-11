import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { MeetingNotes, MeetingOutcomes } from "@doan/shared";
import { query, withTransaction } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";
import { requireChannelAccess, validateId } from "../workspaces/service.js";
import { createTask } from "../tasks/service.js";

// Outcomes of a meeting session: agenda, shared notes, tasks created during the call and the
// summary posted when the session ends. Tasks belong to text-channel boards, so every session
// points at an outcome text channel in the room's workspace.

const NOTES_MAX = 20000;

type SessionRow = {
  id: string;
  channel_id: string;
  schedule_id: string | null;
  host_id: string;
  ended_at: Date | null;
  outcome_channel_id: string | null;
};

async function sessionFor(userId: string, sessionId: unknown) {
  validateId(sessionId);
  const session = (
    await query<SessionRow>(
      `SELECT id,channel_id,schedule_id,host_id,ended_at,outcome_channel_id FROM meeting_sessions WHERE id=$1`,
      [sessionId],
    )
  ).rows[0];
  if (!session) throw new HttpError(404, "SESSION_NOT_FOUND", "Phiên họp không tồn tại.");
  await requireChannelAccess(userId, session.channel_id);
  return session;
}

// Editing is limited to admitted attendees of a session that is still running.
async function lockEditable(client: PoolClient, userId: string, sessionId: unknown) {
  validateId(sessionId);
  const session = (
    await client.query<SessionRow>(`SELECT * FROM meeting_sessions WHERE id=$1 FOR UPDATE`, [
      sessionId,
    ])
  ).rows[0];
  if (!session) throw new HttpError(404, "SESSION_NOT_FOUND", "Phiên họp không tồn tại.");
  if (session.ended_at)
    throw new HttpError(409, "MEETING_ENDED", "Phiên họp đã kết thúc, không thể chỉnh sửa.");
  const attendee = (
    await client.query<{ role: string }>(
      `SELECT a.role FROM meeting_attendees a JOIN channel_access access ON access.channel_id=$3 AND access.user_id=a.user_id AND access.can_write WHERE a.session_id=$1 AND a.user_id=$2 AND a.state='admitted'`,
      [session.id, userId, session.channel_id],
    )
  ).rows[0];
  if (!attendee)
    throw new HttpError(403, "NOT_ATTENDEE", "Chỉ người đã vào phòng mới chỉnh sửa được.");
  return { session, role: attendee.role };
}

function label(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 200)
    throw new HttpError(400, "INVALID_AGENDA", "Mục agenda cần 1–200 ký tự.");
  return value.trim();
}

export function normalizeAgenda(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 30)
    throw new HttpError(400, "INVALID_AGENDA", "Agenda tối đa 30 mục.");
  return value.map(label);
}

export async function replaceScheduleAgenda(
  client: PoolClient,
  scheduleId: string,
  items: string[],
) {
  await client.query(`DELETE FROM meeting_agenda_items WHERE schedule_id=$1`, [scheduleId]);
  for (const [index, item] of items.entries())
    await client.query(
      `INSERT INTO meeting_agenda_items(id,schedule_id,label,position) VALUES($1,$2,$3,$4)`,
      [randomUUID(), scheduleId, item, index * 1024],
    );
}

export async function defaultOutcomeChannel(client: PoolClient, roomId: string) {
  const row = (
    await client.query<{ id: string }>(
      `SELECT c.id FROM channels c JOIN channels room ON room.workspace_id=c.workspace_id WHERE room.id=$1 AND c.type='text' AND c.archived_at IS NULL AND NOT c.is_private ORDER BY c.position,c.created_at,c.id LIMIT 1`,
      [roomId],
    )
  ).rows[0];
  return row?.id ?? null;
}

export async function getMeetingOutcomes(
  userId: string,
  sessionId: unknown,
): Promise<MeetingOutcomes> {
  const session = await sessionFor(userId, sessionId);
  const head = (
    await query(
      `SELECT room.name AS "roomName",room.workspace_id AS "workspaceId",COALESCE(sc.title,room.name) AS title,s.started_at AS "startedAt",s.ended_at AS "endedAt",out.id AS "outcomeChannelId",out.name AS "outcomeChannelName",
        EXISTS(SELECT 1 FROM meeting_attendees a JOIN channel_access access ON access.channel_id=s.channel_id AND access.user_id=a.user_id AND access.can_write WHERE a.session_id=s.id AND a.user_id=$2 AND a.state='admitted') AS attendee,
        (SELECT role FROM meeting_attendees WHERE session_id=s.id AND user_id=$2) AS role,
        (SELECT id FROM messages WHERE meeting_session_id=s.id AND kind='meeting_summary' AND deleted_at IS NULL) AS "summaryMessageId"
       FROM meeting_sessions s JOIN channels room ON room.id=s.channel_id LEFT JOIN meeting_schedules sc ON sc.id=s.schedule_id
       LEFT JOIN channels out ON out.id=s.outcome_channel_id AND EXISTS(SELECT 1 FROM channel_access oa WHERE oa.channel_id=out.id AND oa.user_id=$2)
       WHERE s.id=$1`,
      [session.id, userId],
    )
  ).rows[0];
  const attendees = await query(
    `SELECT a.user_id AS "userId",u.display_name AS "displayName" FROM meeting_attendees a JOIN users u ON u.id=a.user_id WHERE a.session_id=$1 AND a.state='admitted' ORDER BY a.joined_at,a.user_id`,
    [session.id],
  );
  const agenda = await query(
    `SELECT i.id,i.label,i.done,u.display_name AS "doneByName",(i.schedule_id IS NOT NULL) AS "fromSchedule" FROM meeting_agenda_items i LEFT JOIN users u ON u.id=i.done_by WHERE (i.schedule_id=$2 AND $2::uuid IS NOT NULL) OR i.session_id=$1 ORDER BY (i.schedule_id IS NULL),i.position,i.created_at,i.id`,
    [session.id, session.schedule_id],
  );
  const notes = await query<MeetingNotes>(
    `SELECT n.content,n.version,u.display_name AS "updatedByName",n.updated_at AS "updatedAt" FROM meeting_notes n LEFT JOIN users u ON u.id=n.updated_by WHERE n.session_id=$1`,
    [session.id],
  );
  // Only tasks on boards the viewer can open are listed.
  const tasks = await query(
    `SELECT t.id,t.channel_id AS "channelId",t.title,t.status,u.display_name AS "assigneeName",t.due_at AS "dueAt" FROM tasks t JOIN channel_access access ON access.channel_id=t.channel_id AND access.user_id=$2 LEFT JOIN users u ON u.id=t.assignee_id WHERE t.meeting_session_id=$1 AND t.archived_at IS NULL ORDER BY t.created_at,t.id`,
    [session.id, userId],
  );
  const live = !head.endedAt;
  return {
    sessionId: session.id,
    roomId: session.channel_id,
    hostId: session.host_id,
    roomName: head.roomName,
    workspaceId: head.workspaceId,
    title: head.title,
    startedAt: head.startedAt,
    endedAt: head.endedAt,
    outcomeChannelId: head.outcomeChannelId,
    outcomeChannelName: head.outcomeChannelName,
    canEdit: live && head.attendee,
    canManage: live && head.attendee && ["host", "cohost"].includes(head.role),
    attendees: attendees.rows,
    agenda: agenda.rows,
    notes: notes.rows[0] ?? { content: "", version: 0, updatedByName: null, updatedAt: null },
    tasks: tasks.rows,
    summaryMessageId: head.summaryMessageId,
  } as MeetingOutcomes;
}

// Optimistic concurrency like task versions: a stale baseVersion returns the current notes so
// the client can merge instead of silently overwriting another attendee.
export async function saveMeetingNotes(
  userId: string,
  sessionId: unknown,
  body: { content?: unknown; baseVersion?: unknown },
) {
  if (typeof body.content !== "string" || body.content.length > NOTES_MAX)
    throw new HttpError(400, "INVALID_NOTES", `Ghi chú tối đa ${NOTES_MAX} ký tự.`);
  if (!Number.isInteger(body.baseVersion) || Number(body.baseVersion) < 0)
    throw new HttpError(400, "INVALID_VERSION", "Cần phiên bản ghi chú hiện tại.");
  const content = body.content;
  return withTransaction(async (client) => {
    const { session } = await lockEditable(client, userId, sessionId);
    const current = await client.query<{ version: number }>(
      `SELECT version FROM meeting_notes WHERE session_id=$1 FOR UPDATE`,
      [session.id],
    );
    if ((current.rows[0]?.version ?? 0) !== body.baseVersion)
      throw new HttpError(409, "NOTES_CONFLICT", "Ghi chú vừa được người khác cập nhật.");
    const saved = (
      await client.query(
        `INSERT INTO meeting_notes(session_id,content,version,updated_by,updated_at) VALUES($1,$2,1,$3,now())
         ON CONFLICT(session_id) DO UPDATE SET content=EXCLUDED.content,version=meeting_notes.version+1,updated_by=EXCLUDED.updated_by,updated_at=now()
         RETURNING content,version,updated_at AS "updatedAt",(SELECT display_name FROM users WHERE id=$3) AS "updatedByName"`,
        [session.id, content, userId],
      )
    ).rows[0] as MeetingNotes;
    return { roomId: session.channel_id, sessionId: session.id, notes: saved };
  });
}

export async function addAgendaItem(userId: string, sessionId: unknown, body: { label?: unknown }) {
  const text = label(body.label);
  return withTransaction(async (client) => {
    const { session } = await lockEditable(client, userId, sessionId);
    const count = await client.query(
      `SELECT count(*)::integer AS total FROM meeting_agenda_items WHERE session_id=$1 OR (schedule_id=$2 AND $2::uuid IS NOT NULL)`,
      [session.id, session.schedule_id],
    );
    if (count.rows[0].total >= 30)
      throw new HttpError(409, "AGENDA_FULL", "Agenda tối đa 30 mục.");
    await client.query(
      `INSERT INTO meeting_agenda_items(id,session_id,label,position) VALUES($1,$2,$3,(SELECT COALESCE(max(position),0)+1024 FROM meeting_agenda_items WHERE session_id=$2))`,
      [randomUUID(), session.id, text],
    );
    return { roomId: session.channel_id, sessionId: session.id };
  });
}

async function agendaTarget(client: PoolClient, session: SessionRow, itemId: unknown) {
  validateId(itemId);
  const item = (
    await client.query(
      `SELECT id FROM meeting_agenda_items WHERE id=$1 AND (session_id=$2 OR (schedule_id=$3 AND $3::uuid IS NOT NULL)) FOR UPDATE`,
      [itemId, session.id, session.schedule_id],
    )
  ).rows[0];
  if (!item) throw new HttpError(404, "AGENDA_NOT_FOUND", "Mục agenda không còn tồn tại.");
}

export async function updateAgendaItem(
  userId: string,
  sessionId: unknown,
  itemId: unknown,
  body: { done?: unknown; label?: unknown },
) {
  return withTransaction(async (client) => {
    const { session } = await lockEditable(client, userId, sessionId);
    await agendaTarget(client, session, itemId);
    if (body.label !== undefined)
      await client.query(`UPDATE meeting_agenda_items SET label=$2 WHERE id=$1`, [
        itemId,
        label(body.label),
      ]);
    if (body.done !== undefined) {
      if (typeof body.done !== "boolean")
        throw new HttpError(400, "INVALID_AGENDA", "Trạng thái agenda không hợp lệ.");
      await client.query(
        `UPDATE meeting_agenda_items SET done=$2,done_by=CASE WHEN $2 THEN $3::uuid ELSE NULL END WHERE id=$1`,
        [itemId, body.done, userId],
      );
    }
    return { roomId: session.channel_id, sessionId: session.id };
  });
}

export async function deleteAgendaItem(userId: string, sessionId: unknown, itemId: unknown) {
  return withTransaction(async (client) => {
    const { session } = await lockEditable(client, userId, sessionId);
    await agendaTarget(client, session, itemId);
    // Items planned on the schedule stay with the schedule; only ad-hoc items are removed.
    const removed = await client.query(
      `DELETE FROM meeting_agenda_items WHERE id=$1 AND session_id=$2`,
      [itemId, session.id],
    );
    if (!removed.rowCount)
      throw new HttpError(409, "AGENDA_SCHEDULED", "Mục lấy từ lịch họp chỉ có thể đánh dấu xong.");
    return { roomId: session.channel_id, sessionId: session.id };
  });
}

export async function setOutcomeChannel(
  userId: string,
  sessionId: unknown,
  body: { channelId?: unknown },
) {
  validateId(body.channelId);
  return withTransaction(async (client) => {
    const { session, role } = await lockEditable(client, userId, sessionId);
    if (!["host", "cohost"].includes(role))
      throw new HttpError(403, "FORBIDDEN", "Chỉ host/co-host đổi kênh nhận kết quả.");
    const target = await client.query(
      `SELECT 1 FROM channel_access access JOIN channels room ON room.id=$3 WHERE access.channel_id=$1 AND access.user_id=$2 AND access.type='text' AND access.can_write AND access.workspace_id=room.workspace_id`,
      [body.channelId, userId, session.channel_id],
    );
    if (!target.rowCount)
      throw new HttpError(
        400,
        "INVALID_OUTCOME_CHANNEL",
        "Kênh nhận kết quả phải là kênh văn bản bạn có quyền ghi trong cùng workspace.",
      );
    await client.query(`UPDATE meeting_sessions SET outcome_channel_id=$2 WHERE id=$1`, [
      session.id,
      body.channelId,
    ]);
    return { roomId: session.channel_id, sessionId: session.id };
  });
}

export async function createMeetingTask(
  userId: string,
  sessionId: unknown,
  body: Record<string, unknown>,
) {
  const { session } = await withTransaction(async (client) =>
    lockEditable(client, userId, sessionId),
  );
  if (!session.outcome_channel_id)
    throw new HttpError(
      409,
      "NO_OUTCOME_CHANNEL",
      "Hãy chọn kênh nhận kết quả trước khi tạo việc.",
    );
  const task = await createTask(userId, session.outcome_channel_id, body, {
    meetingSessionId: session.id,
  });
  return { roomId: session.channel_id, sessionId: session.id, task };
}

function minutes(start: Date, end: Date) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
}

// Called inside the transaction that ends a session. The partial unique index on
// messages(meeting_session_id) makes this idempotent across API nodes and repeated calls.
export async function createMeetingSummary(client: PoolClient, sessionId: string) {
  const session = (
    await client.query(
      `SELECT s.id,s.channel_id,s.host_id,s.started_at,s.ended_at,s.outcome_channel_id,COALESCE(sc.title,room.name) AS title
       FROM meeting_sessions s JOIN channels room ON room.id=s.channel_id LEFT JOIN meeting_schedules sc ON sc.id=s.schedule_id WHERE s.id=$1`,
      [sessionId],
    )
  ).rows[0];
  if (!session?.ended_at) return null;
  const attendees = (
    await client.query<{ user_id: string; display_name: string }>(
      `SELECT a.user_id,u.display_name FROM meeting_attendees a JOIN users u ON u.id=a.user_id WHERE a.session_id=$1 AND a.state='admitted' ORDER BY (a.user_id=$2) DESC,a.joined_at,a.user_id`,
      [sessionId, session.host_id],
    )
  ).rows;
  const agenda = (
    await client.query<{ label: string; done: boolean }>(
      `SELECT i.label,i.done FROM meeting_agenda_items i JOIN meeting_sessions s ON s.id=$1 WHERE i.session_id=s.id OR (i.schedule_id=s.schedule_id AND s.schedule_id IS NOT NULL) ORDER BY (i.schedule_id IS NULL),i.position,i.id`,
      [sessionId],
    )
  ).rows;
  const tasks = (
    await client.query<{ title: string; assignee: string | null }>(
      `SELECT t.title,u.display_name AS assignee FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id WHERE t.meeting_session_id=$1 AND t.archived_at IS NULL ORDER BY t.created_at,t.id`,
      [sessionId],
    )
  ).rows;
  const notes = (
    await client.query<{ content: string }>(`SELECT content FROM meeting_notes WHERE session_id=$1`, [
      sessionId,
    ])
  ).rows[0]?.content.trim();
  // A host testing alone with nothing recorded does not need a channel post.
  if (attendees.length < 2 && !tasks.length && !notes && !agenda.some((item) => item.done))
    return null;
  const target = (
    await client.query<{ id: string }>(
      `SELECT c.id FROM channels c WHERE c.id=ANY($1::uuid[]) AND c.archived_at IS NULL ORDER BY (c.id=$2) DESC LIMIT 1`,
      [[session.outcome_channel_id, session.channel_id].filter(Boolean), session.outcome_channel_id],
    )
  ).rows[0];
  if (!target) return null;
  const author = (
    await client.query<{ user_id: string }>(
      `SELECT user_id FROM channel_access WHERE channel_id=$1 AND can_write AND user_id=ANY($2::uuid[]) ORDER BY array_position($2::uuid[],user_id) LIMIT 1`,
      [target.id, attendees.map((row) => row.user_id)],
    )
  ).rows[0];
  if (!author) return null;
  const doneCount = agenda.filter((item) => item.done).length;
  const lines = [
    `Tổng kết cuộc họp: ${session.title}`,
    `${minutes(session.started_at, session.ended_at)} phút · ${attendees.length} người tham dự: ${attendees.map((row) => row.display_name).join(", ")}`,
  ];
  if (agenda.length) lines.push(`Agenda: ${doneCount}/${agenda.length} mục hoàn thành`);
  if (tasks.length)
    lines.push(
      `Việc cần làm (${tasks.length}):`,
      ...tasks.map((task) => `• ${task.title}${task.assignee ? ` — ${task.assignee}` : ""}`),
    );
  if (notes) lines.push(`Ghi chú: ${notes.length > 600 ? `${notes.slice(0, 600)}…` : notes}`);
  let content = lines.join("\n");
  if (content.length > 4000) content = `${content.slice(0, 3999)}…`;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO messages(id,channel_id,author_id,content,kind,meeting_session_id) VALUES($1,$2,$3,$4,'meeting_summary',$5)
     ON CONFLICT (meeting_session_id) WHERE kind='meeting_summary' DO NOTHING RETURNING id`,
    [randomUUID(), target.id, author.user_id, content, sessionId],
  );
  return inserted.rows[0]?.id ?? null;
}

// Single place that ends a session so the summary can never be skipped by one exit path.
export async function finishSession(client: PoolClient, sessionId: string) {
  await client.query(`UPDATE meeting_sessions SET ended_at=COALESCE(ended_at,now()) WHERE id=$1`, [
    sessionId,
  ]);
  await client.query(`DELETE FROM meeting_connections WHERE session_id=$1`, [sessionId]);
  return createMeetingSummary(client, sessionId);
}
