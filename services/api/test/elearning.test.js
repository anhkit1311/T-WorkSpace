import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { test } from "node:test";
process.env.JWT_SECRET ??= "elearning-test-secret-at-least-32-characters";
const skip = process.env.RUN_DB_TESTS !== "1";

const rejects = (promise, code) =>
  assert.rejects(promise, (error) => error.code === code || assert.fail(`expected ${code}, got ${error.code}: ${error.message}`));

test("E-learning: course → enrollment → document, quiz, live class with replay → progress → support", { skip, timeout: 60000 }, async () => {
  const { pool } = await import("../../../dist/api/infrastructure/database/db.js");
  const { ElearningRepository } = await import("../../../dist/api/modules/elearning/repository/elearning-repository.js");
  const { CourseService } = await import("../../../dist/api/modules/elearning/service/course-service.js");
  const { LearningService } = await import("../../../dist/api/modules/elearning/service/learning-service.js");
  const { LiveClassService } = await import("../../../dist/api/modules/elearning/service/live-service.js");
  const { createWorkspace, addWorkspaceMember, getWorkspaceChannels } = await import("../../../dist/api/modules/workspaces/service.js");
  const sql = (text, values = []) => pool.query(text, values);
  const repo = new ElearningRepository();
  const courses = new CourseService(repo);
  const learning = new LearningService(repo, courses);
  const live = new LiveClassService(repo, courses, () => {});

  const people = {};
  for (const name of ["lecturer", "student", "other", "outsider"]) {
    const userId = randomUUID();
    people[name] = { id: userId, email: `el-${userId}@example.test` };
    await sql(`INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only',$3,true)`, [userId, people[name].email, `EL ${name}`]);
  }
  const id = (name) => people[name].id;
  const unitId = randomUUID();
  let workspace;
  let videoId = null;
  try {
    await sql(`INSERT INTO academic_units(id,code,name) VALUES($1,$2,'Phòng Đào tạo (QA)')`, [unitId, `EL${Date.now() % 100000}`]);
    await sql(`INSERT INTO academic_staff(user_id,unit_id,staff_code,academic_rank) VALUES($1,$2,'GVEL','ths')`, [id("lecturer"), unitId]);

    // ---- EL-1 authoring ------------------------------------------------------------------------
    await rejects(courses.create(id("student"), { unitId, code: "X1", title: "Không được" }), "FORBIDDEN");
    const code = `EL${Date.now() % 1000000}`;
    let course = await courses.create(id("lecturer"), { unitId, code, title: "Nghiệp vụ tổng đài cơ bản", description: "Khóa QA" });
    assert.equal(course.status, "draft");
    assert.equal(course.canManage, true);
    await rejects(courses.detail(id("student"), course.id), "NOT_FOUND"); // drafts are hidden
    course = await courses.addChapter(id("lecturer"), course.id, { title: "Chương 1" });
    const chapterId = course.chapters[0].id;
    const doc = await courses.addLesson(id("lecturer"), chapterId, { title: "Quy trình tiếp nhận", kind: "document" });
    await rejects(courses.updateLesson(id("lecturer"), doc.id, { status: "published" }), "NOT_READY");
    await courses.updateLesson(id("lecturer"), doc.id, { body: "Chào khách, xác minh, ghi nhận.", status: "published" });
    await rejects(courses.addLesson(id("lecturer"), chapterId, { title: "Live", kind: "live" }), "INVALID_INPUT");

    // ---- EL-3 upload → queued transcode (Q3); a new upload clears old captions (M3) ----------------
    const { LessonMediaService } = await import("../../../dist/api/modules/elearning/service/media-service.js");
    const { Readable } = await import("node:stream");
    const media = new LessonMediaService(repo, courses, () => {});
    const video = await courses.addLesson(id("lecturer"), chapterId, { title: "Video", kind: "video" });
    videoId = video.id;
    const upload = (bytes) =>
      media.upload(id("lecturer"), video.id, Object.assign(Readable.from([bytes]), { headers: { "content-type": "audio/wav", "content-length": String(bytes.length) } }));
    assert.deepEqual(await upload(Buffer.from("RIFF-test-audio")), { status: "processing" });
    const jobs = await sql(`SELECT kind,status FROM media_jobs WHERE ref_id=$1`, [video.id]);
    assert.deepEqual(jobs.rows, [{ kind: "lesson_transcode", status: "queued" }]);
    await repo.setMedia(video.id, { status: "ready", durationSeconds: 3 });
    await repo.setTranscript(video.id, "ready");
    assert.equal((await repo.lesson(video.id)).transcriptStatus, "ready");
    await upload(Buffer.from("RIFF-second"));
    await rejects(upload(Buffer.from("third")), "PROCESSING");
    assert.equal((await repo.lesson(video.id)).transcriptStatus, null, "captions of the old video are gone");

    // ---- EL-4 bank and quiz ------------------------------------------------------------------------
    const options = [{ id: "a", text: "Ghi âm" }, { id: "b", text: "Mã kết quả" }, { id: "c", text: "Bỏ qua" }];
    await rejects(courses.saveQuestion(id("lecturer"), course.id, null, { kind: "single", prompt: "?", options, answer: ["a", "b"] }), "INVALID_INPUT");
    const q1 = await courses.saveQuestion(id("lecturer"), course.id, null, { kind: "single", prompt: "Bước đầu tiên?", options, answer: ["a"], points: 1 });
    const q2 = await courses.saveQuestion(id("lecturer"), course.id, null, { kind: "multiple", prompt: "Sau cuộc gọi cần?", options, answer: ["a", "b"], points: 2 });
    const q3 = await courses.saveQuestion(id("lecturer"), course.id, null, { kind: "true_false", prompt: "Được bỏ qua mã kết quả?", answer: [false], points: 1 });
    const quiz = await courses.addLesson(id("lecturer"), chapterId, { title: "Kiểm tra chương 1", kind: "quiz" });
    await rejects(courses.updateLesson(id("lecturer"), quiz.id, { status: "published" }), "NOT_READY");
    await courses.updateLesson(id("lecturer"), quiz.id, { questionIds: [q1.id, q2.id, q3.id], timeLimitSeconds: 600, passPercent: 75, status: "published" });
    await rejects(courses.deleteQuestion(id("lecturer"), q1.id), "QUESTION_IN_USE");
    await courses.update(id("lecturer"), course.id, { status: "published" });

    // ---- EL-2 enrollment ----------------------------------------------------------------------------
    await rejects(learning.lesson(id("student"), doc.id), "FORBIDDEN"); // not enrolled yet
    course = await courses.enrollSelf(id("student"), course.id);
    assert.equal(course.enrolled, true);
    assert.equal(course.progress, 0);
    const assigned = await courses.assign(id("lecturer"), course.id, { emails: [people.other.email, "nobody@example.test", people.student.email] });
    assert.deepEqual([assigned.added, assigned.alreadyEnrolled, assigned.notFound], [1, 1, ["nobody@example.test"]]);
    await rejects(courses.assign(id("student"), course.id, { emails: [] }), "FORBIDDEN");

    // ---- learning: document and quiz -------------------------------------------------------------------
    await learning.complete(id("student"), doc.id);
    await rejects(learning.complete(id("student"), quiz.id), "NOT_SELF_COMPLETED");
    const attempt = await learning.startQuiz(id("student"), quiz.id);
    assert.equal(attempt.questions.length, 3);
    assert.ok(attempt.questions.every((question) => !("answer" in question)), "answers stay on the server");
    assert.ok(attempt.deadlineAt);
    assert.equal((await learning.startQuiz(id("student"), quiz.id)).id, attempt.id, "resumes the open attempt");
    const failed = await learning.submitQuiz(id("student"), attempt.id, { answers: { [q1.id]: ["a"], [q2.id]: ["a"], [q3.id]: [false] } });
    assert.deepEqual([failed.score, failed.maxScore, failed.passed], [2, 4, false]);
    assert.equal(failed.review.find((item) => item.questionId === q2.id).correct, false);
    const second = await learning.startQuiz(id("student"), quiz.id);
    const passed = await learning.submitQuiz(id("student"), second.id, { answers: { [q1.id]: ["a"], [q2.id]: ["b", "a"], [q3.id]: [false] } });
    assert.equal(passed.passed, true);
    // A late submission counts only what was autosaved in time.
    const late = await learning.startQuiz(id("other"), quiz.id);
    await learning.saveAnswers(id("other"), late.id, { answers: { [q3.id]: [false] } });
    assert.deepEqual((await learning.startQuiz(id("other"), quiz.id)).answers, { [q3.id]: [false] }, "resume restores the draft");
    await rejects(learning.saveAnswers(id("student"), late.id, { answers: {} }), "NOT_FOUND");
    await rejects(learning.saveAnswers(id("other"), late.id, { answers: { [randomUUID()]: ["a"] } }), "INVALID_INPUT");
    await sql(`UPDATE course_quiz_attempts SET deadline_at=now()-interval '5 minutes' WHERE id=$1`, [late.id]);
    await rejects(learning.saveAnswers(id("other"), late.id, { answers: { [q1.id]: ["a"] } }), "TIME_UP");
    assert.equal((await learning.submitQuiz(id("other"), late.id, { answers: { [q1.id]: ["a"] } })).score, 1);

    // Drawing 2 of 3 questions, shuffled: each attempt keeps its own set, grading uses only those.
    await courses.updateLesson(id("lecturer"), quiz.id, { drawCount: 2, shuffle: true });
    const drawn = await learning.startQuiz(id("other"), quiz.id);
    assert.equal(drawn.questions.length, 2);
    assert.deepEqual((await learning.startQuiz(id("other"), quiz.id)).questions.map((q) => q.id), drawn.questions.map((q) => q.id), "stable on resume");
    const key = { [q1.id]: ["a"], [q2.id]: ["a", "b"], [q3.id]: [false] };
    const graded = await learning.submitQuiz(id("other"), drawn.id, { answers: Object.fromEntries(drawn.questions.map((q) => [q.id, key[q.id]])) });
    assert.equal(graded.passed, true);
    assert.equal(graded.review.length, 2);
    await courses.updateLesson(id("lecturer"), quiz.id, { drawCount: null, shuffle: false });

    // ---- EL-6 live class from a meeting schedule, LT-2 replay --------------------------------------------
    workspace = await createWorkspace(id("lecturer"), "Lớp QA e-learning");
    for (const name of ["student", "other"]) await addWorkspaceMember(workspace.id, id(name));
    const room = (await getWorkspaceChannels(id("lecturer"), workspace.id)).find((channel) => channel.type === "video");
    const startsAt = new Date(Date.now() + 120_000);
    const liveLesson = await live.create(id("lecturer"), chapterId, {
      title: "Buổi live 1",
      roomId: room.id,
      startsAt: startsAt.toISOString(),
      endsAt: new Date(+startsAt + 3600_000).toISOString(),
    });
    await courses.updateLesson(id("lecturer"), liveLesson.id, { status: "published" });
    const scheduleId = (await repo.lesson(liveLesson.id)).scheduleId;
    await rejects(live.close(id("lecturer"), liveLesson.id), "NOT_HELD");
    // The class was held 60 minutes; the student stayed 50 (two overlapping tabs), the other 20.
    const sessionId = randomUUID();
    await sql(
      `INSERT INTO meeting_sessions(id,channel_id,schedule_id,host_id,started_at,ended_at) VALUES($1,$2,$3,$4,now()-interval '60 minutes',now())`,
      [sessionId, room.id, scheduleId, id("lecturer")],
    );
    const visit = (who, from, to) =>
      sql(
        `INSERT INTO meeting_participations(id,channel_id,user_id,socket_id,session_id,joined_at,left_at)
         VALUES($1,$2,$3,$4,$5,now()-make_interval(mins=>$6),now()-make_interval(mins=>$7))`,
        [randomUUID(), room.id, id(who), `el-${randomUUID()}`, sessionId, from, to],
      );
    await visit("student", 60, 30);
    await visit("student", 35, 10);
    await visit("other", 60, 40);
    const recordingId = randomUUID();
    await sql(`INSERT INTO meeting_recordings(id,session_id,channel_id,started_by,status,stopped_at,duration_seconds) VALUES($1,$2,$3,$4,'ready',now(),3500)`, [
      recordingId, sessionId, room.id, id("lecturer"),
    ]);
    await live.closeFinished(); // the schedule has not ended yet, so the automatic pass waits
    assert.equal((await repo.lesson(liveLesson.id)).attendanceClosedAt, null);
    const closed = await live.close(id("lecturer"), liveLesson.id);
    assert.deepEqual([closed.attended, closed.replays], [1, 1]);
    const rows = await live.attendance(id("lecturer"), liveLesson.id);
    assert.equal(rows.find((row) => row.userId === id("student")).attended, true);
    assert.equal(rows.find((row) => row.userId === id("other")).attended, false);
    await rejects(live.close(id("lecturer"), liveLesson.id), "ALREADY_CLOSED");
    const outline = (await courses.detail(id("lecturer"), course.id)).chapters[0].lessons;
    const replay = outline[outline.findIndex((lesson) => lesson.id === liveLesson.id) + 1];
    assert.equal(replay.kind, "video");
    assert.equal(replay.status, "published");
    assert.match(replay.title, /^Xem lại: Buổi live 1/);
    assert.equal((await learning.lesson(id("student"), liveLesson.id)).live.attended, true);

    // ---- EL-5 progress ----------------------------------------------------------------------------------
    const report = await courses.progress(id("lecturer"), course.id);
    const student = report.learners.find((learner) => learner.userId === id("student"));
    // Published: document, quiz, live, replay → 3 of 4 done.
    assert.equal(student.percent, 75);
    assert.equal(student.quizPercents[quiz.id], 100);
    assert.equal(report.learners.find((learner) => learner.userId === id("other")).quizPercents[quiz.id], 100, "best of the late (25%) and drawn (100%) attempts");
    await rejects(courses.progress(id("student"), course.id), "FORBIDDEN");
    assert.match(await courses.progressCsv(id("lecturer"), course.id), /Hoàn thành \(%\)/);
    await learning.complete(id("student"), replay.id);
    assert.ok((await sql(`SELECT completed_at FROM course_enrollments WHERE course_id=$1 AND user_id=$2`, [course.id, id("student")])).rows[0].completed_at);

    // ---- LT-1 support ------------------------------------------------------------------------------------
    await rejects(learning.requestSupport(id("student"), doc.id, {}), "NO_SUPPORT_DEPARTMENT");
    await sql(`INSERT INTO cc_departments(unit_id,extension_from,extension_to) VALUES($1,8800,8829)`, [unitId]);
    const hotlineId = randomUUID();
    const number = `1900${Date.now() % 10000}`;
    await sql(`INSERT INTO cc_hotlines(id,number,name) VALUES($1,$2,'QA hotline')`, [hotlineId, number]);
    await sql(`INSERT INTO cc_ivr_options(hotline_id,digit,department_id) VALUES($1,'3',$2)`, [hotlineId, unitId]);
    const support = await learning.requestSupport(id("student"), doc.id, { message: "Không mở được tài liệu" });
    assert.equal(support.hotline, `${number} (phím 3)`);
    const ticket = (await sql(`SELECT source,lesson_id,description FROM cc_tickets WHERE department_id=$1`, [unitId])).rows[0];
    assert.equal(ticket.source, "elearning");
    assert.equal(ticket.lesson_id, doc.id);
    assert.match(ticket.description, new RegExp(code));
    await rejects(learning.requestSupport(id("outsider"), doc.id, {}), "FORBIDDEN");
    await sql(`DELETE FROM cc_tickets WHERE department_id=$1`, [unitId]);
    await sql(`DELETE FROM cc_hotlines WHERE id=$1`, [hotlineId]);
    await sql(`DELETE FROM cc_departments WHERE unit_id=$1`, [unitId]);

    // ---- EL-8 certificate ---------------------------------------------------------------------------
    await rejects(courses.certificate(id("other"), course.id), "NOT_COMPLETED");
    const certificate = await courses.certificate(id("student"), course.id);
    assert.match(certificate.code, /^TDTU-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    assert.equal(certificate.courseCode, code);
    assert.equal((await courses.certificate(id("student"), course.id)).code, certificate.code, "issued once");
    assert.equal((await courses.verifyCertificate(certificate.code.toLowerCase())).learnerName, certificate.learnerName);
    await rejects(courses.verifyCertificate("TDTU-XXXX-XXXX"), "NOT_FOUND");
    await rejects(courses.verifyCertificate("' OR 1=1 --"), "NOT_FOUND");

    // ---- EL-7 discussion workspace ------------------------------------------------------------------
    await rejects(courses.discussion(id("outsider"), course.id), "FORBIDDEN");
    const discussion = await courses.discussion(id("student"), course.id);
    assert.ok(discussion.channelId && discussion.roomId);
    assert.equal((await courses.discussion(id("lecturer"), course.id)).workspaceId, discussion.workspaceId, "one workspace per course");
    const roles = async () => Object.fromEntries((await sql(`SELECT user_id,role FROM memberships WHERE workspace_id=$1`, [discussion.workspaceId])).rows.map((row) => [row.user_id, row.role]));
    assert.equal((await roles())[id("student")], "member");
    assert.equal((await roles())[id("other")], "member");
    assert.equal((await roles())[id("lecturer")], "owner");
    await courses.unenroll(id("lecturer"), course.id, id("other"));
    assert.equal((await roles())[id("other")], undefined, "leaving the course leaves its discussion");
  } finally {
    if (videoId) {
      await sql(`DELETE FROM media_jobs WHERE ref_id=$1`, [videoId]);
      const { rm } = await import("node:fs/promises");
      const { config } = await import("../../../dist/api/config/config.js");
      await rm(`${config.mediaDir}/lessons/${videoId}`, { recursive: true, force: true });
    }
    await sql(`DELETE FROM courses WHERE unit_id=$1`, [unitId]);
    await sql(`DELETE FROM workspaces WHERE owner_id=ANY($1::uuid[])`, [Object.values(people).map((person) => person.id)]);
    if (workspace) await sql(`DELETE FROM workspaces WHERE id=$1`, [workspace.id]);
    await sql(`DELETE FROM academic_staff WHERE unit_id=$1`, [unitId]);
    await sql(`DELETE FROM academic_units WHERE id=$1`, [unitId]);
    await sql(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [Object.values(people).map((person) => person.id)]);
    await pool.end();
  }
});
