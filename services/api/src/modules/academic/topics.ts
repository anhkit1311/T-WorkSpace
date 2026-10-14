import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "../../infrastructure/database/db.js";
import {
  audit,
  choice,
  conflict,
  forbidden,
  hasUnitRole,
  id,
  integer,
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
import { similarTopics } from "./similarity.js";

type TopicStatus = "draft" | "awaiting_supervisor" | "submitted" | "revision_requested" | "approved" | "rejected" | "closed";
interface TopicRow {
  id: string;
  term_id: string;
  code: string;
  title: string;
  proposed_by: string;
  proposer_kind: "lecturer" | "student";
  supervisor_id: string;
  co_supervisor_id: string | null;
  max_students: number;
  status: TopicStatus;
  version: number;
}

/** Topic decisions: who may move a topic from which state, and where it lands. */
const decisions = {
  submit: { from: ["draft", "revision_requested"], to: (topic: TopicRow) => (topic.proposer_kind === "student" ? "awaiting_supervisor" : "submitted") },
  supervisor_accept: { from: ["awaiting_supervisor"], to: () => "submitted" },
  supervisor_decline: { from: ["awaiting_supervisor"], to: () => "draft" },
  approve: { from: ["submitted"], to: () => "approved" },
  reject: { from: ["submitted"], to: () => "rejected" },
  request_revision: { from: ["submitted"], to: () => "revision_requested" },
  close: { from: ["approved"], to: () => "closed" },
} as const satisfies Record<string, { from: readonly TopicStatus[]; to: (topic: TopicRow) => TopicStatus }>;
type Decision = keyof typeof decisions;

const projection = `SELECT t.id,t.term_id AS "termId",t.code,t.title,t.summary,t.requirements,t.expected_outcomes AS "expectedOutcomes",t.keywords,
  t.proposer_kind AS "proposerKind",t.proposed_by AS "proposedBy",pu.display_name AS "proposerName",
  t.supervisor_id AS "supervisorId",su.display_name AS "supervisorName",s.academic_rank AS "supervisorRank",
  t.co_supervisor_id AS "coSupervisorId",cu.display_name AS "coSupervisorName",
  t.max_students AS "maxStudents",t.status,t.version,t.updated_at AS "updatedAt",
  COALESCE((SELECT sum(p.student_count) FROM thesis_projects p WHERE p.topic_id=t.id AND p.status<>'withdrawn'),0)::int AS "assignedStudents",
  (SELECT count(*)::int FROM thesis_registrations r WHERE r.topic_id=t.id AND r.status='pending') AS "pendingRegistrations"
  FROM thesis_topics t JOIN users pu ON pu.id=t.proposed_by JOIN users su ON su.id=t.supervisor_id JOIN academic_staff s ON s.user_id=t.supervisor_id
  LEFT JOIN users cu ON cu.id=t.co_supervisor_id`;

async function lockTopic(client: PoolClient, topicId: unknown): Promise<{ topic: TopicRow; term: TermRow }> {
  id(topicId);
  const termRef = await client.query<{ term_id: string }>(`SELECT term_id FROM thesis_topics WHERE id=$1`, [topicId]);
  if (!termRef.rowCount) throw notFound("Không tìm thấy đề tài.");
  const term = await lockTerm(client, termRef.rows[0].term_id);
  const topic = await client.query<TopicRow>(`SELECT * FROM thesis_topics WHERE id=$1 FOR UPDATE`, [topicId]);
  return { topic: topic.rows[0], term };
}

async function requireLecturer(client: PoolClient, lecturerId: string, unitId: string, label: string) {
  const row = await client.query(`SELECT 1 FROM academic_staff WHERE user_id=$1 AND unit_id=$2 AND active`, [lecturerId, unitId]);
  if (!row.rowCount) throw invalid(`${label} phải là giảng viên đang hoạt động của khoa.`);
}

function readContent(body: Record<string, unknown>, term: TermRow, current?: Record<string, unknown>) {
  const keywords = body.keywords === undefined ? (current?.keywords as string[]) ?? [] : body.keywords;
  if (!Array.isArray(keywords) || keywords.length > 10 || keywords.some((k) => typeof k !== "string" || !k.trim() || k.length > 40))
    throw invalid("Từ khóa: tối đa 10 mục, mỗi mục 1–40 ký tự.");
  const maxStudents = body.maxStudents === undefined ? (current?.max_students as number) : integer(body.maxStudents, "Số SV tối đa", 1, 5);
  if (maxStudents === undefined || maxStudents < term.min_group_size || maxStudents > term.max_group_size)
    throw invalid(`Số SV tối đa phải trong khoảng ${term.min_group_size}–${term.max_group_size} theo quy định của đợt.`);
  return {
    title: body.title === undefined ? (current?.title as string) : text(body.title, "Tên đề tài", 10, 300),
    summary: body.summary === undefined ? (current?.summary as string) : text(body.summary, "Mô tả", 50, 8000),
    requirements: body.requirements === undefined ? ((current?.requirements as string) ?? "") : optionalText(body.requirements, "Yêu cầu", 4000),
    expectedOutcomes: body.expectedOutcomes === undefined ? ((current?.expected_outcomes as string) ?? "") : optionalText(body.expectedOutcomes, "Kết quả dự kiến", 4000),
    keywords: [...new Set((keywords as string[]).map((k) => k.trim().toLowerCase()))],
    maxStudents,
  };
}

export async function createTopic(userId: string, termId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId, "update");
    requirePhase(term, "draft", "registration");
    const actor = await loadActor(client, userId);
    const isLecturer = isLecturerOf(actor, term.unit_id);
    const isStudent = (await client.query(`SELECT 1 FROM thesis_enrollments WHERE term_id=$1 AND student_id=$2 AND eligible AND withdrawn_at IS NULL`, [term.id, userId])).rowCount;
    if (!isLecturer && !isStudent) throw forbidden("Chỉ giảng viên của khoa hoặc sinh viên đủ điều kiện được đề xuất đề tài.");
    const content = readContent(body, term);
    // Students name the lecturer they want; lecturers supervise their own proposals.
    const supervisorId = isLecturer ? userId : id(body.supervisorId);
    await requireLecturer(client, supervisorId, term.unit_id, "Giảng viên hướng dẫn");
    const coSupervisorId = body.coSupervisorId ? id(body.coSupervisorId) : null;
    if (coSupervisorId) {
      if (coSupervisorId === supervisorId) throw invalid("Đồng hướng dẫn phải khác giảng viên hướng dẫn.");
      await requireLecturer(client, coSupervisorId, term.unit_id, "Đồng hướng dẫn");
    }
    // Sequential, human-friendly topic codes per term; the term row lock makes this race-free.
    const next = await client.query<{ n: number }>(`SELECT count(*)::int+1 AS n FROM thesis_topics WHERE term_id=$1`, [term.id]);
    const topicId = randomUUID();
    const topicCode = `T${String(next.rows[0].n).padStart(3, "0")}`;
    await client.query(
      `INSERT INTO thesis_topics(id,term_id,code,title,summary,requirements,expected_outcomes,keywords,proposed_by,proposer_kind,supervisor_id,co_supervisor_id,max_students)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [topicId, term.id, topicCode, content.title, content.summary, content.requirements, content.expectedOutcomes, content.keywords, userId, isLecturer ? "lecturer" : "student", supervisorId, coSupervisorId, content.maxStudents],
    );
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "topic", entityId: topicId, action: "topic.created", details: { code: topicCode } });
    return getTopicIn(client, actor, topicId);
  });
}

export async function updateTopic(userId: string, topicId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const { topic, term } = await lockTopic(client, topicId);
    requirePhase(term, "draft", "registration");
    if (topic.proposed_by !== userId) throw forbidden("Chỉ người đề xuất được sửa đề tài.");
    if (!["draft", "revision_requested"].includes(topic.status))
      throw conflict("TOPIC_LOCKED", "Chỉ sửa được đề tài ở trạng thái nháp hoặc cần chỉnh sửa.");
    requireVersion(topic.version, body.version, "Đề tài");
    const current = (await client.query(`SELECT * FROM thesis_topics WHERE id=$1`, [topicId])).rows[0];
    const content = readContent(body, term, current);
    await client.query(
      `UPDATE thesis_topics SET title=$2,summary=$3,requirements=$4,expected_outcomes=$5,keywords=$6,max_students=$7,version=version+1,updated_at=now() WHERE id=$1`,
      [topicId, content.title, content.summary, content.requirements, content.expectedOutcomes, content.keywords, content.maxStudents],
    );
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "topic", entityId: topicId, action: "topic.updated", details: { fields: Object.keys(body).filter((k) => k !== "version") } });
    return getTopicIn(client, await loadActor(client, userId), topicId);
  });
}

export async function decideTopic(userId: string, topicId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const { topic, term } = await lockTopic(client, topicId);
    const actor = await loadActor(client, userId);
    const decision = choice(body.decision, Object.keys(decisions) as Decision[], "Quyết định");
    requireVersion(topic.version, body.version, "Đề tài");
    const rule = decisions[decision];
    if (!(rule.from as readonly string[]).includes(topic.status))
      throw conflict("INVALID_TRANSITION", `Không thể "${decision}" đề tài đang ở trạng thái ${topic.status}.`);
    const note = optionalText(body.note, "Ghi chú", 2000);

    if (decision === "submit") {
      requirePhase(term, "draft", "registration");
      if (topic.proposed_by !== userId) throw forbidden("Chỉ người đề xuất được nộp đề tài.");
    } else if (decision === "supervisor_accept" || decision === "supervisor_decline") {
      if (topic.supervisor_id !== userId) throw forbidden("Chỉ giảng viên được đề nghị hướng dẫn mới quyết định.");
    } else if (decision === "close") {
      if (!hasUnitRole(actor, term.unit_id, "unit_admin", "unit_head") && topic.supervisor_id !== userId) throw forbidden();
    } else {
      if (!hasUnitRole(actor, term.unit_id, "unit_head")) throw forbidden("Chỉ lãnh đạo khoa duyệt đề tài.");
      // Separation of duties: nobody approves a topic they proposed or will supervise.
      if ([topic.proposed_by, topic.supervisor_id, topic.co_supervisor_id].includes(userId))
        throw forbidden("Không được tự duyệt đề tài mình đề xuất hoặc hướng dẫn.");
      requirePhase(term, "draft", "registration");
      if (decision !== "approve" && note.length < 10) throw invalid("Cần ghi rõ lý do (ít nhất 10 ký tự).");
    }
    if (decision === "close" && (await client.query(`SELECT 1 FROM thesis_registrations WHERE topic_id=$1 AND status='pending'`, [topicId])).rowCount)
      throw conflict("PENDING_REGISTRATIONS", "Đề tài còn nguyện vọng chờ duyệt.");

    const to = rule.to(topic);
    await client.query(`UPDATE thesis_topics SET status=$2,version=version+1,updated_at=now() WHERE id=$1`, [topicId, to]);
    await client.query(
      `INSERT INTO thesis_topic_decisions(id,topic_id,actor_id,decision,note,from_status,to_status) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), topicId, userId, decision, note, topic.status, to],
    );
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "topic", entityId: topicId, action: `topic.${decision}`, details: { from: topic.status, to, note } });
    const recipients = new Set([topic.proposed_by, topic.supervisor_id]);
    recipients.delete(userId);
    await notify(client, recipients, `topic.${decision}`, "topic", topicId, `Đề tài ${topic.code} "${topic.title}" chuyển sang trạng thái: ${to}.`);
    if (to === "submitted") {
      // Ask the unit heads (other than the people involved) to review.
      const heads = await client.query<{ user_id: string }>(`SELECT user_id FROM academic_role_grants WHERE unit_id=$1 AND role='unit_head'`, [term.unit_id]);
      await notify(client, heads.rows.map((r) => r.user_id).filter((u) => ![topic.proposed_by, topic.supervisor_id].includes(u)), "topic.review_requested", "topic", topicId, `Đề tài ${topic.code} cần duyệt.`);
    }
    return getTopicIn(client, actor, topicId);
  });
}

async function canSeeAllTopics(client: PoolClient, actor: Actor, term: TermRow) {
  return hasUnitRole(actor, term.unit_id, "unit_admin", "unit_head") || isLecturerOf(actor, term.unit_id);
}

async function getTopicIn(client: PoolClient, actor: Actor, topicId: string) {
  const row = await client.query(`${projection} WHERE t.id=$1`, [topicId]);
  if (!row.rowCount) throw notFound("Không tìm thấy đề tài.");
  const topic = row.rows[0];
  const term = await lockTerm(client, topic.termId);
  const staffView = await canSeeAllTopics(client, actor, term);
  const enrolled = (await client.query(`SELECT 1 FROM thesis_enrollments WHERE term_id=$1 AND student_id=$2`, [term.id, actor.userId])).rowCount;
  // Students see approved topics and their own proposals only.
  if (!staffView && !(enrolled && (topic.status === "approved" || topic.proposedBy === actor.userId)))
    throw notFound("Không tìm thấy đề tài.");
  const history = await client.query(
    `SELECT d.decision,d.note,d.from_status AS "fromStatus",d.to_status AS "toStatus",d.created_at AS "createdAt",u.display_name AS "actorName" FROM thesis_topic_decisions d JOIN users u ON u.id=d.actor_id WHERE d.topic_id=$1 ORDER BY d.created_at`,
    [topicId],
  );
  return { ...topic, history: history.rows };
}

export async function getTopic(userId: string, topicId: string) {
  id(topicId);
  return withTransaction(async (client) => getTopicIn(client, await loadActor(client, userId), topicId));
}

export async function listTopics(userId: string, termId: string, params: URLSearchParams) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId);
    const actor = await loadActor(client, userId);
    const staffView = await canSeeAllTopics(client, actor, term);
    const enrolled = (await client.query(`SELECT 1 FROM thesis_enrollments WHERE term_id=$1 AND student_id=$2`, [termId, userId])).rowCount;
    if (!staffView && !enrolled) throw forbidden();
    const status = params.get("status");
    if (status) choice(status, Object.keys({ draft: 1, awaiting_supervisor: 1, submitted: 1, revision_requested: 1, approved: 1, rejected: 1, closed: 1 }), "Trạng thái");
    const supervisor = params.get("supervisor");
    if (supervisor) id(supervisor);
    const search = (params.get("q") ?? "").trim().slice(0, 100);
    const rows = await client.query(
      `${projection} WHERE t.term_id=$1
        AND ($2::boolean OR t.status='approved' OR t.proposed_by=$3)
        AND ($4::text IS NULL OR t.status=$4)
        AND ($5::uuid IS NULL OR t.supervisor_id=$5)
        AND ($6='' OR t.title ILIKE '%'||$6||'%' OR t.code ILIKE $6||'%' OR $6=ANY(t.keywords))
        ORDER BY t.code LIMIT 500`,
      [termId, staffView, userId, status, supervisor, search.toLowerCase()],
    );
    return { topics: rows.rows };
  });
}

/** Similar titles from this and earlier terms of the unit, using the in-house n-gram index. */
export async function topicSimilarity(userId: string, topicId: string) {
  return withTransaction(async (client) => {
    const { topic, term } = await lockTopic(client, topicId);
    const actor = await loadActor(client, userId);
    if (!(await canSeeAllTopics(client, actor, term)) && topic.proposed_by !== userId) throw forbidden();
    const candidates = await client.query<{ id: string; code: string; title: string; summary: string; termCode: string }>(
      `SELECT t.id,t.code,t.title,t.summary,tt.code AS "termCode" FROM thesis_topics t JOIN thesis_terms tt ON tt.id=t.term_id
       WHERE tt.unit_id=$1 AND t.id<>$2 AND t.status IN ('submitted','approved','closed') ORDER BY t.created_at DESC LIMIT 5000`,
      [term.unit_id, topicId],
    );
    const self = (await client.query<{ title: string; summary: string }>(`SELECT title,summary FROM thesis_topics WHERE id=$1`, [topicId])).rows[0];
    return { matches: similarTopics(self, candidates.rows, { limit: 5, threshold: 0.25 }) };
  });
}
