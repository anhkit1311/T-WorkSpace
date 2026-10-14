import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "../../infrastructure/database/db.js";
import {
  audit,
  choice,
  code,
  conflict,
  date,
  decimal,
  forbidden,
  hasUnitRole,
  id,
  integer,
  invalid,
  loadActor,
  lockTerm,
  notFound,
  notify,
  optionalText,
  requirePhase,
  requireUnitRole,
  requireVersion,
  text,
  type TermRow,
} from "./access.js";
import {
  canonicalJson,
  chainHash,
  committeeAggregate,
  finalScore,
  GENESIS_HASH,
  letterGrade,
  sheetTotal,
  verifyChain,
} from "./grading.js";
import { lockProject, transition, type ProjectContext } from "./projects.js";
import { buildSchedule } from "./scheduler.js";

const pgConflict = (error: { code?: string; constraint?: string; message?: string }) => {
  if (error.code === "23P01")
    return conflict("SCHEDULE_CONFLICT", "Trùng lịch: hội đồng hoặc một giảng viên đã có ca bảo vệ chồng giờ.");
  if (error.code === "23514") return conflict("RULE_VIOLATION", ruleMessage(error.message ?? ""));
  if (error.code === "23505") return conflict("DUPLICATE", "Dữ liệu bị trùng.");
  return null;
};
function ruleMessage(message: string) {
  if (message.includes("supervisor cannot sit")) return "Giảng viên hướng dẫn không được ngồi hội đồng chấm đồ án của mình.";
  if (message.includes("doctorate")) return "Chủ tịch hội đồng phải có học vị Tiến sĩ trở lên.";
  if (message.includes("frozen")) return "Hội đồng đã xác nhận, không thay đổi thành viên.";
  if (message.includes("confirmed committees")) return "Hội đồng chưa được xác nhận.";
  if (message.includes("Reviewer cannot")) return "Giảng viên phản biện phải khác giảng viên hướng dẫn.";
  return "Vi phạm ràng buộc nghiệp vụ.";
}
async function guarded<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    throw pgConflict(error as { code?: string }) ?? error;
  }
}

// ---- review ----------------------------------------------------------------------

export async function assignReviewer(userId: string, projectId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const context = await lockProject(client, userId, projectId);
    const { project, term } = context;
    if (!context.roles.head) throw forbidden("Chỉ lãnh đạo khoa phân công phản biện.");
    // A head who supervises the project must leave the choice of its reviewer to another head.
    if (context.roles.supervisor) throw forbidden("Không được tự phân công phản biện cho đồ án mình hướng dẫn.");
    requirePhase(term, "execution", "review");
    requireVersion(project.version, body.version, "Đồ án");
    const reviewerId = id(body.reviewerId);
    const dueAt = date(body.dueAt, "Hạn phản biện");
    if (+dueAt < +term.db_now) throw invalid("Hạn phản biện phải ở tương lai.");
    if ([project.supervisor_id, project.co_supervisor_id].includes(reviewerId))
      throw conflict("CONFLICT_OF_INTEREST", "Giảng viên phản biện phải khác giảng viên hướng dẫn.");
    if (!(await client.query(`SELECT 1 FROM academic_staff WHERE user_id=$1 AND unit_id=$2 AND active`, [reviewerId, term.unit_id])).rowCount)
      throw invalid("Người phản biện phải là giảng viên đang hoạt động của khoa.");
    const existing = await client.query<{ reviewer_id: string; submitted_at: Date | null }>(`SELECT reviewer_id,submitted_at FROM thesis_reviews WHERE project_id=$1 FOR UPDATE`, [project.id]);
    if (existing.rows[0]?.submitted_at) throw conflict("REVIEW_SUBMITTED", "Phản biện đã nộp, không thể phân công lại.");
    if (!existing.rowCount && project.status !== "defense_approved") throw conflict("WRONG_STAGE", "Đồ án chưa được GVHD đồng ý cho bảo vệ.");
    if (existing.rowCount) {
      // Reassignment discards the previous reviewer's draft score sheet.
      await client.query(`DELETE FROM thesis_score_sheets WHERE project_id=$1 AND grader_role='reviewer' AND submitted_at IS NULL`, [project.id]);
      await guarded(client.query(`UPDATE thesis_reviews SET reviewer_id=$2,due_at=$3,assigned_by=$4,assigned_at=now() WHERE project_id=$1`, [project.id, reviewerId, dueAt, userId]));
    } else {
      await guarded(client.query(`INSERT INTO thesis_reviews(project_id,reviewer_id,assigned_by,due_at) VALUES($1,$2,$3,$4)`, [project.id, reviewerId, userId, dueAt]));
      await transition(client, context, userId, "under_review", "Phân công phản biện");
    }
    await notify(client, [reviewerId], "review.assigned", "project", project.id, `Bạn được phân công phản biện đồ án ${project.code}.`);
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "review", entityId: project.id, action: existing.rowCount ? "review.reassigned" : "review.assigned", details: { reviewerId, previous: existing.rows[0]?.reviewer_id } });
    return { reviewerId, dueAt };
  });
}

export async function submitReview(userId: string, projectId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const context = await lockProject(client, userId, projectId);
    const { project, term } = context;
    if (!context.roles.reviewer) throw forbidden("Chỉ giảng viên phản biện được nộp phiếu phản biện.");
    if (project.status !== "under_review") throw conflict("WRONG_STAGE", "Đồ án không ở giai đoạn phản biện.");
    const recommendation = choice(body.recommendation, ["approve", "reject"] as const, "Đề nghị");
    const comments = text(body.comments, "Nhận xét", 50, 10000);
    const questions = optionalText(body.questions, "Câu hỏi", 4000);
    if (recommendation === "approve" && term.reviewer_weight > 0) {
      const sheet = await client.query(`SELECT 1 FROM thesis_score_sheets WHERE project_id=$1 AND grader_role='reviewer' AND submitted_at IS NOT NULL`, [project.id]);
      if (!sheet.rowCount) throw conflict("SCORE_REQUIRED", "Nộp phiếu điểm phản biện trước khi đề nghị cho bảo vệ.");
    }
    await client.query(`UPDATE thesis_reviews SET recommendation=$2,comments=$3,questions=$4,submitted_at=now() WHERE project_id=$1`, [project.id, recommendation, comments, questions]);
    await transition(client, context, userId, recommendation === "approve" ? "review_passed" : "review_failed", recommendation === "approve" ? "Phản biện đồng ý cho bảo vệ" : "Phản biện không đồng ý cho bảo vệ");
    return { recommendation, status: project.status };
  });
}

// ---- committees -------------------------------------------------------------------

async function lockCommittee(client: PoolClient, committeeId: unknown) {
  id(committeeId);
  const ref = await client.query<{ term_id: string }>(`SELECT term_id FROM thesis_committees WHERE id=$1`, [committeeId]);
  if (!ref.rowCount) throw notFound("Không tìm thấy hội đồng.");
  const term = await lockTerm(client, ref.rows[0].term_id);
  const committee = (await client.query<{ id: string; code: string; status: string; version: number }>(`SELECT * FROM thesis_committees WHERE id=$1 FOR UPDATE`, [committeeId])).rows[0];
  return { term, committee };
}

export async function createCommittee(userId: string, termId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId);
    requireUnitRole(await loadActor(client, userId), term.unit_id, "unit_admin");
    requirePhase(term, "execution", "review", "defense");
    const committee = { id: randomUUID(), code: code(body.code, "Mã hội đồng"), name: text(body.name, "Tên hội đồng", 3, 160), room: text(body.room, "Phòng", 1, 60) };
    const inserted = await client.query(`INSERT INTO thesis_committees(id,term_id,code,name,room) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [committee.id, term.id, committee.code, committee.name, committee.room]);
    if (!inserted.rowCount) throw conflict("DUPLICATE_CODE", "Mã hội đồng đã tồn tại.");
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "committee", entityId: committee.id, action: "committee.created", details: committee });
    return committee;
  });
}

export async function setCommitteeMember(userId: string, committeeId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const { term, committee } = await lockCommittee(client, committeeId);
    requireUnitRole(await loadActor(client, userId), term.unit_id, "unit_admin");
    if (committee.status !== "draft") throw conflict("COMMITTEE_CONFIRMED", "Hội đồng đã xác nhận, không thay đổi thành viên.");
    const lecturerId = id(body.lecturerId);
    if (body.remove === true) {
      await client.query(`DELETE FROM thesis_committee_members WHERE committee_id=$1 AND lecturer_id=$2`, [committee.id, lecturerId]);
    } else {
      const role = choice(body.role, ["chair", "secretary", "member"] as const, "Vai trò");
      if (!(await client.query(`SELECT 1 FROM academic_staff WHERE user_id=$1 AND unit_id=$2 AND active`, [lecturerId, term.unit_id])).rowCount)
        throw invalid("Thành viên phải là giảng viên đang hoạt động của khoa.");
      await guarded(
        client.query(
          `INSERT INTO thesis_committee_members(committee_id,lecturer_id,role) VALUES($1,$2,$3) ON CONFLICT(committee_id,lecturer_id) DO UPDATE SET role=EXCLUDED.role`,
          [committee.id, lecturerId, role],
        ),
      ).catch((error) => {
        if (error.code === "DUPLICATE") throw conflict("ROLE_TAKEN", "Hội đồng đã có chủ tịch hoặc thư ký.");
        throw error;
      });
    }
    await client.query(`UPDATE thesis_committees SET version=version+1 WHERE id=$1`, [committee.id]);
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "committee", entityId: committee.id, action: body.remove === true ? "committee.member_removed" : "committee.member_set", details: { lecturerId, role: body.role } });
    return getCommitteeIn(client, committee.id);
  });
}

export async function confirmCommittee(userId: string, committeeId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const { term, committee } = await lockCommittee(client, committeeId);
    requireUnitRole(await loadActor(client, userId), term.unit_id, "unit_admin");
    requireVersion(committee.version, body.version, "Hội đồng");
    if (committee.status !== "draft") throw conflict("COMMITTEE_CONFIRMED", "Hội đồng đã được xác nhận.");
    const roles = await client.query<{ role: string; n: number }>(`SELECT role,count(*)::int AS n FROM thesis_committee_members WHERE committee_id=$1 GROUP BY role`, [committee.id]);
    const count = (role: string) => roles.rows.find((row) => row.role === role)?.n ?? 0;
    const total = roles.rows.reduce((sum, row) => sum + row.n, 0);
    const blockers = [
      ...(total < 3 || total > 5 ? [`Hội đồng cần 3–5 thành viên (hiện ${total}).`] : []),
      ...(count("chair") !== 1 ? ["Cần đúng 1 chủ tịch."] : []),
      ...(count("secretary") !== 1 ? ["Cần đúng 1 thư ký."] : []),
    ];
    if (blockers.length) throw Object.assign(conflict("COMMITTEE_INCOMPLETE", blockers.join(" ")), { blockers });
    await client.query(`UPDATE thesis_committees SET status='confirmed',version=version+1 WHERE id=$1`, [committee.id]);
    const members = await client.query<{ lecturer_id: string }>(`SELECT lecturer_id FROM thesis_committee_members WHERE committee_id=$1`, [committee.id]);
    await notify(client, members.rows.map((r) => r.lecturer_id), "committee.confirmed", "committee", committee.id, `Bạn là thành viên hội đồng ${committee.code}.`);
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "committee", entityId: committee.id, action: "committee.confirmed" });
    return getCommitteeIn(client, committee.id);
  });
}

async function getCommitteeIn(client: PoolClient, committeeId: string) {
  const committee = await client.query(`SELECT id,term_id AS "termId",code,name,room,status,version FROM thesis_committees WHERE id=$1`, [committeeId]);
  const members = await client.query(
    `SELECT m.lecturer_id AS "lecturerId",u.display_name AS "displayName",s.academic_rank AS rank,m.role FROM thesis_committee_members m JOIN users u ON u.id=m.lecturer_id JOIN academic_staff s ON s.user_id=m.lecturer_id
     WHERE m.committee_id=$1 ORDER BY array_position(ARRAY['chair','secretary','member'],m.role::text),u.display_name`,
    [committeeId],
  );
  const slots = await client.query(
    `SELECT s.id,s.project_id AS "projectId",p.code AS "projectCode",t.title AS "topicTitle",p.status,lower(s.during) AS "startsAt",upper(s.during) AS "endsAt"
     FROM thesis_defense_slots s JOIN thesis_projects p ON p.id=s.project_id JOIN thesis_topics t ON t.id=p.topic_id WHERE s.committee_id=$1 ORDER BY lower(s.during)`,
    [committeeId],
  );
  return { ...committee.rows[0], members: members.rows, slots: slots.rows };
}

export async function listCommittees(userId: string, termId: string) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId);
    const actor = await loadActor(client, userId);
    const wide = hasUnitRole(actor, term.unit_id, "unit_admin", "unit_head");
    const ids = await client.query<{ id: string }>(
      `SELECT c.id FROM thesis_committees c WHERE c.term_id=$1 AND ($2::boolean OR EXISTS(SELECT 1 FROM thesis_committee_members m WHERE m.committee_id=c.id AND m.lecturer_id=$3)) ORDER BY c.code`,
      [term.id, wide, userId],
    );
    return { committees: await Promise.all(ids.rows.map((row) => getCommitteeIn(client, row.id))) };
  });
}

// ---- defense schedule ---------------------------------------------------------------

function withinDefenseWindow(term: TermRow & Record<string, unknown>, start: Date, end: Date) {
  const day = (value: Date) => value.toISOString().slice(0, 10);
  const from = String(term.defense_starts_on instanceof Date ? (term.defense_starts_on as Date).toISOString().slice(0, 10) : term.defense_starts_on);
  const to = String(term.defense_ends_on instanceof Date ? (term.defense_ends_on as Date).toISOString().slice(0, 10) : term.defense_ends_on);
  if (day(start) < from || day(end) > to) throw invalid(`Ca bảo vệ phải nằm trong đợt bảo vệ ${from} – ${to}.`);
}

async function insertSlot(client: PoolClient, context: ProjectContext, userId: string, committeeId: string, start: Date, end: Date) {
  if (context.project.status !== "review_passed") throw conflict("WRONG_STAGE", `Đồ án ${context.project.code} chưa qua phản biện.`);
  withinDefenseWindow(context.term as TermRow & Record<string, unknown>, start, end);
  const slotId = randomUUID();
  await guarded(
    client.query(`INSERT INTO thesis_defense_slots(id,committee_id,project_id,during,created_by) VALUES($1,$2,$3,tstzrange($4,$5,'[)'),$6)`, [slotId, committeeId, context.project.id, start, end, userId]),
  );
  await transition(client, context, userId, "scheduled", `Bảo vệ lúc ${start.toISOString()}`);
  return slotId;
}

export async function scheduleDefense(userId: string, projectId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const context = await lockProject(client, userId, projectId);
    if (!context.roles.admin) throw forbidden("Chỉ giáo vụ xếp lịch bảo vệ.");
    requirePhase(context.term, "review", "defense");
    const start = date(body.startsAt, "Bắt đầu"),
      end = date(body.endsAt, "Kết thúc");
    const slotId = await insertSlot(client, context, userId, id(body.committeeId), start, end);
    return { slotId, status: context.project.status };
  });
}

export async function unscheduleDefense(userId: string, projectId: string) {
  return withTransaction(async (client) => {
    const context = await lockProject(client, userId, projectId);
    if (!context.roles.admin) throw forbidden("Chỉ giáo vụ xếp lịch bảo vệ.");
    if (context.project.status !== "scheduled") throw conflict("WRONG_STAGE", "Đồ án chưa được xếp lịch.");
    await client.query(`DELETE FROM thesis_defense_slots WHERE project_id=$1`, [context.project.id]);
    await transition(client, context, userId, "review_passed", "Hủy ca bảo vệ");
    return { status: context.project.status };
  });
}

/** Runs the in-house scheduler for every review-passed project; `apply` persists the plan atomically. */
export async function autoSchedule(userId: string, termId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const term = (await lockTerm(client, termId)) as TermRow & Record<string, unknown>;
    requireUnitRole(await loadActor(client, userId), term.unit_id, "unit_admin");
    requirePhase(term, "review", "defense");
    // One scheduler run at a time per term.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`thesis-schedule:${term.id}`]);
    const slotMinutes = integer(body.slotMinutes ?? 45, "Thời lượng ca", 15, 180);
    if (!Array.isArray(body.sessions) || !body.sessions.length || body.sessions.length > 200) throw invalid("Cần danh sách buổi bảo vệ của các hội đồng.");
    const sessions = body.sessions.map((raw) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const start = date(row.startsAt, "Bắt đầu buổi"),
        end = date(row.endsAt, "Kết thúc buổi");
      if (end <= start) throw invalid("Buổi bảo vệ phải kết thúc sau khi bắt đầu.");
      withinDefenseWindow(term, start, end);
      return { committeeId: id(row.committeeId), start, end };
    });
    const committees = await client.query<{ id: string; members: string[] }>(
      `SELECT c.id,array_agg(m.lecturer_id) AS members FROM thesis_committees c JOIN thesis_committee_members m ON m.committee_id=c.id WHERE c.term_id=$1 AND c.status='confirmed' GROUP BY c.id`,
      [term.id],
    );
    const known = new Set(committees.rows.map((row) => row.id));
    for (const session of sessions) if (!known.has(session.committeeId)) throw invalid("Buổi bảo vệ gắn với hội đồng chưa xác nhận hoặc không thuộc đợt.");
    const projects = await client.query<{ id: string; code: string; supervisor_id: string; co_supervisor_id: string | null; reviewer_id: string | null }>(
      `SELECT p.id,p.code,p.supervisor_id,p.co_supervisor_id,r.reviewer_id FROM thesis_projects p LEFT JOIN thesis_reviews r ON r.project_id=p.id WHERE p.term_id=$1 AND p.status='review_passed' ORDER BY p.code`,
      [term.id],
    );
    const busy = await client.query<{ lecturer_id: string; start: Date; end: Date }>(
      `SELECT lecturer_id,lower(during) AS start,upper(during) AS "end" FROM thesis_lecturer_bookings`,
    );
    const plan = buildSchedule({
      projects: projects.rows.map((p) => ({ id: p.id, supervisorIds: [p.supervisor_id, ...(p.co_supervisor_id ? [p.co_supervisor_id] : [])], reviewerId: p.reviewer_id })),
      committees: committees.rows.map((c) => ({ id: c.id, memberIds: c.members, sessions: sessions.filter((s) => s.committeeId === c.id) })),
      slotMinutes,
      allowSupervisorInCommittee: term.supervisor_in_committee,
      busy: busy.rows.map((b) => ({ lecturerId: b.lecturer_id, start: b.start, end: b.end })),
    });
    if (body.apply === true)
      for (const item of plan.scheduled) {
        const context = await lockProject(client, userId, item.projectId);
        await insertSlot(client, context, userId, item.committeeId, item.start, item.end);
      }
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "term", entityId: term.id, action: body.apply === true ? "schedule.applied" : "schedule.previewed", details: { scheduled: plan.scheduled.length, unscheduled: plan.unscheduled.length } });
    const codes = new Map(projects.rows.map((p) => [p.id, p.code]));
    return {
      applied: body.apply === true,
      scheduled: plan.scheduled.map((item) => ({ ...item, projectCode: codes.get(item.projectId) })),
      unscheduled: plan.unscheduled.map((item) => ({ ...item, projectCode: codes.get(item.projectId) })),
    };
  });
}

export async function markDefended(userId: string, projectId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const context = await lockProject(client, userId, projectId);
    requirePhase(context.term, "defense");
    requireVersion(context.project.version, body.version, "Đồ án");
    const slot = await client.query<{ starts: Date; role: string | null }>(
      `SELECT lower(s.during) AS starts,(SELECT role FROM thesis_committee_members m WHERE m.committee_id=s.committee_id AND m.lecturer_id=$2) AS role FROM thesis_defense_slots s WHERE s.project_id=$1`,
      [context.project.id, userId],
    );
    if (!slot.rowCount) throw conflict("WRONG_STAGE", "Đồ án chưa có lịch bảo vệ.");
    if (slot.rows[0].role !== "secretary" && slot.rows[0].role !== "chair" && !context.roles.admin)
      throw forbidden("Chủ tịch, thư ký hội đồng hoặc giáo vụ xác nhận đã bảo vệ.");
    if (+context.term.db_now < +slot.rows[0].starts) throw conflict("NOT_STARTED", "Ca bảo vệ chưa bắt đầu.");
    await transition(client, context, userId, "defended", "Đã bảo vệ trước hội đồng");
    return { status: context.project.status };
  });
}

// ---- grading ----------------------------------------------------------------------

type GraderRole = "supervisor" | "reviewer" | "committee";

async function graderRoleAllowed(client: PoolClient, context: ProjectContext, userId: string, role: GraderRole) {
  const { project } = context;
  if (role === "supervisor") {
    if (project.supervisor_id !== userId) throw forbidden("Chỉ GVHD chính chấm điểm hướng dẫn.");
    if (!["defense_approved", "under_review", "review_passed", "scheduled", "defended"].includes(project.status))
      throw conflict("WRONG_STAGE", "Chưa đến hoặc đã qua giai đoạn chấm điểm hướng dẫn.");
  } else if (role === "reviewer") {
    if (!context.roles.reviewer) throw forbidden("Chỉ giảng viên phản biện chấm điểm phản biện.");
    if (!["under_review", "review_passed", "scheduled", "defended"].includes(project.status)) throw conflict("WRONG_STAGE", "Không ở giai đoạn chấm phản biện.");
  } else {
    if (!context.roles.committee) throw forbidden("Chỉ thành viên hội đồng chấm điểm bảo vệ.");
    if (project.status !== "defended") throw conflict("WRONG_STAGE", "Chỉ chấm điểm hội đồng sau khi đồ án đã bảo vệ.");
  }
}

export async function saveScoreSheet(userId: string, projectId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const context = await lockProject(client, userId, projectId);
    const role = choice(body.graderRole, ["supervisor", "reviewer", "committee"] as const, "Vai trò chấm");
    await graderRoleAllowed(client, context, userId, role);
    const criteria = await client.query<{ id: string; weight: string; code: string }>(`SELECT id,weight,code FROM thesis_rubric_criteria WHERE term_id=$1 AND grader_role=$2`, [context.term.id, role]);
    if (!criteria.rowCount) throw conflict("NO_RUBRIC", "Đợt chưa có rubric cho vai trò này.");
    const scores = (body.scores ?? {}) as Record<string, unknown>;
    if (typeof scores !== "object" || Array.isArray(scores)) throw invalid("scores phải là đối tượng {criterionId: điểm}.");
    const unknown = Object.keys(scores).filter((key) => !criteria.rows.some((c) => c.id === key));
    if (unknown.length) throw invalid("Có tiêu chí không thuộc rubric.");
    const submit = body.submit === true;
    const items = criteria.rows
      .filter((c) => scores[c.id] !== undefined)
      .map((c) => ({ criterionId: c.id, weight: Number(c.weight), score: decimal(scores[c.id], `Điểm ${c.code}`, 0, 10) }));
    for (const item of items) if (item.score * 4 !== Math.trunc(item.score * 4)) throw invalid("Điểm theo bước 0,25.");
    if (submit && items.length !== criteria.rowCount) throw invalid("Cần chấm đủ mọi tiêu chí trước khi nộp.");
    const total = submit ? sheetTotal(items) : null;
    const comment = optionalText(body.comment, "Nhận xét", 4000);
    const existing = await client.query<{ id: string; version: number; submitted_at: Date | null }>(
      `SELECT id,version,submitted_at FROM thesis_score_sheets WHERE project_id=$1 AND grader_id=$2 AND grader_role=$3 FOR UPDATE`,
      [context.project.id, userId, role],
    );
    if (existing.rows[0]?.submitted_at) throw conflict("SHEET_SUBMITTED", "Phiếu điểm đã nộp, không thể sửa.");
    if (existing.rowCount) requireVersion(existing.rows[0].version, body.version, "Phiếu điểm");
    const sheetId = existing.rows[0]?.id ?? randomUUID();
    // Draft row first, then items, then the submission stamp: once stamped, the database freezes the sheet.
    await guarded(
      existing.rowCount
        ? client.query(`UPDATE thesis_score_sheets SET comment=$2,version=version+1 WHERE id=$1`, [sheetId, comment])
        : client.query(`INSERT INTO thesis_score_sheets(id,project_id,grader_id,grader_role,comment) VALUES($1,$2,$3,$4,$5)`, [sheetId, context.project.id, userId, role, comment]),
    );
    await client.query(`DELETE FROM thesis_score_items WHERE sheet_id=$1`, [sheetId]);
    for (const item of items) await client.query(`INSERT INTO thesis_score_items(sheet_id,criterion_id,score) VALUES($1,$2,$3)`, [sheetId, item.criterionId, item.score]);
    if (submit) await client.query(`UPDATE thesis_score_sheets SET total=$2,submitted_at=now() WHERE id=$1`, [sheetId, total]);
    if (submit) await audit(client, { unitId: context.term.unit_id, termId: context.term.id, actorId: userId, entity: "score_sheet", entityId: sheetId, action: "score.submitted", details: { role, total } });
    return { id: sheetId, total, submitted: submit };
  });
}

export async function getScoreSheets(userId: string, projectId: string) {
  return withTransaction(async (client) => {
    const context = await lockProject(client, userId, projectId, false);
    const staff = context.roles.admin || context.roles.head || context.roles.committee;
    // Graders see their own sheet; the committee and office see all sheets.
    const sheets = await client.query(
      `SELECT s.id,s.grader_role AS "graderRole",s.grader_id AS "graderId",u.display_name AS "graderName",s.total::float8 AS total,s.comment,s.submitted_at AS "submittedAt",s.version,
              COALESCE(json_object_agg(i.criterion_id,i.score::float8) FILTER (WHERE i.criterion_id IS NOT NULL),'{}') AS scores
       FROM thesis_score_sheets s JOIN users u ON u.id=s.grader_id LEFT JOIN thesis_score_items i ON i.sheet_id=s.id
       WHERE s.project_id=$1 AND ($2::boolean OR s.grader_id=$3) GROUP BY s.id,u.display_name ORDER BY s.grader_role,u.display_name`,
      [context.project.id, staff, userId],
    );
    const rubric = await client.query(`SELECT id,grader_role AS "graderRole",code,name,weight::float8 AS weight FROM thesis_rubric_criteria WHERE term_id=$1 ORDER BY grader_role,position`, [context.term.id]);
    return { sheets: sheets.rows, rubric: rubric.rows };
  });
}

async function appendLedger(client: PoolClient, termId: string, projectId: string, event: "finalized" | "appeal_adjusted", payload: object, actorId: string) {
  // Ledger appends are serialised per term so the chain cannot fork.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`thesis-ledger:${termId}`]);
  const last = await client.query<{ hash: string }>(`SELECT hash FROM thesis_grade_ledger WHERE term_id=$1 ORDER BY seq DESC LIMIT 1`, [termId]);
  const prevHash = last.rows[0]?.hash ?? GENESIS_HASH;
  const body = canonicalJson({ ...payload, event, projectId, actorId });
  const hash = chainHash(prevHash, body);
  await client.query(`INSERT INTO thesis_grade_ledger(term_id,project_id,event,payload,prev_hash,hash,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, [termId, projectId, event, body, prevHash, hash, actorId]);
  return hash;
}

/** Committee secretary (or chair) closes grading: aggregates, checks deviation, locks, and records to the ledger. */
export async function finalizeGrades(userId: string, projectId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const context = await lockProject(client, userId, projectId);
    const { project, term } = context;
    requirePhase(term, "defense", "grading");
    if (project.status !== "defended") throw conflict("WRONG_STAGE", "Đồ án chưa bảo vệ hoặc đã chốt điểm.");
    requireVersion(project.version, body.version, "Đồ án");
    const membership = await client.query<{ role: string; committee_id: string }>(
      `SELECT m.role,m.committee_id FROM thesis_defense_slots s JOIN thesis_committee_members m ON m.committee_id=s.committee_id AND m.lecturer_id=$2 WHERE s.project_id=$1`,
      [project.id, userId],
    );
    const role = membership.rows[0]?.role;
    if (role !== "secretary" && role !== "chair") throw forbidden("Chỉ thư ký hoặc chủ tịch hội đồng chốt điểm.");
    const committeeId = (await client.query<{ committee_id: string }>(`SELECT committee_id FROM thesis_defense_slots WHERE project_id=$1`, [project.id])).rows[0].committee_id;
    const sheets = await client.query<{ grader_role: string; grader_id: string; total: string | null }>(`SELECT grader_role,grader_id,total FROM thesis_score_sheets WHERE project_id=$1 AND submitted_at IS NOT NULL`, [project.id]);
    const members = await client.query<{ lecturer_id: string }>(`SELECT lecturer_id FROM thesis_committee_members WHERE committee_id=$1`, [committeeId]);
    const blockers: string[] = [];
    const supervisorSheet = sheets.rows.find((s) => s.grader_role === "supervisor");
    const reviewerSheet = sheets.rows.find((s) => s.grader_role === "reviewer");
    if (term.supervisor_weight > 0 && !supervisorSheet) blockers.push("Thiếu phiếu điểm của GVHD.");
    if (term.reviewer_weight > 0 && !reviewerSheet) blockers.push("Thiếu phiếu điểm phản biện.");
    const committeeTotals = members.rows.map((m) => sheets.rows.find((s) => s.grader_role === "committee" && s.grader_id === m.lecturer_id));
    const missing = committeeTotals.filter((s) => !s).length;
    if (missing) blockers.push(`Còn ${missing} thành viên hội đồng chưa nộp phiếu.`);
    if (blockers.length) throw Object.assign(conflict("GRADING_INCOMPLETE", blockers.join(" ")), { blockers });
    const aggregate = committeeAggregate(committeeTotals.map((s) => Number(s!.total)), Number(term.max_score_deviation));
    let deviationNote: string | null = null;
    if (aggregate.deviates) {
      // Large disagreement must be explained by the chair before the grade is locked.
      if (role !== "chair") throw conflict("DEVIATION_REVIEW", `Điểm các thành viên lệch ${aggregate.spread} (> ${term.max_score_deviation}); chủ tịch hội đồng phải giải trình và chốt.`);
      deviationNote = text(body.deviationNote, "Giải trình chênh lệch", 30, 4000);
    }
    const components = {
      supervisor: supervisorSheet ? Number(supervisorSheet.total) : 0,
      reviewer: reviewerSheet ? Number(reviewerSheet.total) : 0,
      committee: aggregate.mean,
    };
    const final = finalScore(components, { supervisor: term.supervisor_weight, reviewer: term.reviewer_weight, committee: term.committee_weight });
    const letter = letterGrade(final);
    const passed = final >= Number(term.pass_score);
    await client.query(
      `INSERT INTO thesis_results(project_id,supervisor_score,reviewer_score,committee_score,committee_spread,deviation_note,final_score,letter,passed,finalized_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [project.id, components.supervisor, components.reviewer, components.committee, aggregate.spread, deviationNote, final, letter, passed, userId],
    );
    const hash = await appendLedger(client, term.id, project.id, "finalized", {
      components,
      weights: { supervisor: term.supervisor_weight, reviewer: term.reviewer_weight, committee: term.committee_weight },
      committeeSpread: aggregate.spread,
      finalScore: final,
      letter,
      passed,
    }, userId);
    await transition(client, context, userId, "graded", "Chốt điểm hội đồng");
    return { finalScore: final, letter, passed, committee: aggregate, ledgerHash: hash };
  });
}

/** Office publishes all finalised results of the term and closes each project. */
export async function publishGrades(userId: string, termId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId, "update");
    requireUnitRole(await loadActor(client, userId), term.unit_id, "unit_admin");
    requirePhase(term, "grading");
    requireVersion(term.version, body.version, "Đợt đồ án");
    if (term.grades_published_at) throw conflict("ALREADY_PUBLISHED", "Điểm đã được công bố.");
    const pending = await client.query<{ code: string }>(`SELECT code FROM thesis_projects WHERE term_id=$1 AND status IN ('defended','scheduled') ORDER BY code`, [term.id]);
    if (pending.rowCount) throw conflict("GRADING_INCOMPLETE", `Còn đồ án chưa chốt điểm: ${pending.rows.map((r) => r.code).join(", ")}.`);
    const projects = await client.query<{ id: string }>(`SELECT id FROM thesis_projects WHERE term_id=$1 AND status IN ('graded','review_failed') ORDER BY code`, [term.id]);
    let completed = 0,
      failed = 0;
    for (const row of projects.rows) {
      const context = await lockProject(client, userId, row.id);
      const result = await client.query<{ passed: boolean }>(`SELECT passed FROM thesis_results WHERE project_id=$1`, [row.id]);
      const pass = context.project.status === "graded" && result.rows[0]?.passed === true;
      await transition(client, context, userId, pass ? "completed" : "failed", context.project.status === "review_failed" ? "Không đủ điều kiện bảo vệ" : "Công bố kết quả");
      if (pass) completed++;
      else failed++;
    }
    await client.query(`UPDATE thesis_results r SET published_at=now() FROM thesis_projects p WHERE p.id=r.project_id AND p.term_id=$1`, [term.id]);
    await client.query(`UPDATE thesis_terms SET grades_published_at=now(),version=version+1,updated_at=now() WHERE id=$1`, [term.id]);
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "term", entityId: term.id, action: "grades.published", details: { completed, failed } });
    return { completed, failed };
  });
}

/** Recomputes the hash chain and cross-checks every result against its latest ledger entry. */
export async function verifyLedger(userId: string, termId: string) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId);
    requireUnitRole(await loadActor(client, userId), term.unit_id, "unit_admin", "unit_head");
    const entries = await client.query<{ seq: string; payload: string; prev_hash: string; hash: string; project_id: string }>(
      `SELECT seq::text,payload,prev_hash,hash,project_id FROM thesis_grade_ledger WHERE term_id=$1 ORDER BY seq`,
      [term.id],
    );
    const broken = verifyChain(entries.rows.map((e) => ({ seq: e.seq, payload: e.payload, prevHash: e.prev_hash, hash: e.hash })));
    const latest = new Map<string, number>();
    for (const entry of entries.rows) latest.set(entry.project_id, (JSON.parse(entry.payload) as { finalScore: number }).finalScore);
    const results = await client.query<{ project_id: string; code: string; final_score: string }>(
      `SELECT r.project_id,p.code,r.final_score FROM thesis_results r JOIN thesis_projects p ON p.id=r.project_id WHERE p.term_id=$1`,
      [term.id],
    );
    const mismatches = results.rows
      .filter((r) => latest.get(r.project_id) !== Number(r.final_score))
      .map((r) => ({ projectCode: r.code, stored: Number(r.final_score), ledger: latest.get(r.project_id) ?? null }));
    return { entries: entries.rowCount, chainIntact: broken === null, brokenAt: broken, mismatches, intact: broken === null && !mismatches.length };
  });
}

// ---- appeals ----------------------------------------------------------------------

export async function fileAppeal(userId: string, projectId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const context = await lockProject(client, userId, projectId);
    if (!context.roles.student) throw forbidden("Chỉ sinh viên của đồ án được nộp đơn phúc khảo.");
    const published = await client.query<{ published_at: Date }>(`SELECT published_at FROM thesis_results WHERE project_id=$1 AND published_at IS NOT NULL`, [context.project.id]);
    if (!published.rowCount) throw conflict("NOT_PUBLISHED", "Chưa có kết quả công bố để phúc khảo.");
    if (+context.term.db_now > +published.rows[0].published_at + context.term.appeal_window_days * 86_400_000)
      throw conflict("APPEAL_WINDOW_CLOSED", `Đã quá ${context.term.appeal_window_days} ngày kể từ khi công bố điểm.`);
    const appealId = randomUUID();
    const inserted = await client.query(`INSERT INTO thesis_appeals(id,project_id,filed_by,reason) VALUES($1,$2,$3,$4) ON CONFLICT(project_id) DO NOTHING`, [appealId, context.project.id, userId, text(body.reason, "Lý do phúc khảo", 30, 4000)]);
    if (!inserted.rowCount) throw conflict("APPEAL_EXISTS", "Đồ án đã có đơn phúc khảo.");
    const heads = await client.query<{ user_id: string }>(`SELECT user_id FROM academic_role_grants WHERE unit_id=$1 AND role='unit_head'`, [context.term.unit_id]);
    await notify(client, heads.rows.map((r) => r.user_id), "appeal.filed", "project", context.project.id, `Đơn phúc khảo mới cho đồ án ${context.project.code}.`);
    await audit(client, { unitId: context.term.unit_id, termId: context.term.id, actorId: userId, entity: "appeal", entityId: appealId, action: "appeal.filed" });
    return { id: appealId, status: "submitted" };
  });
}

export async function decideAppeal(userId: string, projectId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const context = await lockProject(client, userId, projectId);
    const { project, term } = context;
    if (!context.roles.head) throw forbidden("Chỉ lãnh đạo khoa xử lý phúc khảo.");
    // Anyone who graded the project is excluded from deciding its appeal.
    if (context.roles.supervisor || context.roles.reviewer || context.roles.committee)
      throw forbidden("Người đã hướng dẫn/chấm đồ án không được xử lý phúc khảo của đồ án đó.");
    const appeal = (await client.query<{ id: string; status: string }>(`SELECT id,status FROM thesis_appeals WHERE project_id=$1 FOR UPDATE`, [project.id])).rows[0];
    if (!appeal) throw notFound("Không có đơn phúc khảo.");
    if (appeal.status !== "submitted") throw conflict("ALREADY_DECIDED", "Đơn đã được xử lý.");
    const decision = choice(body.decision, ["upheld", "adjusted"] as const, "Kết luận");
    const note = text(body.note, "Kết luận phúc khảo", 30, 4000);
    let newScore: number | null = null;
    if (decision === "adjusted") {
      newScore = decimal(body.newScore, "Điểm sau phúc khảo", 0, 10);
      if (Math.round(newScore * 10) !== newScore * 10) throw invalid("Điểm sau phúc khảo làm tròn 0,1.");
      const current = await client.query<{ final_score: string }>(`SELECT final_score FROM thesis_results WHERE project_id=$1`, [project.id]);
      if (Number(current.rows[0].final_score) === newScore) throw invalid("Điểm mới trùng điểm cũ; hãy chọn giữ nguyên.");
      const letter = letterGrade(newScore),
        passed = newScore >= Number(term.pass_score);
      await client.query(`UPDATE thesis_results SET final_score=$2,letter=$3,passed=$4,adjusted_by_appeal=true WHERE project_id=$1`, [project.id, newScore, letter, passed]);
      await appendLedger(client, term.id, project.id, "appeal_adjusted", { previousScore: Number(current.rows[0].final_score), finalScore: newScore, letter, passed, note }, userId);
      const target = passed ? "completed" : "failed";
      if (project.status !== target) await transition(client, context, userId, target, "Điều chỉnh sau phúc khảo");
    }
    await client.query(`UPDATE thesis_appeals SET status=$2,decision_note=$3,new_score=$4,decided_by=$5,decided_at=now() WHERE id=$1`, [appeal.id, decision, note, newScore, userId]);
    await notify(client, context.students, "appeal.decided", "project", project.id, `Kết quả phúc khảo đồ án ${project.code}: ${decision === "adjusted" ? `điều chỉnh thành ${newScore}` : "giữ nguyên điểm"}.`);
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "appeal", entityId: appeal.id, action: `appeal.${decision}`, details: { newScore } });
    return { decision, newScore };
  });
}
