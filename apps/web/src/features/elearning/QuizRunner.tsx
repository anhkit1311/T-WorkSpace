import { useCallback, useEffect, useRef, useState } from "react";
import type { LessonDetail, QuizAttempt } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Badge, Button } from "../../shared/ui/Primitives";
import { coursesApi } from "./courses-api";

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** EL-4: one attempt at a time; the deadline comes from the server and the attempt submits itself at zero. */
export function QuizRunner({ lesson, onFinished }: { lesson: LessonDetail; onFinished: () => void }) {
  const { accessToken } = useApp();
  const quiz = lesson.quiz!;
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, (string | boolean)[]>>({});
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const submitting = useRef(false);
  const dirty = useRef(false);

  const start = async () => {
    setError("");
    try {
      const started = await coursesApi.startQuiz(accessToken!, lesson.id);
      // Resuming continues from the autosaved answers.
      setAnswers(started.answers ?? {});
      setSaved(started.savedAt ? "saved" : "idle");
      dirty.current = false;
      setAttempt(started);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không bắt đầu được bài kiểm tra.");
    }
  };

  const submit = useCallback(async () => {
    if (!attempt || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      setAttempt(await coursesApi.submitQuiz(accessToken!, attempt.id, answers));
      onFinished();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không nộp được bài.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }, [attempt, answers, accessToken, onFinished]);

  const running = attempt && !attempt.submittedAt;
  // Autosave a moment after the last change, so a lost connection or reload keeps the work.
  useEffect(() => {
    if (!running || !dirty.current) return;
    const timer = window.setTimeout(() => {
      setSaved("saving");
      coursesApi.saveAnswers(accessToken!, attempt.id, answers).then(
        () => setSaved("saved"),
        () => setSaved("failed"),
      );
    }, 800);
    return () => window.clearTimeout(timer);
  }, [answers, running, attempt?.id, accessToken]);
  useEffect(() => {
    if (!running || !attempt.deadlineAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [running, attempt?.deadlineAt]);
  const left = running && attempt.deadlineAt ? +new Date(attempt.deadlineAt) - now : null;
  useEffect(() => {
    if (left !== null && left <= 0) void submit();
  }, [left, submit]);

  if (!attempt)
    return (
      <div className="quiz">
        <p>
          {quiz.drawCount && quiz.drawCount < quiz.questionIds.length ? `${quiz.drawCount} câu rút ngẫu nhiên từ ${quiz.questionIds.length}` : `${quiz.questionIds.length} câu hỏi`} · {quiz.timeLimitSeconds ? `${Math.round(quiz.timeLimitSeconds / 60)} phút` : "không giới hạn thời gian"} · đạt từ {quiz.passPercent}%
        </p>
        {quiz.bestPercent !== null && <Badge tone={quiz.passed ? "green" : "amber"}>Điểm cao nhất: {quiz.bestPercent}%{quiz.passed ? " · Đạt" : ""}</Badge>}
        {error && <p role="alert" className="courses-error">{error}</p>}
        <Button icon="play" onClick={() => void start()}>{quiz.openAttemptId ? "Làm tiếp" : quiz.bestPercent === null ? "Bắt đầu làm bài" : "Làm lại"}</Button>
      </div>
    );

  const review = new Map(attempt.review?.map((item) => [item.questionId, item]) ?? []);
  const pick = (questionId: string, value: string | boolean, multiple: boolean) => {
    dirty.current = true;
    setAnswers((current) => {
      const previous = current[questionId] ?? [];
      return { ...current, [questionId]: multiple ? (previous.includes(value) ? previous.filter((item) => item !== value) : [...previous, value]) : [value] };
    });
  };

  return (
    <form
      className="quiz"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {running && left !== null && (
        <p className={`quiz-timer${left < 60_000 ? " is-urgent" : ""}`} role="timer" aria-live="off">
          Còn lại {clock(left)}
        </p>
      )}
      {running && saved !== "idle" && (
        <p className={`quiz-saved${saved === "failed" ? " is-failed" : ""}`} role="status">
          {saved === "saving" ? "Đang lưu nháp…" : saved === "saved" ? "Đã lưu nháp" : "Chưa lưu được nháp — kiểm tra kết nối"}
        </p>
      )}
      {attempt.submittedAt && (
        <p className="quiz-result" role="status">
          Kết quả: {attempt.score}/{attempt.maxScore} điểm · <strong>{attempt.passed ? "Đạt" : "Chưa đạt"}</strong>
        </p>
      )}
      <ol className="quiz-questions">
        {attempt.questions.map((question) => {
          const result = review.get(question.id);
          const choices = question.kind === "true_false" ? [{ id: true, text: "Đúng" }, { id: false, text: "Sai" }] : question.options;
          const multiple = question.kind === "multiple";
          return (
            <li key={question.id} className={result ? (result.correct ? "is-correct" : "is-wrong") : ""}>
              <fieldset disabled={!running}>
                <legend>
                  {question.prompt} <small>({question.points} điểm{multiple ? ", chọn tất cả đáp án đúng" : ""})</small>
                </legend>
                {choices.map((choice) => (
                  <label key={String(choice.id)}>
                    <input
                      type={multiple ? "checkbox" : "radio"}
                      name={question.id}
                      checked={(answers[question.id] ?? []).includes(choice.id)}
                      onChange={() => pick(question.id, choice.id, multiple)}
                    />
                    {choice.text}
                    {result?.answer.includes(choice.id) && <small> ✓ đáp án</small>}
                  </label>
                ))}
                {result?.explanation && <p className="course-card__meta">{result.explanation}</p>}
              </fieldset>
            </li>
          );
        })}
      </ol>
      {error && <p role="alert" className="courses-error">{error}</p>}
      {running ? (
        <Button type="submit" icon="send" disabled={busy}>Nộp bài</Button>
      ) : (
        <Button variant="secondary" type="button" onClick={() => void start()}>Làm lại</Button>
      )}
    </form>
  );
}
