import { useCallback, useEffect, useState } from "react";
import type { CourseDetail, LessonKind, MeetingScheduleItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Button } from "../../shared/ui/Primitives";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { cn } from "../../shared/lib/utils";
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
const BTN =
  "inline-flex h-[34px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-semibold whitespace-nowrap transition-colors";
const BTN_PRIMARY = `${BTN} bg-primary text-primary-foreground hover:bg-primary/90`;
const BTN_GHOST = `${BTN} border bg-card text-foreground hover:bg-secondary`;
const BACK =
  "inline-flex cursor-pointer items-center gap-1 justify-self-start text-[13px] text-muted-foreground hover:text-foreground";
const LINK =
  "inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground";
const CHIP = "shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap";
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
      setLessonId(
        (current) => current ?? next.chapters.flatMap((chapter) => chapter.lessons)[0]?.id ?? null,
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không tải được khóa học.");
    }
  }, [accessToken, courseId]);
  useEffect(() => void load(), [load]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setError("");
    try {
      const result = await action();
      if (result && typeof result === "object" && "chapters" in result)
        setCourse(result as CourseDetail);
      else await load();
      notify(label);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không thực hiện được thao tác.");
      return false;
    }
  };

  const back = (
    <button type="button" className={BACK} onClick={onBack}>
      <Icon name="chevron-left" size={15} />
      Khóa học
    </button>
  );
  if (!course)
    return (
      <div className="tw grid gap-3 px-7 py-5 text-foreground max-md:px-3.5">
        {back}
        <p role={error ? "alert" : "status"} className="text-[13px] text-muted-foreground">
          {error || "Đang tải…"}
        </p>
      </div>
    );

  const token = accessToken!;
  const tabs: [Tab, string][] = course.canManage
    ? [
        ["content", "Nội dung"],
        ["learners", "Học viên & tiến độ"],
        ["questions", "Ngân hàng câu hỏi"],
        ["settings", "Thiết lập"],
      ]
    : [];
  const lessons = course.chapters.flatMap((chapter) => chapter.lessons);

  return (
    <div className="grid w-full grid-cols-[320px_minmax(0,1fr)] items-start text-foreground max-lg:grid-cols-1">
      {/* Left: the course and its outline, pinned while the lesson scrolls. */}
      <div className="sticky top-0 max-h-[calc(100vh-57px)] min-h-[calc(100vh-57px)] self-start overflow-y-auto border-0 border-r border-solid border-border max-lg:static max-lg:max-h-none max-lg:min-h-0 max-lg:border-r-0 max-lg:border-b">
        <header className="tw grid gap-1.5 border-b px-4 py-3.5">
          {back}
          <small className="text-xs text-muted-foreground">
            {course.code} · {course.unitName}
          </small>
          <h1 className="m-0 text-[15px] leading-snug font-semibold tracking-normal text-foreground">
            {course.title}
          </h1>
          {course.description && (
            <p className="m-0 line-clamp-3 text-[13px] text-muted-foreground">
              {course.description}
            </p>
          )}
          <small className="text-xs text-muted-foreground">
            Giảng viên:{" "}
            {[course.ownerName, ...course.instructors.map((item) => item.displayName)].join(", ")}
          </small>
          {course.progress !== null && (
            <>
              <span
                className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary"
                aria-hidden="true"
              >
                <span
                  className={cn(
                    "block h-full rounded-full",
                    course.progress === 100 ? "bg-emerald-500" : "bg-brand",
                  )}
                  style={{ width: `${course.progress}%` }}
                />
              </span>
              <small className="text-xs text-muted-foreground">
                {lessons.filter((lesson) => lesson.completed).length}/{lessons.length} bài · hoàn
                thành {course.progress}%
              </small>
            </>
          )}
        </header>
        {tab === "content" && (
          <Outline course={course} lessonId={lessonId} onOpen={setLessonId} run={run} />
        )}
      </div>

      <div className="min-w-0">
        <div className="tw flex min-h-[49px] flex-wrap items-center gap-x-1 gap-y-2 border-b px-5 max-md:px-3">
          {tabs.length > 0 && (
            <div
              className="flex max-w-full overflow-x-auto overflow-y-hidden"
              role="tablist"
              aria-label="Quản lý khóa học"
            >
              {tabs.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  className={cn(
                    "-mb-px cursor-pointer border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap",
                    tab === id
                      ? "border-foreground font-semibold text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <span className="flex-1" />
          <div className="flex flex-wrap items-center gap-2 py-2">
            {course.canManage && (
              <span
                className={cn(
                  CHIP,
                  course.status === "published"
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                    : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                )}
              >
                {STATUS_LABEL[course.status]}
              </span>
            )}
            {course.requested && (
              <span
                className={cn(
                  CHIP,
                  "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                )}
              >
                Đang chờ giảng viên duyệt
              </span>
            )}
            {(course.enrolled || course.canManage) && (
              <button
                type="button"
                className={BTN_GHOST}
                onClick={() =>
                  void coursesApi.discussion(token, course.id).then(
                    (space) =>
                      navigate({
                        view: "chat",
                        workspaceId: space.workspaceId,
                        ...(space.channelId ? { channelId: space.channelId } : {}),
                      }),
                    (failure) => notify("Không mở được thảo luận", failure.message, "warning"),
                  )
                }
              >
                <Icon name="message" size={15} />
                Thảo luận
              </button>
            )}
            {course.enrolled && course.progress === 100 && (
              <button
                type="button"
                className={BTN_PRIMARY}
                onClick={() => setCertificateOpen(true)}
              >
                <Icon name="star" size={15} />
                Nhận chứng nhận
              </button>
            )}
            {course.canEnroll && (
              <button
                type="button"
                className={BTN_PRIMARY}
                onClick={() =>
                  void run(
                    course.enrollment === "approval" ? "Đã gửi yêu cầu ghi danh" : "Đã ghi danh",
                    () => coursesApi.enroll(token, course.id),
                  )
                }
              >
                <Icon name="user-plus" size={15} />
                {course.enrollment === "approval" ? "Gửi yêu cầu ghi danh" : "Ghi danh"}
              </button>
            )}
          </div>
        </div>
        {certificateOpen && (
          <CertificateDialog
            token={token}
            courseId={course.id}
            onClose={() => setCertificateOpen(false)}
          />
        )}

        {/* The lesson body (courses.css) needs the legacy heading margins, so it stays outside the .tw reset. */}
        <div className="mx-auto grid max-w-[1100px] min-w-0 gap-4 px-7 pt-4 pb-10 max-md:px-3.5">
          {error && (
            <p
              role="alert"
              className="tw rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          )}
          {tab === "content" &&
            (lessonId ? (
              <LessonView
                key={lessonId}
                lessonId={lessonId}
                course={course}
                onChanged={() => void load()}
                onOpen={setLessonId}
                onDeleted={() => {
                  setLessonId(null);
                  void load();
                }}
              />
            ) : (
              <p className="tw py-10 text-center text-sm text-muted-foreground">
                {course.enrolled || course.canManage
                  ? "Chọn một bài học."
                  : "Ghi danh để bắt đầu học."}
              </p>
            ))}
          {tab === "learners" && <CourseLearners course={course} />}
          {tab === "questions" && <QuestionBank course={course} />}
          {tab === "settings" && <CourseSettings course={course} run={run} />}
        </div>
      </div>
    </div>
  );
}

type Run = (label: string, action: () => Promise<unknown>) => Promise<boolean>;

function Outline({
  course,
  lessonId,
  onOpen,
  run,
}: {
  course: CourseDetail;
  lessonId: string | null;
  onOpen: (id: string) => void;
  run: Run;
}) {
  const { accessToken } = useApp();
  const token = accessToken!;
  const [chapterTitle, setChapterTitle] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const canOpen = course.enrolled || course.canManage;
  return (
    <nav className="grid grid-cols-[minmax(0,1fr)] gap-1 p-2" aria-label="Nội dung khóa học">
      {course.chapters.map((chapter, index) => (
        <section key={chapter.id}>
          <div className="tw">
            <h2 className="m-0 flex items-baseline gap-2 px-2 py-2 text-[13.5px] leading-5 font-semibold tracking-normal text-foreground">
              <span className="min-w-0 flex-1">
                {/^chương\s*\d/i.test(chapter.title)
                  ? chapter.title
                  : `Chương ${index + 1}. ${chapter.title}`}
              </span>
              <small className="text-xs font-normal text-muted-foreground">
                {chapter.lessons.filter((lesson) => lesson.completed).length}/
                {chapter.lessons.length}
              </small>
            </h2>
            <ol className="grid grid-cols-[minmax(0,1fr)] gap-px">
              {chapter.lessons.map((lesson) => (
                <li key={lesson.id}>
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13.5px] text-foreground transition-colors hover:bg-secondary disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent aria-[current=true]:bg-brand-soft aria-[current=true]:font-semibold aria-[current=true]:text-brand"
                    disabled={!canOpen}
                    aria-current={lesson.id === lessonId}
                    title={KIND[lesson.kind][0]}
                    onClick={() => onOpen(lesson.id)}
                  >
                    <span
                      className={cn(
                        "grid size-5 shrink-0 place-items-center rounded-full",
                        lesson.completed
                          ? "bg-emerald-500 text-white"
                          : "border text-muted-foreground",
                      )}
                    >
                      <Icon name={lesson.completed ? "check" : KIND[lesson.kind][1]} size={12} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
                    {lesson.status === "draft" && (
                      <span
                        className={cn(
                          CHIP,
                          "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
                        )}
                      >
                        Nháp
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          {course.canManage &&
            (adding === chapter.id ? (
              <NewLesson
                chapterId={chapter.id}
                onDone={(id) => {
                  setAdding(null);
                  if (id) onOpen(id);
                }}
                run={run}
              />
            ) : (
              <div className="tw flex gap-1 px-1 pt-0.5 pb-1.5">
                <button type="button" className={LINK} onClick={() => setAdding(chapter.id)}>
                  <Icon name="plus" size={14} />
                  Bài học
                </button>
                {!chapter.lessons.length && (
                  <button
                    type="button"
                    className={LINK}
                    onClick={() =>
                      void run("Đã xóa chương", () => coursesApi.deleteChapter(token, chapter.id))
                    }
                  >
                    <Icon name="trash" size={14} />
                    Xóa chương
                  </button>
                )}
              </div>
            ))}
        </section>
      ))}
      {course.canManage && (
        <form
          className="tw flex gap-1.5 border-t px-1 pt-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            void run("Đã thêm chương", () =>
              coursesApi.addChapter(token, course.id, chapterTitle.trim()),
            ).then((ok) => ok && setChapterTitle(""));
          }}
        >
          <input
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground"
            value={chapterTitle}
            onChange={(event) => setChapterTitle(event.target.value)}
            placeholder="Tên chương mới"
            aria-label="Tên chương mới"
            maxLength={160}
            required
          />
          <button type="submit" className={cn(BTN_GHOST, "h-8")}>
            <Icon name="plus" size={14} />
            Chương
          </button>
        </form>
      )}
      {!course.chapters.length && (
        <p className="tw px-2 py-6 text-center text-[13px] text-muted-foreground">
          Khóa học chưa có nội dung.
        </p>
      )}
    </nav>
  );
}

/** Video, document and quiz lessons start empty; a live lesson picks one of the lecturer's meeting schedules (EL-6). */
function NewLesson({
  chapterId,
  onDone,
  run,
}: {
  chapterId: string;
  onDone: (id: string | null) => void;
  run: Run;
}) {
  const { accessToken } = useApp();
  const [kind, setKind] = useState<LessonKind>("video");
  const [title, setTitle] = useState("");
  const [schedules, setSchedules] = useState<MeetingScheduleItem[] | null>(null);
  const [scheduleId, setScheduleId] = useState("");
  useEffect(() => {
    if (kind === "live" && !schedules && accessToken)
      void getMeetingSchedulesApi(accessToken).then(
        (items) => setSchedules(items.filter((item) => item.canManage)),
        () => setSchedules([]),
      );
  }, [kind, schedules, accessToken]);

  return (
    <form
      className="tw tw-form grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        let created: string | null = null;
        void run("Đã thêm bài học", async () => {
          created = (
            kind === "live"
              ? await coursesApi.addLive(accessToken!, chapterId, {
                  title: title.trim(),
                  scheduleId,
                })
              : await coursesApi.addLesson(accessToken!, chapterId, { title: title.trim(), kind })
          ).id;
        }).then((ok) => ok && onDone(created));
      }}
    >
      <select
        value={kind}
        onChange={(event) => setKind(event.target.value as LessonKind)}
        aria-label="Loại bài"
      >
        {(Object.keys(KIND) as LessonKind[]).map((value) => (
          <option key={value} value={value}>
            {KIND[value][0]}
          </option>
        ))}
      </select>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Tên bài học"
        aria-label="Tên bài học"
        maxLength={160}
        required
      />
      {kind === "live" && (
        <select
          value={scheduleId}
          onChange={(event) => setScheduleId(event.target.value)}
          required
          aria-label="Lịch họp"
        >
          <option value="">
            {schedules?.length
              ? "— Chọn lịch họp —"
              : "Chưa có lịch họp sắp tới (tạo trong Họp trực tuyến)"}
          </option>
          {schedules?.map((item) => (
            <option key={item.id} value={item.id}>
              {new Date(item.startsAt).toLocaleString("vi-VN", { hour12: false })} · {item.title} (
              {item.roomName})
            </option>
          ))}
        </select>
      )}
      <div className="tw flex flex-wrap items-center gap-2 [&>h3]:mr-auto">
        <Button size="sm" variant="ghost" type="button" onClick={() => onDone(null)}>
          Hủy
        </Button>
        <Button size="sm" type="submit">
          Thêm
        </Button>
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
    <div className="tw tw-form grid min-w-0 gap-4 rounded-[10px] border bg-card p-4 text-sm text-foreground">
      <form
        className="tw tw-form grid gap-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          void run("Đã lưu khóa học", () =>
            coursesApi.update(token, course.id, {
              title: title.trim(),
              description: description.trim(),
              enrollment,
            }),
          );
        }}
      >
        <label>
          Tên khóa học
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            maxLength={160}
          />
        </label>
        <label>
          Mô tả
          <textarea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={4000}
          />
        </label>
        <label>
          Ghi danh
          <select
            value={enrollment}
            onChange={(event) => setEnrollment(event.target.value as typeof enrollment)}
          >
            <option value="open">Mở: học viên tự đăng ký</option>
            <option value="assigned">Chỉ định: giảng viên gán học viên</option>
            <option value="approval">Cần duyệt: học viên gửi yêu cầu, giảng viên duyệt</option>
          </select>
        </label>
        <div className="tw flex flex-wrap items-center gap-2 [&>h3]:mr-auto">
          <Button type="submit">Lưu</Button>
          {course.status !== "published" && (
            <Button
              variant="secondary"
              type="button"
              onClick={() =>
                void run("Đã xuất bản khóa học", () =>
                  coursesApi.update(token, course.id, { status: "published" }),
                )
              }
            >
              Xuất bản
            </Button>
          )}
          {course.status === "published" && (
            <Button
              variant="ghost"
              type="button"
              onClick={() =>
                void run("Đã chuyển về nháp", () =>
                  coursesApi.update(token, course.id, { status: "draft" }),
                )
              }
            >
              Chuyển về nháp
            </Button>
          )}
          {course.status !== "archived" && (
            <Button
              variant="ghost"
              type="button"
              onClick={() =>
                void run("Đã lưu trữ khóa học", () =>
                  coursesApi.update(token, course.id, { status: "archived" }),
                )
              }
            >
              Lưu trữ
            </Button>
          )}
        </div>
      </form>
      <form
        className="tw tw-form tw-row"
        onSubmit={(event) => {
          event.preventDefault();
          void run("Đã thêm giảng viên", () =>
            coursesApi.addInstructor(token, course.id, email.trim()),
          ).then((ok) => ok && setEmail(""));
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email giảng viên cùng dạy"
          aria-label="Email giảng viên cùng dạy"
          required
        />
        <Button size="sm" type="submit" icon="user-plus">
          Thêm giảng viên
        </Button>
      </form>
    </div>
  );
}
