import { useCallback, useEffect, useState } from "react";
import type {
  CcAgentProfile,
  CcCallTranscript,
  CcQaCriterion,
  CcQaReview,
  CourseDetail,
  CourseSummary,
} from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { coursesApi } from "../elearning/courses-api";
import { Button, Modal } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import { cn } from "../../shared/lib/utils";
import { BTN_PRIMARY, CHIP, MUTED, PANEL, PANEL_HEAD, PILL, PILL_ON, TINT } from "./ui";

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

export const qaTone = (percent: number, threshold = 70) =>
  percent >= 85 ? "green" : percent >= threshold ? "blue" : "red";

/** The scorecard a department gets when it has none; the sheet is no longer edited in the app. */
const DEFAULT_CRITERIA = [
  { id: null, label: "Chào hỏi đúng mẫu", weight: 1 },
  { id: null, label: "Xác minh thông tin người gọi", weight: 2 },
  { id: null, label: "Giải quyết đúng yêu cầu", weight: 3 },
  { id: null, label: "Thái độ lịch sự, rõ ràng", weight: 2 },
  { id: null, label: "Kết thúc và ghi nhận cuộc gọi", weight: 1 },
];
const SHEET = "tw tw-form grid gap-3.5 text-sm text-foreground";
const WARNING =
  "rounded-lg bg-[var(--tint-amber-bg)] px-3 py-2 text-[13px] text-[var(--tint-amber-fg)]";

/**
 * V7 / E2: scorecard per department and the reviews. Supervisors see their departments' sheet and
 * reviews; an agent sees the reviews of their own calls.
 */
export function QaPanel({
  me,
  api,
  fail,
}: {
  me: CcAgentProfile;
  api: Api;
  fail: (error: unknown) => void;
}) {
  const supervised = me.departments.filter((department) => department.role === "supervisor");
  const [departments, setDepartments] = useState(supervised);
  const [departmentId, setDepartmentId] = useState(supervised[0]?.id ?? "");
  const [criteria, setCriteria] = useState<CcQaCriterion[] | null>(null);
  const [reviews, setReviews] = useState<CcQaReview[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const manages = me.isAdmin || supervised.length > 0;

  useEffect(() => {
    if (!me.isAdmin) return;
    api<{ id: string; name: string }[]>("departments").then((list) => {
      setDepartments(list.map((item) => ({ ...item, role: "supervisor" as const })));
      setDepartmentId((current) => current || list[0]?.id || "");
    }, fail);
  }, [api, fail, me.isAdmin]);
  const load = useCallback(() => {
    api<CcQaReview[]>(
      `qa-reviews${manages && departmentId ? `?departmentId=${departmentId}` : ""}`,
    ).then(setReviews, fail);
    if (manages && departmentId)
      api<CcQaCriterion[]>(`departments/${departmentId}/qa-criteria`).then(setCriteria, fail);
  }, [api, departmentId, fail, manages]);
  useEffect(load, [load]);

  const useDefault = () =>
    api<CcQaCriterion[]>(`departments/${departmentId}/qa-criteria`, "POST", {
      criteria: DEFAULT_CRITERIA,
    }).then(setCriteria, fail);
  const average = reviews?.length
    ? Math.round(reviews.reduce((sum, review) => sum + review.percent, 0) / reviews.length)
    : null;

  return (
    <div className="tw grid min-w-0 gap-3.5 text-sm text-foreground">
      {manages && departments.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Phòng ban">
          {departments.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(PILL, departmentId === item.id && PILL_ON)}
              aria-pressed={departmentId === item.id}
              onClick={() => setDepartmentId(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
      )}
      <div
        className={cn(
          "grid min-w-0 items-start gap-4",
          manages && "min-[1100px]:grid-cols-[340px_minmax(0,1fr)]",
        )}
      >
        {manages && (
          <section className={cn(PANEL, "min-[1100px]:sticky min-[1100px]:top-2")}>
            <div className={PANEL_HEAD}>
              <Icon name="clipboard" size={16} className="text-muted-foreground" />
              <h2 className="text-[15px] font-semibold">Phiếu chấm điểm</h2>
            </div>
            <p className={cn(MUTED, "px-4 pt-3")}>
              Mỗi tiêu chí chấm 0–10 điểm, nhân trọng số. Điểm dưới ngưỡng của phòng ban sẽ tự gán
              khóa bồi dưỡng.
            </p>
            {criteria && !criteria.length ? (
              <div className="grid gap-2.5 px-4 py-3.5">
                <p className={WARNING}>Phòng ban chưa có phiếu chấm.</p>
                <button type="button" className={cn(BTN_PRIMARY, "w-max")} onClick={useDefault}>
                  <Icon name="check" size={15} />
                  Dùng phiếu chấm mẫu
                </button>
              </div>
            ) : (
              <ol className="grid list-none grid-cols-[minmax(0,1fr)] gap-1 px-2.5 py-3">
                {criteria?.map((item, index) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-secondary"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-secondary text-xs font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className={cn(CHIP, "px-2 py-0.5", TINT.neutral)}>×{item.weight}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
        <section className={PANEL}>
          <div className={PANEL_HEAD}>
            <Icon name="star" size={16} className="text-muted-foreground" />
            <h2 className="text-[15px] font-semibold">
              {manages ? "Đánh giá gần đây" : "Đánh giá cuộc gọi của tôi"}
            </h2>
            {average !== null && (
              <span className="ml-auto flex items-baseline gap-1.5">
                <b className="text-2xl font-bold tabular-nums">{average}%</b>
                <small className="text-xs text-muted-foreground">
                  trung bình {reviews!.length} cuộc
                </small>
              </span>
            )}
          </div>
          {!reviews?.length ? (
            <p className={cn(MUTED, "px-4 py-8 text-center")}>
              {manages
                ? "Chưa có cuộc gọi nào được chấm. Chấm từ tab “Lịch sử cuộc gọi”."
                : "Chưa có cuộc gọi nào của bạn được chấm."}
            </p>
          ) : (
            <ul className="list-none">
              {reviews.map((review) => (
                <li key={review.id} className="border-b last:border-b-0">
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-secondary"
                    aria-expanded={open === review.id}
                    onClick={() => setOpen(open === review.id ? null : review.id)}
                  >
                    <UserAvatar name={review.agentName} />
                    <span className="min-w-0 flex-1">
                      <b className="block truncate font-semibold">{review.agentName}</b>
                      <small className="block truncate text-xs text-muted-foreground">
                        {new Date(review.callStartedAt).toLocaleString("vi-VN")} ·{" "}
                        {review.callerNumber} · chấm bởi {review.reviewerName ?? "—"}
                      </small>
                    </span>
                    {review.coachingAssigned && (
                      <span className={cn(CHIP, "px-2 py-0.5", TINT.amber)}>Đã gán bồi dưỡng</span>
                    )}
                    <span className={cn(CHIP, "px-2 py-0.5", TINT[qaTone(review.percent)])}>
                      {review.percent}%
                    </span>
                    <Icon
                      name={open === review.id ? "chevron-up" : "chevron-down"}
                      size={15}
                      className="shrink-0 text-muted-foreground"
                    />
                  </button>
                  {open === review.id && (
                    <div className="grid gap-2 px-4 pb-3.5 pl-[60px]">
                      {review.items.map((item) => (
                        <div
                          key={item.id}
                          className="grid grid-cols-[minmax(0,1fr)_120px_44px] items-center gap-3 text-[13px]"
                        >
                          <span className="truncate">
                            {item.label}{" "}
                            <small className="text-muted-foreground">×{item.weight}</small>
                          </span>
                          <span className="h-1.5 overflow-hidden rounded-full bg-secondary">
                            <span
                              className="block h-full rounded-full bg-[#2f6bff]"
                              style={{ width: `${item.score * 10}%` }}
                            />
                          </span>
                          <b className="text-right font-semibold tabular-nums">{item.score}/10</b>
                        </div>
                      ))}
                      {review.comment && (
                        <p className="rounded-lg bg-secondary px-3 py-2 text-[13px] italic">
                          “{review.comment}”
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/** Scoring one call; opens with the existing review when there is one. */
export function QaReviewDialog({
  call,
  api,
  fail,
  onSaved,
  onClose,
}: {
  call: { id: string; departmentId: string; title: string };
  api: Api;
  fail: (error: unknown) => void;
  onSaved: (review: CcQaReview) => void;
  onClose: () => void;
}) {
  const [criteria, setCriteria] = useState<CcQaCriterion[] | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      api<CcQaCriterion[]>(`departments/${call.departmentId}/qa-criteria`),
      api<{ review: CcQaReview | null }>(`calls/${call.id}/qa`),
    ]).then(([sheet, { review: existing }]) => {
      setCriteria(sheet);
      setScores(
        Object.fromEntries(
          sheet.map((item) => [
            item.id,
            existing?.items.find((scored) => scored.id === item.id)?.score ?? 5,
          ]),
        ),
      );
      setComment(existing?.comment ?? "");
    }, fail);
  }, [api, call.departmentId, call.id, fail]);

  const total = criteria?.reduce((sum, item) => sum + item.weight * 10, 0) ?? 0;
  const earned =
    criteria?.reduce((sum, item) => sum + item.weight * (scores[item.id] ?? 0), 0) ?? 0;
  const percent = total ? Math.round((earned / total) * 100) : 0;
  const save = () => {
    setBusy(true);
    api<CcQaReview>(`calls/${call.id}/qa`, "POST", { scores, comment })
      .then(onSaved, fail)
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      title="Chấm điểm cuộc gọi"
      eyebrow={call.title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Hủy
          </Button>
          <Button type="button" icon="check" disabled={busy || !criteria?.length} onClick={save}>
            Lưu đánh giá · {percent}%
          </Button>
        </>
      }
    >
      {!criteria ? (
        <p className={MUTED}>Đang tải phiếu chấm…</p>
      ) : !criteria.length ? (
        <p className={WARNING}>
          Phòng ban chưa có phiếu chấm. Mở tab “Chất lượng” và bấm “Dùng phiếu chấm mẫu”.
        </p>
      ) : (
        <div className={SHEET}>
          {criteria.map((item) => (
            <label
              key={item.id}
              className="grid! grid-cols-[minmax(0,1fr)_minmax(120px,200px)_44px] items-center gap-3 text-foreground!"
            >
              <span>
                {item.label}{" "}
                <small className="text-muted-foreground">(trọng số {item.weight})</small>
              </span>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={scores[item.id] ?? 0}
                onChange={(event) =>
                  setScores({ ...scores, [item.id]: Number(event.target.value) })
                }
              />
              <output className="text-right font-semibold tabular-nums">
                {scores[item.id] ?? 0}/10
              </output>
            </label>
          ))}
          <label>
            Nhận xét cho tổng đài viên
            <textarea
              rows={3}
              maxLength={2000}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
        </div>
      )}
    </Modal>
  );
}

/**
 * E2: a supervisor turns a good (or instructive) call into a draft audio lesson of a course they
 * manage, after confirming consent. The lesson opens for review in Khóa học.
 */
export function CallLessonDialog({
  call,
  onClose,
}: {
  call: { id: string; title: string };
  onClose: () => void;
}) {
  const { accessToken, notify, navigate } = useApp();
  const token = accessToken!;
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [chapterId, setChapterId] = useState("");
  const [title, setTitle] = useState(`Tình huống mẫu: ${call.title}`.slice(0, 160));
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    coursesApi.list(token).then(
      (list) => setCourses(list.filter((item) => item.canManage)),
      (failure) => setError(failure.message),
    );
  }, [token]);
  const pick = (courseId: string) => {
    setCourse(null);
    setChapterId("");
    if (courseId)
      coursesApi.detail(token, courseId).then(
        (detail) => {
          setCourse(detail);
          setChapterId(detail.chapters[0]?.id ?? "");
        },
        (failure) => setError(failure.message),
      );
  };
  const save = () => {
    setBusy(true);
    setError("");
    coursesApi
      .importCall(token, chapterId, { callId: call.id, title: title.trim(), consent })
      .then(
        () => {
          notify(
            "Đã tạo bài học từ ghi âm",
            "Bài ở trạng thái nháp, đang chuyển định dạng.",
            "success",
          );
          onClose();
          navigate({ view: "elearning", query: course!.id });
        },
        (failure) => setError(failure.message),
      )
      .finally(() => setBusy(false));
  };

  return (
    <Modal
      title="Dùng ghi âm làm bài học"
      eyebrow={call.title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose}>
            Hủy
          </Button>
          <Button
            type="button"
            icon="book"
            disabled={busy || !chapterId || !consent || !title.trim()}
            onClick={save}
          >
            Tạo bài học
          </Button>
        </>
      }
    >
      <div className={SHEET}>
        <label>
          Khóa học
          <select value={course?.id ?? ""} onChange={(event) => pick(event.target.value)}>
            <option value="">
              {courses
                ? courses.length
                  ? "— Chọn khóa học bạn phụ trách —"
                  : "Bạn chưa phụ trách khóa học nào"
                : "Đang tải…"}
            </option>
            {courses?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} — {item.title}
              </option>
            ))}
          </select>
        </label>
        {course && (
          <label>
            Chương
            <select value={chapterId} onChange={(event) => setChapterId(event.target.value)}>
              {!course.chapters.length && <option value="">Khóa học chưa có chương</option>}
              {course.chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Tên bài học
          <input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="flex! items-start gap-2 text-foreground!">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          Tôi xác nhận người gọi đã đồng ý, hoặc ghi âm không chứa thông tin cá nhân (Nghị định
          13/2023).
        </label>
        {error && (
          <p className={WARNING} role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

const minuteSecond = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** 2.1: the automatic speech-to-text of a call recording. */
export function CallTranscriptDialog({
  call,
  api,
  onClose,
  labelOf = () => "",
  onApply,
}: {
  call: { id: string; title: string };
  api: Api;
  onClose: () => void;
  labelOf?: (dispositionId: string) => string;
  /** Puts the AI summary into the call's notes and its suggested disposition on the call. */
  onApply?: (summary: string, dispositionId: string | null) => Promise<void>;
}) {
  const [transcript, setTranscript] = useState<CcCallTranscript | null>(null);
  const [error, setError] = useState("");
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    api<CcCallTranscript>(`calls/${call.id}/transcript`).then(setTranscript, (failure: Error) =>
      setError(failure.message),
    );
  }, [api, call.id]);
  const apply = (summary: string, dispositionId: string | null) =>
    onApply?.(summary, dispositionId).then(
      () => setApplied(true),
      (failure: Error) => setError(failure.message),
    );
  return (
    <Modal title="Lời thoại cuộc gọi" eyebrow={call.title} onClose={onClose}>
      <div className={SHEET}>
        {transcript?.aiSummary && (
          <section
            className="grid gap-2 rounded-lg bg-[var(--tint-violet-bg)] px-3.5 py-3"
            aria-label="Tóm tắt bằng AI"
          >
            <strong className="flex items-center gap-1.5 text-[var(--tint-violet-fg)]">
              <Icon name="sparkles" size={14} />
              Tóm tắt (AI, cần kiểm tra lại)
            </strong>
            <p>{transcript.aiSummary}</p>
            {transcript.aiDispositionId && (
              <p className={MUTED}>
                Gợi ý mã kết quả: {labelOf(transcript.aiDispositionId) || "—"}
              </p>
            )}
            {onApply && (
              <Button
                size="sm"
                variant="secondary"
                disabled={applied}
                onClick={() => void apply(transcript.aiSummary!, transcript.aiDispositionId)}
              >
                {applied ? "Đã áp dụng" : "Áp dụng vào ghi nhận"}
              </Button>
            )}
          </section>
        )}
        {error ? (
          <p className={WARNING} role="alert">
            {error}
          </p>
        ) : !transcript ? (
          <p className={MUTED}>Đang tải…</p>
        ) : transcript.segments.length ? (
          <ol className="grid max-h-[50vh] list-none gap-1.5 overflow-y-auto">
            {transcript.segments.map((segment, index) => (
              <li key={index} className="grid grid-cols-[44px_minmax(0,1fr)] gap-2 text-[13.5px]">
                <span className="font-mono text-xs text-muted-foreground">
                  {minuteSecond(segment.start)}
                </span>{" "}
                {segment.text}
              </li>
            ))}
          </ol>
        ) : (
          <p className={MUTED}>Không nhận dạng được lời nói trong ghi âm.</p>
        )}
      </div>
    </Modal>
  );
}
