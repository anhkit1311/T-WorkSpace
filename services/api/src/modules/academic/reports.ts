import { withTransaction } from "../../infrastructure/database/db.js";
import { forbidden, invalid, loadActor } from "./access.js";

export interface UnitReportRow {
  unitId: string;
  code: string;
  name: string;
  /** Hotline calls to the unit's department that reached its queue; callbacks are neither answered nor abandoned. */
  calls: { offered: number; answered: number; abandoned: number; callbacks: number; answerRate: number | null };
  /** Meetings hosted by the unit's lecturers and staff. */
  meetings: { sessions: number; hours: number };
  courses: { published: number; enrolled: number; completed: number };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ZONE = "Asia/Ho_Chi_Minh";
const dayIn = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(date);

/** `from`/`to` are whole days in Vietnam time, `to` included; the default is the last 30 days. */
function period(params: URLSearchParams) {
  const to = params.get("to") || dayIn(new Date());
  const from = params.get("from") || dayIn(new Date(Date.now() - 29 * 86_400_000));
  if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)))
    throw invalid("Ngày phải có dạng YYYY-MM-DD.");
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days < 0 || days > 366) throw invalid("Khoảng thời gian từ 1 đến 367 ngày.");
  return { from, to };
}

/**
 * 2.5: one row per unit for faculty leaders. System admins see every unit; unit heads and unit
 * admins see theirs. Counts only, nothing about a single person.
 */
export async function unitReport(userId: string, params: URLSearchParams) {
  const { from, to } = period(params);
  return withTransaction(async (client) => {
    const actor = await loadActor(client, userId);
    const units = actor.systemAdmin ? null : [...actor.unitRoles.keys()];
    if (units && !units.length) throw forbidden("Báo cáo đơn vị dành cho lãnh đạo và giáo vụ đơn vị.");
    const rows = await client.query<{
      id: string; code: string; name: string; offered: number; answered: number; abandoned: number; callbacks: number;
      sessions: number; seconds: number; published: number; enrolled: number; completed: number;
    }>(
      `WITH span AS (SELECT ($1::date::timestamp AT TIME ZONE '${ZONE}') AS since, (($2::date + 1)::timestamp AT TIME ZONE '${ZONE}') AS until)
       SELECT u.id,u.code,u.name,c.offered,c.answered,c.abandoned,c.callbacks,m.sessions,m.seconds,k.published,e.enrolled,e.completed
       FROM academic_units u CROSS JOIN span
       CROSS JOIN LATERAL (
         SELECT count(*)::int AS offered,
           count(*) FILTER (WHERE outcome='answered')::int AS answered,
           count(*) FILTER (WHERE outcome='abandoned')::int AS abandoned,
           count(*) FILTER (WHERE outcome='callback')::int AS callbacks
         FROM cc_calls WHERE department_id=u.id AND queued_at IS NOT NULL AND started_at>=span.since AND started_at<span.until) c
       CROSS JOIN LATERAL (
         SELECT count(*)::int AS sessions,
           COALESCE(sum(extract(epoch FROM least(COALESCE(s.ended_at, now()), span.until) - s.started_at)), 0)::float8 AS seconds
         FROM meeting_sessions s JOIN academic_staff st ON st.user_id=s.host_id AND st.unit_id=u.id
         WHERE s.started_at>=span.since AND s.started_at<span.until) m
       CROSS JOIN LATERAL (SELECT count(*)::int AS published FROM courses WHERE unit_id=u.id AND status='published') k
       CROSS JOIN LATERAL (
         SELECT count(*) FILTER (WHERE e.enrolled_at>=span.since AND e.enrolled_at<span.until)::int AS enrolled,
           count(*) FILTER (WHERE e.completed_at>=span.since AND e.completed_at<span.until)::int AS completed
         FROM course_enrollments e JOIN courses co ON co.id=e.course_id WHERE co.unit_id=u.id) e
       WHERE $3::uuid[] IS NULL OR u.id=ANY($3::uuid[])
       ORDER BY u.code`,
      [from, to, units],
    );
    const report: UnitReportRow[] = rows.rows.map((row) => ({
      unitId: row.id,
      code: row.code,
      name: row.name,
      calls: {
        offered: row.offered,
        answered: row.answered,
        abandoned: row.abandoned,
        callbacks: row.callbacks,
        answerRate: row.offered ? Math.round((row.answered / row.offered) * 1000) / 1000 : null,
      },
      meetings: { sessions: row.sessions, hours: Math.round((row.seconds / 3600) * 10) / 10 },
      courses: { published: row.published, enrolled: row.enrolled, completed: row.completed },
    }));
    return { from, to, units: report };
  });
}
