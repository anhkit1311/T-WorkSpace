import type { MeetingAttendance } from "@doan/shared";
import { query } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";
import { requireChannelAccess, validateId } from "../workspaces/service.js";

// MT-2: who attended a session and for how long, from the per-connection rows in
// meeting_participations. EL-6 reuses presentMs for "present for at least 70% of the class".

/** Total time covered by the intervals; overlaps (two tabs, a reconnect) count once. */
export function presentMs(intervals: { from: number; to: number }[]): number {
  let total = 0;
  let end = -Infinity;
  for (const { from, to } of [...intervals].sort((a, b) => a.from - b.from)) {
    if (to <= end) continue;
    total += to - Math.max(from, end);
    end = to;
  }
  return total;
}

export async function getMeetingAttendance(userId: string, sessionId: unknown): Promise<MeetingAttendance> {
  validateId(sessionId);
  const session = (
    await query<{ id: string; channel_id: string; host_id: string; title: string; started_at: Date; ended_at: Date | null; role: string | null; now: Date }>(
      `SELECT s.id,s.channel_id,s.host_id,COALESCE(sc.title,room.name) AS title,s.started_at,s.ended_at,
         (SELECT role FROM meeting_attendees WHERE session_id=s.id AND user_id=$2) AS role,now() AS now
       FROM meeting_sessions s JOIN channels room ON room.id=s.channel_id LEFT JOIN meeting_schedules sc ON sc.id=s.schedule_id
       WHERE s.id=$1`,
      [sessionId, userId],
    )
  ).rows[0];
  if (!session) throw new HttpError(404, "SESSION_NOT_FOUND", "Phiên họp không tồn tại.");
  await requireChannelAccess(userId, session.channel_id);
  // Attendance is a register: the host and co-hosts keep it, not every participant.
  if (session.host_id !== userId && session.role !== "host" && session.role !== "cohost")
    throw new HttpError(403, "FORBIDDEN", "Chỉ chủ trì hoặc đồng chủ trì xem được danh sách tham dự.");

  const end = (session.ended_at ?? session.now).getTime();
  const rows = await query<{ user_id: string; display_name: string; email: string; joined_at: Date; left_at: Date | null }>(
    `SELECT p.user_id,u.display_name,u.email,p.joined_at,p.left_at FROM meeting_participations p JOIN users u ON u.id=p.user_id
     WHERE p.session_id=$1 ORDER BY p.joined_at`,
    [session.id],
  );
  const people = new Map<string, { displayName: string; email: string; intervals: { from: number; to: number }[]; first: Date; last: Date | null; open: boolean }>();
  for (const row of rows.rows) {
    const person = people.get(row.user_id) ?? { displayName: row.display_name, email: row.email, intervals: [], first: row.joined_at, last: null, open: false };
    // A connection still open counts until the session ended (or now, while it runs).
    person.intervals.push({ from: row.joined_at.getTime(), to: Math.min(row.left_at?.getTime() ?? end, end) });
    if (!row.left_at) person.open = true;
    else if (!person.last || row.left_at > person.last) person.last = row.left_at;
    people.set(row.user_id, person);
  }
  const duration = Math.max(1, end - session.started_at.getTime());
  return {
    sessionId: session.id,
    title: session.title,
    startedAt: session.started_at.toISOString(),
    endedAt: session.ended_at?.toISOString() ?? null,
    durationSeconds: Math.round(duration / 1000),
    rows: [...people].map(([id, person]) => {
      const present = presentMs(person.intervals);
      return {
        userId: id,
        displayName: person.displayName,
        email: person.email,
        firstJoinedAt: person.first.toISOString(),
        lastLeftAt: person.open ? null : (person.last?.toISOString() ?? null),
        presentSeconds: Math.round(present / 1000),
        ratio: Math.min(1, Number((present / duration).toFixed(4))),
      };
    }),
  };
}

/** TDTU student accounts are <MSSV>@student.tdtu.edu.vn; other accounts have no student number. */
export const studentIdFromEmail = (email: string) => /^([0-9a-z]+)@student\.tdtu\.edu\.vn$/i.exec(email)?.[1].toUpperCase() ?? "";

/** The register as CSV for Excel (the route adds the UTF-8 BOM). */
export async function exportMeetingAttendance(userId: string, sessionId: unknown) {
  const attendance = await getMeetingAttendance(userId, sessionId);
  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false }) : "");
  const cell = (value: string) => (/[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [
    ["Họ tên", "MSSV", "Email", "Vào lúc", "Rời lúc", "Có mặt (phút)", "Tỉ lệ (%)"],
    ...attendance.rows.map((row) => [
      row.displayName,
      studentIdFromEmail(row.email),
      row.email,
      time(row.firstJoinedAt),
      row.lastLeftAt ? time(row.lastLeftAt) : "Đang trong phòng",
      String(Math.round(row.presentSeconds / 60)),
      String(Math.round(row.ratio * 100)),
    ]),
  ];
  return {
    fileName: `tham-du-${attendance.startedAt.slice(0, 10)}.csv`,
    content: lines.map((line) => line.map(cell).join(",")).join("\r\n"),
  };
}
