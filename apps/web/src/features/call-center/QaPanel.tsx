import { useCallback, useEffect, useState } from "react";
import type { CcAgentProfile, CcQaCriterion, CcQaReview, CourseDetail, CourseSummary } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { coursesApi } from "../elearning/courses-api";
import { Badge, Button, Field, FilterPills, Modal } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import "./quality.css";

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;
type Draft = { id: string | null; label: string; weight: number };

export const qaTone = (percent: number, threshold = 70) => (percent >= 85 ? "green" : percent >= threshold ? "blue" : "red");

/**
 * V7 / E2: scorecard per department and the reviews. Supervisors edit the sheet and see their
 * departments; an agent sees the reviews of their own calls.
 */
export function QaPanel({ me, api, fail }: { me: CcAgentProfile; api: Api; fail: (error: unknown) => void }) {
  const supervised = me.departments.filter((department) => department.role === "supervisor");
  const [departments, setDepartments] = useState(supervised);
  const [departmentId, setDepartmentId] = useState(supervised[0]?.id ?? "");
  const [criteria, setCriteria] = useState<Draft[]>([]);
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
    api<CcQaReview[]>(`qa-reviews${manages && departmentId ? `?departmentId=${departmentId}` : ""}`).then(setReviews, fail);
    if (manages && departmentId) api<CcQaCriterion[]>(`departments/${departmentId}/qa-criteria`).then(setCriteria, fail);
  }, [api, departmentId, fail, manages]);
  useEffect(load, [load]);

  const save = () =>
    api<CcQaCriterion[]>(`departments/${departmentId}/qa-criteria`, "POST", { criteria: criteria.filter((item) => item.label.trim()) }).then(setCriteria, fail);
  const average = reviews?.length ? Math.round(reviews.reduce((sum, review) => sum + review.percent, 0) / reviews.length) : null;

  return (
    <div className="qa-panel">
      {manages && departments.length > 1 && (
        <FilterPills options={departments.map((item) => ({ key: item.id, label: item.name }))} activeKey={departmentId} onChange={setDepartmentId} />
      )}
      <div className="qa-grid">
        {manages && (
          <section className="callcenter-panel">
            <div className="callcenter-panel__head">
              <h2 className="callcenter-panel__title"><Icon name="clipboard" size={18} /><span>Phiếu chấm điểm cuộc gọi</span></h2>
            </div>
            <p className="desk-muted">Mỗi tiêu chí chấm 0–10 điểm, nhân trọng số. Điểm dưới ngưỡng của phòng ban sẽ tự gán khóa bồi dưỡng.</p>
            <ol className="qa-criteria">
              {criteria.map((item, index) => (
                <li key={item.id ?? `new-${index}`}>
                  <input
                    aria-label={`Tiêu chí ${index + 1}`}
                    value={item.label}
                    maxLength={160}
                    placeholder="Ví dụ: Chào hỏi đúng mẫu"
                    onChange={(event) => setCriteria(criteria.map((other, at) => (at === index ? { ...other, label: event.target.value } : other)))}
                  />
                  <label className="qa-weight">
                    Trọng số
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={item.weight}
                      onChange={(event) => setCriteria(criteria.map((other, at) => (at === index ? { ...other, weight: Number(event.target.value) || 1 } : other)))}
                    />
                  </label>
                  <Button size="sm" variant="ghost" type="button" icon="x" aria-label={`Bỏ tiêu chí ${index + 1}`} onClick={() => setCriteria(criteria.filter((_, at) => at !== index))} />
                </li>
              ))}
            </ol>
            <div className="desk-actions">
              <Button size="sm" variant="ghost" type="button" icon="plus" disabled={criteria.length >= 20} onClick={() => setCriteria([...criteria, { id: null, label: "", weight: 1 }])}>
                Thêm tiêu chí
              </Button>
              <Button size="sm" type="button" icon="check" disabled={!criteria.some((item) => item.label.trim())} onClick={() => void save()}>Lưu phiếu chấm</Button>
            </div>
          </section>
        )}
        <section className="callcenter-panel">
          <div className="callcenter-panel__head">
            <h2 className="callcenter-panel__title"><Icon name="star" size={18} /><span>{manages ? "Đánh giá gần đây" : "Đánh giá cuộc gọi của tôi"}</span></h2>
            {average !== null && <Badge tone={qaTone(average)}>Trung bình {average}%</Badge>}
          </div>
          {!reviews?.length ? (
            <p className="desk-muted">{manages ? "Chưa có cuộc gọi nào được chấm. Chấm từ tab “Lịch sử cuộc gọi”." : "Chưa có cuộc gọi nào của bạn được chấm."}</p>
          ) : (
            reviews.map((review) => (
              <div key={review.id} className="call-item-card qa-review">
                <button type="button" className="qa-review__head" aria-expanded={open === review.id} onClick={() => setOpen(open === review.id ? null : review.id)}>
                  <span className="call-item-info">
                    <span className="call-item-caller">{review.agentName}</span>
                    <span className="call-item-meta">
                      {new Date(review.callStartedAt).toLocaleString("vi-VN")} · {review.callerNumber} · chấm bởi {review.reviewerName ?? "—"}
                    </span>
                  </span>
                  <Badge tone={qaTone(review.percent)}>{review.percent}%</Badge>
                  {review.coachingAssigned && <Badge tone="amber">Đã gán bồi dưỡng</Badge>}
                </button>
                {open === review.id && (
                  <div className="qa-review__body">
                    <ul>
                      {review.items.map((item) => (
                        <li key={item.id}>{item.label} <small>(×{item.weight})</small>: <strong>{item.score}/10</strong></li>
                      ))}
                    </ul>
                    {review.comment && <p>{review.comment}</p>}
                  </div>
                )}
              </div>
            ))
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
    Promise.all([api<CcQaCriterion[]>(`departments/${call.departmentId}/qa-criteria`), api<{ review: CcQaReview | null }>(`calls/${call.id}/qa`)]).then(([sheet, { review: existing }]) => {
      setCriteria(sheet);
      setScores(Object.fromEntries(sheet.map((item) => [item.id, existing?.items.find((scored) => scored.id === item.id)?.score ?? 5])));
      setComment(existing?.comment ?? "");
    }, fail);
  }, [api, call.departmentId, call.id, fail]);

  const total = criteria?.reduce((sum, item) => sum + item.weight * 10, 0) ?? 0;
  const earned = criteria?.reduce((sum, item) => sum + item.weight * (scores[item.id] ?? 0), 0) ?? 0;
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
          <Button variant="ghost" type="button" onClick={onClose}>Hủy</Button>
          <Button type="button" icon="check" disabled={busy || !criteria?.length} onClick={save}>Lưu đánh giá · {percent}%</Button>
        </>
      }
    >
      {!criteria ? (
        <p className="desk-muted">Đang tải phiếu chấm…</p>
      ) : !criteria.length ? (
        <p className="desk-warning">Phòng ban chưa có phiếu chấm. Tạo tiêu chí ở tab “Chất lượng”.</p>
      ) : (
        <div className="qa-sheet">
          {criteria.map((item) => (
            <label key={item.id} className="qa-score">
              <span>{item.label} <small>(trọng số {item.weight})</small></span>
              <input type="range" min={0} max={10} step={1} value={scores[item.id] ?? 0} onChange={(event) => setScores({ ...scores, [item.id]: Number(event.target.value) })} />
              <output>{scores[item.id] ?? 0}/10</output>
            </label>
          ))}
          <Field label="Nhận xét cho tổng đài viên">
            <textarea rows={3} maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
}

/**
 * E2: a supervisor turns a good (or instructive) call into a draft audio lesson of a course they
 * manage, after confirming consent. The lesson opens for review in Khóa học.
 */
export function CallLessonDialog({ call, onClose }: { call: { id: string; title: string }; onClose: () => void }) {
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
    coursesApi.list(token).then((list) => setCourses(list.filter((item) => item.canManage)), (failure) => setError(failure.message));
  }, [token]);
  const pick = (courseId: string) => {
    setCourse(null);
    setChapterId("");
    if (courseId)
      coursesApi.detail(token, courseId).then((detail) => {
        setCourse(detail);
        setChapterId(detail.chapters[0]?.id ?? "");
      }, (failure) => setError(failure.message));
  };
  const save = () => {
    setBusy(true);
    setError("");
    coursesApi
      .importCall(token, chapterId, { callId: call.id, title: title.trim(), consent })
      .then(
        () => {
          notify("Đã tạo bài học từ ghi âm", "Bài ở trạng thái nháp, đang chuyển định dạng.", "success");
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
          <Button variant="ghost" type="button" onClick={onClose}>Hủy</Button>
          <Button type="button" icon="book" disabled={busy || !chapterId || !consent || !title.trim()} onClick={save}>Tạo bài học</Button>
        </>
      }
    >
      <div className="qa-sheet">
        <Field label="Khóa học">
          <select value={course?.id ?? ""} onChange={(event) => pick(event.target.value)}>
            <option value="">{courses ? (courses.length ? "— Chọn khóa học bạn phụ trách —" : "Bạn chưa phụ trách khóa học nào") : "Đang tải…"}</option>
            {courses?.map((item) => <option key={item.id} value={item.id}>{item.code} — {item.title}</option>)}
          </select>
        </Field>
        {course && (
          <Field label="Chương">
            <select value={chapterId} onChange={(event) => setChapterId(event.target.value)}>
              {!course.chapters.length && <option value="">Khóa học chưa có chương</option>}
              {course.chapters.map((chapter) => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}
            </select>
          </Field>
        )}
        <Field label="Tên bài học">
          <input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <label className="qa-check">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          Tôi xác nhận người gọi đã đồng ý, hoặc ghi âm không chứa thông tin cá nhân (Nghị định 13/2023).
        </label>
        {error && <p className="desk-warning" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
