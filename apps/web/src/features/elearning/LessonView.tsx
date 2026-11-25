import { LessonBody } from "./LessonBody";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CourseDetail, CourseQuestion, LessonDetail, LiveAttendanceRow } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Badge, Button, Modal } from "../../shared/ui/Primitives";
import { HlsPlayer } from "../../shared/ui/HlsPlayer";
import { coursesApi, lessonFileUrl, openLessonFile, uploadLessonFile } from "./courses-api";
import { KIND } from "./CourseView";
import { Icon } from "../../shared/ui/Icon";
import { cn } from "../../shared/lib/utils";
import { WebCallDialog } from "../call-center/ContactCenter";
import { QuizRunner } from "./QuizRunner";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("vi-VN", { hour12: false }) : "—";
const MEDIA = {
  none: "Chưa có tệp",
  processing: "Đang chuyển sang HLS…",
  ready: "Sẵn sàng",
  failed: "Lỗi xử lý",
} as const;
const BTN =
  "inline-flex h-[34px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-semibold whitespace-nowrap transition-colors";
const BTN_PRIMARY = `${BTN} bg-primary text-primary-foreground hover:bg-primary/90`;
const BTN_GHOST = `${BTN} border bg-card text-foreground hover:bg-secondary`;
const CHIP = "rounded-[5px] px-[7px] py-[3px] text-xs leading-none font-semibold whitespace-nowrap";
const GREEN = "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]";
const AMBER = "bg-[var(--tint-amber-bg)] text-[var(--tint-amber-fg)]";
const minutes = (seconds: number) => Math.max(0, Math.round(seconds / 60));

export function LessonView({
  lessonId,
  course,
  onChanged,
  onDeleted,
  onOpen,
}: {
  lessonId: string;
  course: CourseDetail;
  onChanged: () => void;
  onDeleted: () => void;
  /** Opens another lesson of the course (the previous/next buttons). */
  onOpen?: (lessonId: string) => void;
}) {
  const { accessToken, notify } = useApp();
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [support, setSupport] = useState(false);
  const completed = useRef(false);
  completed.current = Boolean(lesson?.completed);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setLesson(await coursesApi.lesson(accessToken, lessonId));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không tải được bài học.");
    }
  }, [accessToken, lessonId]);
  useEffect(() => void load(), [load]);

  // A video being converted updates itself.
  useEffect(() => {
    if (lesson?.mediaStatus !== "processing" && lesson?.transcriptStatus !== "processing") return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [lesson?.mediaStatus, lesson?.transcriptStatus, load]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
      notify(label);
      await load();
      onChanged();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không thực hiện được thao tác.");
      return false;
    }
  };

  if (!lesson) return <p role={error ? "alert" : "status"}>{error || "Đang tải bài học…"}</p>;
  const token = accessToken!;
  const learner = course.enrolled;
  // EL-5: each stretch played counts toward 90% of the video; the server completes the lesson.
  const reportWatch = (from: number, to: number, position: number) =>
    void coursesApi
      .watch(token, lesson.id, {
        from: Math.floor(from),
        to: Math.ceil(to),
        position: Math.floor(position),
      })
      .then(
        (result) => {
          setLesson(
            (current) =>
              current && {
                ...current,
                completed: current.completed || result.completed,
                watch: {
                  watchedSeconds: result.watchedSeconds,
                  positionSeconds: result.positionSeconds,
                },
              },
          );
          if (result.completed && !completed.current) {
            completed.current = true;
            notify("Đã hoàn thành bài học");
            onChanged();
          }
        },
        () => undefined, // a lost report only delays completion; the next one carries on
      );

  const order = course.chapters.flatMap((chapter) => chapter.lessons);
  const at = order.findIndex((item) => item.id === lesson.id);
  const previous = at > 0 ? order[at - 1] : null;
  const next = at >= 0 && at < order.length - 1 ? order[at + 1] : null;
  const player = !editing && lesson.kind === "video" && lesson.mediaStatus === "ready" && (
    <HlsPlayer
      src={lessonFileUrl(lesson.id, "index.m3u8")}
      label={lesson.title}
      captions={lesson.transcriptStatus === "ready"}
      startAt={lesson.watch?.positionSeconds}
      onPlayed={lesson.watch ? reportWatch : undefined}
    />
  );

  return (
    <article className="grid min-w-0 gap-4">
      {player}
      <header className="tw flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="grid min-w-0 flex-1 basis-64 gap-0.5">
          <small className="text-xs text-muted-foreground">
            {KIND[lesson.kind][0]}
            {lesson.durationSeconds
              ? ` · ${Math.max(1, Math.round(lesson.durationSeconds / 60))} phút`
              : ""}
          </small>
          <h2 className="m-0 text-xl leading-snug font-bold tracking-normal text-foreground">
            {lesson.title}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lesson.completed && <span className={cn(CHIP, GREEN)}>Đã hoàn thành</span>}
          {lesson.canManage && (
            <span className={cn(CHIP, lesson.status === "published" ? GREEN : AMBER)}>
              {lesson.status === "published" ? "Đã xuất bản" : "Nháp"}
            </span>
          )}
          {learner && (
            <button type="button" className={BTN_GHOST} onClick={() => setSupport(true)}>
              <Icon name="headset" size={15} />
              Cần hỗ trợ
            </button>
          )}
          {lesson.canManage && (
            <button
              type="button"
              className={BTN_GHOST}
              onClick={() => setEditing((value) => !value)}
            >
              <Icon name="pencil" size={15} />
              {editing ? "Xem như học viên" : "Soạn bài"}
            </button>
          )}
          {!editing &&
            learner &&
            !lesson.completed &&
            (lesson.kind === "document" || (lesson.kind === "video" && !lesson.watch)) && (
              <button
                type="button"
                className={BTN_PRIMARY}
                onClick={() =>
                  void run("Đã hoàn thành bài học", () => coursesApi.complete(token, lesson.id))
                }
              >
                <Icon name="check" size={15} />
                Đánh dấu đã học xong
              </button>
            )}
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="tw rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {editing ? (
        <LessonEditor lesson={lesson} courseId={course.id} run={run} onDeleted={onDeleted} />
      ) : (
        <>
          {lesson.kind === "video" && lesson.mediaStatus !== "ready" && (
            <p className="tw rounded-[10px] border border-dashed py-10 text-center text-sm text-muted-foreground">
              {MEDIA[lesson.mediaStatus]}
            </p>
          )}
          {lesson.watch && lesson.durationSeconds && !lesson.completed && (
            <p className="tw text-[13px] text-muted-foreground" role="status">
              Đã xem {minutes(lesson.watch.watchedSeconds)}/{minutes(lesson.durationSeconds)} phút ·
              xem ít nhất 90% video để hoàn thành bài học.
            </p>
          )}
          {lesson.kind === "document" && (
            <>
              {lesson.body && <LessonBody body={lesson.body} />}
              {lesson.mediaStatus === "ready" && (
                <div className="tw flex items-center gap-2.5 rounded-[10px] border bg-card px-3 py-2.5">
                  <span className="grid size-[34px] shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                    <Icon name="file" size={17} />
                  </span>
                  <span className="grid min-w-0 flex-1">
                    <b className="truncate text-sm font-medium">
                      {lesson.mediaName || "Tài liệu PDF"}
                    </b>
                    <small className="text-xs text-muted-foreground">Tệp đính kèm</small>
                  </span>
                  <button
                    type="button"
                    className={BTN_GHOST}
                    onClick={() =>
                      void openLessonFile(token, lesson.id, "document.pdf").catch((failure) =>
                        setError(failure.message),
                      )
                    }
                  >
                    Mở tài liệu
                  </button>
                </div>
              )}
            </>
          )}
          {lesson.kind === "video" &&
            lesson.canManage &&
            lesson.mediaStatus === "ready" &&
            !lesson.recordingId && (
              <p className="tw flex items-center gap-2 text-[13px] text-muted-foreground">
                {lesson.transcriptStatus === "processing" ? (
                  "Đang tạo phụ đề tự động…"
                ) : lesson.transcriptStatus === "ready" ? (
                  "Đã có phụ đề và bản chép lời."
                ) : (
                  <button
                    type="button"
                    className={BTN_GHOST}
                    onClick={() =>
                      void run("Đang tạo phụ đề", () => coursesApi.transcript(token, lesson.id))
                    }
                  >
                    <Icon name="file" size={15} />
                    {lesson.transcriptStatus === "failed" ? "Tạo lại phụ đề" : "Tạo phụ đề tự động"}
                  </button>
                )}
              </p>
            )}
          {lesson.kind === "quiz" && lesson.quiz && (
            <QuizRunner
              lesson={lesson}
              onFinished={() => {
                void load();
                onChanged();
              }}
            />
          )}
          {lesson.kind === "live" && lesson.live && <LivePanel lesson={lesson} run={run} />}
        </>
      )}
      {onOpen && !editing && (previous || next) && (
        <nav
          className="tw flex justify-between gap-2.5 border-t pt-3.5"
          aria-label="Bài trước và bài tiếp"
        >
          {previous ? (
            <button
              type="button"
              className={cn(BTN_GHOST, "min-w-0")}
              onClick={() => onOpen(previous.id)}
            >
              <Icon name="chevron-left" size={15} />
              <span className="truncate">{previous.title}</span>
            </button>
          ) : (
            <span />
          )}
          {next && (
            <button
              type="button"
              className={cn(BTN_PRIMARY, "min-w-0")}
              onClick={() => onOpen(next.id)}
            >
              <span className="truncate">Bài tiếp: {next.title}</span>
              <Icon name="chevron-right" size={15} />
            </button>
          )}
        </nav>
      )}
      {support && (
        <SupportDialog
          lesson={lesson}
          hotline={course.supportHotline}
          onClose={() => setSupport(false)}
        />
      )}
    </article>
  );
}

/** EL-6: join the class; after it, attendance (>= 70% present) and, for staff, closing it (LT-2). */
function LivePanel({
  lesson,
  run,
}: {
  lesson: LessonDetail;
  run: (label: string, action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const { accessToken, navigate } = useApp();
  const live = lesson.live!;
  const [rows, setRows] = useState<LiveAttendanceRow[] | null>(null);
  useEffect(() => {
    if (lesson.canManage && live.attendanceClosed && accessToken)
      void coursesApi.attendance(accessToken, lesson.id).then(setRows, () => setRows([]));
  }, [lesson.canManage, live.attendanceClosed, accessToken, lesson.id]);
  const now = Date.now();
  const open =
    live.startsAt &&
    live.endsAt &&
    now >= +new Date(live.startsAt) - 15 * 60_000 &&
    now <= +new Date(live.endsAt);
  return (
    <div className="tw grid justify-items-start gap-2.5">
      <p>
        Lịch học: {when(live.startsAt)} –{" "}
        {live.endsAt
          ? new Date(live.endsAt).toLocaleTimeString("vi-VN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })
          : "—"}
      </p>
      {!live.attendanceClosed && live.roomId && live.workspaceId && (
        <Button
          icon="video"
          variant={open ? "primary" : "secondary"}
          onClick={() =>
            navigate({ view: "meetings", workspaceId: live.workspaceId!, channelId: live.roomId! })
          }
        >
          {open ? "Vào lớp học" : "Mở phòng học"}
        </Button>
      )}
      <p className="m-0 text-[13px] text-muted-foreground">
        Có mặt từ 70% thời lượng buổi học được tính là tham dự. Bản ghi buổi học được đăng thành bài
        xem lại ngay sau buổi.
      </p>
      {live.attendanceClosed && live.attended !== null && (
        <Badge tone={live.attended ? "green" : "red"}>
          {live.attended ? "Đã tham dự" : "Vắng"} · có mặt {Math.round((live.ratio ?? 0) * 100)}%
        </Badge>
      )}
      {lesson.canManage && !live.attendanceClosed && (
        <Button
          variant="secondary"
          icon="lock"
          onClick={() =>
            void run("Đã chốt điểm danh và đăng bản ghi", () =>
              coursesApi.closeLive(accessToken!, lesson.id),
            )
          }
        >
          Chốt điểm danh
        </Button>
      )}
      {rows && (
        <table className="w-full border-collapse text-sm [&_:is(th,td)]:border-b [&_:is(th,td)]:p-2 [&_:is(th,td)]:text-left [&_:is(th,td)]:align-middle [&_:is(th,td)]:font-normal [&_thead_th]:font-semibold [&_tbody_th_small]:block [&_tbody_th_small]:text-muted-foreground">
          <caption>
            Điểm danh ({rows.filter((row) => row.attended).length}/{rows.length} tham dự)
          </caption>
          <thead>
            <tr>
              <th scope="col">Học viên</th>
              <th scope="col">Có mặt</th>
              <th scope="col">Kết quả</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId}>
                <th scope="row">{row.displayName}</th>
                <td>
                  {Math.round(row.presentSeconds / 60)} phút ({Math.round(row.ratio * 100)}%)
                </td>
                <td>{row.attended ? "Tham dự" : "Vắng"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** LT-1: a ticket to the unit's call center carrying the course and lesson, and the hotline to call. */
function SupportDialog({
  lesson,
  hotline,
  onClose,
}: {
  lesson: LessonDetail;
  hotline: string | null;
  onClose: () => void;
}) {
  const { accessToken } = useApp();
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{
    ticketNumber: string;
    hotline: string | null;
    departmentId: string;
    context: string;
  } | null>(null);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const number = (result?.hotline ?? hotline)?.split(" ")[0];
  return (
    <Modal
      title="Cần hỗ trợ"
      eyebrow={lesson.title}
      onClose={onClose}
      footer={
        result ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Đóng
            </Button>
            <Button icon="headset" onClick={() => setCalling(true)}>
              Gọi ngay từ trình duyệt
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Hủy
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                coursesApi
                  .support(accessToken!, lesson.id, message.trim())
                  .then(setResult, (failure) => setError(failure.message))
                  .finally(() => setBusy(false));
              }}
            >
              Gửi yêu cầu
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="[&_p]:mb-2">
          <p>
            Đã tạo phiếu <strong>{result.ticketNumber}</strong>. Tổng đài viên thấy ngay khóa học và
            bài học bạn đang học.
          </p>
          {number && (
            <p>
              Gọi hotline <a href={`tel:${number}`}>{result.hotline}</a> để được hỗ trợ ngay, hoặc
              chờ tổng đài gọi lại.
            </p>
          )}
        </div>
      ) : (
        <label className="tw tw-form grid gap-2.5">
          Bạn gặp khó khăn gì? (không bắt buộc)
          <textarea
            rows={3}
            maxLength={2000}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          {hotline && (
            <span className="m-0 text-[13px] text-muted-foreground">
              Hotline đơn vị phụ trách: {hotline}
            </span>
          )}
        </label>
      )}
      {error && (
        <p
          role="alert"
          className="tw rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
      {calling && result && (
        <WebCallDialog
          department={{ id: result.departmentId, name: "đơn vị phụ trách khóa học" }}
          context={result.context}
          onClose={() => setCalling(false)}
        />
      )}
    </Modal>
  );
}

function LessonEditor({
  lesson,
  courseId,
  run,
  onDeleted,
}: {
  lesson: LessonDetail;
  courseId: string;
  run: (label: string, action: () => Promise<unknown>) => Promise<boolean>;
  onDeleted: () => void;
}) {
  const { accessToken } = useApp();
  const token = accessToken!;
  const [title, setTitle] = useState(lesson.title);
  const [body, setBody] = useState(lesson.body);
  const [timeLimit, setTimeLimit] = useState(
    lesson.quiz?.timeLimitSeconds ? String(lesson.quiz.timeLimitSeconds / 60) : "",
  );
  const [passPercent, setPassPercent] = useState(String(lesson.quiz?.passPercent ?? 50));
  const [picked, setPicked] = useState<string[]>(lesson.quiz?.questionIds ?? []);
  const [drawCount, setDrawCount] = useState(
    lesson.quiz?.drawCount ? String(lesson.quiz.drawCount) : "",
  );
  const [shuffle, setShuffle] = useState(lesson.quiz?.shuffle ?? false);
  const [maxAttempts, setMaxAttempts] = useState(
    lesson.quiz?.maxAttempts ? String(lesson.quiz.maxAttempts) : "",
  );
  const [bank, setBank] = useState<CourseQuestion[]>([]);
  const [upload, setUpload] = useState<number | null>(null);
  useEffect(() => {
    if (lesson.kind === "quiz")
      void coursesApi.questions(token, courseId).then(setBank, () => setBank([]));
  }, [lesson.kind, token, courseId]);

  const save = () =>
    run("Đã lưu bài học", () =>
      coursesApi.updateLesson(token, lesson.id, {
        title: title.trim(),
        ...(lesson.kind === "document" ? { body } : {}),
        ...(lesson.kind === "quiz"
          ? {
              questionIds: picked,
              passPercent: Number(passPercent),
              timeLimitSeconds: timeLimit ? Math.round(Number(timeLimit) * 60) : null,
              drawCount: drawCount ? Number(drawCount) : null,
              maxAttempts: maxAttempts ? Number(maxAttempts) : null,
              shuffle,
            }
          : {}),
      }),
    );

  return (
    <div className="tw tw-form grid gap-2.5">
      <label>
        Tên bài học
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} />
      </label>
      {lesson.kind === "document" && (
        <label>
          Nội dung
          <textarea
            rows={8}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            maxLength={50000}
          />
        </label>
      )}
      {(lesson.kind === "video" || lesson.kind === "document") && !lesson.recordingId && (
        <label>
          {lesson.kind === "video"
            ? "Tệp video hoặc âm thanh (MP4, WebM, MP3…, tối đa 2 GB)"
            : "Tệp PDF (tối đa 50 MB)"}{" "}
          · {MEDIA[lesson.mediaStatus]}
          {lesson.mediaName ? ` · ${lesson.mediaName}` : ""}
          <input
            type="file"
            accept={lesson.kind === "video" ? "video/*,audio/*" : "application/pdf"}
            disabled={upload !== null || lesson.mediaStatus === "processing"}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setUpload(0);
              void run(
                lesson.kind === "video"
                  ? "Đã tải lên, video đang được xử lý"
                  : "Đã tải lên tài liệu",
                () => uploadLessonFile(token, lesson.id, file, setUpload),
              ).finally(() => setUpload(null));
            }}
          />
          {upload !== null && <progress max={100} value={upload} aria-label="Tiến độ tải lên" />}
          {lesson.mediaError && (
            <span className="tw rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300">
              {lesson.mediaError}
            </span>
          )}
        </label>
      )}
      {lesson.recordingId && (
        <p className="m-0 text-[13px] text-muted-foreground">
          Bài xem lại dùng bản ghi của buổi live.
        </p>
      )}
      {lesson.kind === "quiz" && (
        <>
          <div className="tw tw-form tw-row">
            <label>
              Thời gian (phút, để trống = không giới hạn)
              <input
                type="number"
                min={1}
                max={240}
                value={timeLimit}
                onChange={(event) => setTimeLimit(event.target.value)}
              />
            </label>
            <label>
              Điểm đạt (%)
              <input
                type="number"
                min={0}
                max={100}
                value={passPercent}
                onChange={(event) => setPassPercent(event.target.value)}
              />
            </label>
            <label>
              Rút ngẫu nhiên (câu, để trống = tất cả)
              <input
                type="number"
                min={1}
                max={Math.max(1, picked.length)}
                value={drawCount}
                onChange={(event) => setDrawCount(event.target.value)}
              />
            </label>
            <label>
              Số lần làm (để trống = không giới hạn)
              <input
                type="number"
                min={1}
                max={100}
                value={maxAttempts}
                onChange={(event) => setMaxAttempts(event.target.value)}
              />
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={shuffle}
              onChange={(event) => setShuffle(event.target.checked)}
            />
            Xáo trộn thứ tự câu hỏi và phương án cho mỗi lượt làm
          </label>
          <fieldset className="grid gap-1.5 rounded-md border bg-secondary/50 px-3 py-2.5 [&_label]:flex [&_label]:items-center [&_label]:gap-2 [&_label]:text-foreground">
            <legend>Câu hỏi trong bài ({picked.length}) — lấy từ ngân hàng câu hỏi</legend>
            {!bank.length && (
              <p className="m-0 text-[13px] text-muted-foreground">
                Ngân hàng câu hỏi trống; thêm câu hỏi ở tab "Ngân hàng câu hỏi".
              </p>
            )}
            {bank.map((question) => (
              <label key={question.id}>
                <input
                  type="checkbox"
                  checked={picked.includes(question.id)}
                  onChange={(event) =>
                    setPicked((current) =>
                      event.target.checked
                        ? [...current, question.id]
                        : current.filter((item) => item !== question.id),
                    )
                  }
                />
                {question.prompt} <small>({question.points} điểm)</small>
              </label>
            ))}
          </fieldset>
        </>
      )}
      {lesson.kind === "live" && lesson.live && (
        <p className="m-0 text-[13px] text-muted-foreground">
          Lịch học: {when(lesson.live.startsAt)}. Đổi giờ trong mục Họp trực tuyến.
        </p>
      )}
      <div className="tw flex flex-wrap items-center gap-2 [&>h3]:mr-auto">
        <Button onClick={() => void save()}>Lưu</Button>
        {lesson.status === "draft" ? (
          <Button
            variant="secondary"
            onClick={() =>
              void save().then(
                (ok) =>
                  ok &&
                  run("Đã xuất bản bài học", () =>
                    coursesApi.updateLesson(token, lesson.id, { status: "published" }),
                  ),
              )
            }
          >
            Lưu và xuất bản
          </Button>
        ) : (
          <Button
            variant="ghost"
            onClick={() =>
              void run("Đã chuyển bài về nháp", () =>
                coursesApi.updateLesson(token, lesson.id, { status: "draft" }),
              )
            }
          >
            Chuyển về nháp
          </Button>
        )}
        {lesson.status === "draft" && (
          <Button
            variant="ghost"
            icon="trash"
            onClick={() =>
              void run("Đã xóa bài học", () => coursesApi.deleteLesson(token, lesson.id)).then(
                (ok) => ok && onDeleted(),
              )
            }
          >
            Xóa
          </Button>
        )}
      </div>
    </div>
  );
}
