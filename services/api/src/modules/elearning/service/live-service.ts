import type { LiveAttendanceRow } from "@doan/shared";
import { query } from "../../../infrastructure/database/db.js";
import { conflict, id, invalid, text, type Body } from "../../callcenter/service/input.js";
import { createMeetingSchedule, listMeetingSchedules } from "../../meetings/schedules.js";
import { liveAttendance } from "../domain/progress.js";
import type { ElearningRepository } from "../repository/elearning-repository.js";
import type { CourseService } from "./course-service.js";

/**
 * EL-6 / LT-2: a live lesson is a meeting schedule in a class room. When the class is over its
 * attendance is closed from the meeting's join/leave records and the recording becomes a replay.
 */
export class LiveClassService {
  constructor(
    private readonly repo: ElearningRepository,
    private readonly courses: CourseService,
    private readonly log: (event: string, details?: Record<string, unknown>) => void,
  ) {}

  /** From an existing schedule the lecturer manages, or a new one in a room of theirs. */
  async create(userId: string, chapterId: string, body: Body) {
    const chapter = await this.courses.chapterCourse(userId, chapterId);
    const title = text(body, "title", 160);
    let scheduleId: string;
    if (body.scheduleId !== undefined) {
      scheduleId = id(body.scheduleId);
      const schedule = (await listMeetingSchedules(userId)).find((item) => item.id === scheduleId);
      if (!schedule?.canManage) throw invalid("Chọn một lịch họp sắp tới do bạn quản lý.");
    } else {
      const course = (await this.courses.load(userId, chapter.courseId, "manage")).course;
      scheduleId = (
        await createMeetingSchedule(userId, {
          roomId: body.roomId,
          title,
          description: `Buổi học trực tuyến · ${course.code} ${course.title}`.slice(0, 1000),
          startsAt: body.startsAt,
          endsAt: body.endsAt,
        })
      ).id;
    }
    const lessonId = await this.repo.createLesson({ courseId: chapter.courseId, chapterId: chapter.id, title, kind: "live", scheduleId }).catch(
      (error: { code?: string }) => {
        if (error.code === "23505") throw conflict("SCHEDULE_IN_USE", "Lịch họp này đã gắn với một buổi live khác.");
        throw error;
      },
    );
    return { id: lessonId };
  }

  async attendance(userId: string, lessonId: string): Promise<LiveAttendanceRow[]> {
    const { lesson } = await this.courses.lessonCourse(userId, lessonId, "manage");
    if (lesson.kind !== "live") throw invalid("Bài này không phải buổi live.");
    return this.repo.liveAttendanceRows(lesson.id);
  }

  /** LT-2 by hand: the lecturer closes the class without waiting for the automatic pass. */
  async close(userId: string, lessonId: string) {
    const { lesson } = await this.courses.lessonCourse(userId, lessonId, "manage");
    if (lesson.kind !== "live" || !lesson.scheduleId) throw invalid("Bài này không phải buổi live.");
    if (lesson.attendanceClosedAt) throw conflict("ALREADY_CLOSED", "Buổi live đã chốt điểm danh.");
    const sessions = await query<{ open: boolean }>(`SELECT ended_at IS NULL AS open FROM meeting_sessions WHERE schedule_id=$1`, [lesson.scheduleId]);
    if (!sessions.rowCount) throw conflict("NOT_HELD", "Lớp chưa diễn ra.");
    if (sessions.rows.some((row) => row.open)) throw conflict("STILL_RUNNING", "Lớp vẫn đang diễn ra; kết thúc phòng họp trước khi chốt.");
    return this.repo.closeLiveClass(lesson.id, liveAttendance);
  }

  /** Background pass: classes whose meeting ended (and whose recordings are processed) close themselves. */
  async closeFinished() {
    for (const lessonId of await this.repo.finishedLiveLessons()) {
      const result = await this.repo.closeLiveClass(lessonId, liveAttendance).catch((error) => {
        this.log("live_class_close_failed", { lessonId, message: String(error) });
        return null;
      });
      if (result) this.log("live_class_closed", { lessonId, ...result });
    }
  }
}
