import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { URLSearchParams } from "node:url";
import { test } from "node:test";
process.env.JWT_SECRET ??= "academic-test-secret-at-least-32-characters";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import * as org from "../../../dist/api/modules/academic/organization.js";
import * as terms from "../../../dist/api/modules/academic/terms.js";
import * as topics from "../../../dist/api/modules/academic/topics.js";
import * as groups from "../../../dist/api/modules/academic/groups.js";
import * as projects from "../../../dist/api/modules/academic/projects.js";
import * as evaluation from "../../../dist/api/modules/academic/evaluation.js";
import { uploadFile } from "../../../dist/api/modules/files/service.js";
import { createApiServer } from "../../../dist/api/server.js";
import { createAccessToken } from "../../../dist/api/modules/auth/tokens.js";
import { roomManager } from "../../../dist/api/modules/meetings/media/room-manager.js";

const skip = process.env.RUN_DB_TESTS !== "1";
const sql = (text, values = []) => pool.query(text, values);
const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code || assert.fail(`expected ${code}, got ${error.code}: ${error.message}`));
const dbRejects = (promise, pattern) => assert.rejects(promise, (error) => error.code === "23514" && pattern.test(error.message));
const hours = (h) => new Date(Date.now() + h * 3600_000);
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function user(name) {
  const id = randomUUID();
  await sql(`INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only',$3,true)`, [id, `acad-${id}@example.test`, name]);
  return { id, email: `acad-${id}@example.test` };
}

/** Removes everything the test created. Triggers are bypassed only here, in the test session. */
async function cleanup(unitId, userIds) {
  const client = await pool.connect();
  try {
    await client.query(`SET session_replication_role = replica`);
    const terms = `(SELECT id FROM thesis_terms WHERE unit_id=$1)`;
    const projectIds = `(SELECT id FROM thesis_projects WHERE term_id IN ${terms})`;
    const workspaces = (await client.query(`SELECT workspace_id FROM thesis_projects WHERE term_id IN ${terms}`, [unitId])).rows.map((r) => r.workspace_id);
    for (const statement of [
      `DELETE FROM thesis_appeals WHERE project_id IN ${projectIds}`,
      `DELETE FROM thesis_grade_ledger WHERE term_id IN ${terms}`,
      `DELETE FROM thesis_results WHERE project_id IN ${projectIds}`,
      `DELETE FROM thesis_score_items WHERE sheet_id IN (SELECT id FROM thesis_score_sheets WHERE project_id IN ${projectIds})`,
      `DELETE FROM thesis_score_sheets WHERE project_id IN ${projectIds}`,
      `DELETE FROM thesis_lecturer_bookings WHERE slot_id IN (SELECT id FROM thesis_defense_slots WHERE project_id IN ${projectIds})`,
      `DELETE FROM thesis_defense_slots WHERE project_id IN ${projectIds}`,
      `DELETE FROM thesis_committee_members WHERE committee_id IN (SELECT id FROM thesis_committees WHERE term_id IN ${terms})`,
      `DELETE FROM thesis_committees WHERE term_id IN ${terms}`,
      `DELETE FROM thesis_reviews WHERE project_id IN ${projectIds}`,
      `DELETE FROM thesis_supervision_logs WHERE project_id IN ${projectIds}`,
      `DELETE FROM thesis_submissions WHERE project_id IN ${projectIds}`,
      `DELETE FROM thesis_project_events WHERE project_id IN ${projectIds}`,
      `DELETE FROM thesis_projects WHERE term_id IN ${terms}`,
      `DELETE FROM thesis_registrations WHERE group_id IN (SELECT id FROM thesis_groups WHERE term_id IN ${terms})`,
      `DELETE FROM thesis_group_members WHERE term_id IN ${terms}`,
      `DELETE FROM thesis_groups WHERE term_id IN ${terms}`,
      `DELETE FROM thesis_topic_decisions WHERE topic_id IN (SELECT id FROM thesis_topics WHERE term_id IN ${terms})`,
      `DELETE FROM thesis_topics WHERE term_id IN ${terms}`,
      `DELETE FROM thesis_rubric_criteria WHERE term_id IN ${terms}`,
      `DELETE FROM thesis_milestones WHERE term_id IN ${terms}`,
      `DELETE FROM thesis_enrollments WHERE term_id IN ${terms}`,
      `DELETE FROM thesis_term_supervisors WHERE term_id IN ${terms}`,
      `DELETE FROM academic_audit_events WHERE unit_id=$1 OR term_id IN ${terms}`,
      `DELETE FROM thesis_terms WHERE unit_id=$1`,
      `DELETE FROM academic_role_grants WHERE unit_id=$1`,
      `DELETE FROM academic_staff WHERE unit_id=$1`,
      `DELETE FROM academic_departments WHERE unit_id=$1`,
      `DELETE FROM academic_units WHERE id=$1`,
    ])
      await client.query(statement, [unitId]);
    await client.query(`SET session_replication_role = origin`);
    if (workspaces.length) await client.query(`DELETE FROM workspaces WHERE id=ANY($1::uuid[])`, [workspaces]);
    await client.query(`DELETE FROM academic_role_grants WHERE user_id=ANY($1::uuid[])`, [userIds]);
    await client.query(`DELETE FROM academic_notifications WHERE user_id=ANY($1::uuid[])`, [userIds]);
    await client.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [userIds]);
  } finally {
    client.release();
  }
}

test("Thesis lifecycle: registration → supervision → review → defense → grading → appeal", { skip, timeout: 60000 }, async () => {
  const people = {};
  for (const name of ["root", "office", "head", "L1", "L2", "L3", "L4", "L5", "S1", "S2", "S3", "S4", "S5"]) people[name] = await user(`QA ${name}`);
  const id = (name) => people[name].id;
  let unit, server;
  try {
    // ---- organisation -------------------------------------------------------------------------
    await sql(`INSERT INTO academic_role_grants(id,user_id,role) VALUES($1,$2,'system_admin')`, [randomUUID(), id("root")]);
    await rejects(org.createUnit(id("office"), { code: "QA", name: "Khoa QA" }), "FORBIDDEN");
    unit = await org.createUnit(id("root"), { code: `QA${Date.now() % 100000}`, name: "Khoa Công nghệ thông tin (QA)" });
    await org.grantRole(id("root"), { role: "unit_admin", unitId: unit.id, email: people.office.email });
    await org.grantRole(id("root"), { role: "unit_head", unitId: unit.id, email: people.head.email });
    await org.grantRole(id("root"), { role: "unit_head", unitId: unit.id, email: people.L5.email });
    const ranks = { L1: "ts", L2: "ts", L3: "ths", L4: "pgs", L5: "ts" };
    for (const [name, rank] of Object.entries(ranks))
      await org.upsertStaff(id("office"), unit.id, { email: people[name].email, staffCode: `GV${name}`, rank, defaultQuota: 6 });

    // ---- term configuration ------------------------------------------------------------------
    const termInput = {
      code: "DATN-2026",
      name: "Đồ án tốt nghiệp 2026",
      registrationOpensAt: hours(-1).toISOString(),
      registrationClosesAt: hours(24).toISOString(),
      finalDueAt: hours(48).toISOString(),
      defenseStartsOn: day(3),
      defenseEndsOn: day(6),
      minGroupSize: 1,
      maxGroupSize: 2,
      minSupervisionLogs: 2,
      minGpa: 2.0,
      minCredits: 120,
    };
    await assert.rejects(terms.createTerm(id("office"), unit.id, { ...termInput, weights: { supervisor: 30, reviewer: 30, committee: 30 } }), /100/);
    let term = await terms.createTerm(id("office"), unit.id, termInput);
    await rejects(terms.advanceTerm(id("office"), term.id, { version: term.version }), "PHASE_BLOCKED");
    for (const graderRole of ["supervisor", "reviewer", "committee"])
      await terms.setRubric(id("office"), term.id, { graderRole, criteria: [{ code: "ND", name: "Nội dung", weight: 60 }, { code: "TB", name: "Trình bày", weight: 40 }] });
    await assert.rejects(terms.setRubric(id("office"), term.id, { graderRole: "committee", criteria: [{ code: "ND", name: "Nội dung", weight: 70 }] }), /100/);
    const proposal = await terms.createMilestone(id("office"), term.id, { code: "DC", name: "Đề cương", kind: "proposal", dueAt: hours(20).toISOString() });
    const final = await terms.createMilestone(id("office"), term.id, { code: "BC", name: "Báo cáo cuối", kind: "final", dueAt: termInput.finalDueAt });
    await rejects(terms.createMilestone(id("office"), term.id, { code: "BC2", name: "Báo cáo 2", kind: "final", dueAt: termInput.finalDueAt }), "DUPLICATE_MILESTONE");

    // Import is all-or-nothing: one bad row means nothing is written.
    const roster = ["S1", "S2", "S3", "S4"].map((name, index) => ({ email: people[name].email, studentCode: `SV00${index + 1}`, credits: 130, gpa: 3.1 }));
    const bad = await terms.importEnrollments(id("office"), term.id, { students: [...roster, { email: people.S5.email, studentCode: "SV001", credits: 10, gpa: 1 }] }).catch((e) => e);
    assert.equal(bad.code, "IMPORT_ERRORS");
    assert.equal(bad.details[0].row, 5);
    assert.equal((await sql(`SELECT count(*)::int AS n FROM thesis_enrollments WHERE term_id=$1`, [term.id])).rows[0].n, 0);
    assert.deepEqual(await terms.importEnrollments(id("office"), term.id, { students: [...roster, { email: people.S5.email, studentCode: "SV005", credits: 100, gpa: 3.5 }] }), { created: 5, updated: 0 });
    assert.equal((await sql(`SELECT eligible FROM thesis_enrollments WHERE term_id=$1 AND student_id=$2`, [term.id, id("S5")])).rows[0].eligible, false, "credits below the minimum");

    term = (await terms.advanceTerm(id("office"), term.id, { version: term.version })).term;
    assert.equal(term.status, "registration");
    await rejects(terms.updateTerm(id("office"), term.id, { version: term.version, minGpa: 1 }), "POLICY_FROZEN");
    await dbRejects(sql(`UPDATE thesis_terms SET status='review' WHERE id=$1`, [term.id]), /Illegal term transition/);

    // ---- topics -------------------------------------------------------------------------------
    const summary = "Xây dựng nền tảng hỗ trợ quản lý đồ án tốt nghiệp với đầy đủ quy trình đăng ký, hướng dẫn và chấm điểm.";
    let topicA = await topics.createTopic(id("L1"), term.id, { title: "Nền tảng quản lý đồ án tốt nghiệp trực tuyến", summary, maxStudents: 2 });
    let topicB = await topics.createTopic(id("L4"), term.id, { title: "Ứng dụng học sâu nhận diện khuôn mặt điểm danh", summary: summary.replace("đồ án", "điểm danh"), maxStudents: 2 });
    let topicC = await topics.createTopic(id("L5"), term.id, { title: "Hệ thống gợi ý tài liệu học tập cá nhân hóa", summary: summary.replace("đồ án", "tài liệu"), maxStudents: 1 });
    await assert.rejects(topics.createTopic(id("L1"), term.id, { title: "Đề tài ba người", summary, maxStudents: 3 }), /1–2/);
    for (const [topic, owner] of [[topicA, "L1"], [topicB, "L4"], [topicC, "L5"]]) {
      const submitted = await topics.decideTopic(id(owner), topic.id, { decision: "submit", version: topic.version });
      assert.equal(submitted.status, "submitted");
    }
    topicC = await topics.getTopic(id("L5"), topicC.id);
    await rejects(topics.decideTopic(id("L5"), topicC.id, { decision: "approve", version: topicC.version }), "FORBIDDEN"); // head cannot approve own topic
    await rejects(topics.decideTopic(id("L1"), topicA.id, { decision: "approve", version: 2 }), "FORBIDDEN"); // lecturers do not approve
    topicA = await topics.decideTopic(id("head"), topicA.id, { decision: "approve", version: 2 });
    topicB = await topics.decideTopic(id("head"), topicB.id, { decision: "request_revision", version: 2, note: "Làm rõ phạm vi dữ liệu" });
    assert.equal(topicB.status, "revision_requested");
    topicB = await topics.updateTopic(id("L4"), topicB.id, { version: topicB.version, requirements: "Dữ liệu ảnh do trường cung cấp" });
    topicB = await topics.decideTopic(id("L4"), topicB.id, { decision: "submit", version: topicB.version });
    topicB = await topics.decideTopic(id("head"), topicB.id, { decision: "approve", version: topicB.version });
    topicC = await topics.decideTopic(id("head"), topicC.id, { decision: "approve", version: topicC.version });
    assert.deepEqual(topicB.history.map((h) => h.decision), ["submit", "request_revision", "submit", "approve"]);
    await dbRejects(sql(`DELETE FROM thesis_topic_decisions WHERE topic_id=$1`, [topicB.id]), /append-only/);
    // Students see only approved topics.
    const visible = await topics.listTopics(id("S1"), term.id, new URLSearchParams());
    assert.deepEqual(visible.topics.map((t) => t.status), ["approved", "approved", "approved"]);

    // ---- groups and preferences -----------------------------------------------------------------
    await rejects(groups.createGroup(id("S5"), term.id), "FORBIDDEN"); // ineligible
    let g1 = await groups.createGroup(id("S1"), term.id);
    await rejects(groups.createGroup(id("S1"), term.id), "ALREADY_IN_GROUP");
    g1 = await groups.inviteMember(id("S1"), g1.id, { version: g1.version, studentCode: "SV002" });
    await rejects(groups.inviteMember(id("S1"), g1.id, { version: g1.version, studentCode: "SV003" }), "GROUP_FULL");
    await rejects(groups.setPreferences(id("S1"), g1.id, { version: g1.version, topicIds: [topicA.id] }), "PENDING_INVITES");
    g1 = await groups.respondInvitation(id("S2"), g1.id, { response: "accept" });
    assert.equal(g1.members.filter((m) => m.status === "active").length, 2);
    await rejects(groups.setPreferences(id("S1"), g1.id, { version: g1.version, topicIds: [topicC.id] }), "TOPIC_FULL"); // capacity 1 < group of 2
    g1 = await groups.setPreferences(id("S1"), g1.id, { version: g1.version, topicIds: [topicA.id, topicB.id] });
    await rejects(groups.leaveGroup(id("S2"), g1.id, {}), "GROUP_LOCKED");
    let g2 = await groups.createGroup(id("S3"), term.id);
    g2 = await groups.setPreferences(id("S3"), g2.id, { version: g2.version, topicIds: [topicC.id, topicA.id] });
    const g3 = await groups.createGroup(id("S4"), term.id);
    await groups.setPreferences(id("S4"), g3.id, { version: g3.version, topicIds: [topicA.id] });

    // Two supervisors accept the same group at the same moment: exactly one wins.
    const pendingA = (await groups.pendingRegistrations(id("L1"), term.id)).registrations.find((r) => r.groupId === g1.id);
    const pendingB = (await groups.pendingRegistrations(id("L4"), term.id)).registrations.find((r) => r.groupId === g1.id);
    const race = await Promise.allSettled([
      groups.decideRegistration(id("L1"), pendingA.id, { decision: "accept" }),
      groups.decideRegistration(id("L4"), pendingB.id, { decision: "accept" }),
    ]);
    assert.equal(race.filter((r) => r.status === "fulfilled").length, 1, JSON.stringify(race.map((r) => r.reason?.code)));
    assert.equal(race.find((r) => r.status === "rejected").reason.code, "ALREADY_DECIDED");
    const winner = race[0].status === "fulfilled" ? "L1" : "L4";
    const p1Id = race.find((r) => r.status === "fulfilled").value.projectId;
    // Quota: L5 may supervise nobody this term.
    await terms.setSupervisorQuota(id("office"), term.id, { lecturerId: id("L5"), quota: 0 });
    const pendingC = (await groups.pendingRegistrations(id("L5"), term.id)).registrations[0];
    await rejects(groups.decideRegistration(id("L5"), pendingC.id, { decision: "accept" }), "QUOTA_EXCEEDED");
    await rejects(groups.decideRegistration(id("L5"), pendingC.id, { decision: "reject" }), "INVALID_INPUT");
    await groups.decideRegistration(id("L5"), pendingC.id, { decision: "reject", note: "Hết định mức hướng dẫn" });
    if (winner === "L1") {
      // Topic A is full after a two-student group; a further acceptance must be refused.
      const pendingA2 = (await groups.pendingRegistrations(id("L1"), term.id)).registrations.find((r) => r.groupId === g2.id);
      await rejects(groups.decideRegistration(id("L1"), pendingA2.id, { decision: "accept" }), "TOPIC_FULL");
    }

    let project = await projects.getProject(id("S1"), p1Id);
    const supervisor = winner;
    const other = winner === "L1" ? "L4" : "L1";
    assert.equal(project.status, "proposal");
    assert.equal(project.supervisorId, id(supervisor));
    const workspaceMembers = (await sql(`SELECT user_id,role FROM memberships WHERE workspace_id=$1`, [project.workspaceId])).rows;
    assert.deepEqual(new Set(workspaceMembers.map((m) => m.user_id)), new Set([id(supervisor), id("S1"), id("S2")]));
    await rejects(projects.getProject(id("S3"), p1Id), "NOT_FOUND");
    await dbRejects(sql(`UPDATE thesis_projects SET status='completed' WHERE id=$1`, [p1Id]), /Illegal project transition/);
    await dbRejects(sql(`INSERT INTO thesis_projects(id,term_id,code,group_id,topic_id,supervisor_id,student_count,status) SELECT $1,term_id,'X',group_id,topic_id,supervisor_id,1,'graded' FROM thesis_projects WHERE id=$2`, [randomUUID(), p1Id]), /proposal state/);

    // ---- registration closes ---------------------------------------------------------------------
    await sql(`UPDATE thesis_terms SET registration_closes_at=now()-interval '1 second' WHERE id=$1`, [term.id]);
    await rejects(groups.createGroup(id("S5"), term.id), "REGISTRATION_CLOSED");
    term = (await terms.advanceTerm(id("office"), term.id, { version: (await terms.getTerm(id("office"), term.id)).version })).term;
    assert.equal(term.status, "execution");
    assert.equal((await sql(`SELECT status FROM thesis_groups WHERE id=$1`, [g3.id])).rows[0].status, "dissolved");
    assert.equal((await sql(`SELECT count(*)::int AS n FROM thesis_registrations WHERE group_id=$1 AND status='expired'`, [g3.id])).rows[0].n, 1);

    // ---- proposal, logs, final report ------------------------------------------------------------------
    const channel = (await sql(`SELECT id FROM channels WHERE workspace_id=$1 AND name='tai-lieu'`, [project.workspaceId])).rows[0].id;
    const pdf = (text) => Buffer.from(`%PDF-1.4\n${text}\n%%EOF`);
    const proposalFile = await uploadFile(id("S1"), channel, "de-cuong.pdf", "application/pdf", pdf("de cuong v1"));
    await rejects(projects.submit(id(supervisor), p1Id, { milestoneId: proposal.id, attachmentId: proposalFile.id }), "FORBIDDEN");
    await rejects(projects.submit(id("S1"), p1Id, { milestoneId: final.id, attachmentId: proposalFile.id }), "WRONG_STAGE");
    const v1 = await projects.submit(id("S1"), p1Id, { milestoneId: proposal.id, attachmentId: proposalFile.id });
    assert.equal(v1.versionNo, 1);
    await dbRejects(sql(`UPDATE thesis_submissions SET sha256=repeat('0',64) WHERE id=$1`, [v1.id]), /immutable/);
    await dbRejects(sql(`DELETE FROM thesis_submissions WHERE id=$1`, [v1.id]), /cannot be deleted/);
    await rejects(projects.reviewSubmission(id(supervisor), v1.id, { decision: "revision_requested", feedback: "ngắn" }), "INVALID_INPUT");
    await projects.reviewSubmission(id(supervisor), v1.id, { decision: "revision_requested", feedback: "Bổ sung phần khảo sát hiện trạng và mục tiêu." });
    const proposalFile2 = await uploadFile(id("S2"), channel, "de-cuong-v2.pdf", "application/pdf", pdf("de cuong v2"));
    const v2 = await projects.submit(id("S2"), p1Id, { milestoneId: proposal.id, attachmentId: proposalFile2.id });
    assert.equal(v2.versionNo, 2);
    assert.equal((await projects.verifySubmission(id("S1"), v2.id)).intact, true);
    await projects.reviewSubmission(id(supervisor), v2.id, { decision: "accepted", feedback: "" });
    project = await projects.getProject(id("S1"), p1Id);
    assert.equal(project.status, "in_progress");

    const finalFile = await uploadFile(id("S1"), channel, "bao-cao.pdf", "application/pdf", pdf("bao cao cuoi"));
    await projects.submit(id("S1"), p1Id, { milestoneId: final.id, attachmentId: finalFile.id, note: "Bản hoàn chỉnh" });
    project = await projects.getProject(id(supervisor), p1Id);
    assert.equal(project.status, "final_submitted");
    const blocked = await projects.approveDefense(id(supervisor), p1Id, { version: (await sql(`SELECT version FROM thesis_projects WHERE id=$1`, [p1Id])).rows[0].version }).catch((e) => e);
    assert.equal(blocked.code, "DEFENSE_BLOCKED");
    assert.match(blocked.blockers[0], /0\/2/);

    const log1 = await projects.createLog(id("S1"), p1Id, { heldAt: hours(-48).toISOString(), mode: "offline", content: "Thống nhất phạm vi đề tài và kế hoạch triển khai từng tuần." });
    await rejects(projects.createLog(id("S1"), p1Id, { heldAt: hours(5).toISOString(), mode: "offline", content: "Buổi gặp chưa diễn ra nhưng đã ghi trước." }), "INVALID_INPUT");
    await rejects(projects.confirmLog(id("S2"), log1.id, { version: 1 }), "ALREADY_CONFIRMED"); // a student already confirmed by authoring
    await projects.confirmLog(id(supervisor), log1.id, { version: 1 });
    await dbRejects(sql(`UPDATE thesis_supervision_logs SET content='Sửa nội dung sau khi đã xác nhận đủ hai bên' WHERE id=$1`, [log1.id]), /locked/);
    const log2 = await projects.createLog(id(supervisor), p1Id, { heldAt: hours(-24).toISOString(), mode: "online", content: "Rà soát chương 3, góp ý thiết kế cơ sở dữ liệu và kiểm thử." });
    await projects.confirmLog(id("S2"), log2.id, { version: 1 });
    const approved = await projects.approveDefense(id(supervisor), p1Id, { version: (await sql(`SELECT version FROM thesis_projects WHERE id=$1`, [p1Id])).rows[0].version, note: "Đủ điều kiện bảo vệ" });
    assert.equal(approved.status, "defense_approved");

    // ---- review --------------------------------------------------------------------------------------
    const ver = async () => (await sql(`SELECT version FROM thesis_projects WHERE id=$1`, [p1Id])).rows[0].version;
    const crit = async (role) => (await sql(`SELECT id,code FROM thesis_rubric_criteria WHERE term_id=$1 AND grader_role=$2 ORDER BY code`, [term.id, role])).rows;
    const scores = async (role, nd, tb) => Object.fromEntries((await crit(role)).map((c) => [c.id, c.code === "ND" ? nd : tb]));
    await evaluation.saveScoreSheet(id(supervisor), p1Id, { graderRole: "supervisor", scores: await scores("supervisor", 8.5, 8), submit: true });
    await rejects(evaluation.saveScoreSheet(id(supervisor), p1Id, { graderRole: "supervisor", scores: await scores("supervisor", 9, 9), submit: true, version: 1 }), "SHEET_SUBMITTED");
    await rejects(evaluation.assignReviewer(id("office"), p1Id, { version: await ver(), reviewerId: id("L2"), dueAt: hours(30).toISOString() }), "FORBIDDEN");
    await rejects(evaluation.assignReviewer(id("head"), p1Id, { version: await ver(), reviewerId: id(supervisor), dueAt: hours(30).toISOString() }), "CONFLICT_OF_INTEREST");
    if (supervisor === "L1") {
      // A head who supervises the project cannot pick its reviewer.
      await org.grantRole(id("root"), { role: "unit_head", unitId: unit.id, email: people.L1.email });
      await rejects(evaluation.assignReviewer(id("L1"), p1Id, { version: await ver(), reviewerId: id("L2"), dueAt: hours(30).toISOString() }), "FORBIDDEN");
      await org.grantRole(id("root"), { role: "unit_head", unitId: unit.id, email: people.L1.email, revoke: true });
    }
    await evaluation.assignReviewer(id("head"), p1Id, { version: await ver(), reviewerId: id("L2"), dueAt: hours(30).toISOString() });
    const reviewText = "Đồ án có phạm vi rõ ràng, thiết kế cơ sở dữ liệu chặt chẽ, kiểm thử đầy đủ; cần bổ sung đánh giá hiệu năng.";
    await rejects(evaluation.submitReview(id("L2"), p1Id, { recommendation: "approve", comments: reviewText }), "SCORE_REQUIRED");
    await evaluation.saveScoreSheet(id("L2"), p1Id, { graderRole: "reviewer", scores: await scores("reviewer", 7.5, 7), submit: true });
    await evaluation.submitReview(id("L2"), p1Id, { recommendation: "approve", comments: reviewText, questions: "Hệ thống chịu tải bao nhiêu người dùng đồng thời?" });
    await dbRejects(sql(`UPDATE thesis_reviews SET recommendation='reject' WHERE project_id=$1`, [p1Id]), /final/);

    // Second project, driven straight through the state machine for scheduling-conflict checks.
    const p2Id = randomUUID();
    await sql(`INSERT INTO thesis_projects(id,term_id,code,group_id,topic_id,supervisor_id,student_count) VALUES($1,$2,'QA-002',$3,$4,$5,1)`, [p2Id, term.id, g2.id, topicC.id, id("L5")]);
    for (const status of ["in_progress", "final_submitted", "defense_approved", "under_review", "review_passed"])
      await sql(`UPDATE thesis_projects SET status=$2 WHERE id=$1`, [p2Id, status]);

    // ---- committees and schedule ---------------------------------------------------------------------
    await sql(`UPDATE thesis_terms SET registration_opens_at=now()-interval '5 days',registration_closes_at=now()-interval '4 days',final_due_at=now()-interval '3 days',defense_starts_on=current_date-1,defense_ends_on=current_date+3 WHERE id=$1`, [term.id]);
    term = (await terms.advanceTerm(id("office"), term.id, { version: (await terms.getTerm(id("office"), term.id)).version })).term;
    assert.equal(term.status, "review");
    const c1 = await evaluation.createCommittee(id("office"), term.id, { code: "HD1", name: "Hội đồng 1", room: "B1-201" });
    await rejects(evaluation.setCommitteeMember(id("office"), c1.id, { lecturerId: id("L3"), role: "chair" }), "RULE_VIOLATION"); // chair needs a doctorate
    const chair = other === "L4" ? "L4" : "L1"; // a doctorate holder who does not supervise p1
    for (const [name, role] of [[chair, "chair"], ["L5", "secretary"], ["L2", "member"], ["L3", "member"]])
      await evaluation.setCommitteeMember(id("office"), c1.id, { lecturerId: id(name), role });
    await rejects(evaluation.setCommitteeMember(id("office"), c1.id, { lecturerId: id("L2"), role: "chair" }), "ROLE_TAKEN");
    const committee1 = (await evaluation.listCommittees(id("office"), term.id)).committees[0];
    await evaluation.confirmCommittee(id("office"), c1.id, { version: committee1.version });
    await rejects(evaluation.setCommitteeMember(id("office"), c1.id, { lecturerId: id("L3"), role: "member", remove: true }), "COMMITTEE_CONFIRMED");
    const c2 = await evaluation.createCommittee(id("office"), term.id, { code: "HD2", name: "Hội đồng 2", room: "B1-202" });
    for (const [name, role] of [[supervisor, "chair"], ["L3", "secretary"], ["L2", "member"]])
      await evaluation.setCommitteeMember(id("office"), c2.id, { lecturerId: id(name), role });
    await evaluation.confirmCommittee(id("office"), c2.id, { version: (await sql(`SELECT version FROM thesis_committees WHERE id=$1`, [c2.id])).rows[0].version });

    const start = new Date(Math.floor(Date.now() / 60000) * 60000 - 30 * 60000);
    const session = (committeeId) => ({ committeeId, startsAt: start.toISOString(), endsAt: new Date(+start + 3 * 3600_000).toISOString() });
    const preview = await evaluation.autoSchedule(id("office"), term.id, { slotMinutes: 45, sessions: [session(c1.id), session(c2.id)] });
    assert.equal(preview.applied, false);
    assert.equal(preview.scheduled.find((s) => s.projectId === p1Id).committeeId, c1.id, "p1's supervisor sits on HD2");
    await rejects(evaluation.scheduleDefense(id("office"), p1Id, { committeeId: c2.id, startsAt: start.toISOString(), endsAt: new Date(+start + 45 * 60000).toISOString() }), "RULE_VIOLATION");
    await evaluation.scheduleDefense(id("office"), p1Id, { committeeId: c1.id, startsAt: start.toISOString(), endsAt: new Date(+start + 45 * 60000).toISOString() });
    // Same committee, overlapping time.
    await rejects(evaluation.scheduleDefense(id("office"), p2Id, { committeeId: c1.id, startsAt: new Date(+start + 30 * 60000).toISOString(), endsAt: new Date(+start + 75 * 60000).toISOString() }), "SCHEDULE_CONFLICT");
    // Different committee, but L2 sits on both: the lecturer booking constraint fires (L5 supervises p2, HD2 excludes nobody).
    await rejects(evaluation.scheduleDefense(id("office"), p2Id, { committeeId: c2.id, startsAt: start.toISOString(), endsAt: new Date(+start + 45 * 60000).toISOString() }), "SCHEDULE_CONFLICT");
    const applied = await evaluation.autoSchedule(id("office"), term.id, { slotMinutes: 45, sessions: [session(c1.id), session(c2.id)], apply: true });
    assert.equal(applied.scheduled.length, 1);
    assert.ok(+new Date(applied.scheduled[0].start) >= +start + 45 * 60000, "the scheduler avoids existing bookings");

    // ---- defense and grading ----------------------------------------------------------------------------
    await rejects(evaluation.markDefended(id("L5"), p1Id, { version: await ver() }), "TERM_PHASE");
    term = (await terms.advanceTerm(id("office"), term.id, { version: (await terms.getTerm(id("office"), term.id)).version })).term;
    assert.equal(term.status, "defense");
    await rejects(evaluation.saveScoreSheet(id("L3"), p1Id, { graderRole: "committee", scores: await scores("committee", 8, 8) }), "WRONG_STAGE");
    await rejects(evaluation.markDefended(id("L3"), p1Id, { version: await ver() }), "FORBIDDEN");
    await evaluation.markDefended(id("L5"), p1Id, { version: await ver() });
    const committeeScores = { [chair]: [9, 9], L5: [8.5, 8.5], L2: [8, 8], L3: [6.5, 6.5] };
    for (const [name, [nd, tb]] of Object.entries(committeeScores)) {
      const draft = await evaluation.saveScoreSheet(id(name), p1Id, { graderRole: "committee", scores: await scores("committee", nd, tb) });
      assert.equal(draft.submitted, false);
      if (name !== "L3") await evaluation.saveScoreSheet(id(name), p1Id, { graderRole: "committee", scores: await scores("committee", nd, tb), submit: true, version: 1 });
    }
    const incomplete = await evaluation.finalizeGrades(id("L5"), p1Id, { version: await ver() }).catch((e) => e);
    assert.equal(incomplete.code, "GRADING_INCOMPLETE");
    await evaluation.saveScoreSheet(id("L3"), p1Id, { graderRole: "committee", scores: await scores("committee", 6.5, 6.5), submit: true, version: 1 });
    await rejects(evaluation.finalizeGrades(id("L5"), p1Id, { version: await ver() }), "DEVIATION_REVIEW"); // spread 2.5 > 2
    await rejects(evaluation.finalizeGrades(id(chair), p1Id, { version: await ver(), deviationNote: "ngắn" }), "INVALID_INPUT");
    // MT-3 committee room: members see the defenses with their stage; others are kept out.
    const room = await evaluation.committeeRoom(id(chair), c1.id);
    assert.equal(room.myRole, "chair");
    const p1Slot = room.slots.find((slot) => slot.projectId === p1Id);
    assert.equal(p1Slot.status, "defended");
    assert.equal(p1Slot.result, null);
    assert.equal(p1Slot.version, await ver());
    await rejects(evaluation.committeeRoom(id("S1"), c1.id), "FORBIDDEN");
    assert.deepEqual((await evaluation.myCommittees(id("L3"))).map((c) => c.code), ["HD1", "HD2"]);
    const result = await evaluation.finalizeGrades(id(chair), p1Id, {
      version: await ver(),
      deviationNote: "Thành viên L3 đánh giá thấp phần trình bày; hội đồng thống nhất giữ trung bình.",
      conclusion: "Đồ án đạt yêu cầu, đề nghị bổ sung phần đánh giá hiệu năng.",
    });
    const concluded = (await evaluation.committeeRoom(id("L2"), c1.id)).slots.find((slot) => slot.projectId === p1Id);
    assert.equal(concluded.result.conclusion, "Đồ án đạt yêu cầu, đề nghị bổ sung phần đánh giá hiệu năng.");
    assert.equal(concluded.result.letter, "B");
    // supervisor 8.3, reviewer 7.3, committee mean 8.0 → 0.2·8.3 + 0.2·7.3 + 0.6·8 = 7.92 → 7.9
    assert.equal(result.finalScore, 7.9);
    assert.equal(result.letter, "B");
    assert.equal(result.passed, true);
    await dbRejects(sql(`UPDATE thesis_score_items SET score=10 WHERE sheet_id IN (SELECT id FROM thesis_score_sheets WHERE project_id=$1)`, [p1Id]), /locked/);
    await dbRejects(sql(`UPDATE thesis_results SET final_score=10 WHERE project_id=$1`, [p1Id]), /appeal/);
    // Students cannot see unpublished results.
    assert.equal((await projects.getProject(id("S1"), p1Id)).result, null);
    assert.equal((await evaluation.verifyLedger(id("head"), term.id)).intact, true);

    // ---- publication, appeal, closing ---------------------------------------------------------------------
    // p2 was placed by the scheduler but never defended: the phase cannot close until the office cancels it.
    assert.equal((await terms.advanceTerm(id("office"), term.id, { version: (await terms.getTerm(id("office"), term.id)).version }).catch((e) => e)).code, "PHASE_BLOCKED");
    await evaluation.unscheduleDefense(id("office"), p2Id);
    term = (await terms.advanceTerm(id("office"), term.id, { version: (await terms.getTerm(id("office"), term.id)).version })).term;
    assert.equal(term.status, "grading");
    await rejects(evaluation.fileAppeal(id("S1"), p1Id, { reason: "Em đề nghị phúc khảo phần điểm trình bày của hội đồng." }), "NOT_PUBLISHED");
    assert.deepEqual(await evaluation.publishGrades(id("office"), term.id, { version: term.version }), { completed: 1, failed: 0 });
    project = await projects.getProject(id("S1"), p1Id);
    assert.equal(project.status, "completed");
    assert.equal(project.result.finalScore, 7.9);
    await evaluation.fileAppeal(id("S2"), p1Id, { reason: "Nhóm đề nghị phúc khảo vì điểm trình bày lệch nhiều giữa các thành viên." });
    await rejects(evaluation.fileAppeal(id("S1"), p1Id, { reason: "Nộp lần thứ hai cho cùng một đồ án để kiểm tra ràng buộc." }), "APPEAL_EXISTS");
    await rejects(evaluation.decideAppeal(id("L5"), p1Id, { decision: "upheld", note: "Thư ký hội đồng không được tự xử lý phúc khảo." }), "FORBIDDEN");
    await evaluation.decideAppeal(id("head"), p1Id, { decision: "adjusted", newScore: 8.2, note: "Hội đồng phúc khảo thống nhất nâng điểm trình bày theo biên bản." });
    project = await projects.getProject(id("S1"), p1Id);
    assert.equal(project.result.finalScore, 8.2);
    assert.equal(project.result.adjustedByAppeal, true);
    let ledger = await evaluation.verifyLedger(id("head"), term.id);
    assert.deepEqual([ledger.entries, ledger.intact], [2, true]);

    // Tampering directly in the database (bypassing triggers as a superuser would) is detected.
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = replica`);
      await client.query(`UPDATE thesis_results SET final_score=9.5 WHERE project_id=$1`, [p1Id]);
      ledger = await evaluation.verifyLedger(id("head"), term.id);
      assert.equal(ledger.chainIntact, true);
      assert.deepEqual(ledger.mismatches.map((m) => [m.stored, m.ledger]), [[9.5, 8.2]]);
      await client.query(`UPDATE thesis_grade_ledger SET payload=replace(payload,'8.2','9.5') WHERE project_id=$1 AND event='appeal_adjusted'`, [p1Id]);
      ledger = await evaluation.verifyLedger(id("head"), term.id);
      assert.equal(ledger.brokenAt.reason, "hash_mismatch");
      await client.query(`UPDATE thesis_grade_ledger SET payload=replace(payload,'9.5','8.2') WHERE project_id=$1 AND event='appeal_adjusted'`, [p1Id]);
      await client.query(`UPDATE thesis_results SET final_score=8.2 WHERE project_id=$1`, [p1Id]);
    } finally {
      await client.query(`SET session_replication_role = origin`);
      client.release();
    }
    assert.equal((await evaluation.verifyLedger(id("head"), term.id)).intact, true);

    const closing = await terms.advanceTerm(id("office"), term.id, { version: (await terms.getTerm(id("office"), term.id)).version }).catch((e) => e);
    assert.equal(closing.code, "PHASE_BLOCKED");
    assert.ok(closing.blockers.some((b) => /1 đồ án/.test(b)));
    await projects.officeAction(id("office"), p2Id, { version: (await sql(`SELECT version FROM thesis_projects WHERE id=$1`, [p2Id])).rows[0].version, action: "suspend", reason: "Sinh viên vi phạm quy chế, đình chỉ theo quyết định của khoa." });
    await sql(`UPDATE thesis_terms SET grades_published_at=now()-interval '8 days' WHERE id=$1`, [term.id]);
    await sql(`UPDATE thesis_results SET published_at=now()-interval '8 days' WHERE project_id=$1`, [p1Id]);
    term = (await terms.advanceTerm(id("office"), term.id, { version: (await terms.getTerm(id("office"), term.id)).version })).term;
    assert.equal(term.status, "closed");
    await dbRejects(sql(`UPDATE thesis_terms SET name='Đổi tên sau khi đóng' WHERE id=$1`, [term.id]), /read-only/);

    // ---- HTTP surface ---------------------------------------------------------------------------------------
    server = createApiServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (who, path, init = {}) =>
      fetch(base + path, { ...init, headers: { authorization: `Bearer ${await createAccessToken(id(who))}`, "content-type": "application/json", ...(init.headers ?? {}) } });
    const me = await (await call("office", "/api/academic/me")).json();
    assert.deepEqual(me.unitRoles[unit.id], ["unit_admin"]);
    assert.equal((await call("S1", `/api/academic/terms/${term.id}/dashboard`)).status, 403);
    const blockedHttp = await call("office", `/api/academic/terms/${term.id}/advance`, { method: "POST", body: JSON.stringify({ version: term.version }) });
    assert.equal(blockedHttp.status, 409);
    const csv = await call("office", `/api/academic/terms/${term.id}/export/grades.csv`);
    assert.equal(csv.status, 200);
    const csvText = await csv.text();
    assert.match(csvText, /SV001/);
    assert.match(csvText, /8\.2/);
    const notifications = await (await call("S1", "/api/academic/notifications")).json();
    assert.ok(notifications.unread > 0);
    assert.equal((await call("S1", `/api/academic/projects/${p1Id}`, { method: "PUT" })).status, 405);
    // The reviewer is not a workspace member, yet may read the submitted report through the project.
    const finalSubmission = (await sql(`SELECT s.id,s.sha256,s.attachment_id FROM thesis_submissions s JOIN thesis_milestones m ON m.id=s.milestone_id WHERE s.project_id=$1 AND m.kind='final'`, [p1Id])).rows[0];
    assert.equal((await call("L2", `/api/attachments/${finalSubmission.attachment_id}`)).status, 404);
    const report = await call("L2", `/api/academic/submissions/${finalSubmission.id}/file`);
    assert.equal(report.status, 200);
    assert.equal(report.headers.get("x-content-sha256"), finalSubmission.sha256);
    assert.match(Buffer.from(await report.arrayBuffer()).toString(), /bao cao cuoi/);
    assert.equal((await call("S3", `/api/academic/submissions/${finalSubmission.id}/file`)).status, 404);
  } finally {
    roomManager.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    if (unit) await cleanup(unit.id, Object.values(people).map((p) => p.id));
    else await sql(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [Object.values(people).map((p) => p.id)]);
    await pool.end();
  }
});
