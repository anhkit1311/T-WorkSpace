import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  CourseQuestion,
  CourseStatus,
  CourseSummary,
  LessonKind,
  LessonMediaStatus,
  LessonSummary,
  QuestionKind,
} from "@doan/shared";
import { query, withTransaction } from "../../../infrastructure/database/db.js";
import { CourseAccess, type CourseRef } from "../domain/access.js";
import type { WatchRange } from "../domain/watch.js";

export type CourseRow = CourseRef & {
  code: string;
  title: string;
  description: string;
  unitName: string;
  ownerName: string;
};

export type LessonRow = {
  id: string;
  courseId: string;
  chapterId: string;
  title: string;
  kind: LessonKind;
  status: "draft" | "published";
  position: number;
  body: string;
  mediaStatus: LessonMediaStatus;
  mediaName: string | null;
  mediaError: string | null;
  durationSeconds: number | null;
  recordingId: string | null;
  timeLimitSeconds: number | null;
  passPercent: number;
  drawCount: number | null;
  shuffle: boolean;
  scheduleId: string | null;
  attendanceClosedAt: Date | null;
  /** M3: a replay lesson shows its recording's captions. */
  transcriptStatus: "processing" | "ready" | "failed" | null;
};

const COURSE = `SELECT c.id,c.unit_id AS "unitId",c.owner_id AS "ownerId",c.code,c.title,c.description,c.status,c.enrollment,
  u.name AS "unitName",o.display_name AS "ownerName",
  COALESCE((SELECT array_agg(i.user_id) FROM course_instructors i WHERE i.course_id=c.id),'{}') AS "instructorIds"
  FROM courses c JOIN academic_units u ON u.id=c.unit_id JOIN users o ON o.id=c.owner_id`;

const LESSON = `SELECT id,course_id AS "courseId",chapter_id AS "chapterId",title,kind,status,position,body,
  media_status AS "mediaStatus",media_name AS "mediaName",media_error AS "mediaError",duration_seconds AS "durationSeconds",
  recording_id AS "recordingId",time_limit_seconds AS "timeLimitSeconds",pass_percent AS "passPercent",
  draw_count AS "drawCount",shuffle,schedule_id AS "scheduleId",attendance_closed_at AS "attendanceClosedAt",
  COALESCE((SELECT r.transcript_status FROM meeting_recordings r WHERE r.id=recording_id),transcript_status) AS "transcriptStatus"
  FROM course_lessons`;

/** Persistence of the e-learning module; services hold the rules. */
export class ElearningRepository {
  async access(userId: string): Promise<CourseAccess> {
    const [grants, staff] = await Promise.all([
      query<{ role: string; unit_id: string | null }>(`SELECT role,unit_id FROM academic_role_grants WHERE user_id=$1`, [userId]),
      query<{ unit_id: string }>(`SELECT unit_id FROM academic_staff WHERE user_id=$1 AND active`, [userId]),
    ]);
    return new CourseAccess(
      userId,
      grants.rows.some((grant) => grant.role === "system_admin"),
      new Set(grants.rows.filter((grant) => grant.role === "unit_admin" && grant.unit_id).map((grant) => grant.unit_id!)),
      new Set(staff.rows.map((row) => row.unit_id)),
    );
  }

  async units() {
    return (await query<{ id: string; code: string; name: string }>(`SELECT id,code,name FROM academic_units ORDER BY name`)).rows;
  }

  async course(id: string): Promise<CourseRow | null> {
    return (await query<CourseRow>(`${COURSE} WHERE c.id=$1`, [id])).rows[0] ?? null;
  }

  async isEnrolled(courseId: string, userId: string) {
    return Boolean((await query(`SELECT 1 FROM course_enrollments WHERE course_id=$1 AND user_id=$2`, [courseId, userId])).rowCount);
  }

  /** Every course the user may see, with their own progress where enrolled. */
  async listCourses(userId: string): Promise<(CourseRow & Omit<CourseSummary, "canManage" | "canEnroll">)[]> {
    const rows = await query<CourseRow & { lessonCount: number; learnerCount: number; enrolled: boolean; done: number }>(
      `SELECT x.*,
         (SELECT count(*)::int FROM course_lessons l WHERE l.course_id=x.id AND l.status='published') AS "lessonCount",
         (SELECT count(*)::int FROM course_enrollments e WHERE e.course_id=x.id) AS "learnerCount",
         EXISTS(SELECT 1 FROM course_enrollments e WHERE e.course_id=x.id AND e.user_id=$1) AS enrolled,
         (SELECT count(*)::int FROM course_lesson_progress p JOIN course_lessons l ON l.id=p.lesson_id
           WHERE l.course_id=x.id AND l.status='published' AND p.user_id=$1) AS done
       FROM (${COURSE} WHERE c.status<>'archived' OR EXISTS(SELECT 1 FROM course_enrollments e WHERE e.course_id=c.id AND e.user_id=$1)
             OR c.owner_id=$1) x
       ORDER BY x.title`,
      [userId],
    );
    return rows.rows.map((row) => ({
      ...row,
      progress: row.enrolled ? (row.lessonCount ? Math.round((Math.min(row.done, row.lessonCount) / row.lessonCount) * 100) : 0) : null,
    }));
  }

  async createCourse(input: { unitId: string; ownerId: string; code: string; title: string; description: string; enrollment: string }) {
    const id = randomUUID();
    await query(`INSERT INTO courses(id,unit_id,owner_id,code,title,description,enrollment) VALUES($1,$2,$3,$4,$5,$6,$7)`, [
      id, input.unitId, input.ownerId, input.code, input.title, input.description, input.enrollment,
    ]);
    return id;
  }

  async updateCourse(id: string, change: { title: string; description: string; enrollment: string; status: CourseStatus }) {
    await query(
      `UPDATE courses SET title=$2,description=$3,enrollment=$4,status=$5,updated_at=now(),
         published_at=CASE WHEN $5::varchar='published' THEN COALESCE(published_at,now()) ELSE published_at END WHERE id=$1`,
      [id, change.title, change.description, change.enrollment, change.status],
    );
  }

  async instructors(courseId: string) {
    return (
      await query<{ userId: string; displayName: string }>(
        `SELECT u.id AS "userId",u.display_name AS "displayName" FROM course_instructors i JOIN users u ON u.id=i.user_id WHERE i.course_id=$1 ORDER BY u.display_name`,
        [courseId],
      )
    ).rows;
  }

  async userByEmail(email: string) {
    return (await query<{ id: string }>(`SELECT id FROM users WHERE lower(email)=lower($1)`, [email])).rows[0]?.id ?? null;
  }

  async setInstructor(courseId: string, userId: string, present: boolean) {
    await query(
      present
        ? `INSERT INTO course_instructors(course_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`
        : `DELETE FROM course_instructors WHERE course_id=$1 AND user_id=$2`,
      [courseId, userId],
    );
  }

  /** LT-1: the hotline (and IVR digit) that reaches the unit's call-center department. */
  async supportHotline(unitId: string): Promise<string | null> {
    const row = (
      await query<{ number: string; digit: string | null }>(
        `SELECT h.number,o.digit FROM cc_departments d JOIN cc_hotlines h ON h.active
           LEFT JOIN cc_ivr_options o ON o.hotline_id=h.id AND o.department_id=d.unit_id
         WHERE d.unit_id=$1 AND (o.digit IS NOT NULL OR h.fallback_department_id=d.unit_id)
         ORDER BY o.digit NULLS LAST LIMIT 1`,
        [unitId],
      )
    ).rows[0];
    return row ? (row.digit ? `${row.number} (phím ${row.digit})` : row.number) : null;
  }

  async hasSupportDepartment(unitId: string) {
    return Boolean((await query(`SELECT 1 FROM cc_departments WHERE unit_id=$1`, [unitId])).rowCount);
  }

  // ---- chapters and lessons ---------------------------------------------------------------

  async chapters(courseId: string) {
    return (
      await query<{ id: string; title: string; position: number }>(
        `SELECT id,title,position FROM course_chapters WHERE course_id=$1 ORDER BY position,id`,
        [courseId],
      )
    ).rows;
  }

  async chapter(id: string) {
    return (await query<{ id: string; courseId: string; title: string }>(`SELECT id,course_id AS "courseId",title FROM course_chapters WHERE id=$1`, [id])).rows[0] ?? null;
  }

  async createChapter(courseId: string, title: string) {
    const id = randomUUID();
    await query(
      `INSERT INTO course_chapters(id,course_id,title,position) VALUES($1,$2,$3,(SELECT COALESCE(max(position)+1,0) FROM course_chapters WHERE course_id=$2))`,
      [id, courseId, title],
    );
    return id;
  }

  async updateChapter(id: string, title: string, position: number | null) {
    await query(`UPDATE course_chapters SET title=$2,position=COALESCE($3,position) WHERE id=$1`, [id, title, position]);
  }

  async deleteChapter(id: string) {
    const used = await query(`SELECT 1 FROM course_lessons WHERE chapter_id=$1 LIMIT 1`, [id]);
    if (used.rowCount) return false;
    await query(`DELETE FROM course_chapters WHERE id=$1`, [id]);
    return true;
  }

  async lessons(courseId: string, userId: string): Promise<LessonSummary[]> {
    return (
      await query<LessonSummary>(
        `SELECT l.id,l.chapter_id AS "chapterId",l.title,l.kind,l.status,l.position,l.duration_seconds AS "durationSeconds",
           l.media_status AS "mediaStatus",EXISTS(SELECT 1 FROM course_lesson_progress p WHERE p.lesson_id=l.id AND p.user_id=$2) AS completed
         FROM course_lessons l WHERE l.course_id=$1 ORDER BY l.position,l.created_at`,
        [courseId, userId],
      )
    ).rows;
  }

  async lesson(id: string): Promise<LessonRow | null> {
    return (await query<LessonRow>(`${LESSON} WHERE id=$1`, [id])).rows[0] ?? null;
  }

  async createLesson(input: { courseId: string; chapterId: string; title: string; kind: LessonKind; scheduleId?: string | null; recordingId?: string | null; status?: string; position?: number }) {
    const id = randomUUID();
    await query(
      `INSERT INTO course_lessons(id,course_id,chapter_id,title,kind,schedule_id,recording_id,status,media_status,position)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,(SELECT COALESCE(max(position)+1,0) FROM course_lessons WHERE chapter_id=$3)))`,
      [
        id, input.courseId, input.chapterId, input.title, input.kind, input.scheduleId ?? null, input.recordingId ?? null,
        input.status ?? "draft", input.recordingId ? "ready" : "none", input.position ?? null,
      ],
    );
    return id;
  }

  async updateLesson(id: string, change: Partial<{ title: string; status: string; body: string; position: number; chapterId: string; timeLimitSeconds: number | null; passPercent: number; drawCount: number | null; shuffle: boolean }>) {
    const columns: Record<string, string> = {
      title: "title", status: "status", body: "body", position: "position", chapterId: "chapter_id",
      timeLimitSeconds: "time_limit_seconds", passPercent: "pass_percent", drawCount: "draw_count", shuffle: "shuffle",
    };
    const keys = Object.keys(change).filter((key) => key in columns);
    if (!keys.length) return;
    await query(
      `UPDATE course_lessons SET ${keys.map((key, index) => `${columns[key]}=$${index + 2}`).join(",")},updated_at=now() WHERE id=$1`,
      [id, ...keys.map((key) => change[key as keyof typeof change])],
    );
  }

  async deleteLesson(id: string) {
    await query(`DELETE FROM course_lessons WHERE id=$1`, [id]);
  }

  async setTranscript(id: string, status: "processing" | "ready" | "failed") {
    await query(`UPDATE course_lessons SET transcript_status=$2 WHERE id=$1`, [id, status]);
  }

  async setMedia(id: string, change: { status: LessonMediaStatus; name?: string | null; error?: string | null; durationSeconds?: number | null }) {
    await query(
      `UPDATE course_lessons SET media_status=$2,media_name=COALESCE($3,media_name),media_error=$4,
         duration_seconds=COALESCE($5,duration_seconds),updated_at=now(),
         transcript_status=CASE WHEN $2::varchar='processing' THEN NULL ELSE transcript_status END WHERE id=$1`,
      [id, change.status, change.name ?? null, change.error ?? null, change.durationSeconds ?? null],
    );
  }

  // ---- enrollment (EL-2) ----------------------------------------------------------------------

  /** Adds learners who are not enrolled yet; returns how many were added. */
  async enroll(courseId: string, userIds: string[], source: "self" | "assigned", by: string | null) {
    if (!userIds.length) return 0;
    const result = await query(
      `INSERT INTO course_enrollments(course_id,user_id,source,assigned_by) SELECT $1,u,$3,$4 FROM unnest($2::uuid[]) u
       ON CONFLICT DO NOTHING`,
      [courseId, [...new Set(userIds)], source, by],
    );
    return result.rowCount ?? 0;
  }

  async unenroll(courseId: string, userId: string) {
    await query(`DELETE FROM course_enrollments WHERE course_id=$1 AND user_id=$2`, [courseId, userId]);
    // EL-7: leaving the course leaves its discussion workspace too (never its owner).
    await query(
      `DELETE FROM memberships m USING courses c, workspaces w
       WHERE c.id=$1 AND w.id=c.workspace_id AND m.workspace_id=w.id AND m.user_id=$2 AND w.owner_id<>$2
         AND NOT EXISTS(SELECT 1 FROM course_instructors i WHERE i.course_id=c.id AND i.user_id=$2)`,
      [courseId, userId],
    );
  }

  // ---- EL-8 certificates ------------------------------------------------------------------------

  async completedAt(courseId: string, userId: string): Promise<Date | null> {
    return (await query<{ completed_at: Date | null }>(`SELECT completed_at FROM course_enrollments WHERE course_id=$1 AND user_id=$2`, [courseId, userId])).rows[0]?.completed_at ?? null;
  }

  /** Issues once per learner and course; a second call returns the first code. */
  async issueCertificate(courseId: string, userId: string, code: string) {
    await query(
      `INSERT INTO course_certificates(id,course_id,user_id,code) VALUES($1,$2,$3,$4) ON CONFLICT (course_id,user_id) DO NOTHING`,
      [randomUUID(), courseId, userId, code],
    );
    return (await query<{ code: string }>(`SELECT code FROM course_certificates WHERE course_id=$1 AND user_id=$2`, [courseId, userId])).rows[0].code;
  }

  async certificateByCode(code: string) {
    return (
      await query<{ code: string; learnerName: string; courseCode: string; courseTitle: string; unitName: string; instructors: string[]; lessonCount: number; issuedAt: Date }>(
        `SELECT x.code,u.display_name AS "learnerName",c.code AS "courseCode",c.title AS "courseTitle",au.name AS "unitName",
           COALESCE((SELECT array_agg(iu.display_name ORDER BY iu.display_name) FROM course_instructors i JOIN users iu ON iu.id=i.user_id WHERE i.course_id=c.id),
             ARRAY[o.display_name]) AS instructors,
           (SELECT count(*)::int FROM course_lessons l WHERE l.course_id=c.id AND l.status='published') AS "lessonCount",
           x.issued_at AS "issuedAt"
         FROM course_certificates x JOIN users u ON u.id=x.user_id JOIN courses c ON c.id=x.course_id
         JOIN academic_units au ON au.id=c.unit_id JOIN users o ON o.id=c.owner_id
         WHERE x.code=$1`,
        [code],
      )
    ).rows[0] ?? null;
  }

  // ---- EL-7 discussion workspace ----------------------------------------------------------------

  async courseWorkspace(courseId: string): Promise<string | null> {
    return (await query<{ workspace_id: string | null }>(`SELECT workspace_id FROM courses WHERE id=$1`, [courseId])).rows[0]?.workspace_id ?? null;
  }

  async setCourseWorkspace(courseId: string, workspaceId: string) {
    await query(`UPDATE courses SET workspace_id=$2 WHERE id=$1`, [courseId, workspaceId]);
  }

  /** Instructors become admins and learners members of the course workspace; existing rows stay. */
  async syncCourseMembers(courseId: string, workspaceId: string) {
    await query(
      `INSERT INTO memberships(workspace_id,user_id,role)
       SELECT $2::uuid,user_id,'admin' FROM course_instructors WHERE course_id=$1
       UNION SELECT $2::uuid,owner_id,'admin' FROM courses WHERE id=$1
       UNION SELECT $2::uuid,user_id,'member' FROM course_enrollments e WHERE course_id=$1
         AND NOT EXISTS(SELECT 1 FROM course_instructors i WHERE i.course_id=$1 AND i.user_id=e.user_id)
       ON CONFLICT DO NOTHING`,
      [courseId, workspaceId],
    );
  }

  async usersByEmails(emails: string[]) {
    return (await query<{ id: string; email: string }>(`SELECT id,lower(email) AS email FROM users WHERE lower(email)=ANY($1)`, [emails.map((e) => e.toLowerCase())])).rows;
  }

  /** "Lớp": the members of a workspace the assigning user belongs to. */
  async workspaceMembers(workspaceId: string, viewerId: string) {
    return (
      await query<{ user_id: string }>(
        `SELECT m.user_id FROM memberships m WHERE m.workspace_id=$1 AND EXISTS(SELECT 1 FROM memberships v WHERE v.workspace_id=$1 AND v.user_id=$2)`,
        [workspaceId, viewerId],
      )
    ).rows.map((row) => row.user_id);
  }

  /** "Đơn vị": active staff of an academic unit plus the agents and supervisors of its call-center department. */
  async unitMembers(unitId: string) {
    return (
      await query<{ user_id: string }>(
        `SELECT user_id FROM academic_staff WHERE unit_id=$1 AND active UNION SELECT user_id FROM cc_members WHERE department_id=$1`,
        [unitId],
      )
    ).rows.map((row) => row.user_id);
  }

  // ---- questions and quizzes (EL-4) -------------------------------------------------------------

  async questions(courseId: string): Promise<CourseQuestion[]> {
    return (
      await query<CourseQuestion>(
        `SELECT id,kind,prompt,options,answer,explanation,points FROM course_questions WHERE course_id=$1 ORDER BY created_at,id`,
        [courseId],
      )
    ).rows;
  }

  async question(id: string) {
    return (await query<CourseQuestion & { courseId: string }>(
      `SELECT id,course_id AS "courseId",kind,prompt,options,answer,explanation,points FROM course_questions WHERE id=$1`, [id],
    )).rows[0] ?? null;
  }

  async saveQuestion(id: string | null, courseId: string, input: { kind: QuestionKind; prompt: string; options: unknown; answer: unknown; explanation: string; points: number }) {
    const questionId = id ?? randomUUID();
    await query(
      id
        ? `UPDATE course_questions SET kind=$3,prompt=$4,options=$5,answer=$6,explanation=$7,points=$8 WHERE id=$1 AND course_id=$2`
        : `INSERT INTO course_questions(id,course_id,kind,prompt,options,answer,explanation,points) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [questionId, courseId, input.kind, input.prompt, JSON.stringify(input.options), JSON.stringify(input.answer), input.explanation, input.points],
    );
    return questionId;
  }

  async deleteQuestion(id: string) {
    await query(`DELETE FROM course_questions WHERE id=$1`, [id]);
  }

  async quizQuestionIds(lessonId: string) {
    return (await query<{ question_id: string }>(`SELECT question_id FROM course_quiz_questions WHERE lesson_id=$1 ORDER BY position`, [lessonId])).rows.map((row) => row.question_id);
  }

  async setQuizQuestions(lessonId: string, questionIds: string[]) {
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM course_quiz_questions WHERE lesson_id=$1`, [lessonId]);
      for (const [position, questionId] of questionIds.entries())
        await client.query(`INSERT INTO course_quiz_questions(lesson_id,question_id,position) VALUES($1,$2,$3)`, [lessonId, questionId, position]);
    });
  }

  async quizQuestions(lessonId: string): Promise<CourseQuestion[]> {
    return (
      await query<CourseQuestion>(
        `SELECT q.id,q.kind,q.prompt,q.options,q.answer,q.explanation,q.points FROM course_quiz_questions x JOIN course_questions q ON q.id=x.question_id
         WHERE x.lesson_id=$1 ORDER BY x.position`,
        [lessonId],
      )
    ).rows;
  }

  /** Questions of an attempt in the given order; a question deleted meanwhile is left out. */
  async questionsByIds(ids: string[]): Promise<CourseQuestion[]> {
    const rows = (
      await query<CourseQuestion>(`SELECT id,kind,prompt,options,answer,explanation,points FROM course_questions WHERE id=ANY($1::uuid[])`, [ids])
    ).rows;
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((questionId) => byId.get(questionId) ?? []);
  }

  async attempt(id: string) {
    return (
      await query<{ id: string; lessonId: string; userId: string; startedAt: Date; deadlineAt: Date | null; submittedAt: Date | null; answers: Record<string, unknown> | null; score: string | null; maxScore: string | null; passed: boolean | null; questionIds: string[] | null; savedAt: Date | null }>(
        `SELECT id,lesson_id AS "lessonId",user_id AS "userId",started_at AS "startedAt",deadline_at AS "deadlineAt",submitted_at AS "submittedAt",
           answers,score,max_score AS "maxScore",passed,question_ids AS "questionIds",saved_at AS "savedAt" FROM course_quiz_attempts WHERE id=$1`,
        [id],
      )
    ).rows[0] ?? null;
  }

  async openAttempt(lessonId: string, userId: string) {
    return (await query<{ id: string }>(`SELECT id FROM course_quiz_attempts WHERE lesson_id=$1 AND user_id=$2 AND submitted_at IS NULL`, [lessonId, userId])).rows[0]?.id ?? null;
  }

  async startAttempt(lessonId: string, userId: string, timeLimitSeconds: number | null, questionIds: string[]) {
    const id = randomUUID();
    await query(
      `INSERT INTO course_quiz_attempts(id,lesson_id,user_id,deadline_at,question_ids)
       VALUES($1,$2,$3,CASE WHEN $4::int IS NULL THEN NULL ELSE now()+make_interval(secs=>$4::int) END,$5::uuid[])`,
      [id, lessonId, userId, timeLimitSeconds, questionIds],
    );
    return id;
  }

  /** Autosave while the attempt is open; returns false once it was submitted. */
  async saveDraft(id: string, answers: Record<string, unknown>) {
    const updated = await query(`UPDATE course_quiz_attempts SET answers=$2,saved_at=now() WHERE id=$1 AND submitted_at IS NULL`, [id, JSON.stringify(answers)]);
    return Boolean(updated.rowCount);
  }

  /** Grades once: a second submit of the same attempt finds it already submitted. */
  async submitAttempt(id: string, result: { answers: Record<string, unknown>; score: number; maxScore: number; passed: boolean }) {
    return withTransaction(async (client) => {
      const updated = await client.query<{ lesson_id: string; user_id: string }>(
        `UPDATE course_quiz_attempts SET submitted_at=now(),answers=$2,score=$3,max_score=$4,passed=$5 WHERE id=$1 AND submitted_at IS NULL RETURNING lesson_id,user_id`,
        [id, JSON.stringify(result.answers), result.score, result.maxScore, result.passed],
      );
      if (!updated.rowCount) return false;
      if (result.passed) await this.complete(client, updated.rows[0].lesson_id, updated.rows[0].user_id);
      return true;
    });
  }

  async bestQuiz(lessonId: string, userId: string) {
    return (
      await query<{ best: number | null; passed: boolean }>(
        `SELECT max(score/NULLIF(max_score,0)*100)::float8 AS best,COALESCE(bool_or(passed),false) AS passed
         FROM course_quiz_attempts WHERE lesson_id=$1 AND user_id=$2 AND submitted_at IS NOT NULL`,
        [lessonId, userId],
      )
    ).rows[0];
  }

  // ---- progress (EL-5) ----------------------------------------------------------------------------

  async complete(client: PoolClient | null, lessonId: string, userId: string) {
    const run = client ? client.query.bind(client) : query;
    await run(`INSERT INTO course_lesson_progress(lesson_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [lessonId, userId]);
    // The enrollment is complete once every published lesson is.
    await run(
      `UPDATE course_enrollments e SET completed_at=now() FROM course_lessons l
       WHERE l.id=$1 AND e.course_id=l.course_id AND e.user_id=$2 AND e.completed_at IS NULL
         AND NOT EXISTS(SELECT 1 FROM course_lessons x WHERE x.course_id=l.course_id AND x.status='published'
           AND NOT EXISTS(SELECT 1 FROM course_lesson_progress p WHERE p.lesson_id=x.id AND p.user_id=$2))`,
      [lessonId, userId],
    );
  }

  async progressReport(courseId: string) {
    const [learners, done, quizzes] = await Promise.all([
      query<{ userId: string; displayName: string; email: string; source: "self" | "assigned"; completedAt: Date | null }>(
        `SELECT u.id AS "userId",u.display_name AS "displayName",u.email,e.source,e.completed_at AS "completedAt"
         FROM course_enrollments e JOIN users u ON u.id=e.user_id WHERE e.course_id=$1 ORDER BY u.display_name`,
        [courseId],
      ),
      query<{ user_id: string; lesson_id: string }>(
        `SELECT p.user_id,p.lesson_id FROM course_lesson_progress p JOIN course_lessons l ON l.id=p.lesson_id WHERE l.course_id=$1 AND l.status='published'`,
        [courseId],
      ),
      query<{ user_id: string; lesson_id: string; best: number }>(
        `SELECT a.user_id,a.lesson_id,max(a.score/NULLIF(a.max_score,0)*100)::float8 AS best FROM course_quiz_attempts a
         JOIN course_lessons l ON l.id=a.lesson_id WHERE l.course_id=$1 AND a.submitted_at IS NOT NULL GROUP BY a.user_id,a.lesson_id`,
        [courseId],
      ),
    ]);
    return { learners: learners.rows, done: done.rows, quizzes: quizzes.rows };
  }

  // ---- live classes (EL-6, LT-2) ----------------------------------------------------------------

  async liveSchedule(scheduleId: string) {
    return (
      await query<{ id: string; channelId: string; workspaceId: string; startsAt: Date; endsAt: Date }>(
        `SELECT s.id,s.channel_id AS "channelId",c.workspace_id AS "workspaceId",s.starts_at AS "startsAt",s.ends_at AS "endsAt"
         FROM meeting_schedules s JOIN channels c ON c.id=s.channel_id WHERE s.id=$1`,
        [scheduleId],
      )
    ).rows[0] ?? null;
  }

  /** EL-5 video watch time; inside a transaction the row is locked so two tabs cannot lose each other's report. */
  async videoWatch(client: PoolClient | null, lessonId: string, userId: string) {
    const run = client ? client.query.bind(client) : query;
    return (
      (await run(
        `SELECT ranges,position_seconds AS "positionSeconds",updated_at AS "updatedAt" FROM course_video_watch
         WHERE lesson_id=$1 AND user_id=$2${client ? " FOR UPDATE" : ""}`,
        [lessonId, userId],
      )).rows[0] as { ranges: WatchRange[]; positionSeconds: number; updatedAt: Date } | undefined
    ) ?? null;
  }

  async saveVideoWatch(client: PoolClient, lessonId: string, userId: string, ranges: WatchRange[], positionSeconds: number) {
    await client.query(
      `INSERT INTO course_video_watch(lesson_id,user_id,ranges,position_seconds) VALUES($1,$2,$3,$4)
       ON CONFLICT (lesson_id,user_id) DO UPDATE SET ranges=EXCLUDED.ranges,position_seconds=EXCLUDED.position_seconds,updated_at=now()`,
      [lessonId, userId, JSON.stringify(ranges), positionSeconds],
    );
  }

  async liveAttendance(lessonId: string, userId: string) {
    return (await query<{ attended: boolean; ratio: string }>(`SELECT attended,ratio FROM course_live_attendance WHERE lesson_id=$1 AND user_id=$2`, [lessonId, userId])).rows[0] ?? null;
  }

  async liveAttendanceRows(lessonId: string) {
    return (
      await query<{ userId: string; displayName: string; presentSeconds: number; ratio: number; attended: boolean }>(
        `SELECT a.user_id AS "userId",u.display_name AS "displayName",a.present_seconds AS "presentSeconds",a.ratio::float8 AS ratio,a.attended
         FROM course_live_attendance a JOIN users u ON u.id=a.user_id WHERE a.lesson_id=$1 ORDER BY u.display_name`,
        [lessonId],
      )
    ).rows;
  }

  /** Live lessons whose class is over: every session of the schedule ended and no recording is still being made. */
  async finishedLiveLessons() {
    return (
      await query<{ id: string }>(
        `SELECT l.id FROM course_lessons l JOIN meeting_schedules s ON s.id=l.schedule_id
         WHERE l.kind='live' AND l.attendance_closed_at IS NULL AND s.ends_at<now()
           AND EXISTS(SELECT 1 FROM meeting_sessions m WHERE m.schedule_id=s.id)
           AND NOT EXISTS(SELECT 1 FROM meeting_sessions m WHERE m.schedule_id=s.id AND m.ended_at IS NULL)
           AND NOT EXISTS(SELECT 1 FROM meeting_recordings r JOIN meeting_sessions m ON m.id=r.session_id
             WHERE m.schedule_id=s.id AND r.status IN ('recording','processing'))
         LIMIT 20`,
      )
    ).rows.map((row) => row.id);
  }

  /**
   * Closes a live class once (row lock + attendance_closed_at): writes attendance, completes the
   * lesson for learners present >= 70%, and publishes each ready recording as a replay lesson
   * right after it, in the same chapter (LT-2).
   */
  async closeLiveClass(
    lessonId: string,
    attendanceOf: (intervals: { from: number; to: number }[], start: number, end: number) => { presentSeconds: number; ratio: number; attended: boolean },
  ) {
    return withTransaction(async (client) => {
      const lesson = (
        await client.query<{ course_id: string; chapter_id: string; title: string; position: number; schedule_id: string | null; closed: Date | null }>(
          `SELECT course_id,chapter_id,title,position,schedule_id,attendance_closed_at AS closed FROM course_lessons WHERE id=$1 AND kind='live' FOR UPDATE`,
          [lessonId],
        )
      ).rows[0];
      if (!lesson || lesson.closed || !lesson.schedule_id) return null;
      const sessions = await client.query<{ id: string; started_at: Date; ended_at: Date | null }>(
        `SELECT id,started_at,ended_at FROM meeting_sessions WHERE schedule_id=$1`,
        [lesson.schedule_id],
      );
      const now = Date.now();
      const start = Math.min(...sessions.rows.map((row) => +row.started_at), now);
      const end = Math.max(...sessions.rows.map((row) => +(row.ended_at ?? now)), start + 1);
      const visits = await client.query<{ user_id: string; joined_at: Date; left_at: Date | null }>(
        `SELECT p.user_id,p.joined_at,p.left_at FROM meeting_participations p JOIN course_enrollments e ON e.user_id=p.user_id AND e.course_id=$2
         WHERE p.session_id=ANY($1::uuid[])`,
        [sessions.rows.map((row) => row.id), lesson.course_id],
      );
      const byUser = new Map<string, { from: number; to: number }[]>();
      for (const visit of visits.rows)
        byUser.set(visit.user_id, [...(byUser.get(visit.user_id) ?? []), { from: +visit.joined_at, to: +(visit.left_at ?? end) }]);
      const learners = await client.query<{ user_id: string }>(`SELECT user_id FROM course_enrollments WHERE course_id=$1`, [lesson.course_id]);
      let attended = 0;
      for (const { user_id } of learners.rows) {
        const row = attendanceOf(byUser.get(user_id) ?? [], start, end);
        await client.query(
          `INSERT INTO course_live_attendance(lesson_id,user_id,present_seconds,ratio,attended) VALUES($1,$2,$3,$4,$5)
           ON CONFLICT (lesson_id,user_id) DO UPDATE SET present_seconds=EXCLUDED.present_seconds,ratio=EXCLUDED.ratio,attended=EXCLUDED.attended`,
          [lessonId, user_id, row.presentSeconds, row.ratio, row.attended],
        );
        if (row.attended) {
          attended++;
          await this.complete(client, lessonId, user_id);
        }
      }
      const recordings = await client.query<{ id: string; duration_seconds: number | null }>(
        `SELECT r.id,r.duration_seconds FROM meeting_recordings r WHERE r.session_id=ANY($1::uuid[]) AND r.status='ready'
           AND NOT EXISTS(SELECT 1 FROM course_lessons x WHERE x.recording_id=r.id) ORDER BY r.started_at`,
        [sessions.rows.map((row) => row.id)],
      );
      // Make room right after the live lesson for the replays.
      await client.query(`UPDATE course_lessons SET position=position+$3 WHERE chapter_id=$1 AND position>$2`, [
        lesson.chapter_id, lesson.position, recordings.rowCount ?? 0,
      ]);
      for (const [index, recording] of recordings.rows.entries())
        await client.query(
          `INSERT INTO course_lessons(id,course_id,chapter_id,title,kind,status,media_status,recording_id,duration_seconds,position)
           VALUES($1,$2,$3,$4,'video','published','ready',$5,$6,$7)`,
          [
            randomUUID(), lesson.course_id, lesson.chapter_id,
            `Xem lại: ${lesson.title}${recordings.rows.length > 1 ? ` (phần ${index + 1})` : ""}`.slice(0, 160),
            recording.id, recording.duration_seconds, lesson.position + index + 1,
          ],
        );
      await client.query(`UPDATE course_lessons SET attendance_closed_at=now() WHERE id=$1`, [lessonId]);
      return { learners: learners.rowCount ?? 0, attended, replays: recordings.rowCount ?? 0 };
    });
  }
}
