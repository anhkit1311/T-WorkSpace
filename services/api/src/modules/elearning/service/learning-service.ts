import { randomUUID } from "node:crypto";
import type { LessonDetail, QuizAttempt } from "@doan/shared";
import { query } from "../../../infrastructure/database/db.js";
import { conflict, forbidden, id, invalid, notFound, text, type Body } from "../../callcenter/service/input.js";
import { draftProblem, drawQuestions, gradeAttempt, isLate, shuffledOptions } from "../domain/quiz.js";
import type { ElearningRepository } from "../repository/elearning-repository.js";
import type { CourseService } from "./course-service.js";

/** What a learner does inside a lesson: read/watch, take the quiz, ask for help (LT-1). */
export class LearningService {
  constructor(
    private readonly repo: ElearningRepository,
    private readonly courses: CourseService,
  ) {}

  async lesson(userId: string, lessonId: string): Promise<LessonDetail> {
    const { lesson, manages } = await this.courses.lessonCourse(userId, lessonId, "see");
    const completed = (await this.repo.lessons(lesson.courseId, userId)).find((item) => item.id === lesson.id)?.completed ?? false;
    let quiz: LessonDetail["quiz"] = null;
    if (lesson.kind === "quiz") {
      const [questionIds, best, openAttemptId] = await Promise.all([
        this.repo.quizQuestionIds(lesson.id),
        this.repo.bestQuiz(lesson.id, userId),
        this.repo.openAttempt(lesson.id, userId),
      ]);
      quiz = {
        timeLimitSeconds: lesson.timeLimitSeconds,
        passPercent: lesson.passPercent,
        questionIds,
        drawCount: lesson.drawCount,
        shuffle: lesson.shuffle,
        bestPercent: best?.best === null || best?.best === undefined ? null : Math.round(best.best * 100) / 100,
        passed: Boolean(best?.passed),
        openAttemptId,
      };
    }
    let live: LessonDetail["live"] = null;
    if (lesson.kind === "live") {
      const schedule = lesson.scheduleId ? await this.repo.liveSchedule(lesson.scheduleId) : null;
      const mine = await this.repo.liveAttendance(lesson.id, userId);
      live = {
        scheduleId: schedule?.id ?? null,
        roomId: schedule?.channelId ?? null,
        workspaceId: schedule?.workspaceId ?? null,
        startsAt: schedule?.startsAt.toISOString() ?? null,
        endsAt: schedule?.endsAt.toISOString() ?? null,
        attendanceClosed: Boolean(lesson.attendanceClosedAt),
        attended: mine?.attended ?? null,
        ratio: mine ? Number(mine.ratio) : null,
      };
    }
    return {
      id: lesson.id,
      courseId: lesson.courseId,
      chapterId: lesson.chapterId,
      title: lesson.title,
      kind: lesson.kind,
      status: lesson.status,
      position: lesson.position,
      durationSeconds: lesson.durationSeconds,
      mediaStatus: lesson.mediaStatus,
      mediaName: lesson.mediaName,
      mediaError: manages ? lesson.mediaError : null,
      recordingId: lesson.recordingId,
      transcriptStatus: lesson.transcriptStatus,
      body: lesson.body,
      completed,
      canManage: manages,
      quiz,
      live,
    };
  }

  /** Videos and documents are completed by the learner; quizzes and live classes by their rules. */
  async complete(userId: string, lessonId: string) {
    const { lesson, enrolled } = await this.courses.lessonCourse(userId, lessonId, "see");
    if (!enrolled) throw forbidden();
    if (lesson.kind !== "video" && lesson.kind !== "document") throw conflict("NOT_SELF_COMPLETED", "Bài này hoàn thành theo kết quả kiểm tra hoặc điểm danh.");
    await this.repo.complete(null, lesson.id, userId);
    return { ok: true };
  }

  // ---- quiz (EL-4) -----------------------------------------------------------------------------

  /** Starts an attempt (or resumes the open one) with the timer running on the server. */
  async startQuiz(userId: string, lessonId: string): Promise<QuizAttempt> {
    const { lesson, enrolled, manages } = await this.courses.lessonCourse(userId, lessonId, "see");
    if (lesson.kind !== "quiz") throw invalid("Bài này không phải bài kiểm tra.");
    if (!enrolled && !manages) throw forbidden();
    if (!(await this.repo.quizQuestionIds(lesson.id)).length) throw conflict("NOT_READY", "Bài kiểm tra chưa có câu hỏi.");
    const open = await this.repo.openAttempt(lesson.id, userId);
    const attemptId =
      open ??
      (await this.repo
        .startAttempt(lesson.id, userId, lesson.timeLimitSeconds, drawQuestions(await this.repo.quizQuestionIds(lesson.id), lesson.drawCount, lesson.shuffle))
        .catch(async (error: { code?: string }) => {
        // Two tabs starting at once: the unique index keeps one open attempt.
        if (error.code === "23505") return (await this.repo.openAttempt(lesson.id, userId))!;
        throw error;
      }));
    return this.attempt(userId, attemptId);
  }

  async attempt(userId: string, attemptId: string): Promise<QuizAttempt> {
    const attempt = await this.repo.attempt(id(attemptId));
    if (!attempt || attempt.userId !== userId) throw notFound("Không tìm thấy lượt làm bài.");
    const [questions, lesson] = await Promise.all([this.attemptQuestions(attempt), this.repo.lesson(attempt.lessonId)]);
    const submitted = Boolean(attempt.submittedAt);
    return {
      id: attempt.id,
      lessonId: attempt.lessonId,
      startedAt: attempt.startedAt.toISOString(),
      deadlineAt: attempt.deadlineAt?.toISOString() ?? null,
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      // Answers never leave the server before submission.
      questions: questions.map(({ id, kind, prompt, options, points }) => ({
        id,
        kind,
        prompt,
        options: lesson?.shuffle ? shuffledOptions(options, attempt.id) : options,
        points,
      })),
      // The learner's own draft, so a reload or another device continues where they were.
      answers: (attempt.answers as QuizAttempt["answers"]) ?? {},
      savedAt: attempt.savedAt?.toISOString() ?? null,
      score: submitted ? Number(attempt.score) : null,
      maxScore: submitted ? Number(attempt.maxScore) : null,
      passed: submitted ? attempt.passed : null,
      review: submitted
        ? gradeAttempt(questions, attempt.answers ?? {}, lesson?.passPercent ?? 0).results.map((result) => {
            const question = questions.find((item) => item.id === result.questionId)!;
            return { ...result, answer: question.answer, explanation: question.explanation };
          })
        : null,
    };
  }

  async submitQuiz(userId: string, attemptId: string, body: Body): Promise<QuizAttempt> {
    const attempt = await this.repo.attempt(id(attemptId));
    if (!attempt || attempt.userId !== userId) throw notFound("Không tìm thấy lượt làm bài.");
    if (attempt.submittedAt) return this.attempt(userId, attempt.id);
    const lesson = await this.repo.lesson(attempt.lessonId);
    if (!lesson) throw notFound("Không tìm thấy bài học.");
    const questions = await this.attemptQuestions(attempt);
    const raw = body.answers ?? {};
    const problem = draftProblem(raw, questions.map((question) => question.id));
    if (problem) throw invalid(problem);
    // Past the deadline (plus grace) the attempt still closes, counting only what was autosaved in time.
    const answers = isLate(attempt.deadlineAt, new Date()) ? (attempt.answers ?? {}) : (raw as Record<string, unknown>);
    const graded = gradeAttempt(questions, answers, lesson.passPercent);
    await this.repo.submitAttempt(attempt.id, { answers, score: graded.score, maxScore: graded.maxScore, passed: graded.passed });
    return this.attempt(userId, attempt.id);
  }

  /** Autosave of the answers while the attempt runs (EL-4); refused after the deadline. */
  async saveAnswers(userId: string, attemptId: string, body: Body) {
    const attempt = await this.repo.attempt(id(attemptId));
    if (!attempt || attempt.userId !== userId) throw notFound("Không tìm thấy lượt làm bài.");
    if (attempt.submittedAt) throw conflict("SUBMITTED", "Bài đã nộp.");
    if (isLate(attempt.deadlineAt, new Date())) throw conflict("TIME_UP", "Đã hết giờ làm bài.");
    const answers = body.answers ?? {};
    const problem = draftProblem(answers, (await this.attemptQuestions(attempt)).map((question) => question.id));
    if (problem) throw invalid(problem);
    if (!(await this.repo.saveDraft(attempt.id, answers as Record<string, unknown>))) throw conflict("SUBMITTED", "Bài đã nộp.");
    return { savedAt: new Date().toISOString() };
  }

  private attemptQuestions(attempt: { lessonId: string; questionIds: string[] | null }) {
    return attempt.questionIds ? this.repo.questionsByIds(attempt.questionIds) : this.repo.quizQuestions(attempt.lessonId);
  }

  // ---- LT-1 ------------------------------------------------------------------------------------------

  /**
   * "Cần hỗ trợ": opens a ticket in the unit's call-center department carrying the course and
   * lesson, and returns the hotline to call. The agent finds the context on the ticket.
   */
  async requestSupport(userId: string, lessonId: string, body: Body) {
    const { lesson, course, enrolled, manages } = await this.courses.lessonCourse(userId, lessonId, "see");
    if (!enrolled && !manages) throw forbidden();
    if (!(await this.repo.hasSupportDepartment(course.unitId)))
      throw conflict("NO_SUPPORT_DEPARTMENT", "Đơn vị phụ trách khóa học chưa có tổng đài hỗ trợ.");
    const message = text(body, "message", 2000, { optional: true });
    const learner = (await query<{ display_name: string; email: string; phone: string | null }>(`SELECT display_name,email,phone FROM users WHERE id=$1`, [userId])).rows[0];
    const ticketId = randomUUID();
    const created = await query<{ number: string }>(
      `INSERT INTO cc_tickets(id,department_id,source,caller_number,caller_user_id,subject,description,created_by,lesson_id)
       VALUES($1,$2,'elearning',$3,$4,$5,$6,$4,$7) RETURNING number`,
      [
        ticketId,
        course.unitId,
        learner.phone,
        userId,
        `Hỗ trợ học tập: ${course.code} — ${lesson.title}`.slice(0, 200),
        [
          `Học viên: ${learner.display_name} <${learner.email}>`,
          `Khóa học: ${course.code} · ${course.title}`,
          `Bài học: ${lesson.title}`,
          message ? `Nội dung: ${message}` : "",
        ].filter(Boolean).join("\n"),
        lesson.id,
      ],
    );
    const ticketNumber = `TK-${String(created.rows[0].number).padStart(6, "0")}`;
    return {
      ticketNumber,
      hotline: await this.repo.supportHotline(course.unitId),
      // LT1: the browser call goes to this department and shows the agent where the learner is stuck.
      departmentId: course.unitId,
      context: `${course.code} · ${lesson.title} · phiếu ${ticketNumber}`.slice(0, 500),
    };
  }
}
