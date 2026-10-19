import { randomInt } from "node:crypto";
import type { CourseAssignmentResult, CourseCertificate, CourseDetail, CourseProgressReport, CourseQuestion, CourseSummary, LessonKind, QuestionKind } from "@doan/shared";
import { createWorkspace, getWorkspaceChannels } from "../../workspaces/service.js";
import { conflict, forbidden, id, integer, invalid, notFound, oneOf, optionalId, text, type Body } from "../../callcenter/service/input.js";
import { questionProblem, type Answer, type QuestionOption } from "../domain/quiz.js";
import { completionPercent } from "../domain/progress.js";
import type { CourseRow, ElearningRepository } from "../repository/elearning-repository.js";

const KINDS = ["video", "document", "quiz", "live"] as const satisfies readonly LessonKind[];

/** EL-1 catalogue and authoring, EL-2 enrollment, EL-4 question bank, EL-5 progress report. */
export class CourseService {
  constructor(private readonly repo: ElearningRepository) {}

  /** The course, checked against what the user wants to do with it. */
  async load(userId: string, courseId: string, need: "see" | "manage") {
    const course = await this.repo.course(id(courseId));
    if (!course) throw notFound("Không tìm thấy khóa học.");
    const access = await this.repo.access(userId);
    const manages = access.manages(course);
    const enrolled = await this.repo.isEnrolled(course.id, userId);
    if (need === "manage" ? !manages : !access.canSee(course, enrolled)) throw need === "manage" ? forbidden() : notFound("Không tìm thấy khóa học.");
    return { course, access, manages, enrolled };
  }

  async list(userId: string): Promise<CourseSummary[]> {
    const access = await this.repo.access(userId);
    return (await this.repo.listCourses(userId))
      .filter((row) => access.canSee(row, row.enrolled))
      .map((row) => this.summary(row, access.manages(row), row.enrolled, access.canSelfEnroll(row), row));
  }

  private summary(course: CourseRow, manages: boolean, enrolled: boolean, canEnroll: boolean, counts: { lessonCount: number; learnerCount: number; progress: number | null }): CourseSummary {
    return {
      id: course.id,
      code: course.code,
      title: course.title,
      description: course.description,
      unitId: course.unitId,
      unitName: course.unitName,
      ownerName: course.ownerName,
      status: course.status,
      enrollment: course.enrollment,
      lessonCount: counts.lessonCount,
      learnerCount: counts.learnerCount,
      enrolled,
      progress: counts.progress,
      canManage: manages,
      canEnroll: canEnroll && !enrolled,
    };
  }

  async detail(userId: string, courseId: string): Promise<CourseDetail> {
    const { course, access, manages, enrolled } = await this.load(userId, courseId, "see");
    const [chapters, lessons, instructors, hotline] = await Promise.all([
      this.repo.chapters(course.id),
      this.repo.lessons(course.id, userId),
      this.repo.instructors(course.id),
      this.repo.supportHotline(course.unitId),
    ]);
    // Learners see published lessons only; staff see drafts too.
    const visible = lessons.filter((lesson) => manages || lesson.status === "published");
    const published = lessons.filter((lesson) => lesson.status === "published");
    const learners = manages ? (await this.repo.progressReport(course.id)).learners.length : 0;
    return {
      ...this.summary(course, manages, enrolled, access.canSelfEnroll(course), {
        lessonCount: published.length,
        learnerCount: learners,
        progress: enrolled ? completionPercent(published.length, published.filter((lesson) => lesson.completed).length) : null,
      }),
      chapters: chapters.map((chapter) => ({ ...chapter, lessons: visible.filter((lesson) => lesson.chapterId === chapter.id) })),
      instructors,
      supportHotline: hotline,
    };
  }

  /** Units the user may create courses for (create form). */
  async units(userId: string) {
    const access = await this.repo.access(userId);
    return (await this.repo.units()).filter((unit) => access.canCreateIn(unit.id));
  }

  async create(userId: string, body: Body) {
    const unitId = id(body.unitId);
    if (!(await this.repo.access(userId)).canCreateIn(unitId)) throw forbidden();
    const courseId = await this.repo.createCourse({
      unitId,
      ownerId: userId,
      code: text(body, "code", 20, { pattern: /^[A-Z0-9_-]{2,20}$/ }),
      title: text(body, "title", 160),
      description: text(body, "description", 4000, { optional: true }),
      enrollment: oneOf(body, "enrollment", ["open", "assigned"] as const, "open"),
    });
    return this.detail(userId, courseId);
  }

  async update(userId: string, courseId: string, body: Body) {
    const { course } = await this.load(userId, courseId, "manage");
    await this.repo.updateCourse(course.id, {
      title: body.title === undefined ? course.title : text(body, "title", 160),
      description: body.description === undefined ? course.description : text(body, "description", 4000, { optional: true }),
      enrollment: oneOf(body, "enrollment", ["open", "assigned"] as const, course.enrollment),
      status: oneOf(body, "status", ["draft", "published", "archived"] as const, course.status),
    });
    return this.detail(userId, course.id);
  }

  async setInstructor(userId: string, courseId: string, body: Body, present: boolean) {
    const { course } = await this.load(userId, courseId, "manage");
    const target = present ? await this.repo.userByEmail(text(body, "email", 200)) : id(body.userId);
    if (!target) throw notFound("Không tìm thấy người dùng với email này.");
    await this.repo.setInstructor(course.id, target, present);
    return this.detail(userId, course.id);
  }

  // ---- chapters and lessons --------------------------------------------------------------------

  async addChapter(userId: string, courseId: string, body: Body) {
    const { course } = await this.load(userId, courseId, "manage");
    await this.repo.createChapter(course.id, text(body, "title", 160));
    return this.detail(userId, course.id);
  }

  async chapterCourse(userId: string, chapterId: string) {
    const chapter = await this.repo.chapter(id(chapterId));
    if (!chapter) throw notFound("Không tìm thấy chương.");
    await this.load(userId, chapter.courseId, "manage");
    return chapter;
  }

  async updateChapter(userId: string, chapterId: string, body: Body) {
    const chapter = await this.chapterCourse(userId, chapterId);
    await this.repo.updateChapter(chapter.id, body.title === undefined ? chapter.title : text(body, "title", 160), body.position === undefined ? null : integer(body, "position", 0, 10000));
    return this.detail(userId, chapter.courseId);
  }

  async deleteChapter(userId: string, chapterId: string) {
    const chapter = await this.chapterCourse(userId, chapterId);
    if (!(await this.repo.deleteChapter(chapter.id))) throw conflict("CHAPTER_NOT_EMPTY", "Chương còn bài học; hãy xóa hoặc chuyển bài trước.");
    return this.detail(userId, chapter.courseId);
  }

  /** Video, document and quiz lessons; live lessons are created by LiveClassService. */
  async addLesson(userId: string, chapterId: string, body: Body) {
    const chapter = await this.chapterCourse(userId, chapterId);
    const kind = oneOf(body, "kind", KINDS);
    if (kind === "live") throw invalid("Buổi live được tạo kèm lịch họp.");
    const lessonId = await this.repo.createLesson({ courseId: chapter.courseId, chapterId: chapter.id, title: text(body, "title", 160), kind });
    return { id: lessonId };
  }

  async lessonCourse(userId: string, lessonId: string, need: "see" | "manage") {
    const lesson = await this.repo.lesson(id(lessonId));
    if (!lesson) throw notFound("Không tìm thấy bài học.");
    const loaded = await this.load(userId, lesson.courseId, need);
    // A learner reaches published lessons of a course they are enrolled in.
    if (need === "see" && !loaded.manages && (lesson.status !== "published" || !loaded.enrolled))
      throw forbidden();
    return { lesson, ...loaded };
  }

  async updateLesson(userId: string, lessonId: string, body: Body) {
    const { lesson } = await this.lessonCourse(userId, lessonId, "manage");
    const change: Parameters<ElearningRepository["updateLesson"]>[1] = {};
    if (body.title !== undefined) change.title = text(body, "title", 160);
    if (body.status !== undefined) change.status = oneOf(body, "status", ["draft", "published"] as const);
    if (body.body !== undefined) {
      if (typeof body.body !== "string" || body.body.length > 50000) throw invalid("Nội dung tối đa 50.000 ký tự.");
      change.body = body.body;
    }
    if (body.position !== undefined) change.position = integer(body, "position", 0, 10000);
    if (body.chapterId !== undefined) {
      const chapter = await this.repo.chapter(id(body.chapterId));
      if (chapter?.courseId !== lesson.courseId) throw invalid("Chương không thuộc khóa học này.");
      change.chapterId = chapter.id;
    }
    if (lesson.kind === "quiz") {
      if (body.timeLimitSeconds !== undefined)
        change.timeLimitSeconds = body.timeLimitSeconds === null ? null : integer(body, "timeLimitSeconds", 60, 14400);
      if (body.passPercent !== undefined) change.passPercent = integer(body, "passPercent", 0, 100);
      if (body.drawCount !== undefined) change.drawCount = body.drawCount === null ? null : integer(body, "drawCount", 1, 200);
      if (body.shuffle !== undefined) change.shuffle = body.shuffle === true;
      if (body.questionIds !== undefined) {
        if (!Array.isArray(body.questionIds) || body.questionIds.length > 200) throw invalid("Danh sách câu hỏi không hợp lệ.");
        const ids = [...new Set(body.questionIds.map((value) => id(value)))];
        const bank = new Set((await this.repo.questions(lesson.courseId)).map((question) => question.id));
        if (ids.some((questionId) => !bank.has(questionId))) throw invalid("Câu hỏi không thuộc ngân hàng của khóa học.");
        await this.repo.setQuizQuestions(lesson.id, ids);
      }
    }
    const publishing = change.status === "published" && lesson.status !== "published";
    if (publishing) await this.requireReady({ ...lesson, ...change });
    await this.repo.updateLesson(lesson.id, change);
    return { ok: true };
  }

  /** A lesson is published only when a learner can actually use it. */
  private async requireReady(lesson: { id: string; kind: LessonKind; mediaStatus: string; body: string; scheduleId: string | null }) {
    if (lesson.kind === "video" && lesson.mediaStatus !== "ready") throw conflict("NOT_READY", "Video chưa tải lên hoặc chưa xử lý xong.");
    if (lesson.kind === "document" && !lesson.body.trim() && lesson.mediaStatus !== "ready") throw conflict("NOT_READY", "Tài liệu chưa có nội dung hoặc tệp.");
    if (lesson.kind === "quiz" && !(await this.repo.quizQuestionIds(lesson.id)).length) throw conflict("NOT_READY", "Bài kiểm tra chưa có câu hỏi.");
    if (lesson.kind === "live" && !lesson.scheduleId) throw conflict("NOT_READY", "Buổi live chưa có lịch.");
  }

  async deleteLesson(userId: string, lessonId: string) {
    const { lesson } = await this.lessonCourse(userId, lessonId, "manage");
    if (lesson.status === "published") throw conflict("LESSON_PUBLISHED", "Chuyển bài về nháp trước khi xóa.");
    await this.repo.deleteLesson(lesson.id);
    return { ok: true };
  }

  // ---- enrollment (EL-2) ---------------------------------------------------------------------------

  async enrollSelf(userId: string, courseId: string) {
    const { course, access, enrolled } = await this.load(userId, courseId, "see");
    if (!enrolled && !access.canSelfEnroll(course)) throw forbidden();
    await this.repo.enroll(course.id, [userId], "self", null);
    return this.detail(userId, course.id);
  }

  /** By list of emails, by class (a workspace's members) or by unit (its staff and agents). */
  async assign(userId: string, courseId: string, body: Body): Promise<CourseAssignmentResult> {
    const { course } = await this.load(userId, courseId, "manage");
    const userIds: string[] = [];
    const missing: string[] = [];
    if (body.emails !== undefined) {
      if (!Array.isArray(body.emails) || body.emails.length > 500 || body.emails.some((email) => typeof email !== "string"))
        throw invalid("emails phải là danh sách (tối đa 500).");
      const emails = [...new Set((body.emails as string[]).map((email) => email.trim().toLowerCase()).filter(Boolean))];
      const found = await this.repo.usersByEmails(emails);
      userIds.push(...found.map((user) => user.id));
      missing.push(...emails.filter((email) => !found.some((user) => user.email === email)));
    }
    const workspaceId = optionalId(body.workspaceId);
    if (workspaceId) {
      const members = await this.repo.workspaceMembers(workspaceId, userId);
      // Only a member of the class's workspace may enroll it.
      if (!members.length) throw forbidden();
      userIds.push(...members);
    }
    const unitId = optionalId(body.unitId);
    if (unitId) userIds.push(...(await this.repo.unitMembers(unitId)));
    if (!workspaceId && !unitId && body.emails === undefined) throw invalid("Chọn danh sách email, lớp hoặc đơn vị.");
    const unique = [...new Set(userIds)];
    const added = await this.repo.enroll(course.id, unique, "assigned", userId);
    return { added, alreadyEnrolled: unique.length - added, notFound: missing };
  }

  async unenroll(userId: string, courseId: string, learnerId: string) {
    const { course } = await this.load(userId, courseId, "manage");
    await this.repo.unenroll(course.id, id(learnerId));
    return { ok: true };
  }

  // ---- EL-8 certificate, EL-7 discussion -------------------------------------------------------------

  /** Issued on the first request once the learner completed the course. */
  async certificate(userId: string, courseId: string): Promise<CourseCertificate> {
    const { course, enrolled } = await this.load(userId, courseId, "see");
    if (!enrolled || !(await this.repo.completedAt(course.id, userId))) throw conflict("NOT_COMPLETED", "Hoàn thành tất cả bài học để nhận chứng nhận.");
    let code = "";
    for (let attempt = 0; attempt < 5 && !code; attempt++)
      code = await this.repo.issueCertificate(course.id, userId, certificateCode()).catch((error: { code?: string }) => {
        if (error.code === "23505") return ""; // the random code collided; draw again
        throw error;
      });
    return this.verifyCertificate(code);
  }

  /** Public lookup behind the QR code: who completed what, and when. */
  async verifyCertificate(code: string): Promise<CourseCertificate> {
    const normalized = code.trim().toUpperCase();
    const found = /^[A-Z0-9-]{8,16}$/.test(normalized) ? await this.repo.certificateByCode(normalized) : null;
    if (!found) throw notFound("Không tìm thấy chứng nhận với mã này.");
    return { ...found, issuedAt: found.issuedAt.toISOString() };
  }

  /**
   * The course's discussion space: a workspace created on first use, with instructors as admins
   * and learners as members, so group chat, files and meeting rooms work unchanged.
   */
  async discussion(userId: string, courseId: string) {
    const { course, manages, enrolled } = await this.load(userId, courseId, "see");
    if (!manages && !enrolled) throw forbidden();
    let workspaceId = await this.repo.courseWorkspace(course.id);
    if (!workspaceId) {
      workspaceId = (await createWorkspace(course.ownerId, `${course.code} · ${course.title}`.slice(0, 80))).id;
      await this.repo.setCourseWorkspace(course.id, workspaceId);
    }
    await this.repo.syncCourseMembers(course.id, workspaceId);
    const channels = await getWorkspaceChannels(userId, workspaceId);
    return {
      workspaceId,
      channelId: channels.find((channel) => channel.type === "text")?.id ?? null,
      roomId: channels.find((channel) => channel.type === "video")?.id ?? null,
    };
  }

  // ---- question bank (EL-4) ------------------------------------------------------------------------

  async questions(userId: string, courseId: string): Promise<CourseQuestion[]> {
    const { course } = await this.load(userId, courseId, "manage");
    return this.repo.questions(course.id);
  }

  async saveQuestion(userId: string, courseId: string | null, questionId: string | null, body: Body) {
    let targetCourse = courseId;
    if (questionId) {
      const existing = await this.repo.question(id(questionId));
      if (!existing) throw notFound("Không tìm thấy câu hỏi.");
      targetCourse = existing.courseId;
    }
    const { course } = await this.load(userId, targetCourse!, "manage");
    const kind = oneOf<QuestionKind>(body, "kind", ["single", "multiple", "true_false"]);
    const options = (kind === "true_false" ? [] : body.options) as QuestionOption[];
    if (!Array.isArray(options) || options.some((option) => typeof option?.id !== "string" || typeof option?.text !== "string" || option.text.length > 500))
      throw invalid("Phương án không hợp lệ.");
    const answer = body.answer as Answer;
    if (!Array.isArray(answer)) throw invalid("Đáp án không hợp lệ.");
    const problem = questionProblem(kind, options, answer);
    if (problem) throw invalid(problem);
    const savedId = await this.repo.saveQuestion(questionId, course.id, {
      kind,
      prompt: text(body, "prompt", 2000),
      options: options.map((option) => ({ id: option.id, text: option.text.trim() })),
      answer,
      explanation: text(body, "explanation", 2000, { optional: true }),
      points: integer(body, "points", 1, 100, 1),
    });
    return { id: savedId };
  }

  async deleteQuestion(userId: string, questionId: string) {
    const existing = await this.repo.question(id(questionId));
    if (!existing) throw notFound("Không tìm thấy câu hỏi.");
    await this.load(userId, existing.courseId, "manage");
    await this.repo.deleteQuestion(existing.id).catch((error: { code?: string }) => {
      if (error.code === "23503") throw conflict("QUESTION_IN_USE", "Câu hỏi đang dùng trong một bài kiểm tra.");
      throw error;
    });
    return { ok: true };
  }

  // ---- progress (EL-5) -------------------------------------------------------------------------------

  async progress(userId: string, courseId: string): Promise<CourseProgressReport> {
    const { course } = await this.load(userId, courseId, "manage");
    const lessons = (await this.repo.lessons(course.id, userId)).filter((lesson) => lesson.status === "published");
    const report = await this.repo.progressReport(course.id);
    return {
      lessons: lessons.map(({ id, title, kind }) => ({ id, title, kind })),
      learners: report.learners.map((learner) => {
        const completed = report.done.filter((row) => row.user_id === learner.userId).map((row) => row.lesson_id);
        return {
          userId: learner.userId,
          displayName: learner.displayName,
          email: learner.email,
          source: learner.source,
          percent: completionPercent(lessons.length, completed.length),
          completedLessonIds: completed,
          quizPercents: Object.fromEntries(
            report.quizzes.filter((row) => row.user_id === learner.userId).map((row) => [row.lesson_id, Math.round(row.best * 100) / 100]),
          ),
          completedAt: learner.completedAt?.toISOString() ?? null,
        };
      }),
    };
  }

  /** CSV of the progress table for Excel. */
  async progressCsv(userId: string, courseId: string) {
    const report = await this.progress(userId, courseId);
    const quizzes = report.lessons.filter((lesson) => lesson.kind === "quiz");
    const cell = (value: string) => (/[",\n;]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    const lines = [
      ["Họ tên", "Email", "Hoàn thành (%)", ...quizzes.map((quiz) => `Điểm: ${quiz.title}`)],
      ...report.learners.map((learner) => [
        learner.displayName,
        learner.email,
        String(learner.percent),
        ...quizzes.map((quiz) => (learner.quizPercents[quiz.id] === undefined ? "" : String(learner.quizPercents[quiz.id]))),
      ]),
    ];
    return lines.map((line) => line.map(cell).join(",")).join("\r\n");
  }
}

// No 0/O/1/I so a code read off paper is typed back right.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const certificateCode = () => `TDTU-${Array.from({ length: 8 }, (_, i) => (i === 4 ? "-" : "") + ALPHABET[randomInt(ALPHABET.length)]).join("")}`;
