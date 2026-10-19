import { useCallback, useEffect, useState } from "react";
import type { CourseDetail, CourseProgressReport, CourseQuestion, QuestionKind, WorkspaceItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Button } from "../../shared/ui/Primitives";
import { getWorkspacesApi } from "../chat/api";
import { coursesApi, downloadProgressCsv } from "./courses-api";

/** EL-2 assignment and EL-5 progress of every learner. */
export function CourseLearners({ course }: { course: CourseDetail }) {
  const { accessToken, notify } = useApp();
  const token = accessToken!;
  const [report, setReport] = useState<CourseProgressReport | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [units, setUnits] = useState<{ id: string; name: string }[]>([]);
  const [target, setTarget] = useState<"emails" | "workspace" | "unit">("emails");
  const [emails, setEmails] = useState("");
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => coursesApi.progress(token, course.id).then(setReport, (failure) => setError(failure.message)), [token, course.id]);
  useEffect(() => {
    void load();
    void getWorkspacesApi(token).then(setWorkspaces, () => setWorkspaces([]));
    void coursesApi.units(token).then(setUnits, () => setUnits([]));
  }, [load, token]);

  const assign = async () => {
    setError("");
    try {
      const body =
        target === "emails"
          ? { emails: emails.split(/[\s,;]+/).filter(Boolean) }
          : target === "workspace"
            ? { workspaceId: targetId }
            : { unitId: targetId };
      const result = await coursesApi.assign(token, course.id, body);
      notify(
        `Đã ghi danh ${result.added} học viên`,
        [result.alreadyEnrolled ? `${result.alreadyEnrolled} người đã có trong khóa` : "", result.notFound.length ? `Không tìm thấy: ${result.notFound.join(", ")}` : ""]
          .filter(Boolean)
          .join(". ") || undefined,
        result.notFound.length ? "warning" : "success",
      );
      setEmails("");
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không ghi danh được.");
    }
  };

  const quizzes = report?.lessons.filter((lesson) => lesson.kind === "quiz") ?? [];
  return (
    <div className="course-panel">
      <form
        className="courses-form"
        onSubmit={(event) => {
          event.preventDefault();
          void assign();
        }}
      >
        <fieldset className="course-inline-form">
          <legend>Gán học viên</legend>
          <select value={target} onChange={(event) => { setTarget(event.target.value as typeof target); setTargetId(""); }} aria-label="Gán theo">
            <option value="emails">Theo danh sách email</option>
            <option value="workspace">Theo lớp (nhóm làm việc)</option>
            <option value="unit">Theo đơn vị</option>
          </select>
          {target === "emails" ? (
            <textarea rows={2} value={emails} onChange={(event) => setEmails(event.target.value)} placeholder="Mỗi email một dòng hoặc cách nhau bởi dấu phẩy" aria-label="Danh sách email" required />
          ) : (
            <select value={targetId} onChange={(event) => setTargetId(event.target.value)} required aria-label={target === "workspace" ? "Lớp" : "Đơn vị"}>
              <option value="">— Chọn —</option>
              {(target === "workspace" ? workspaces : units).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          )}
          <Button type="submit" icon="user-plus">Ghi danh</Button>
        </fieldset>
      </form>
      {error && <p role="alert" className="courses-error">{error}</p>}
      <div className="course-outline__tools">
        <h3>Tiến độ học viên ({report?.learners.length ?? 0})</h3>
        <Button size="sm" variant="secondary" icon="download" onClick={() => void downloadProgressCsv(token, course.id, `tien-do-${course.code}.csv`).catch((failure) => setError(failure.message))}>
          Xuất Excel
        </Button>
      </div>
      {report && (
        <div className="course-table-wrap">
          <table className="course-table">
            <thead>
              <tr>
                <th scope="col">Học viên</th>
                <th scope="col">Hoàn thành</th>
                {quizzes.map((quiz) => <th key={quiz.id} scope="col">{quiz.title}</th>)}
                <th scope="col"><span className="visually-hidden">Thao tác</span></th>
              </tr>
            </thead>
            <tbody>
              {report.learners.map((learner) => (
                <tr key={learner.userId}>
                  <th scope="row">
                    {learner.displayName}
                    <small>{learner.email}{learner.source === "self" ? " · tự đăng ký" : ""}</small>
                  </th>
                  <td>
                    <span className="course-progress course-progress--inline" aria-hidden="true"><span style={{ width: `${learner.percent}%` }} /></span>
                    {learner.percent}%
                  </td>
                  {quizzes.map((quiz) => <td key={quiz.id}>{learner.quizPercents[quiz.id] === undefined ? "—" : `${learner.quizPercents[quiz.id]}%`}</td>)}
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => void coursesApi.unenroll(token, course.id, learner.userId).then(load, (failure) => setError(failure.message))}>
                      Gỡ
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const KINDS: [QuestionKind, string][] = [
  ["single", "Một lựa chọn"],
  ["multiple", "Nhiều lựa chọn"],
  ["true_false", "Đúng / Sai"],
];
const blank = (): Omit<CourseQuestion, "id"> => ({
  kind: "single",
  prompt: "",
  options: [{ id: "a", text: "" }, { id: "b", text: "" }],
  answer: [],
  explanation: "",
  points: 1,
});

/** EL-4: the course's question bank; quizzes pick their questions from it. */
export function QuestionBank({ course }: { course: CourseDetail }) {
  const { accessToken, notify } = useApp();
  const token = accessToken!;
  const [questions, setQuestions] = useState<CourseQuestion[]>([]);
  const [draft, setDraft] = useState<Omit<CourseQuestion, "id"> & { id?: string }>(blank);
  const [error, setError] = useState("");
  const load = useCallback(() => coursesApi.questions(token, course.id).then(setQuestions, (failure) => setError(failure.message)), [token, course.id]);
  useEffect(() => void load(), [load]);

  const save = async () => {
    setError("");
    try {
      const { id, ...body } = draft;
      await coursesApi.saveQuestion(token, course.id, id ?? null, body);
      notify(id ? "Đã lưu câu hỏi" : "Đã thêm câu hỏi");
      setDraft(blank());
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không lưu được câu hỏi.");
    }
  };
  const toggleAnswer = (value: string | boolean) =>
    setDraft((current) => ({
      ...current,
      answer: current.kind === "multiple" ? (current.answer.includes(value) ? current.answer.filter((item) => item !== value) : [...current.answer, value]) : [value],
    }));

  return (
    <div className="course-panel course-bank">
      <form
        className="courses-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h3>{draft.id ? "Sửa câu hỏi" : "Thêm câu hỏi"}</h3>
        <div className="course-inline-form">
          <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as QuestionKind, answer: [], options: event.target.value === "true_false" ? [] : draft.options.length ? draft.options : blank().options })} aria-label="Loại câu hỏi">
            {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label>Điểm<input type="number" min={1} max={100} value={draft.points} onChange={(event) => setDraft({ ...draft, points: Number(event.target.value) })} /></label>
        </div>
        <label>Câu hỏi<textarea rows={2} value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} required maxLength={2000} /></label>
        <fieldset className="course-question-picker">
          <legend>Phương án — đánh dấu đáp án đúng</legend>
          {draft.kind === "true_false"
            ? [true, false].map((value) => (
                <label key={String(value)}>
                  <input type="radio" name="tf" checked={draft.answer[0] === value} onChange={() => toggleAnswer(value)} />
                  {value ? "Đúng" : "Sai"}
                </label>
              ))
            : draft.options.map((option, index) => (
                <div key={option.id} className="course-inline-form">
                  <input
                    type={draft.kind === "multiple" ? "checkbox" : "radio"}
                    name="correct"
                    checked={draft.answer.includes(option.id)}
                    onChange={() => toggleAnswer(option.id)}
                    aria-label={`Đáp án đúng: phương án ${index + 1}`}
                  />
                  <input
                    value={option.text}
                    onChange={(event) => setDraft({ ...draft, options: draft.options.map((item) => (item.id === option.id ? { ...item, text: event.target.value } : item)) })}
                    placeholder={`Phương án ${index + 1}`}
                    aria-label={`Phương án ${index + 1}`}
                    required
                    maxLength={500}
                  />
                  {draft.options.length > 2 && (
                    <Button size="sm" variant="ghost" type="button" icon="x" aria-label="Bỏ phương án" onClick={() => setDraft({ ...draft, options: draft.options.filter((item) => item.id !== option.id), answer: draft.answer.filter((item) => item !== option.id) })} />
                  )}
                </div>
              ))}
          {draft.kind !== "true_false" && draft.options.length < 10 && (
            <Button size="sm" variant="ghost" type="button" icon="plus" onClick={() => setDraft({ ...draft, options: [...draft.options, { id: Math.random().toString(36).slice(2, 8), text: "" }] })}>
              Thêm phương án
            </Button>
          )}
        </fieldset>
        <label>Giải thích (hiện sau khi nộp bài)<textarea rows={2} value={draft.explanation} onChange={(event) => setDraft({ ...draft, explanation: event.target.value })} maxLength={2000} /></label>
        {error && <p role="alert" className="courses-error">{error}</p>}
        <div className="course-outline__tools">
          <Button type="submit" disabled={!draft.answer.length}>{draft.id ? "Lưu câu hỏi" : "Thêm vào ngân hàng"}</Button>
          {draft.id && <Button variant="ghost" type="button" onClick={() => setDraft(blank())}>Hủy sửa</Button>}
        </div>
      </form>
      <ol className="course-bank__list">
        {questions.map((question) => (
          <li key={question.id}>
            <span>
              <strong>{question.prompt}</strong>
              <small>{KINDS.find(([value]) => value === question.kind)?.[1]} · {question.points} điểm</small>
            </span>
            <Button size="sm" variant="ghost" icon="pencil" onClick={() => setDraft(question)}>Sửa</Button>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => void coursesApi.deleteQuestion(token, question.id).then(load, (failure) => setError(failure.message))}>Xóa</Button>
          </li>
        ))}
        {!questions.length && <li className="course-card__meta">Chưa có câu hỏi nào.</li>}
      </ol>
    </div>
  );
}
