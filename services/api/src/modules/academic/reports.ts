import { withTransaction } from "../../infrastructure/database/db.js";
import { forbidden, hasUnitRole, isLecturerOf, loadActor, lockTerm, requireUnitRole } from "./access.js";

export async function termDashboard(userId: string, termId: string) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId);
    const actor = await loadActor(client, userId);
    if (!hasUnitRole(actor, term.unit_id, "unit_admin", "unit_head") && !isLecturerOf(actor, term.unit_id)) throw forbidden();
    const [students, topics, projects, late, grades, load] = await Promise.all([
      client.query(
        `SELECT count(*)::int AS total,count(*) FILTER (WHERE eligible)::int AS eligible,
                count(*) FILTER (WHERE EXISTS(SELECT 1 FROM thesis_group_members m JOIN thesis_projects p ON p.group_id=m.group_id WHERE m.term_id=e.term_id AND m.student_id=e.student_id AND m.status='active'))::int AS assigned
         FROM thesis_enrollments e WHERE term_id=$1 AND withdrawn_at IS NULL`,
        [term.id],
      ),
      client.query(`SELECT status,count(*)::int AS n FROM thesis_topics WHERE term_id=$1 GROUP BY status`, [term.id]),
      client.query(`SELECT status,count(*)::int AS n FROM thesis_projects WHERE term_id=$1 GROUP BY status`, [term.id]),
      client.query(
        `SELECT m.code,count(*) FILTER (WHERE s.is_late)::int AS late,count(*)::int AS total FROM thesis_milestones m LEFT JOIN thesis_submissions s ON s.milestone_id=m.id WHERE m.term_id=$1 GROUP BY m.code,m.due_at ORDER BY m.due_at`,
        [term.id],
      ),
      client.query(
        `SELECT r.letter,count(*)::int AS n,round(avg(r.final_score),2)::float8 AS mean FROM thesis_results r JOIN thesis_projects p ON p.id=r.project_id WHERE p.term_id=$1 GROUP BY r.letter`,
        [term.id],
      ),
      client.query(
        `SELECT u.display_name AS "displayName",COALESCE(ts.quota,s.default_quota)::int AS quota,COALESCE(sum(p.student_count) FILTER (WHERE p.status<>'withdrawn'),0)::int AS used
         FROM academic_staff s JOIN users u ON u.id=s.user_id LEFT JOIN thesis_term_supervisors ts ON ts.term_id=$1 AND ts.lecturer_id=s.user_id
         LEFT JOIN thesis_projects p ON p.term_id=$1 AND p.supervisor_id=s.user_id WHERE s.unit_id=$2 AND s.active GROUP BY u.display_name,ts.quota,s.default_quota ORDER BY used DESC,u.display_name`,
        [term.id, term.unit_id],
      ),
    ]);
    const counts = (rows: { status: string; n: number }[]) => Object.fromEntries(rows.map((row) => [row.status, row.n]));
    return {
      term: { id: term.id, code: term.code, status: term.status },
      students: students.rows[0],
      topics: counts(topics.rows),
      projects: counts(projects.rows),
      submissions: late.rows,
      grades: grades.rows,
      supervisorLoad: load.rows,
    };
  });
}

/** RFC 4180 quoting; also neutralises leading formula characters to prevent CSV injection in spreadsheets. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export async function exportCsv(userId: string, termId: string, kind: "assignments" | "schedule" | "grades") {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId);
    requireUnitRole(await loadActor(client, userId), term.unit_id, "unit_admin", "unit_head");
    if (kind === "assignments") {
      const rows = await client.query(
        `SELECT p.code,t.code AS topic,t.title,su.display_name AS supervisor,e.student_code,u.display_name AS student,p.status
         FROM thesis_projects p JOIN thesis_topics t ON t.id=p.topic_id JOIN users su ON su.id=p.supervisor_id
         JOIN thesis_group_members m ON m.group_id=p.group_id AND m.status='active' JOIN thesis_enrollments e ON e.term_id=m.term_id AND e.student_id=m.student_id JOIN users u ON u.id=m.student_id
         WHERE p.term_id=$1 ORDER BY p.code,e.student_code`,
        [term.id],
      );
      return {
        fileName: `${term.code}-phan-cong.csv`,
        content: toCsv(["Mã đồ án", "Mã đề tài", "Tên đề tài", "GVHD", "MSSV", "Sinh viên", "Trạng thái"], rows.rows.map((r) => [r.code, r.topic, r.title, r.supervisor, r.student_code, r.student, r.status])),
      };
    }
    if (kind === "schedule") {
      const rows = await client.query(
        `SELECT c.code AS committee,c.room,lower(s.during) AS starts,upper(s.during) AS ends,p.code,t.title,su.display_name AS supervisor
         FROM thesis_defense_slots s JOIN thesis_committees c ON c.id=s.committee_id JOIN thesis_projects p ON p.id=s.project_id JOIN thesis_topics t ON t.id=p.topic_id JOIN users su ON su.id=p.supervisor_id
         WHERE c.term_id=$1 ORDER BY lower(s.during),c.code`,
        [term.id],
      );
      return {
        fileName: `${term.code}-lich-bao-ve.csv`,
        content: toCsv(["Hội đồng", "Phòng", "Bắt đầu", "Kết thúc", "Mã đồ án", "Đề tài", "GVHD"], rows.rows.map((r) => [r.committee, r.room, r.starts, r.ends, r.code, r.title, r.supervisor])),
      };
    }
    const rows = await client.query(
      `SELECT p.code,e.student_code,u.display_name AS student,r.supervisor_score,r.reviewer_score,r.committee_score,r.final_score,r.letter,r.passed,r.adjusted_by_appeal,r.published_at
       FROM thesis_results r JOIN thesis_projects p ON p.id=r.project_id JOIN thesis_group_members m ON m.group_id=p.group_id AND m.status='active'
       JOIN thesis_enrollments e ON e.term_id=m.term_id AND e.student_id=m.student_id JOIN users u ON u.id=m.student_id
       WHERE p.term_id=$1 ORDER BY p.code,e.student_code`,
      [term.id],
    );
    return {
      fileName: `${term.code}-bang-diem.csv`,
      content: toCsv(
        ["Mã đồ án", "MSSV", "Sinh viên", "Điểm GVHD", "Điểm PB", "Điểm HĐ", "Tổng kết", "Điểm chữ", "Đạt", "Phúc khảo", "Công bố"],
        rows.rows.map((r) => [r.code, r.student_code, r.student, r.supervisor_score, r.reviewer_score, r.committee_score, r.final_score, r.letter, r.passed ? "Đạt" : "Không đạt", r.adjusted_by_appeal ? "Có" : "", r.published_at]),
      ),
    };
  });
}
