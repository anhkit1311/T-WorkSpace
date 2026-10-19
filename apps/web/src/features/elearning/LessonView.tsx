import { useCallback, useEffect, useState } from "react";
import type { CourseDetail, CourseQuestion, LessonDetail, LiveAttendanceRow } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Badge, Button, Modal } from "../../shared/ui/Primitives";
import { HlsPlayer } from "../../shared/ui/HlsPlayer";
import { coursesApi, lessonFileUrl, openLessonFile, uploadLessonFile } from "./courses-api";
import { KIND } from "./CourseView";
import { WebCallDialog } from "../call-center/ContactCenter";
import { QuizRunner } from "./QuizRunner";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN", { hour12: false }) : "—");
const MEDIA = { none: "Chưa có tệp", processing: "Đang chuyển sang HLS…", ready: "Sẵn sàng", failed: "Lỗi xử lý" } as const;

export function LessonView({ lessonId, course, onChanged, onDeleted }: { lessonId: string; course: CourseDetail; onChanged: () => void; onDeleted: () => void }) {
  const { accessToken, notify } = useApp();
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [support, setSupport] = useState(false);

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

  return (
    <article className="lesson">
      <header className="lesson-head">
        <div>
          <span className="course-card__code">{KIND[lesson.kind][0]}{lesson.durationSeconds ? ` · ${Math.max(1, Math.round(lesson.durationSeconds / 60))} phút` : ""}</span>
          <h2>{lesson.title}</h2>
        </div>
        <div className="course-actions">
          {lesson.completed && <Badge tone="green">Đã hoàn thành</Badge>}
          {lesson.canManage && <Badge tone={lesson.status === "published" ? "green" : "amber"}>{lesson.status === "published" ? "Đã xuất bản" : "Nháp"}</Badge>}
          {learner && (
            <Button size="sm" variant="secondary" icon="headset" onClick={() => setSupport(true)}>
              Cần hỗ trợ
            </Button>
          )}
          {lesson.canManage && (
            <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEditing((value) => !value)}>
              {editing ? "Xem như học viên" : "Soạn bài"}
            </Button>
          )}
        </div>
      </header>
      {error && <p role="alert" className="courses-error">{error}</p>}

      {editing ? (
        <LessonEditor lesson={lesson} courseId={course.id} run={run} onDeleted={onDeleted} />
      ) : (
        <>
          {lesson.kind === "video" &&
            (lesson.mediaStatus === "ready" ? (
              <HlsPlayer
                src={lessonFileUrl(lesson.id, "index.m3u8")}
                label={lesson.title}
                captions={lesson.transcriptStatus === "ready"}
                onEnded={() => learner && !lesson.completed && void run("Đã hoàn thành bài học", () => coursesApi.complete(token, lesson.id))}
              />
            ) : (
              <p className="courses-empty">{MEDIA[lesson.mediaStatus]}</p>
            ))}
          {lesson.kind === "document" && (
            <>
              {lesson.body && <div className="lesson-body">{lesson.body}</div>}
              {lesson.mediaStatus === "ready" && (
                <Button variant="secondary" icon="file" onClick={() => void openLessonFile(token, lesson.id, "document.pdf").catch((failure) => setError(failure.message))}>
                  Mở tài liệu {lesson.mediaName ? `(${lesson.mediaName})` : "PDF"}
                </Button>
              )}
            </>
          )}
          {lesson.kind === "video" && lesson.canManage && lesson.mediaStatus === "ready" && !lesson.recordingId && (
            <p className="lesson-captions">
              {lesson.transcriptStatus === "processing" ? (
                "Đang tạo phụ đề tự động…"
              ) : lesson.transcriptStatus === "ready" ? (
                "Đã có phụ đề và bản chép lời."
              ) : (
                <Button size="sm" variant="ghost" icon="file" onClick={() => void run("Đang tạo phụ đề", () => coursesApi.transcript(token, lesson.id))}>
                  {lesson.transcriptStatus === "failed" ? "Tạo lại phụ đề" : "Tạo phụ đề tự động"}
                </Button>
              )}
            </p>
          )}
          {lesson.kind === "quiz" && lesson.quiz && <QuizRunner lesson={lesson} onFinished={() => { void load(); onChanged(); }} />}
          {lesson.kind === "live" && lesson.live && <LivePanel lesson={lesson} run={run} />}
          {learner && !lesson.completed && (lesson.kind === "video" || lesson.kind === "document") && (
            <Button icon="check" onClick={() => void run("Đã hoàn thành bài học", () => coursesApi.complete(token, lesson.id))}>
              Đánh dấu đã học xong
            </Button>
          )}
        </>
      )}
      {support && <SupportDialog lesson={lesson} hotline={course.supportHotline} onClose={() => setSupport(false)} />}
    </article>
  );
}

/** EL-6: join the class; after it, attendance (>= 70% present) and, for staff, closing it (LT-2). */
function LivePanel({ lesson, run }: { lesson: LessonDetail; run: (label: string, action: () => Promise<unknown>) => Promise<boolean> }) {
  const { accessToken, navigate } = useApp();
  const live = lesson.live!;
  const [rows, setRows] = useState<LiveAttendanceRow[] | null>(null);
  useEffect(() => {
    if (lesson.canManage && live.attendanceClosed && accessToken) void coursesApi.attendance(accessToken, lesson.id).then(setRows, () => setRows([]));
  }, [lesson.canManage, live.attendanceClosed, accessToken, lesson.id]);
  const now = Date.now();
  const open = live.startsAt && live.endsAt && now >= +new Date(live.startsAt) - 15 * 60_000 && now <= +new Date(live.endsAt);
  return (
    <div className="lesson-live">
      <p>
        Lịch học: {when(live.startsAt)} – {live.endsAt ? new Date(live.endsAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "—"}
      </p>
      {!live.attendanceClosed && live.roomId && live.workspaceId && (
        <Button icon="video" variant={open ? "primary" : "secondary"} onClick={() => navigate({ view: "meetings", workspaceId: live.workspaceId!, channelId: live.roomId! })}>
          {open ? "Vào lớp học" : "Mở phòng học"}
        </Button>
      )}
      <p className="course-card__meta">Có mặt từ 70% thời lượng buổi học được tính là tham dự. Bản ghi buổi học được đăng thành bài xem lại ngay sau buổi.</p>
      {live.attendanceClosed && live.attended !== null && (
        <Badge tone={live.attended ? "green" : "red"}>
          {live.attended ? "Đã tham dự" : "Vắng"} · có mặt {Math.round((live.ratio ?? 0) * 100)}%
        </Badge>
      )}
      {lesson.canManage && !live.attendanceClosed && (
        <Button variant="secondary" icon="lock" onClick={() => void run("Đã chốt điểm danh và đăng bản ghi", () => coursesApi.closeLive(accessToken!, lesson.id))}>
          Chốt điểm danh
        </Button>
      )}
      {rows && (
        <table className="course-table">
          <caption>Điểm danh ({rows.filter((row) => row.attended).length}/{rows.length} tham dự)</caption>
          <thead><tr><th scope="col">Học viên</th><th scope="col">Có mặt</th><th scope="col">Kết quả</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId}>
                <th scope="row">{row.displayName}</th>
                <td>{Math.round(row.presentSeconds / 60)} phút ({Math.round(row.ratio * 100)}%)</td>
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
function SupportDialog({ lesson, hotline, onClose }: { lesson: LessonDetail; hotline: string | null; onClose: () => void }) {
  const { accessToken } = useApp();
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<{ ticketNumber: string; hotline: string | null; departmentId: string; context: string } | null>(null);
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
            <Button variant="ghost" onClick={onClose}>Đóng</Button>
            <Button icon="headset" onClick={() => setCalling(true)}>Gọi ngay từ trình duyệt</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>Hủy</Button>
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
        <div className="lesson-support">
          <p>Đã tạo phiếu <strong>{result.ticketNumber}</strong>. Tổng đài viên thấy ngay khóa học và bài học bạn đang học.</p>
          {number && (
            <p>
              Gọi hotline <a href={`tel:${number}`}>{result.hotline}</a> để được hỗ trợ ngay, hoặc chờ tổng đài gọi lại.
            </p>
          )}
        </div>
      ) : (
        <label className="courses-form">
          Bạn gặp khó khăn gì? (không bắt buộc)
          <textarea rows={3} maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} />
          {hotline && <span className="course-card__meta">Hotline đơn vị phụ trách: {hotline}</span>}
        </label>
      )}
      {error && <p role="alert" className="courses-error">{error}</p>}
      {calling && result && (
        <WebCallDialog department={{ id: result.departmentId, name: "đơn vị phụ trách khóa học" }} context={result.context} onClose={() => setCalling(false)} />
      )}
    </Modal>
  );
}

function LessonEditor({ lesson, courseId, run, onDeleted }: { lesson: LessonDetail; courseId: string; run: (label: string, action: () => Promise<unknown>) => Promise<boolean>; onDeleted: () => void }) {
  const { accessToken } = useApp();
  const token = accessToken!;
  const [title, setTitle] = useState(lesson.title);
  const [body, setBody] = useState(lesson.body);
  const [timeLimit, setTimeLimit] = useState(lesson.quiz?.timeLimitSeconds ? String(lesson.quiz.timeLimitSeconds / 60) : "");
  const [passPercent, setPassPercent] = useState(String(lesson.quiz?.passPercent ?? 50));
  const [picked, setPicked] = useState<string[]>(lesson.quiz?.questionIds ?? []);
  const [drawCount, setDrawCount] = useState(lesson.quiz?.drawCount ? String(lesson.quiz.drawCount) : "");
  const [shuffle, setShuffle] = useState(lesson.quiz?.shuffle ?? false);
  const [bank, setBank] = useState<CourseQuestion[]>([]);
  const [upload, setUpload] = useState<number | null>(null);
  useEffect(() => {
    if (lesson.kind === "quiz") void coursesApi.questions(token, courseId).then(setBank, () => setBank([]));
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
              shuffle,
            }
          : {}),
      }),
    );

  return (
    <div className="courses-form">
      <label>Tên bài học<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} /></label>
      {lesson.kind === "document" && (
        <label>Nội dung<textarea rows={8} value={body} onChange={(event) => setBody(event.target.value)} maxLength={50000} /></label>
      )}
      {(lesson.kind === "video" || lesson.kind === "document") && !lesson.recordingId && (
        <label>
          {lesson.kind === "video" ? "Tệp video hoặc âm thanh (MP4, WebM, MP3…, tối đa 2 GB)" : "Tệp PDF (tối đa 50 MB)"} · {MEDIA[lesson.mediaStatus]}
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
              void run(lesson.kind === "video" ? "Đã tải lên, video đang được xử lý" : "Đã tải lên tài liệu", () =>
                uploadLessonFile(token, lesson.id, file, setUpload),
              ).finally(() => setUpload(null));
            }}
          />
          {upload !== null && <progress max={100} value={upload} aria-label="Tiến độ tải lên" />}
          {lesson.mediaError && <span className="courses-error">{lesson.mediaError}</span>}
        </label>
      )}
      {lesson.recordingId && <p className="course-card__meta">Bài xem lại dùng bản ghi của buổi live.</p>}
      {lesson.kind === "quiz" && (
        <>
          <div className="course-inline-form">
            <label>Thời gian (phút, để trống = không giới hạn)<input type="number" min={1} max={240} value={timeLimit} onChange={(event) => setTimeLimit(event.target.value)} /></label>
            <label>Điểm đạt (%)<input type="number" min={0} max={100} value={passPercent} onChange={(event) => setPassPercent(event.target.value)} /></label>
            <label>
              Rút ngẫu nhiên (câu, để trống = tất cả)
              <input type="number" min={1} max={Math.max(1, picked.length)} value={drawCount} onChange={(event) => setDrawCount(event.target.value)} />
            </label>
          </div>
          <label className="course-check">
            <input type="checkbox" checked={shuffle} onChange={(event) => setShuffle(event.target.checked)} />
            Xáo trộn thứ tự câu hỏi và phương án cho mỗi lượt làm
          </label>
          <fieldset className="course-question-picker">
            <legend>Câu hỏi trong bài ({picked.length}) — lấy từ ngân hàng câu hỏi</legend>
            {!bank.length && <p className="course-card__meta">Ngân hàng câu hỏi trống; thêm câu hỏi ở tab "Ngân hàng câu hỏi".</p>}
            {bank.map((question) => (
              <label key={question.id}>
                <input
                  type="checkbox"
                  checked={picked.includes(question.id)}
                  onChange={(event) => setPicked((current) => (event.target.checked ? [...current, question.id] : current.filter((item) => item !== question.id)))}
                />
                {question.prompt} <small>({question.points} điểm)</small>
              </label>
            ))}
          </fieldset>
        </>
      )}
      {lesson.kind === "live" && lesson.live && (
        <p className="course-card__meta">Lịch học: {when(lesson.live.startsAt)}. Đổi giờ trong mục Họp trực tuyến.</p>
      )}
      <div className="course-outline__tools">
        <Button onClick={() => void save()}>Lưu</Button>
        {lesson.status === "draft" ? (
          <Button variant="secondary" onClick={() => void save().then((ok) => ok && run("Đã xuất bản bài học", () => coursesApi.updateLesson(token, lesson.id, { status: "published" })))}>
            Lưu và xuất bản
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => void run("Đã chuyển bài về nháp", () => coursesApi.updateLesson(token, lesson.id, { status: "draft" }))}>
            Chuyển về nháp
          </Button>
        )}
        {lesson.status === "draft" && (
          <Button variant="ghost" icon="trash" onClick={() => void run("Đã xóa bài học", () => coursesApi.deleteLesson(token, lesson.id)).then((ok) => ok && onDeleted())}>
            Xóa
          </Button>
        )}
      </div>
    </div>
  );
}
