import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { URLSearchParams } from "node:url";
import { needsCoaching, scoreReview } from "../../../dist/api/modules/callcenter/domain/qa.js";

const sheet = [
  { id: "greet", label: "Chào hỏi đúng mẫu", weight: 1 },
  { id: "solve", label: "Giải quyết đúng nghiệp vụ", weight: 3 },
];

test("QA review is weighted, complete and bounded", () => {
  assert.deepEqual(scoreReview(sheet, { greet: 10, solve: 10 }).percent, 100);
  assert.equal(scoreReview(sheet, { greet: 10, solve: 0 }).percent, 25);
  assert.equal(scoreReview(sheet, { greet: 5, solve: 5 }).percent, 50);
  assert.equal(typeof scoreReview(sheet, { greet: 10 }), "string", "every criterion is scored");
  assert.equal(typeof scoreReview(sheet, { greet: 10, solve: 11 }), "string");
  assert.equal(typeof scoreReview(sheet, { greet: 10, solve: 5, extra: 1 }), "string");
  assert.equal(typeof scoreReview([], {}), "string");
  assert.equal(needsCoaching(60, 70, "course", false), true);
  assert.equal(needsCoaching(60, 70, "course", true), false, "once per review");
  assert.equal(needsCoaching(80, 70, "course", false), false);
  assert.equal(needsCoaching(10, 70, null, false), false);
});

// LT-4 / V7 / E2 against PostgreSQL: training gate on Ready, scorecards, coaching assignment.
test(
  "Call center: required training gates Ready; a low QA score assigns the coaching course",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 30000 },
  async () => {
    process.env.JWT_SECRET ??= "training-qa-test-secret-at-least-32-characters";
    const { pool } = await import("../../../dist/api/infrastructure/database/db.js");
    const { CallCenterRepository } = await import("../../../dist/api/modules/callcenter/repository/callcenter-repository.js");
    const { QaRepository } = await import("../../../dist/api/modules/callcenter/repository/qa-repository.js");
    const { CallCenterAdminService } = await import("../../../dist/api/modules/callcenter/service/admin-service.js");
    const { CallCenterAgentService } = await import("../../../dist/api/modules/callcenter/service/agent-service.js");
    const { CallCenterQaService } = await import("../../../dist/api/modules/callcenter/service/qa-service.js");
    const { ElearningRepository } = await import("../../../dist/api/modules/elearning/repository/elearning-repository.js");

    const [adminId, supervisorId, agentId, outsiderId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const repo = new CallCenterRepository();
    const admin = new CallCenterAdminService(repo, () => null, async () => {}, () => {});
    const requested = [];
    const acd = { requestState: async (userId, state) => void requested.push([userId, state]), agentView: () => null };
    const invites = [];
    const agents = new CallCenterAgentService(repo, admin, () => acd, () => null, "wss://pbx.tdtu.local/ws", (userId, data) => void invites.push([userId, data]));
    const qa = new CallCenterQaService(repo, new QaRepository());
    const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code);
    let departmentId;
    const courseIds = [randomUUID(), randomUUID()];
    try {
      for (const id of [adminId, supervisorId, agentId, outsiderId])
        await pool.query(`INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,'x',$3)`, [id, `${id}@qa.test`, "QA user"]);
      await pool.query(`INSERT INTO academic_role_grants(id,user_id,role) VALUES($1,$2,'system_admin')`, [randomUUID(), adminId]);
      const from = 800000 + Math.floor(Math.random() * 9000) * 10;
      departmentId = (await admin.createDepartment(adminId, { code: `QA${tag}`, name: `Phòng QA ${tag}`, extensionFrom: from, extensionTo: from + 9 })).id;

      // Two published courses with one published document lesson each.
      const lessonIds = [];
      for (const [index, courseId] of courseIds.entries()) {
        await pool.query(`INSERT INTO courses(id,unit_id,owner_id,code,title,status) VALUES($1,$2,$3,$4,$5,'published')`, [
          courseId, departmentId, adminId, `T${index}${tag}`, index ? "Bồi dưỡng kỹ năng" : "Nghiệp vụ bắt buộc",
        ]);
        const chapterId = randomUUID();
        await pool.query(`INSERT INTO course_chapters(id,course_id,title) VALUES($1,$2,'Chương 1')`, [chapterId, courseId]);
        const lessonId = randomUUID();
        await pool.query(`INSERT INTO course_lessons(id,course_id,chapter_id,title,kind,status,body) VALUES($1,$2,$3,'Bài 1','document','published','Nội dung')`, [
          lessonId, courseId, chapterId,
        ]);
        lessonIds.push(lessonId);
      }

      // ---- LT-4 ------------------------------------------------------------------------------------
      await rejects(admin.updateDepartment(adminId, departmentId, { trainingCourseId: randomUUID() }), "INVALID_INPUT");
      await rejects(admin.updateDepartment(supervisorId, departmentId, { trainingCourseId: courseIds[0] }), "FORBIDDEN");
      const updated = await admin.updateDepartment(adminId, departmentId, { trainingCourseId: courseIds[0], coachingCourseId: courseIds[1], qaThreshold: 70 });
      assert.deepEqual([updated.trainingCourseId, updated.coachingCourseId, updated.qaThreshold], [courseIds[0], courseIds[1], 70]);
      await admin.addMember(adminId, departmentId, { email: `${agentId}@qa.test`, role: "agent" });
      await admin.addMember(adminId, departmentId, { email: `${supervisorId}@qa.test`, role: "supervisor" });
      const enrolled = await pool.query(`SELECT source FROM course_enrollments WHERE course_id=$1 AND user_id=$2`, [courseIds[0], agentId]);
      assert.equal(enrolled.rows[0]?.source, "assigned", "a new agent is enrolled in the required course");

      const me = await agents.me(agentId);
      assert.equal(me.training.length, 1);
      assert.equal(me.training[0].percent, 0);
      await rejects(agents.setState(agentId, { state: "ready" }), "TRAINING_REQUIRED");
      await agents.setState(agentId, { state: "not_ready" });
      assert.deepEqual((await agents.me(supervisorId)).training, [], "supervisors are not gated");

      await new ElearningRepository().complete(null, lessonIds[0], agentId);
      assert.deepEqual((await agents.me(agentId)).training, []);
      await agents.setState(agentId, { state: "ready" });
      assert.deepEqual(requested.at(-1), [agentId, "ready"]);

      // ---- V7 / E2 ---------------------------------------------------------------------------------
      await rejects(qa.saveCriteria(agentId, departmentId, { criteria: [{ label: "x" }] }), "FORBIDDEN");
      const criteria = await qa.saveCriteria(supervisorId, departmentId, {
        criteria: [{ label: "Chào hỏi đúng mẫu", weight: 1 }, { label: "Giải quyết đúng nghiệp vụ", weight: 3 }],
      });
      assert.equal(criteria.length, 2);
      assert.deepEqual((await qa.criteria(agentId, departmentId)).map((item) => item.label), criteria.map((item) => item.label));

      const callId = randomUUID();
      await pool.query(
        `INSERT INTO cc_calls(id,linkedid,direction,department_id,caller_number,callee_number,agent_user_id,started_at,answered_at,ended_at,outcome)
         VALUES($1,$2,'inbound',$3,'0901000111','1900',$4,now()-interval '4 minutes',now()-interval '3 minutes',now(),'answered')`,
        [callId, `qa-${callId}`, departmentId, agentId],
      );
      const scores = (greet, solve) => ({ [criteria[0].id]: greet, [criteria[1].id]: solve });
      await rejects(qa.saveReview(agentId, callId, { scores: scores(10, 10) }), "FORBIDDEN");
      await rejects(qa.saveReview(supervisorId, callId, { scores: { [criteria[0].id]: 5 } }), "INVALID_INPUT");
      const low = await qa.saveReview(supervisorId, callId, { scores: scores(8, 4), comment: "Chưa xác minh MSSV." });
      assert.equal(low.percent, 50);
      assert.equal(low.coachingAssigned, true);
      assert.equal(low.items.length, 2);
      assert.ok((await pool.query(`SELECT 1 FROM course_enrollments WHERE course_id=$1 AND user_id=$2`, [courseIds[1], agentId])).rowCount);
      const notices = await pool.query(`SELECT kind FROM academic_notifications WHERE user_id=$1 AND entity_id=$2`, [agentId, courseIds[1]]);
      assert.deepEqual(notices.rows.map((row) => row.kind), ["coaching_assigned"]);

      const rescored = await qa.saveReview(supervisorId, callId, { scores: scores(6, 2) });
      assert.equal(rescored.percent, 30);
      assert.equal((await pool.query(`SELECT 1 FROM academic_notifications WHERE user_id=$1 AND entity_id=$2`, [agentId, courseIds[1]])).rowCount, 1, "re-scoring does not assign again");

      assert.equal((await qa.review(agentId, callId)).percent, 30, "the agent sees their own review");
      await rejects(qa.review(outsiderId, callId), "FORBIDDEN");
      assert.equal((await qa.reviews(agentId, new URLSearchParams())).length, 1);
      assert.equal((await qa.reviews(supervisorId, new URLSearchParams({ departmentId }))).length, 1);
      assert.equal((await qa.reviews(outsiderId, new URLSearchParams())).length, 0);

      // ---- M2: the agent moves an identified caller's call to a private video room ------------------
      await rejects(agents.videoRoom(agentId, callId), "CALLER_UNKNOWN");
      await pool.query(`UPDATE cc_calls SET caller_user_id=$2 WHERE id=$1`, [callId, outsiderId]);
      await rejects(agents.videoRoom(supervisorId, callId), "FORBIDDEN");
      const room = await agents.videoRoom(agentId, callId);
      assert.deepEqual(invites.at(-1), [outsiderId, { workspaceId: room.workspaceId, roomId: room.roomId, from: `Phòng QA ${tag}` }]);
      const members = (await pool.query(`SELECT user_id,role FROM memberships WHERE workspace_id=$1`, [room.workspaceId])).rows;
      assert.deepEqual(members.map((row) => row.role).sort(), ["member", "owner"]);
      assert.deepEqual((await agents.videoRoom(agentId, callId)).workspaceId, room.workspaceId, "invited again: same room");
    } finally {
      await pool.query(`DELETE FROM academic_notifications WHERE entity_id=ANY($1::uuid[])`, [courseIds]);
      if (departmentId) {
        await pool.query(`DELETE FROM cc_calls WHERE department_id=$1`, [departmentId]);
        await pool.query(`DELETE FROM cc_departments WHERE unit_id=$1`, [departmentId]);
      }
      await pool.query(`DELETE FROM courses WHERE id=ANY($1::uuid[])`, [courseIds]);
      await pool.query(`DELETE FROM workspaces WHERE owner_id=ANY($1::uuid[])`, [[adminId, supervisorId, agentId, outsiderId]]);
      if (departmentId) await pool.query(`DELETE FROM academic_units WHERE id=$1`, [departmentId]);
      await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[adminId, supervisorId, agentId, outsiderId]]);
      await pool.end();
    }
  },
);
