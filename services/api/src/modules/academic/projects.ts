import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, withTransaction } from "../../infrastructure/database/db.js";
import { readObject } from "../files/storage.js";
import {
  audit,
  choice,
  conflict,
  date,
  forbidden,
  hasUnitRole,
  id,
  invalid,
  isLecturerOf,
  loadActor,
  lockTerm,
  notFound,
  notify,
  optionalText,
  requirePhase,
  requireVersion,
  text,
  type Actor,
  type TermRow,
} from "./access.js";

export type ProjectStatus =
  | "proposal"
  | "in_progress"
  | "final_submitted"
  | "defense_approved"
  | "under_review"
  | "review_passed"
  | "review_failed"
  | "scheduled"
  | "defended"
  | "graded"
  | "completed"
  | "failed"
  | "withdrawn"
  | "suspended";

export interface ProjectRow {
  id: string;
  term_id: string;
  code: string;
  group_id: string;
  topic_id: string;
  supervisor_id: string;
  co_supervisor_id: string | null;
  student_count: number;
  workspace_id: string | null;
  status: ProjectStatus;
  version: number;
}

export interface ProjectContext {
  term: TermRow;
  project: ProjectRow;
  actor: Actor;
  students: string[];
  roles: { student: boolean; supervisor: boolean; reviewer: boolean; committee: boolean; admin: boolean; head: boolean };
}

/** Locks term (share) then project (update) and resolves the caller's relationship to the project. */
export async function lockProject(client: PoolClient, userId: string, projectId: unknown, lock = true): Promise<ProjectContext> {
  id(projectId);
  const ref = await client.query<{ term_id: string }>(`SELECT term_id FROM thesis_projects WHERE id=$1`, [projectId]);
  if (!ref.rowCount) throw notFound("Không tìm thấy đồ án.");
  const term = await lockTerm(client, ref.rows[0].term_id);
  const project = (await client.query<ProjectRow>(`SELECT * FROM thesis_projects WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`, [projectId])).rows[0];
  const actor = await loadActor(client, userId);
  const students = (
    await client.query<{ student_id: string }>(`SELECT student_id FROM thesis_group_members WHERE group_id=$1 AND status='active'`, [project.group_id])
  ).rows.map((row) => row.student_id);
  const reviewer = (await client.query(`SELECT 1 FROM thesis_reviews WHERE project_id=$1 AND reviewer_id=$2`, [project.id, userId])).rowCount;
  const committee = (
    await client.query(`SELECT 1 FROM thesis_defense_slots s JOIN thesis_committee_members m ON m.committee_id=s.committee_id WHERE s.project_id=$1 AND m.lecturer_id=$2`, [project.id, userId])
  ).rowCount;
  const roles = {
    student: students.includes(userId),
    supervisor: project.supervisor_id === userId || project.co_supervisor_id === userId,
    reviewer: Boolean(reviewer),
    committee: Boolean(committee),
    admin: hasUnitRole(actor, term.unit_id, "unit_admin"),
    head: hasUnitRole(actor, term.unit_id, "unit_head"),
  };
  if (!Object.values(roles).some(Boolean)) throw notFound("Không tìm thấy đồ án.");
  return { term, project, actor, students, roles };
}

/** Single place that performs a status change; the database trigger re-validates the transition. */
export async function transition(
  client: PoolClient,
  context: Pick<ProjectContext, "term" | "project" | "students">,
  actorId: string,
  to: ProjectStatus,
  note = "",
): Promise<void> {
  const { project, term } = context;
  await client.query(`UPDATE thesis_projects SET status=$2,version=version+1,updated_at=now() WHERE id=$1`, [project.id, to]).catch((error: { code?: string }) => {
    if (error.code === "23514") throw conflict("INVALID_TRANSITION", `Đồ án không thể chuyển từ ${project.status} sang ${to}.`);
    throw error;
  });
  await client.query(
    `INSERT INTO thesis_project_events(id,project_id,actor_id,from_status,to_status,note) VALUES($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), project.id, actorId, project.status, to, note],
  );
  await audit(client, { unitId: term.unit_id, termId: term.id, actorId, entity: "project", entityId: project.id, action: "project.transition", details: { from: project.status, to, note } });
  const recipients = new Set([...context.students, project.supervisor_id, ...(project.co_supervisor_id ? [project.co_supervisor_id] : [])]);
  recipients.delete(actorId);
  await notify(client, recipients, "project.status", "project", project.id, `Đồ án ${project.code}: ${project.status} → ${to}${note ? ` — ${note.slice(0, 120)}` : ""}`);
  project.status = to;
  project.version++;
}

// ---- read models --------------------------------------------------------------

export async function getProject(userId: string, projectId: string) {
  return withTransaction(async (client) => {
    const context = await lockProject(client, userId, projectId, false);
    const { project, term, roles } = context;
    const header = await client.query(
      `SELECT p.id,p.code,p.status,p.version,p.workspace_id AS "workspaceId",p.term_id AS "termId",tt.code AS "termCode",
              t.id AS "topicId",t.code AS "topicCode",t.title AS "topicTitle",
              p.supervisor_id AS "supervisorId",su.display_name AS "supervisorName",p.co_supervisor_id AS "coSupervisorId",cu.display_name AS "coSupervisorName"
       FROM thesis_projects p JOIN thesis_terms tt ON tt.id=p.term_id JOIN thesis_topics t ON t.id=p.topic_id JOIN users su ON su.id=p.supervisor_id LEFT JOIN users cu ON cu.id=p.co_supervisor_id WHERE p.id=$1`,
      [project.id],
    );
    const members = await client.query(
      `SELECT e.student_id AS "studentId",e.student_code AS "studentCode",u.display_name AS "displayName",(e.student_id=g.leader_id) AS leader
       FROM thesis_group_members m JOIN thesis_groups g ON g.id=m.group_id JOIN thesis_enrollments e ON e.term_id=m.term_id AND e.student_id=m.student_id JOIN users u ON u.id=m.student_id
       WHERE m.group_id=$1 AND m.status='active' ORDER BY e.student_code`,
      [project.group_id],
    );
    const milestones = await client.query(
      `SELECT ms.id,ms.code,ms.name,ms.kind,ms.due_at AS "dueAt",ms.required,
              latest.id AS "latestSubmissionId",latest.version_no AS "latestVersion",latest.review_status AS "latestReviewStatus",latest.is_late AS "latestIsLate",latest.submitted_at AS "latestSubmittedAt"
       FROM thesis_milestones ms LEFT JOIN LATERAL (SELECT * FROM thesis_submissions s WHERE s.project_id=$1 AND s.milestone_id=ms.id ORDER BY version_no DESC LIMIT 1) latest ON true
       WHERE ms.term_id=$2 ORDER BY ms.due_at,ms.code`,
      [project.id, term.id],
    );
    const logs = await client.query<{ confirmed: number; total: number; last: Date | null }>(
      `SELECT count(*) FILTER (WHERE supervisor_confirmed_at IS NOT NULL AND student_confirmed_at IS NOT NULL)::int AS confirmed,count(*)::int AS total,
              max(held_at) FILTER (WHERE supervisor_confirmed_at IS NOT NULL AND student_confirmed_at IS NOT NULL) AS last
       FROM thesis_supervision_logs WHERE project_id=$1`,
      [project.id],
    );
    const events = await client.query(
      `SELECT e.from_status AS "fromStatus",e.to_status AS "toStatus",e.note,e.created_at AS "createdAt",u.display_name AS "actorName" FROM thesis_project_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.project_id=$1 ORDER BY e.created_at`,
      [project.id],
    );
    const review = await client.query(
      `SELECT r.reviewer_id AS "reviewerId",u.display_name AS "reviewerName",r.due_at AS "dueAt",r.recommendation,r.submitted_at AS "submittedAt",
              CASE WHEN r.submitted_at IS NOT NULL THEN r.comments END AS comments,CASE WHEN r.submitted_at IS NOT NULL THEN r.questions END AS questions
       FROM thesis_reviews r JOIN users u ON u.id=r.reviewer_id WHERE r.project_id=$1`,
      [project.id],
    );
    const defense = await client.query(
      `SELECT s.id,lower(s.during) AS "startsAt",upper(s.during) AS "endsAt",c.id AS "committeeId",c.code AS "committeeCode",c.name AS "committeeName",c.room FROM thesis_defense_slots s JOIN thesis_committees c ON c.id=s.committee_id WHERE s.project_id=$1`,
      [project.id],
    );
    // Students only see the result after publication; staff involved see it once finalised.
    const result = await client.query(
      `SELECT final_score::float8 AS "finalScore",letter,passed,published_at AS "publishedAt",adjusted_by_appeal AS "adjustedByAppeal",
              supervisor_score::float8 AS "supervisorScore",reviewer_score::float8 AS "reviewerScore",committee_score::float8 AS "committeeScore"
       FROM thesis_results WHERE project_id=$1 AND ($2::boolean OR published_at IS NOT NULL)`,
      [project.id, !roles.student || roles.supervisor || roles.admin || roles.head],
    );
    const appeal = await client.query(
      `SELECT id,status,reason,decision_note AS "decisionNote",new_score::float8 AS "newScore",created_at AS "createdAt",decided_at AS "decidedAt" FROM thesis_appeals WHERE project_id=$1`,
      [project.id],
    );
    return {
      ...header.rows[0],
      members: members.rows,
      milestones: milestones.rows,
      supervision: { ...logs.rows[0], required: term.min_supervision_logs },
      events: events.rows,
      review: review.rows[0] ?? null,
      defense: defense.rows[0] ?? null,
      result: result.rows[0] ?? null,
      appeal: appeal.rows[0] ?? null,
      viewerRoles: roles,
    };
  });
}

export async function listProjects(userId: string, termId: string, params: URLSearchParams) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId);
    const actor = await loadActor(client, userId);
    const staffWide = hasUnitRole(actor, term.unit_id, "unit_admin", "unit_head");
    const scope = params.get("scope") ?? (staffWide ? "all" : "mine");
    choice(scope, ["all", "mine", "supervising", "reviewing", "committee"] as const, "Phạm vi");
    if (scope === "all" && !staffWide) throw forbidden();
    const status = params.get("status");
    const rows = await client.query(
      `SELECT p.id,p.code,p.status,p.student_count AS "studentCount",t.code AS "topicCode",t.title AS "topicTitle",su.display_name AS "supervisorName",
              ru.display_name AS "reviewerName",r.recommendation,
              (SELECT count(*)::int FROM thesis_supervision_logs l WHERE l.project_id=p.id AND l.supervisor_confirmed_at IS NOT NULL AND l.student_confirmed_at IS NOT NULL) AS "confirmedLogs",
              res.final_score::float8 AS "finalScore",res.letter,lower(s.during) AS "defenseAt",c.code AS "committeeCode"
       FROM thesis_projects p JOIN thesis_topics t ON t.id=p.topic_id JOIN users su ON su.id=p.supervisor_id
       LEFT JOIN thesis_reviews r ON r.project_id=p.id LEFT JOIN users ru ON ru.id=r.reviewer_id
       LEFT JOIN thesis_results res ON res.project_id=p.id LEFT JOIN thesis_defense_slots s ON s.project_id=p.id LEFT JOIN thesis_committees c ON c.id=s.committee_id
       WHERE p.term_id=$1 AND ($3::text IS NULL OR p.status=$3) AND (
         $2='all'
         OR ($2 IN ('mine','supervising') AND $4 IN (p.supervisor_id,p.co_supervisor_id))
         OR ($2 IN ('mine','reviewing') AND r.reviewer_id=$4)
         OR ($2 IN ('mine','committee') AND EXISTS(SELECT 1 FROM thesis_committee_members m WHERE m.committee_id=s.committee_id AND m.lecturer_id=$4))
         OR ($2='mine' AND EXISTS(SELECT 1 FROM thesis_group_members gm WHERE gm.group_id=p.group_id AND gm.student_id=$4 AND gm.status='active')))
       ORDER BY p.code LIMIT 1000`,
      [term.id, scope, status, userId],
    );
    return { projects: rows.rows };
  });
}

// ---- submissions ---------------------------------------------------------------

/**
 * Students submit a file already uploaded to the project's workspace. The hash is computed from
 * the stored bytes so the submission record proves exactly what was handed in.
 */
export async function submit(userId: string, projectId: string, body: Record<string, unknown>) {
  const { milestoneId, attachmentId } = { milestoneId: id(body.milestoneId), attachmentId: id(body.attachmentId) };
  // Read and hash the bytes before taking locks; storage reads may be slow.
  const file = await query<{ data: Buffer | null; object_key: string | null; file_name: string; file_size: number; uploader_id: string; workspace_id: string }>(
    `SELECT a.data,a.object_key,a.file_name,a.file_size,a.uploader_id,c.workspace_id FROM message_attachments a JOIN channels c ON c.id=a.channel_id WHERE a.id=$1`,
    [attachmentId],
  );
  if (!file.rowCount) throw notFound("Không tìm thấy tệp.");
  const bytes = file.rows[0].data ?? (file.rows[0].object_key ? await readObject(file.rows[0].object_key) : null);
  if (!bytes || bytes.length !== file.rows[0].file_size) throw conflict("STORAGE_UNAVAILABLE", "Không đọc được tệp để tính mã băm.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  return withTransaction(async (client) => {
    const context = await lockProject(client, userId, projectId);
    const { project, term } = context;
    if (!context.roles.student) throw forbidden("Chỉ sinh viên của nhóm được nộp bài.");
    if (file.rows[0].workspace_id !== project.workspace_id || file.rows[0].uploader_id !== userId)
      throw invalid("Tệp phải do bạn tải lên trong không gian làm việc của đồ án.");
    const milestone = (
      await client.query<{ id: string; kind: string; due_at: Date; code: string }>(`SELECT id,kind,due_at,code FROM thesis_milestones WHERE id=$1 AND term_id=$2`, [milestoneId, term.id])
    ).rows[0];
    if (!milestone) throw invalid("Mốc nộp không thuộc đợt.");
    requirePhase(term, "execution", "review");
    const allowed: Record<string, ProjectStatus[]> = {
      proposal: ["proposal"],
      progress: ["in_progress"],
      final: ["in_progress", "final_submitted"],
    };
    if (!allowed[milestone.kind].includes(project.status))
      throw conflict("WRONG_STAGE", `Đồ án đang ở trạng thái ${project.status}, chưa/không còn nộp được mốc ${milestone.code}.`);
    const late = +term.db_now > +milestone.due_at;
    if (late && term.late_policy === "reject") throw conflict("DEADLINE_PASSED", "Đã quá hạn nộp và đợt không nhận bài trễ.");
    const previous = await client.query<{ id: string; version_no: number; review_status: string }>(
      `SELECT id,version_no,review_status FROM thesis_submissions WHERE project_id=$1 AND milestone_id=$2 ORDER BY version_no DESC LIMIT 1`,
      [project.id, milestone.id],
    );
    if (previous.rows[0]?.review_status === "accepted") throw conflict("ALREADY_ACCEPTED", "Mốc này đã được giảng viên chấp nhận.");
    if (previous.rows[0]?.review_status === "pending")
      await client.query(`UPDATE thesis_submissions SET review_status='superseded' WHERE id=$1`, [previous.rows[0].id]);
    const submissionId = randomUUID();
    const versionNo = (previous.rows[0]?.version_no ?? 0) + 1;
    await client.query(
      `INSERT INTO thesis_submissions(id,project_id,milestone_id,version_no,attachment_id,file_name,file_size,sha256,note,submitted_by,is_late) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [submissionId, project.id, milestone.id, versionNo, attachmentId, file.rows[0].file_name, file.rows[0].file_size, sha256, optionalText(body.note, "Ghi chú", 2000), userId, late],
    );
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "submission", entityId: submissionId, action: "submission.created", details: { milestone: milestone.code, versionNo, sha256, late } });
    if (milestone.kind === "final" && project.status === "in_progress") await transition(client, context, userId, "final_submitted", `Nộp báo cáo cuối (bản ${versionNo})`);
    else await notify(client, [project.supervisor_id], "submission.created", "project", project.id, `Đồ án ${project.code} nộp ${milestone.code} bản ${versionNo}${late ? " (trễ hạn)" : ""}.`);
    return { id: submissionId, versionNo, sha256, isLate: late };
  });
}

export async function reviewSubmission(userId: string, submissionId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    id(submissionId);
    const ref = await client.query<{ project_id: string }>(`SELECT project_id FROM thesis_submissions WHERE id=$1`, [submissionId]);
    if (!ref.rowCount) throw notFound("Không tìm thấy bản nộp.");
    const context = await lockProject(client, userId, ref.rows[0].project_id);
    if (!context.roles.supervisor) throw forbidden("Chỉ giảng viên hướng dẫn được nhận xét bản nộp.");
    const submission = (
      await client.query<{ review_status: string; kind: string; version_no: number; code: string }>(
        `SELECT s.review_status,m.kind,s.version_no,m.code FROM thesis_submissions s JOIN thesis_milestones m ON m.id=s.milestone_id WHERE s.id=$1 FOR UPDATE OF s`,
        [submissionId],
      )
    ).rows[0];
    if (submission.review_status !== "pending") throw conflict("ALREADY_REVIEWED", "Bản nộp đã được nhận xét hoặc đã có bản mới hơn.");
    const decision = choice(body.decision, ["accepted", "revision_requested"] as const, "Kết luận");
    const feedback = text(body.feedback, "Nhận xét", decision === "accepted" ? 0 : 20, 4000);
    await client.query(`UPDATE thesis_submissions SET review_status=$2,feedback=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1`, [submissionId, decision, feedback, userId]);
    await audit(client, { unitId: context.term.unit_id, termId: context.term.id, actorId: userId, entity: "submission", entityId: submissionId, action: `submission.${decision}` });
    if (submission.kind === "proposal" && decision === "accepted" && context.project.status === "proposal")
      await transition(client, context, userId, "in_progress", "Đề cương được chấp nhận");
    else if (submission.kind === "final" && decision === "revision_requested" && context.project.status === "final_submitted")
      await transition(client, context, userId, "in_progress", "Báo cáo cuối cần chỉnh sửa: " + feedback.slice(0, 200));
    else
      await notify(client, context.students, "submission.reviewed", "project", context.project.id, `Bản nộp ${submission.code} v${submission.version_no}: ${decision === "accepted" ? "được chấp nhận" : "cần chỉnh sửa"}.`);
    return { id: submissionId, reviewStatus: decision };
  });
}

export async function listSubmissions(userId: string, projectId: string) {
  return withTransaction(async (client) => {
    const { project } = await lockProject(client, userId, projectId, false);
    const rows = await client.query(
      `SELECT s.id,m.code AS "milestoneCode",m.name AS "milestoneName",s.version_no AS "versionNo",s.attachment_id AS "attachmentId",s.file_name AS "fileName",s.file_size AS "fileSize",s.sha256,s.note,
              s.submitted_at AS "submittedAt",u.display_name AS "submittedBy",s.is_late AS "isLate",s.review_status AS "reviewStatus",s.feedback,s.reviewed_at AS "reviewedAt"
       FROM thesis_submissions s JOIN thesis_milestones m ON m.id=s.milestone_id JOIN users u ON u.id=s.submitted_by WHERE s.project_id=$1 ORDER BY m.due_at,s.version_no DESC`,
      [project.id],
    );
    return { submissions: rows.rows };
  });
}

/**
 * Reviewers and committee members are not members of the project workspace, so submissions are
 * served through the project's own authorisation instead of channel access.
 */
export async function downloadSubmission(userId: string, submissionId: string) {
  id(submissionId);
  const row = await query<{ project_id: string; file_name: string; mime_type: string; sha256: string; data: Buffer | null; object_key: string | null }>(
    `SELECT s.project_id,s.file_name,a.mime_type,s.sha256,a.data,a.object_key FROM thesis_submissions s JOIN message_attachments a ON a.id=s.attachment_id WHERE s.id=$1`,
    [submissionId],
  );
  if (!row.rowCount) throw notFound("Không tìm thấy bản nộp.");
  await withTransaction((client) => lockProject(client, userId, row.rows[0].project_id, false));
  const bytes = row.rows[0].data ?? (row.rows[0].object_key ? await readObject(row.rows[0].object_key) : null);
  if (!bytes) throw conflict("STORAGE_UNAVAILABLE", "Tệp tạm thời không đọc được.");
  return { fileName: row.rows[0].file_name, mimeType: row.rows[0].mime_type, sha256: row.rows[0].sha256, data: bytes };
}

/** Re-hashes stored bytes and compares them with the hash recorded at submission time. */
export async function verifySubmission(userId: string, submissionId: string) {
  id(submissionId);
  const row = await query<{ project_id: string; sha256: string; data: Buffer | null; object_key: string | null }>(
    `SELECT s.project_id,s.sha256,a.data,a.object_key FROM thesis_submissions s JOIN message_attachments a ON a.id=s.attachment_id WHERE s.id=$1`,
    [submissionId],
  );
  if (!row.rowCount) throw notFound("Không tìm thấy bản nộp.");
  await withTransaction((client) => lockProject(client, userId, row.rows[0].project_id, false));
  const bytes = row.rows[0].data ?? (row.rows[0].object_key ? await readObject(row.rows[0].object_key) : null);
  const actual = bytes ? createHash("sha256").update(bytes).digest("hex") : null;
  return { recorded: row.rows[0].sha256, actual, intact: actual === row.rows[0].sha256 };
}

// ---- supervision logs -------------------------------------------------------------

export async function createLog(userId: string, projectId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const context = await lockProject(client, userId, projectId);
    const { project, term } = context;
    if (!context.roles.supervisor && !context.roles.student) throw forbidden();
    requirePhase(term, "execution", "review");
    if (["completed", "failed", "withdrawn", "suspended", "graded", "defended"].includes(project.status))
      throw conflict("PROJECT_CLOSED", "Đồ án đã kết thúc giai đoạn hướng dẫn.");
    const heldAt = date(body.heldAt, "Thời điểm gặp");
    if (+heldAt > +term.db_now + 5 * 60_000) throw invalid("Không ghi nhật ký cho buổi gặp chưa diễn ra.");
    const mode = choice(body.mode, ["online", "offline"] as const, "Hình thức");
    let meetingSessionId: string | null = null;
    if (body.meetingSessionId) {
      if (mode !== "online") throw invalid("Chỉ buổi gặp trực tuyến mới gắn phiên họp.");
      meetingSessionId = id(body.meetingSessionId);
      // The meeting must have happened in this project's workspace and the author must have attended.
      const session = await client.query(
        `SELECT 1 FROM meeting_sessions ms JOIN channels c ON c.id=ms.channel_id JOIN meeting_attendees a ON a.session_id=ms.id AND a.user_id=$3 AND a.state='admitted' WHERE ms.id=$1 AND c.workspace_id=$2`,
        [meetingSessionId, project.workspace_id, userId],
      );
      if (!session.rowCount) throw invalid("Phiên họp không thuộc không gian đồ án hoặc bạn không tham dự.");
    }
    const logId = randomUUID();
    const supervisor = context.roles.supervisor;
    await client
      .query(
        `INSERT INTO thesis_supervision_logs(id,project_id,held_at,mode,meeting_session_id,content,next_actions,created_by,supervisor_confirmed_by,supervisor_confirmed_at,student_confirmed_by,student_confirmed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [logId, project.id, heldAt, mode, meetingSessionId, text(body.content, "Nội dung", 20, 6000), optionalText(body.nextActions, "Việc tiếp theo", 3000), userId,
          supervisor ? userId : null, supervisor ? new Date() : null, supervisor ? null : userId, supervisor ? null : new Date()],
      )
      .catch((error: { code?: string }) => {
        if (error.code === "23505") throw conflict("SESSION_LOGGED", "Phiên họp này đã có nhật ký.");
        throw error;
      });
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "supervision_log", entityId: logId, action: "log.created" });
    // The author's own confirmation is implicit; the other side must confirm.
    await notify(client, supervisor ? context.students : [project.supervisor_id], "log.confirm_requested", "project", project.id, `Nhật ký hướng dẫn mới của đồ án ${project.code} cần bạn xác nhận.`);
    return { id: logId };
  });
}

export async function confirmLog(userId: string, logId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    id(logId);
    const ref = await client.query<{ project_id: string }>(`SELECT project_id FROM thesis_supervision_logs WHERE id=$1`, [logId]);
    if (!ref.rowCount) throw notFound("Không tìm thấy nhật ký.");
    const context = await lockProject(client, userId, ref.rows[0].project_id);
    const log = (await client.query(`SELECT * FROM thesis_supervision_logs WHERE id=$1 FOR UPDATE`, [logId])).rows[0];
    requireVersion(log.version, body.version, "Nhật ký");
    if (context.roles.supervisor) {
      if (log.supervisor_confirmed_at) throw conflict("ALREADY_CONFIRMED", "Giảng viên đã xác nhận nhật ký.");
      await client.query(`UPDATE thesis_supervision_logs SET supervisor_confirmed_by=$2,supervisor_confirmed_at=now(),version=version+1 WHERE id=$1`, [logId, userId]);
    } else if (context.roles.student) {
      if (log.student_confirmed_at) throw conflict("ALREADY_CONFIRMED", "Sinh viên đã xác nhận nhật ký.");
      await client.query(`UPDATE thesis_supervision_logs SET student_confirmed_by=$2,student_confirmed_at=now(),version=version+1 WHERE id=$1`, [logId, userId]);
    } else throw forbidden();
    await audit(client, { unitId: context.term.unit_id, termId: context.term.id, actorId: userId, entity: "supervision_log", entityId: logId, action: "log.confirmed" });
    return { id: logId, confirmed: true };
  });
}

export async function listLogs(userId: string, projectId: string) {
  return withTransaction(async (client) => {
    const { project } = await lockProject(client, userId, projectId, false);
    const rows = await client.query(
      `SELECT l.id,l.held_at AS "heldAt",l.mode,l.meeting_session_id AS "meetingSessionId",l.content,l.next_actions AS "nextActions",u.display_name AS "createdBy",
              l.supervisor_confirmed_at AS "supervisorConfirmedAt",l.student_confirmed_at AS "studentConfirmedAt",sc.display_name AS "studentConfirmedBy",l.version
       FROM thesis_supervision_logs l JOIN users u ON u.id=l.created_by LEFT JOIN users sc ON sc.id=l.student_confirmed_by WHERE l.project_id=$1 ORDER BY l.held_at DESC`,
      [project.id],
    );
    return { logs: rows.rows };
  });
}

// ---- supervisor and office actions ---------------------------------------------------

/** Supervisor's go/no-go for the defense, guarded by the measurable prerequisites. */
export async function approveDefense(userId: string, projectId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const context = await lockProject(client, userId, projectId);
    const { project, term } = context;
    if (project.supervisor_id !== userId) throw forbidden("Chỉ giảng viên hướng dẫn chính được đề nghị bảo vệ.");
    requireVersion(project.version, body.version, "Đồ án");
    requirePhase(term, "execution", "review");
    if (project.status !== "final_submitted") throw conflict("WRONG_STAGE", "Đồ án chưa nộp báo cáo cuối.");
    const blockers = await defenseBlockers(client, project, term);
    if (blockers.length) throw Object.assign(conflict("DEFENSE_BLOCKED", blockers.join(" ")), { blockers });
    // Accepting the final report is part of the approval.
    await client.query(
      `UPDATE thesis_submissions s SET review_status='accepted',feedback=COALESCE(NULLIF($2,''),'Đồng ý cho bảo vệ'),reviewed_by=$3,reviewed_at=now()
       FROM thesis_milestones m WHERE m.id=s.milestone_id AND m.kind='final' AND s.project_id=$1 AND s.review_status='pending'`,
      [project.id, optionalText(body.note, "Ghi chú", 2000), userId],
    );
    await transition(client, context, userId, "defense_approved", optionalText(body.note, "Ghi chú", 2000));
    return { status: project.status, version: project.version };
  });
}

export async function defenseBlockers(client: PoolClient, project: ProjectRow, term: TermRow): Promise<string[]> {
  const blockers: string[] = [];
  const logs = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM thesis_supervision_logs WHERE project_id=$1 AND supervisor_confirmed_at IS NOT NULL AND student_confirmed_at IS NOT NULL`,
    [project.id],
  );
  if (logs.rows[0].n < term.min_supervision_logs)
    blockers.push(`Mới có ${logs.rows[0].n}/${term.min_supervision_logs} buổi hướng dẫn được xác nhận hai phía.`);
  const missing = await client.query<{ code: string }>(
    `SELECT m.code FROM thesis_milestones m WHERE m.term_id=$1 AND m.required AND m.kind<>'final' AND NOT EXISTS(
       SELECT 1 FROM thesis_submissions s WHERE s.milestone_id=m.id AND s.project_id=$2 AND s.review_status='accepted') ORDER BY m.due_at`,
    [term.id, project.id],
  );
  if (missing.rowCount) blockers.push(`Mốc bắt buộc chưa được chấp nhận: ${missing.rows.map((r) => r.code).join(", ")}.`);
  const final = await client.query(
    `SELECT 1 FROM thesis_submissions s JOIN thesis_milestones m ON m.id=s.milestone_id WHERE s.project_id=$1 AND m.kind='final' AND s.review_status IN ('pending','accepted')`,
    [project.id],
  );
  if (!final.rowCount) blockers.push("Không có báo cáo cuối đang chờ duyệt.");
  return blockers;
}

/** Office-level interventions: suspension (discipline) or withdrawal (student request). */
export async function officeAction(userId: string, projectId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const context = await lockProject(client, userId, projectId);
    if (!context.roles.admin) throw forbidden("Chỉ giáo vụ khoa thực hiện đình chỉ hoặc cho rút đồ án.");
    requireVersion(context.project.version, body.version, "Đồ án");
    const action = choice(body.action, ["suspend", "withdraw"] as const, "Thao tác");
    const reason = text(body.reason, "Lý do", 20, 2000);
    if ((await client.query(`SELECT 1 FROM thesis_defense_slots WHERE project_id=$1`, [context.project.id])).rowCount)
      await client.query(`DELETE FROM thesis_defense_slots WHERE project_id=$1`, [context.project.id]);
    await transition(client, context, userId, action === "suspend" ? "suspended" : "withdrawn", reason);
    return { status: context.project.status };
  });
}

/** Projects that need attention: no confirmed supervision recently or an overdue required milestone. */
export async function atRiskProjects(userId: string, termId: string) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId);
    const actor = await loadActor(client, userId);
    const wide = hasUnitRole(actor, term.unit_id, "unit_admin", "unit_head");
    if (!wide && !isLecturerOf(actor, term.unit_id)) throw forbidden();
    const rows = await client.query(
      `WITH base AS (
         SELECT p.id,p.code,p.status,su.display_name AS "supervisorName",
           (SELECT max(held_at) FROM thesis_supervision_logs l WHERE l.project_id=p.id AND l.supervisor_confirmed_at IS NOT NULL AND l.student_confirmed_at IS NOT NULL) AS last_log,
           (SELECT array_agg(m.code ORDER BY m.due_at) FROM thesis_milestones m WHERE m.term_id=p.term_id AND m.required AND m.due_at<now()
              AND NOT EXISTS(SELECT 1 FROM thesis_submissions s WHERE s.project_id=p.id AND s.milestone_id=m.id)) AS overdue
         FROM thesis_projects p JOIN users su ON su.id=p.supervisor_id
         WHERE p.term_id=$1 AND p.status IN ('proposal','in_progress','final_submitted') AND ($2::boolean OR p.supervisor_id=$3))
       SELECT id,code,status,"supervisorName",last_log AS "lastConfirmedLog",COALESCE(overdue,'{}') AS "overdueMilestones",
              (last_log IS NULL OR last_log<now()-interval '14 days') AS "inactive"
       FROM base WHERE last_log IS NULL OR last_log<now()-interval '14 days' OR overdue IS NOT NULL ORDER BY code`,
      [term.id, wide, userId],
    );
    return { projects: rows.rows };
  });
}
