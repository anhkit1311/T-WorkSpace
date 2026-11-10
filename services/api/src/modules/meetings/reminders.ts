import type { MeetingScheduleNotice } from "@doan/shared";
import { query } from "../../infrastructure/database/db.js";
import { sendNoticeEmail } from "../../infrastructure/email/service.js";
import { webOrigin } from "../../shared/http/utils.js";
import { addNotices } from "../../infrastructure/realtime/notices.js";
import type { Emitter } from "./outcome-events.js";

type Kind = MeetingScheduleNotice["kind"];
const SUBJECT: Record<Kind, string> = {
  created: "Lời mời họp",
  updated: "Lịch họp đã thay đổi",
  canceled: "Lịch họp đã bị hủy",
  reminder: "Sắp đến giờ họp (15 phút)",
};

/** NV-MT1: tell everyone who can enter the room (except the actor) by socket and e-mail. */
export async function noticeSchedule(
  io: Emitter,
  scheduleId: string,
  kind: Kind,
  actorId: string | null = null,
) {
  const audience = await query<
    { userId: string; email: string; mail: boolean } & Omit<MeetingScheduleNotice, "kind">
  >(
    `SELECT a.user_id AS "userId", u.email, u.notifications_enabled AS mail,
       s.id AS "scheduleId", c.workspace_id AS "workspaceId", s.channel_id AS "roomId", s.title, s.starts_at AS "startsAt"
     FROM meeting_schedules s JOIN channels c ON c.id=s.channel_id
     JOIN channel_access a ON a.channel_id=s.channel_id JOIN users u ON u.id=a.user_id
     WHERE s.id=$1 AND a.user_id IS DISTINCT FROM $2
       -- With an invite list only the invitees (and the organizer) are told.
       AND (a.user_id=s.created_by OR NOT EXISTS(SELECT 1 FROM meeting_invitees i WHERE i.schedule_id=s.id)
         OR EXISTS(SELECT 1 FROM meeting_invitees i WHERE i.schedule_id=s.id AND i.user_id=a.user_id))`,
    [scheduleId, actorId],
  );
  const first = audience.rows[0];
  if (!first) return;
  const when = new Date(first.startsAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  await addNotices(
    audience.rows.map((row) => row.userId),
    {
      kind: "meeting",
      title: SUBJECT[kind],
      body: `${first.title} · ${when}`,
      link: { view: "meetings", workspaceId: first.workspaceId, channelId: first.roomId },
    },
  );
  for (const { userId, email, mail, ...notice } of audience.rows) {
    io.to(`user:${userId}`).emit("meeting_schedule_notice", { kind, ...notice });
    if (!mail) continue;
    const text = `${SUBJECT[kind]}: "${notice.title}"\nThời gian bắt đầu: ${when}\nMở lịch họp: ${webOrigin}/app`;
    void sendNoticeEmail(email, `[T-WorkSpace] ${SUBJECT[kind]}: ${notice.title}`, text).catch(
      (error: Error) =>
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "meeting_notice_email_failed",
            message: error.message,
          }),
        ),
    );
  }
}

/** Claims due schedules first so two API instances never remind twice. */
export async function sendDueReminders(io: Emitter) {
  const due = await query<{ id: string }>(
    `UPDATE meeting_schedules SET reminded_at=now()
     WHERE reminded_at IS NULL AND canceled_at IS NULL AND starts_at > now() AND starts_at <= now()+interval '15 minutes'
     RETURNING id`,
  );
  for (const { id } of due.rows) await noticeSchedule(io, id, "reminder");
  return due.rowCount ?? 0;
}

export function startMeetingReminders(io: Emitter) {
  const timer = setInterval(
    () =>
      void sendDueReminders(io).catch((error: Error) =>
        console.error(
          JSON.stringify({
            level: "error",
            event: "meeting_reminder_failed",
            message: error.message,
          }),
        ),
      ),
    60_000,
  );
  timer.unref();
  return () => clearInterval(timer);
}
