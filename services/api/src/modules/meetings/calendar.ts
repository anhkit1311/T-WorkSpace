import type { MeetingCalendar, MeetingCalendarSession, MeetingScheduleItem } from "@doan/shared";
import { query } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";

/** Longest window one request may cover: a month view plus its spill-over weeks. */
const MAX_RANGE_DAYS = 42;

/**
 * The "Họp" week view: schedules (past ones too, cancelled ones not) and the sessions that ran or
 * are running in [from, to), in rooms the user can see. Rooms of archived groups stay visible
 * read-only, so canManage also needs write access.
 */
export async function listMeetingCalendar(userId: string, from: Date, to: Date): Promise<MeetingCalendar> {
  const span = to.getTime() - from.getTime();
  if (!Number.isFinite(span) || span <= 0 || span > MAX_RANGE_DAYS * 86_400_000)
    throw new HttpError(400, "INVALID_RANGE", `Khoảng thời gian phải hợp lệ và không quá ${MAX_RANGE_DAYS} ngày.`);
  const [schedules, sessions] = await Promise.all([
    query<MeetingScheduleItem>(
      `SELECT s.id, s.channel_id AS "roomId", c.workspace_id AS "workspaceId",
         c.name AS "roomName", w.name AS "workspaceName", s.created_by AS "createdBy",
         u.display_name AS "organizerName", s.title, s.description,
         s.starts_at AS "startsAt", s.ends_at AS "endsAt",
         COALESCE((SELECT json_agg(i.label ORDER BY i.position,i.id) FROM meeting_agenda_items i WHERE i.schedule_id=s.id),'[]'::json) AS agenda,
         (m.can_write AND (s.created_by=$1 OR m.role IN ('owner','admin'))) AS "canManage"
       FROM meeting_schedules s
       JOIN channels c ON c.id=s.channel_id
       JOIN workspaces w ON w.id=c.workspace_id
       JOIN channel_access m ON m.channel_id=c.id AND m.user_id=$1
       JOIN users u ON u.id=s.created_by
       WHERE s.canceled_at IS NULL AND s.starts_at<$3 AND s.ends_at>$2
       ORDER BY s.starts_at, s.id LIMIT 500`,
      [userId, from, to],
    ),
    // People: who is connected now for a running session, who was let in for a finished one.
    query<MeetingCalendarSession>(
      `SELECT s.id, s.channel_id AS "roomId", c.name AS "roomName", c.workspace_id AS "workspaceId",
         w.name AS "workspaceName", s.schedule_id AS "scheduleId", sc.title,
         s.started_at AS "startedAt", s.ended_at AS "endedAt",
         COALESCE((SELECT json_agg(u.display_name ORDER BY a.joined_at, a.user_id)
           FROM meeting_attendees a JOIN users u ON u.id=a.user_id
           WHERE a.session_id=s.id AND a.state='admitted'
             AND (s.ended_at IS NOT NULL OR EXISTS(SELECT 1 FROM meeting_connections mc WHERE mc.session_id=s.id AND mc.user_id=a.user_id))),'[]'::json) AS people
       FROM meeting_sessions s
       JOIN channels c ON c.id=s.channel_id
       JOIN workspaces w ON w.id=c.workspace_id
       JOIN channel_access m ON m.channel_id=c.id AND m.user_id=$1
       LEFT JOIN meeting_schedules sc ON sc.id=s.schedule_id
       WHERE s.started_at<$3 AND (s.ended_at IS NULL OR s.ended_at>$2)
       ORDER BY s.started_at, s.id LIMIT 500`,
      [userId, from, to],
    ),
  ]);
  return { schedules: schedules.rows, sessions: sessions.rows };
}
