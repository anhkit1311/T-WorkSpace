import { randomUUID } from "node:crypto";
import type { MeetingScheduleItem } from "@doan/shared";
import { query, withTransaction } from "../../infrastructure/database/db.js";
import { normalizeAgenda, replaceScheduleAgenda } from "./outcomes.js";
import { HttpError } from "../../shared/http/http-error.js";
import { validateId } from "../workspaces/service.js";

type ScheduleInput = {
  roomId?: unknown;
  title?: unknown;
  description?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  agenda?: unknown;
  committeeId?: unknown;
};

/** MT-3: a schedule may name a defense committee the organizer sits on (null clears it). */
async function committeeFor(userId: string, value: unknown): Promise<string | null> {
  if (value === null || value === "") return null;
  validateId(value);
  const member = await query(
    `SELECT 1 FROM thesis_committees c JOIN thesis_committee_members m ON m.committee_id=c.id AND m.lecturer_id=$2
     WHERE c.id=$1 AND c.status='confirmed'`,
    [value, userId],
  );
  if (!member.rowCount) throw new HttpError(403, "NOT_COMMITTEE_MEMBER", "Bạn không thuộc hội đồng này.");
  return value;
}

function validateSchedule(input: ScheduleInput) {
  validateId(input.roomId);
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (title.length < 3 || title.length > 120 || description.length > 1000)
    throw new HttpError(
      400,
      "INVALID_SCHEDULE",
      "Tên cuộc họp cần 3–120 ký tự; mô tả tối đa 1000 ký tự.",
    );
  const parseTime = (value: unknown) => {
    if (typeof value !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value))
      throw new HttpError(400, "INVALID_TIME", "Thời gian phải có múi giờ hợp lệ.");
    const time = Date.parse(value);
    if (!Number.isFinite(time))
      throw new HttpError(400, "INVALID_TIME", "Thời gian cuộc họp không hợp lệ.");
    return time;
  };
  const startsAt = parseTime(input.startsAt);
  const endsAt = parseTime(input.endsAt);
  if (startsAt < Date.now() + 60_000 || startsAt > Date.now() + 180 * 86_400_000)
    throw new HttpError(
      400,
      "INVALID_TIME",
      "Lịch họp cần bắt đầu sau ít nhất 1 phút và trong 180 ngày tới.",
    );
  if (endsAt - startsAt < 10 * 60_000 || endsAt - startsAt > 8 * 60 * 60_000)
    throw new HttpError(400, "INVALID_TIME", "Thời lượng cuộc họp phải từ 10 phút đến 8 giờ.");
  return {
    roomId: input.roomId,
    title,
    description,
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
  };
}

const selectSchedule = `SELECT s.id, s.channel_id AS "roomId", c.workspace_id AS "workspaceId",
  c.name AS "roomName", w.name AS "workspaceName", s.created_by AS "createdBy",
  u.display_name AS "organizerName", s.title, s.description,
  s.starts_at AS "startsAt", s.ends_at AS "endsAt", s.committee_id AS "committeeId",
  COALESCE((SELECT json_agg(i.label ORDER BY i.position,i.id) FROM meeting_agenda_items i WHERE i.schedule_id=s.id),'[]'::json) AS agenda,
  (s.created_by=$1 OR m.role IN ('owner','admin')) AS "canManage"
  FROM meeting_schedules s
  JOIN channels c ON c.id=s.channel_id
  JOIN workspaces w ON w.id=c.workspace_id
  JOIN channel_access m ON m.channel_id=c.id AND m.user_id=$1 AND m.can_write
  JOIN users u ON u.id=s.created_by`;

export async function listMeetingSchedules(userId: string): Promise<MeetingScheduleItem[]> {
  const result = await query<MeetingScheduleItem>(
    `${selectSchedule} WHERE s.canceled_at IS NULL AND s.ends_at > now()
     ORDER BY s.starts_at ASC LIMIT 100`,
    [userId],
  );
  return result.rows;
}

export async function createMeetingSchedule(
  userId: string,
  input: ScheduleInput,
): Promise<MeetingScheduleItem> {
  const data = validateSchedule(input);
  const room = await query(
    `SELECT 1 FROM channel_access WHERE channel_id=$1 AND user_id=$2 AND type IN ('voice','video') AND can_write`,
    [data.roomId, userId],
  );
  if (!room.rowCount)
    throw new HttpError(404, "ROOM_NOT_FOUND", "Không tìm thấy phòng họp trong nhóm của bạn.");
  const agenda = normalizeAgenda(input.agenda);
  const committeeId = input.committeeId === undefined ? null : await committeeFor(userId, input.committeeId);
  const id = randomUUID();
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO meeting_schedules(id,channel_id,created_by,title,description,starts_at,ends_at,committee_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, data.roomId, userId, data.title, data.description, data.startsAt, data.endsAt, committeeId],
    );
    await replaceScheduleAgenda(client, id, agenda);
  });
  const result = await query<MeetingScheduleItem>(`${selectSchedule} WHERE s.id=$2`, [userId, id]);
  return result.rows[0];
}

async function requireManageSchedule(userId: string, id: string): Promise<void> {
  validateId(id);
  const result = await query<{ canManage: boolean }>(
    `${selectSchedule} WHERE s.id=$2 AND s.canceled_at IS NULL AND s.ends_at > now()`,
    [userId, id],
  );
  if (!result.rowCount) throw new HttpError(404, "SCHEDULE_NOT_FOUND", "Không tìm thấy lịch họp.");
  if (!result.rows[0].canManage)
    throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền sửa lịch họp này.");
}

export async function updateMeetingSchedule(
  userId: string,
  id: string,
  input: ScheduleInput,
): Promise<MeetingScheduleItem> {
  await requireManageSchedule(userId, id);
  const data = validateSchedule(input);
  const room = await query(
    `SELECT 1 FROM channel_access c
     WHERE c.channel_id=$1 AND c.user_id=$2 AND c.type IN ('voice','video') AND c.can_write
       AND c.workspace_id=(SELECT previous.workspace_id FROM meeting_schedules s
         JOIN channels previous ON previous.id=s.channel_id WHERE s.id=$3)`,
    [data.roomId, userId, id],
  );
  if (!room.rowCount)
    throw new HttpError(404, "ROOM_NOT_FOUND", "Không tìm thấy phòng họp trong nhóm của bạn.");
  const agenda = input.agenda === undefined ? null : normalizeAgenda(input.agenda);
  const committeeId = input.committeeId === undefined ? undefined : await committeeFor(userId, input.committeeId);
  await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE meeting_schedules SET channel_id=$2,title=$3,description=$4,starts_at=$5,ends_at=$6,updated_at=now(),
         committee_id=CASE WHEN $7 THEN $8::uuid ELSE committee_id END
       WHERE id=$1 AND canceled_at IS NULL RETURNING id`,
      [id, data.roomId, data.title, data.description, data.startsAt, data.endsAt, committeeId !== undefined, committeeId ?? null],
    );
    if (!result.rowCount)
      throw new HttpError(404, "SCHEDULE_NOT_FOUND", "Không tìm thấy lịch họp.");
    if (!agenda) return;
    const current = await client.query<{ label: string }>(
      `SELECT label FROM meeting_agenda_items WHERE schedule_id=$1 ORDER BY position,id`,
      [id],
    );
    if (JSON.stringify(current.rows.map((row) => row.label)) === JSON.stringify(agenda)) return;
    // Once a session has used the agenda, its ticked progress belongs to that meeting.
    const started = await client.query(`SELECT 1 FROM meeting_sessions WHERE schedule_id=$1`, [id]);
    if (started.rowCount)
      throw new HttpError(409, "AGENDA_IN_USE", "Cuộc họp đã bắt đầu, hãy sửa agenda trong phòng họp.");
    await replaceScheduleAgenda(client, id, agenda);
  });
  const schedule = await query<MeetingScheduleItem>(`${selectSchedule} WHERE s.id=$2`, [
    userId,
    id,
  ]);
  return schedule.rows[0];
}

export async function cancelMeetingSchedule(userId: string, id: string): Promise<void> {
  await requireManageSchedule(userId, id);
  await query(
    `UPDATE meeting_schedules SET canceled_at=now(),updated_at=now() WHERE id=$1 AND canceled_at IS NULL`,
    [id],
  );
}
