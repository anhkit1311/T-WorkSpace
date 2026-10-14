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
  invalid,
  loadActor,
  lockTerm,
  notFound,
  notify,
  optionalText,
  requirePhase,
  requireVersion,
  type TermRow,
} from "./access.js";
import { studentsSupervised, supervisorQuota } from "./terms.js";

interface GroupRow {
  id: string;
  term_id: string;
  leader_id: string;
  status: "forming" | "assigned" | "dissolved";
  version: number;
}

function registrationWindow(term: TermRow) {
  requirePhase(term, "registration");
  const now = +term.db_now;
  if (now < +term.registration_opens_at || now > +term.registration_closes_at)
    throw conflict("REGISTRATION_CLOSED", "Ngoài thời gian đăng ký của đợt.");
}

async function requireEligible(client: PoolClient, termId: string, studentId: string) {
  const row = await client.query(
    `SELECT 1 FROM thesis_enrollments WHERE term_id=$1 AND student_id=$2 AND eligible AND withdrawn_at IS NULL`,
    [termId, studentId],
  );
  if (!row.rowCount) throw forbidden("Sinh viên chưa ghi danh hoặc không đủ điều kiện làm đồ án đợt này.");
}

/** Locks the term (share) and then the group row; the order is the same everywhere to avoid deadlocks. */
async function lockGroup(client: PoolClient, groupId: unknown) {
  id(groupId);
  const ref = await client.query<{ term_id: string }>(`SELECT term_id FROM thesis_groups WHERE id=$1`, [groupId]);
  if (!ref.rowCount) throw notFound("Không tìm thấy nhóm.");
  const term = await lockTerm(client, ref.rows[0].term_id);
  const group = (await client.query<GroupRow>(`SELECT * FROM thesis_groups WHERE id=$1 FOR UPDATE`, [groupId])).rows[0];
  return { term, group };
}

async function activeMembers(client: PoolClient, groupId: string): Promise<string[]> {
  const rows = await client.query<{ student_id: string }>(
    `SELECT student_id FROM thesis_group_members WHERE group_id=$1 AND status='active' ORDER BY created_at`,
    [groupId],
  );
  return rows.rows.map((row) => row.student_id);
}

async function hasLiveRegistrations(client: PoolClient, groupId: string) {
  return Boolean(
    (await client.query(`SELECT 1 FROM thesis_registrations WHERE group_id=$1 AND status IN ('pending','accepted')`, [groupId])).rowCount,
  );
}

const bumpGroup = (client: PoolClient, groupId: string) =>
  client.query(`UPDATE thesis_groups SET version=version+1 WHERE id=$1`, [groupId]);

export async function createGroup(userId: string, termId: string) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId);
    registrationWindow(term);
    await requireEligible(client, term.id, userId);
    const groupId = randomUUID();
    await client.query(`INSERT INTO thesis_groups(id,term_id,leader_id) VALUES($1,$2,$3)`, [groupId, term.id, userId]);
    await client
      .query(
        `INSERT INTO thesis_group_members(group_id,term_id,student_id,status,invited_by,responded_at) VALUES($1,$2,$3,'active',$3,now())`,
        [groupId, term.id, userId],
      )
      .catch((error: { code?: string }) => {
        if (error.code === "23505") throw conflict("ALREADY_IN_GROUP", "Bạn đã thuộc một nhóm khác trong đợt này.");
        throw error;
      });
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "group", entityId: groupId, action: "group.created" });
    return getGroupIn(client, userId, groupId);
  });
}

export async function inviteMember(userId: string, groupId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const { term, group } = await lockGroup(client, groupId);
    registrationWindow(term);
    if (group.leader_id !== userId) throw forbidden("Chỉ trưởng nhóm được mời thành viên.");
    if (group.status !== "forming") throw conflict("GROUP_LOCKED", "Nhóm đã được nhận đề tài hoặc đã giải thể.");
    requireVersion(group.version, body.version, "Nhóm");
    if (await hasLiveRegistrations(client, group.id))
      throw conflict("GROUP_LOCKED", "Rút các nguyện vọng đang chờ trước khi thay đổi thành viên.");
    const code = optionalText(body.studentCode, "Mã SV", 20);
    const student = await client.query<{ student_id: string }>(
      `SELECT student_id FROM thesis_enrollments WHERE term_id=$1 AND student_code=$2`,
      [term.id, code],
    );
    if (!student.rowCount) throw notFound("Không có sinh viên mang mã này trong đợt.");
    const studentId = student.rows[0].student_id;
    await requireEligible(client, term.id, studentId);
    const pendingOrActive = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM thesis_group_members WHERE group_id=$1 AND status IN ('active','invited')`,
      [group.id],
    );
    if (pendingOrActive.rows[0].n >= term.max_group_size)
      throw conflict("GROUP_FULL", `Nhóm tối đa ${term.max_group_size} sinh viên (tính cả lời mời đang chờ).`);
    if ((await client.query(`SELECT 1 FROM thesis_group_members WHERE term_id=$1 AND student_id=$2 AND status='active'`, [term.id, studentId])).rowCount)
      throw conflict("ALREADY_IN_GROUP", "Sinh viên đã thuộc một nhóm.");
    await client.query(
      `INSERT INTO thesis_group_members(group_id,term_id,student_id,status,invited_by) VALUES($1,$2,$3,'invited',$4)
       ON CONFLICT(group_id,student_id) DO UPDATE SET status='invited',invited_by=EXCLUDED.invited_by,responded_at=NULL,created_at=now()`,
      [group.id, term.id, studentId, userId],
    );
    await bumpGroup(client, group.id);
    await notify(client, [studentId], "group.invited", "group", group.id, `Bạn được mời vào nhóm đồ án đợt ${term.code}.`);
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "group", entityId: group.id, action: "group.invited", details: { studentId } });
    return getGroupIn(client, userId, group.id);
  });
}

export async function respondInvitation(userId: string, groupId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const { term, group } = await lockGroup(client, groupId);
    registrationWindow(term);
    const accept = choice(body.response, ["accept", "decline"] as const, "Phản hồi") === "accept";
    const invite = await client.query(
      `SELECT 1 FROM thesis_group_members WHERE group_id=$1 AND student_id=$2 AND status='invited' FOR UPDATE`,
      [group.id, userId],
    );
    if (!invite.rowCount) throw notFound("Không có lời mời đang chờ.");
    if (accept) {
      if (group.status !== "forming" || (await hasLiveRegistrations(client, group.id)))
        throw conflict("GROUP_LOCKED", "Nhóm đang chờ duyệt nguyện vọng hoặc đã được nhận đề tài.");
      await requireEligible(client, term.id, userId);
    }
    await client
      .query(`UPDATE thesis_group_members SET status=$3,responded_at=now() WHERE group_id=$1 AND student_id=$2`, [
        group.id,
        userId,
        accept ? "active" : "declined",
      ])
      .catch((error: { code?: string }) => {
        if (error.code === "23505") throw conflict("ALREADY_IN_GROUP", "Bạn đã thuộc một nhóm khác; hãy rời nhóm đó trước.");
        throw error;
      });
    if (accept)
      // Accepting one invitation withdraws every other pending invitation of the student.
      await client.query(
        `UPDATE thesis_group_members SET status='declined',responded_at=now() WHERE term_id=$1 AND student_id=$2 AND status='invited' AND group_id<>$3`,
        [term.id, userId, group.id],
      );
    await bumpGroup(client, group.id);
    await notify(client, [group.leader_id], accept ? "group.joined" : "group.declined", "group", group.id, accept ? "Một sinh viên đã tham gia nhóm." : "Một sinh viên đã từ chối lời mời.");
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "group", entityId: group.id, action: accept ? "group.joined" : "group.declined" });
    return getGroupIn(client, userId, group.id);
  });
}

export async function leaveGroup(userId: string, groupId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const { term, group } = await lockGroup(client, groupId);
    registrationWindow(term);
    if (group.status !== "forming") throw conflict("GROUP_LOCKED", "Nhóm đã được nhận đề tài; liên hệ giáo vụ để rút.");
    if (await hasLiveRegistrations(client, group.id)) throw conflict("GROUP_LOCKED", "Rút nguyện vọng trước khi rời nhóm.");
    const target = body.studentId ? id(body.studentId) : userId;
    if (target !== userId && group.leader_id !== userId) throw forbidden("Chỉ trưởng nhóm được mời người khác ra.");
    const members = await activeMembers(client, group.id);
    if (!members.includes(target)) {
      // Leader may also cancel a pending invitation.
      const cancelled = await client.query(
        `UPDATE thesis_group_members SET status='declined',responded_at=now() WHERE group_id=$1 AND student_id=$2 AND status='invited'`,
        [group.id, target],
      );
      if (!cancelled.rowCount) throw notFound("Sinh viên không thuộc nhóm.");
    } else if (target === group.leader_id) {
      // Leader leaving: hand over to the longest-standing member, or dissolve an empty group.
      const successor = members.find((member) => member !== target);
      await client.query(`UPDATE thesis_group_members SET status='left',responded_at=now() WHERE group_id=$1 AND student_id=$2`, [group.id, target]);
      if (successor) await client.query(`UPDATE thesis_groups SET leader_id=$2 WHERE id=$1`, [group.id, successor]);
      else {
        await client.query(`UPDATE thesis_groups SET status='dissolved' WHERE id=$1`, [group.id]);
        await client.query(`UPDATE thesis_group_members SET status='declined',responded_at=now() WHERE group_id=$1 AND status='invited'`, [group.id]);
      }
    } else
      await client.query(`UPDATE thesis_group_members SET status='left',responded_at=now() WHERE group_id=$1 AND student_id=$2`, [group.id, target]);
    await bumpGroup(client, group.id);
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "group", entityId: group.id, action: "group.left", details: { studentId: target } });
    return { left: true };
  });
}

// ---- preferences -----------------------------------------------------------

export async function setPreferences(userId: string, groupId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const { term, group } = await lockGroup(client, groupId);
    registrationWindow(term);
    if (group.leader_id !== userId) throw forbidden("Chỉ trưởng nhóm được đăng ký nguyện vọng.");
    if (group.status !== "forming") throw conflict("GROUP_LOCKED", "Nhóm đã được nhận đề tài.");
    requireVersion(group.version, body.version, "Nhóm");
    if (!Array.isArray(body.topicIds) || body.topicIds.length > term.max_preferences)
      throw invalid(`Đăng ký tối đa ${term.max_preferences} nguyện vọng theo thứ tự ưu tiên.`);
    const topicIds = body.topicIds.map((value) => id(value));
    if (new Set(topicIds).size !== topicIds.length) throw invalid("Nguyện vọng bị trùng đề tài.");
    const members = await activeMembers(client, group.id);
    if (topicIds.length && members.length < term.min_group_size)
      throw conflict("GROUP_TOO_SMALL", `Nhóm cần ít nhất ${term.min_group_size} thành viên trước khi đăng ký.`);
    if ((await client.query(`SELECT 1 FROM thesis_group_members WHERE group_id=$1 AND status='invited'`, [group.id])).rowCount && topicIds.length)
      throw conflict("PENDING_INVITES", "Còn lời mời chưa được phản hồi; hủy lời mời hoặc chờ phản hồi trước khi đăng ký.");
    for (const topicId of topicIds) {
      const topic = await client.query<{ status: string; max_students: number; assigned: number; supervisor_id: string; co_supervisor_id: string | null; proposed_by: string; proposer_kind: string }>(
        `SELECT t.status,t.max_students,t.supervisor_id,t.co_supervisor_id,t.proposed_by,t.proposer_kind,COALESCE((SELECT sum(student_count) FROM thesis_projects p WHERE p.topic_id=t.id AND p.status<>'withdrawn'),0)::int AS assigned FROM thesis_topics t WHERE t.id=$1 AND t.term_id=$2`,
        [topicId, term.id],
      );
      if (!topic.rowCount || topic.rows[0].status !== "approved") throw invalid("Chỉ đăng ký được đề tài đã duyệt trong đợt.");
      if (topic.rows[0].max_students - topic.rows[0].assigned < members.length)
        throw conflict("TOPIC_FULL", "Một đề tài không còn đủ chỗ cho cả nhóm.");
      // A student-proposed topic is reserved for the group of its proposer.
      if (topic.rows[0].proposer_kind === "student" && !members.includes(topic.rows[0].proposed_by))
        throw forbidden("Đề tài do sinh viên khác đề xuất, chỉ nhóm của sinh viên đó được đăng ký.");
    }
    // Replace the wish list atomically: withdrawn rows stay for history.
    await client.query(`UPDATE thesis_registrations SET status='withdrawn',decided_at=now() WHERE group_id=$1 AND status='pending'`, [group.id]);
    for (const [index, topicId] of topicIds.entries())
      await client.query(
        `INSERT INTO thesis_registrations(id,group_id,topic_id,rank) VALUES($1,$2,$3,$4)
         ON CONFLICT(group_id,topic_id) DO UPDATE SET rank=EXCLUDED.rank,status='pending',note='',decided_by=NULL,decided_at=NULL,created_at=now()
         WHERE thesis_registrations.status IN ('withdrawn')`,
        [randomUUID(), group.id, topicId, index + 1],
      ).then((result) => {
        if (!result.rowCount) throw conflict("ALREADY_DECIDED", "Đề tài này đã từ chối nguyện vọng của nhóm; không đăng ký lại.");
      });
    await bumpGroup(client, group.id);
    const supervisors = await client.query<{ supervisor_id: string }>(`SELECT DISTINCT supervisor_id FROM thesis_topics WHERE id=ANY($1::uuid[])`, [topicIds]);
    await notify(client, supervisors.rows.map((r) => r.supervisor_id), "registration.received", "group", group.id, `Có nhóm đăng ký đề tài của bạn trong đợt ${term.code}.`);
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "group", entityId: group.id, action: "registration.set", details: { topicIds } });
    return getGroupIn(client, userId, group.id);
  });
}

/**
 * Supervisor accepts or rejects a wish. Acceptance is the critical section of the module:
 * it re-checks topic capacity and the lecturer's quota under row locks, creates the project
 * with its collaboration workspace, and withdraws the group's other wishes, all atomically.
 */
export async function decideRegistration(userId: string, registrationId: string, body: Record<string, unknown>) {
  const result = await withTransaction(async (client) => {
    id(registrationId);
    const ref = await client.query<{ group_id: string; topic_id: string }>(`SELECT group_id,topic_id FROM thesis_registrations WHERE id=$1`, [registrationId]);
    if (!ref.rowCount) throw notFound("Không tìm thấy nguyện vọng.");
    const { term, group } = await lockGroup(client, ref.rows[0].group_id);
    // Lock order: term → group → topic → supervisor's projects.
    const topic = (
      await client.query<{ id: string; code: string; title: string; supervisor_id: string; co_supervisor_id: string | null; max_students: number; status: string }>(
        `SELECT id,code,title,supervisor_id,co_supervisor_id,max_students,status FROM thesis_topics WHERE id=$1 FOR UPDATE`,
        [ref.rows[0].topic_id],
      )
    ).rows[0];
    const registration = (
      await client.query<{ status: string }>(`SELECT status FROM thesis_registrations WHERE id=$1 FOR UPDATE`, [registrationId])
    ).rows[0];
    if (topic.supervisor_id !== userId) throw forbidden("Chỉ giảng viên hướng dẫn của đề tài được quyết định.");
    registrationWindow(term);
    if (registration.status !== "pending") throw conflict("ALREADY_DECIDED", "Nguyện vọng đã được xử lý.");
    const decision = choice(body.decision, ["accept", "reject"] as const, "Quyết định");
    const note = optionalText(body.note, "Ghi chú", 1000);
    const members = await activeMembers(client, group.id);

    if (decision === "reject") {
      if (note.length < 5) throw invalid("Cần ghi lý do từ chối.");
      await client.query(`UPDATE thesis_registrations SET status='rejected',note=$2,decided_by=$3,decided_at=now() WHERE id=$1`, [registrationId, note, userId]);
      await notify(client, members, "registration.rejected", "group", group.id, `Nguyện vọng đề tài ${topic.code} bị từ chối: ${note}`);
      await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "registration", entityId: registrationId, action: "registration.rejected", details: { note } });
      return { status: "rejected" as const, projectId: null, members };
    }

    if (group.status !== "forming") throw conflict("GROUP_ASSIGNED", "Nhóm đã được giảng viên khác nhận.");
    if (topic.status !== "approved") throw conflict("TOPIC_UNAVAILABLE", "Đề tài không còn mở.");
    if (members.length < term.min_group_size || members.length > term.max_group_size)
      throw conflict("GROUP_SIZE", "Số thành viên nhóm không còn hợp lệ.");
    // Serialise every acceptance by this supervisor in the term so the quota check cannot race.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`thesis-quota:${term.id}:${userId}`]);
    const assigned = await client.query<{ n: number }>(
      `SELECT COALESCE(sum(student_count),0)::int AS n FROM thesis_projects WHERE topic_id=$1 AND status<>'withdrawn'`,
      [topic.id],
    );
    if (assigned.rows[0].n + members.length > topic.max_students)
      throw conflict("TOPIC_FULL", "Đề tài không còn đủ chỗ cho nhóm.");
    const quota = await supervisorQuota(client, term.id, userId);
    const used = await studentsSupervised(client, term.id, userId);
    if (used + members.length > quota)
      throw conflict("QUOTA_EXCEEDED", `Vượt định mức hướng dẫn (${used}/${quota} sinh viên).`);

    const projectId = randomUUID();
    const sequence = await client.query<{ n: number }>(`SELECT count(*)::int+1 AS n FROM thesis_projects WHERE term_id=$1`, [term.id]);
    // Codes are unique per term (the term code is shown alongside), e.g. DA-007.
    const projectCode = `DA-${String(sequence.rows[0].n).padStart(3, "0")}`;
    const workspaceId = await createProjectWorkspace(client, {
      name: `${projectCode} · ${topic.title}`.slice(0, 80),
      supervisorId: userId,
      coSupervisorId: topic.co_supervisor_id,
      students: members,
    });
    await client.query(
      `INSERT INTO thesis_projects(id,term_id,code,group_id,topic_id,supervisor_id,co_supervisor_id,student_count,workspace_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [projectId, term.id, projectCode, group.id, topic.id, userId, topic.co_supervisor_id, members.length, workspaceId],
    );
    await client.query(
      `INSERT INTO thesis_project_events(id,project_id,actor_id,from_status,to_status,note) VALUES($1,$2,$3,NULL,'proposal',$4)`,
      [randomUUID(), projectId, userId, `Nhận nhóm vào đề tài ${topic.code}`],
    );
    await client.query(`UPDATE thesis_registrations SET status='accepted',note=$2,decided_by=$3,decided_at=now() WHERE id=$1`, [registrationId, note, userId]);
    await client.query(`UPDATE thesis_registrations SET status='withdrawn',decided_at=now() WHERE group_id=$1 AND status='pending'`, [group.id]);
    await client.query(`UPDATE thesis_groups SET status='assigned',version=version+1 WHERE id=$1`, [group.id]);
    // Students still invited to this group lose the invitation; the roster is final.
    await client.query(`UPDATE thesis_group_members SET status='declined',responded_at=now() WHERE group_id=$1 AND status='invited'`, [group.id]);
    await notify(client, members, "registration.accepted", "project", projectId, `Nhóm được nhận vào đề tài ${topic.code}. Mã đồ án: ${projectCode}.`);
    await audit(client, { unitId: term.unit_id, termId: term.id, actorId: userId, entity: "project", entityId: projectId, action: "project.created", details: { topicId: topic.id, groupId: group.id, members, workspaceId } });
    return { status: "accepted" as const, projectId, members: [...members, userId, ...(topic.co_supervisor_id ? [topic.co_supervisor_id] : [])] };
  });
  return result;
}

/** Every project gets its own collaboration space with the default channels and a meeting room. */
async function createProjectWorkspace(
  client: PoolClient,
  input: { name: string; supervisorId: string; coSupervisorId: string | null; students: string[] },
): Promise<string> {
  const workspaceId = randomUUID();
  const slug = `do-an-${workspaceId.slice(0, 8)}`;
  await client.query(`INSERT INTO workspaces(id,name,slug,owner_id,description) VALUES($1,$2,$3,$4,$5)`, [
    workspaceId,
    input.name,
    slug,
    input.supervisorId,
    "Không gian làm việc của đồ án tốt nghiệp (tạo tự động).",
  ]);
  await client.query(`INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')`, [workspaceId, input.supervisorId]);
  if (input.coSupervisorId)
    await client.query(`INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'admin')`, [workspaceId, input.coSupervisorId]);
  for (const student of input.students)
    await client.query(`INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'member')`, [workspaceId, student]);
  const channels: [string, string, number][] = [
    ["thong-bao", "text", 1],
    ["trao-doi", "text", 2],
    ["tai-lieu", "text", 3],
    ["tien-do", "text", 4],
    ["phong-hop", "video", 5],
  ];
  for (const [name, type, position] of channels)
    await client.query(`INSERT INTO channels(id,workspace_id,created_by,name,type,position) VALUES($1,$2,$3,$4,$5,$6)`, [
      randomUUID(),
      workspaceId,
      input.supervisorId,
      name,
      type,
      position,
    ]);
  return workspaceId;
}

async function getGroupIn(client: PoolClient, userId: string, groupId: string) {
  const group = await client.query(
    `SELECT g.id,g.term_id AS "termId",g.leader_id AS "leaderId",g.status,g.version,p.id AS "projectId",p.code AS "projectCode" FROM thesis_groups g LEFT JOIN thesis_projects p ON p.group_id=g.id WHERE g.id=$1`,
    [groupId],
  );
  if (!group.rowCount) throw notFound("Không tìm thấy nhóm.");
  const members = await client.query(
    `SELECT m.student_id AS "studentId",u.display_name AS "displayName",e.student_code AS "studentCode",m.status,m.created_at AS "createdAt"
     FROM thesis_group_members m JOIN users u ON u.id=m.student_id JOIN thesis_enrollments e ON e.term_id=m.term_id AND e.student_id=m.student_id
     WHERE m.group_id=$1 AND m.status IN ('active','invited') ORDER BY m.created_at`,
    [groupId],
  );
  const involved = members.rows.some((member) => member.studentId === userId);
  const term = await lockTerm(client, group.rows[0].termId);
  const actor = await loadActor(client, userId);
  const supervisorView = (
    await client.query(`SELECT 1 FROM thesis_registrations r JOIN thesis_topics t ON t.id=r.topic_id WHERE r.group_id=$1 AND t.supervisor_id=$2`, [groupId, userId])
  ).rowCount;
  if (!involved && !supervisorView && !hasUnitRole(actor, term.unit_id, "unit_admin", "unit_head"))
    throw notFound("Không tìm thấy nhóm.");
  const registrations = await client.query(
    `SELECT r.id,r.topic_id AS "topicId",t.code AS "topicCode",t.title AS "topicTitle",su.display_name AS "supervisorName",r.rank,r.status,r.note,r.decided_at AS "decidedAt"
     FROM thesis_registrations r JOIN thesis_topics t ON t.id=r.topic_id JOIN users su ON su.id=t.supervisor_id
     WHERE r.group_id=$1 AND r.status<>'withdrawn' ORDER BY r.rank`,
    [groupId],
  );
  return { ...group.rows[0], members: members.rows, registrations: registrations.rows };
}

export async function getGroup(userId: string, groupId: string) {
  id(groupId);
  return withTransaction((client) => getGroupIn(client, userId, groupId));
}

/** The caller's group for a term, plus invitations waiting for an answer. */
export async function myGroup(userId: string, termId: string) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId);
    const active = await client.query<{ group_id: string }>(
      `SELECT group_id FROM thesis_group_members WHERE term_id=$1 AND student_id=$2 AND status='active'`,
      [term.id, userId],
    );
    const invitations = await client.query(
      `SELECT g.id AS "groupId",u.display_name AS "leaderName",m.created_at AS "invitedAt" FROM thesis_group_members m JOIN thesis_groups g ON g.id=m.group_id JOIN users u ON u.id=g.leader_id
       WHERE m.term_id=$1 AND m.student_id=$2 AND m.status='invited' AND g.status='forming' ORDER BY m.created_at DESC`,
      [term.id, userId],
    );
    return {
      group: active.rowCount ? await getGroupIn(client, userId, active.rows[0].group_id) : null,
      invitations: invitations.rows,
    };
  });
}

/** Wishes waiting for the calling supervisor, highest priority first. */
export async function pendingRegistrations(userId: string, termId: string) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId);
    const rows = await client.query(
      `SELECT r.id,r.rank,r.created_at AS "createdAt",t.id AS "topicId",t.code AS "topicCode",t.title AS "topicTitle",g.id AS "groupId",
              json_agg(json_build_object('studentId',e.student_id,'studentCode',e.student_code,'displayName',u.display_name,'gpa',e.gpa::float8) ORDER BY e.student_code) AS members
       FROM thesis_registrations r JOIN thesis_topics t ON t.id=r.topic_id JOIN thesis_groups g ON g.id=r.group_id
       JOIN thesis_group_members m ON m.group_id=g.id AND m.status='active' JOIN thesis_enrollments e ON e.term_id=m.term_id AND e.student_id=m.student_id JOIN users u ON u.id=m.student_id
       WHERE t.term_id=$1 AND t.supervisor_id=$2 AND r.status='pending'
       GROUP BY r.id,t.id,g.id ORDER BY t.code,r.rank,r.created_at`,
      [term.id, userId],
    );
    return { registrations: rows.rows };
  });
}
