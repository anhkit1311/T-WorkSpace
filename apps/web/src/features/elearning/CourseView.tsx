import { useCallback, useEffect, useState } from "react";
import type { CourseDetail, LessonKind, MeetingScheduleItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Badge, Button } from "../../shared/ui/Primitives";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { getMeetingSchedulesApi } from "../meetings/api";
import { coursesApi } from "./courses-api";
import { LessonView } from "./LessonView";
import { CertificateDialog } from "./Certificate";
import { CourseLearners, QuestionBank } from "./CourseAdmin";
import { STATUS_LABEL } from "./CoursesWorkspace";

export const KIND: Record<LessonKind, [string, IconName]> = {
  video: ["Video", "play"],
  document: ["Tài liệu", "file"],
  quiz: ["Kiểm tra", "check-square"],
  live: ["Buổi live", "video"],
};
type Tab = "content" | "learners" | "questions" | "settings";

export function CourseView({ courseId, onBack }: { courseId: string; onBack: () => void }) {
  const { accessToken, notify, navigate } = useApp();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [certificateOpen, setCertificateOpen] = useState(false);
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("content");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const next = await coursesApi.detail(accessToken, courseId);
      setCourse(next);
      setLessonId((current) => current ?? next.chapters.flatMap((chapter) => chapter.lessons)[0]?.id ?? null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không tải được khóa học.");
    }
  }, [accessToken, courseId]);
  useEffect(() => void load(), [load]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setError("");
    try {
      const result = await action();
      if (result && typeof result === "object" && "chapters" in result) setCourse(result as CourseDetail);
      else await load();
      notify(label);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không thực hiện được thao tác.");
      return false;
    }
  };

  if (!course)
    return (
      <div className="courses">
        <Button variant="ghost" icon="chevron-left" onClick={onBack}>Khóa học</Button>
        <p role={error ? "alert" : "status"}>{error || "Đang tải…"}</p>
      </div>
    );

  const token = accessToken!;
  const tabs: [Tab, string][] = course.canManage
    ? [["content", "Nội dung"], ["learners", "Học viên & tiến độ"], ["questions", "Ngân hàng câu hỏi"], ["settings", "Thiết lập"]]
    : [];

  return (
    <div className="courses course-view">
      <Button variant="ghost" icon="chevron-left" onClick={onBack}>Khóa học</Button>
      <header className="courses-head">
        <div>
          <span className="course-card__code">{course.code} · {course.unitName}</span>
          <h1>{course.title}</h1>
          {course.description && <p>{course.description}</p>}
          <p className="course-card__meta">
            Giảng viên: {[course.ownerName, ...course.instructors.map((item) => item.displayName)].join(", ")}
          </p>
        </div>
        <div className="course-actions">
          {course.canManage && <Badge tone={course.status === "published" ? "green" : "amber"}>{STATUS_LABEL[course.status]}</Badge>}
          {course.progress !== null && <Badge tone="blue">Hoàn thành {course.progress}%</Badge>}
          {(course.enrolled || course.canManage) && (
            <Button
              variant="secondary"
              icon="message"
              onClick={() =>
                void coursesApi.discussion(token, course.id).then(
                  (space) => navigate({ view: "chat", workspaceId: space.workspaceId, ...(space.channelId ? { channelId: space.channelId } : {}) }),
                  (failure) => notify("Không mở được thảo luận", failure.message, "warning"),
                )
              }
            >
              Thảo luận
            </Button>
          )}
          {course.enrolled && course.progress === 100 && (
            <Button icon="star" onClick={() => setCertificateOpen(true)}>Nhận chứng nhận</Button>
          )}
          {course.canEnroll && (
            <Button icon="user-plus" onClick={() => void run("Đã ghi danh", () => coursesApi.enroll(token, course.id))}>
              Ghi danh
            </Button>
          )}
        </div>
      </header>
      {certificateOpen && <CertificateDialog token={token} courseId={course.id} onClose={() => setCertificateOpen(false)} />}
      {course.progress !== null && (
        <span className="course-progress" aria-hidden="true">
          <span style={{ width: `${course.progress}%` }} />
        </span>
      )}
      {tabs.length > 0 && (
        <div className="courses-filters" role="tablist" aria-label="Quản lý khóa học">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="courses-error">{error}</p>}

      {tab === "content" && (
        <div className="course-layout">
          <Outline course={course} lessonId={lessonId} onOpen={setLessonId} run={run} />
          <div className="course-lesson">
            {lessonId ? (
              <LessonView
                key={lessonId}
                lessonId={lessonId}
                course={course}
                onChanged={() => void load()}
                onDeleted={() => {
                  setLessonId(null);
                  void load();
                }}
              />
            ) : (
              <p className="courses-empty">{course.enrolled || course.canManage ? "Chọn một bài học." : "Ghi danh để bắt đầu học."}</p>
            )}
          </div>
        </div>
      )}
      {tab === "learners" && <CourseLearners course={course} />}
      {tab === "questions" && <QuestionBank course={course} />}
      {tab === "settings" && <CourseSettings course={course} run={run} />}
    </div>
  );
}

type Run = (label: string, action: () => Promise<unknown>) => Promise<boolean>;

function Outline({ course, lessonId, onOpen, run }: { course: CourseDetail; lessonId: string | null; onOpen: (id: string) => void; run: Run }) {
  const { accessToken } = useApp();
  const token = accessToken!;
  const [chapterTitle, setChapterTitle] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const canOpen = course.enrolled || course.canManage;
  return (
    <nav className="course-outline" aria-label="Nội dung khóa học">
      {course.chapters.map((chapter, index) => (
        <section key={chapter.id}>
          <h3>
            {/^chương\s*\d/i.test(chapter.title) ? chapter.title : `Chương ${index + 1}. ${chapter.title}`}
          </h3>
          <ol>
            {chapter.lessons.map((lesson) => (
              <li key={lesson.id}>
                <button type="button" disabled={!canOpen} aria-current={lesson.id === lessonId} onClick={() => onOpen(lesson.id)}>
                  <Icon name={lesson.completed ? "check" : KIND[lesson.kind][1]} size={14} />
                  <span>{lesson.title}</span>
                  {lesson.status === "draft" && <Badge tone="amber">Nháp</Badge>}
                </button>
              </li>
            ))}
          </ol>
          {course.canManage &&
            (adding === chapter.id ? (
              <NewLesson chapterId={chapter.id} onDone={(id) => { setAdding(null); if (id) onOpen(id); }} run={run} />
            ) : (
              <div className="course-outline__tools">
                <Button size="sm" variant="ghost" icon="plus" onClick={() => setAdding(chapter.id)}>Bài học</Button>
                {!chapter.lessons.length && (
                  <Button size="sm" variant="ghost" icon="trash" onClick={() => void run("Đã xóa chương", () => coursesApi.deleteChapter(token, chapter.id))}>
                    Xóa chương
                  </Button>
                )}
              </div>
            ))}
        </section>
      ))}
      {course.canManage && (
        <form
          className="course-inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run("Đã thêm chương", () => coursesApi.addChapter(token, course.id, chapterTitle.trim())).then((ok) => ok && setChapterTitle(""));
          }}
        >
          <input value={chapterTitle} onChange={(event) => setChapterTitle(event.target.value)} placeholder="Tên chương mới" aria-label="Tên chương mới" maxLength={160} required />
          <Button size="sm" type="submit" icon="plus">Chương</Button>
        </form>
      )}
      {!course.chapters.length && <p className="courses-empty">Khóa học chưa có nội dung.</p>}
    </nav>
  );
}

/** Video, document and quiz lessons start empty; a live lesson picks one of the lecturer's meeting schedules (EL-6). */
function NewLesson({ chapterId, onDone, run }: { chapterId: string; onDone: (id: string | null) => void; run: Run }) {
  const { accessToken } = useApp();
  const [kind, setKind] = useState<LessonKind>("video");
  const [title, setTitle] = useState("");
  const [schedules, setSchedules] = useState<MeetingScheduleItem[] | null>(null);
  const [scheduleId, setScheduleId] = useState("");
  useEffect(() => {
    if (kind === "live" && !schedules && accessToken)
      void getMeetingSchedulesApi(accessToken).then((items) => setSchedules(items.filter((item) => item.canManage)), () => setSchedules([]));
  }, [kind, schedules, accessToken]);

  return (
    <form
      className="course-inline-form course-inline-form--stack"
      onSubmit={(event) => {
        event.preventDefault();
        let created: string | null = null;
        void run("Đã thêm bài học", async () => {
          created = (
            kind === "live"
              ? await coursesApi.addLive(accessToken!, chapterId, { title: title.trim(), scheduleId })
              : await coursesApi.addLesson(accessToken!, chapterId, { title: title.trim(), kind })
          ).id;
        }).then((ok) => ok && onDone(created));
      }}
    >
      <select value={kind} onChange={(event) => setKind(event.target.value as LessonKind)} aria-label="Loại bài">
        {(Object.keys(KIND) as LessonKind[]).map((value) => (
          <option key={value} value={value}>{KIND[value][0]}</option>
        ))}
      </select>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Tên bài học" aria-label="Tên bài học" maxLength={160} required />
      {kind === "live" && (
        <select value={scheduleId} onChange={(event) => setScheduleId(event.target.value)} required aria-label="Lịch họp">
          <option value="">{schedules?.length ? "— Chọn lịch họp —" : "Chưa có lịch họp sắp tới (tạo trong Họp trực tuyến)"}</option>
          {schedules?.map((item) => (
            <option key={item.id} value={item.id}>
              {new Date(item.startsAt).toLocaleString("vi-VN", { hour12: false })} · {item.title} ({item.roomName})
            </option>
          ))}
        </select>
      )}
      <div className="course-outline__tools">
        <Button size="sm" variant="ghost" type="button" onClick={() => onDone(null)}>Hủy</Button>
        <Button size="sm" type="submit">Thêm</Button>
      </div>
    </form>
  );
}

function CourseSettings({ course, run }: { course: CourseDetail; run: Run }) {
  const { accessToken } = useApp();
  const token = accessToken!;
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description);
  const [enrollment, setEnrollment] = useState(course.enrollment);
  const [email, setEmail] = useState("");
  return (
    <div className="course-panel">
      <form
        className="courses-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run("Đã lưu khóa học", () => coursesApi.update(token, course.id, { title: title.trim(), description: description.trim(), enrollment }));
        }}
      >
        <label>Tên khóa học<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={160} /></label>
        <label>Mô tả<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={4000} /></label>
        <label>
          Ghi danh
          <select value={enrollment} onChange={(event) => setEnrollment(event.target.value as typeof enrollment)}>
            <option value="open">Mở: học viên tự đăng ký</option>
            <option value="assigned">Chỉ định: giảng viên gán học viên</option>
          </select>
        </label>
        <div className="course-outline__tools">
          <Button type="submit">Lưu</Button>
          {course.status !== "published" && (
            <Button variant="secondary" type="button" onClick={() => void run("Đã xuất bản khóa học", () => coursesApi.update(token, course.id, { status: "published" }))}>
              Xuất bản
            </Button>
          )}
          {course.status === "published" && (
            <Button variant="ghost" type="button" onClick={() => void run("Đã chuyển về nháp", () => coursesApi.update(token, course.id, { status: "draft" }))}>
              Chuyển về nháp
            </Button>
          )}
          {course.status !== "archived" && (
            <Button variant="ghost" type="button" onClick={() => void run("Đã lưu trữ khóa học", () => coursesApi.update(token, course.id, { status: "archived" }))}>
              Lưu trữ
            </Button>
          )}
        </div>
      </form>
      <form
        className="course-inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run("Đã thêm giảng viên", () => coursesApi.addInstructor(token, course.id, email.trim())).then((ok) => ok && setEmail(""));
        }}
      >
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email giảng viên cùng dạy" aria-label="Email giảng viên cùng dạy" required />
        <Button size="sm" type="submit" icon="user-plus">Thêm giảng viên</Button>
      </form>
    </div>
  );
}
