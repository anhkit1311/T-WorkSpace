import { useCallback, useEffect, useRef, useState } from "react";
import type { LessonDetail, QuizAttempt } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Icon } from "../../shared/ui/Icon";
import { cn } from "../../shared/lib/utils";

const BTN =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 text-[13.5px] font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-primary text-primary-foreground hover:bg-primary/90`;
const BTN_GHOST = `${BTN} border bg-card text-foreground hover:bg-secondary`;
const CHIP = "rounded-[5px] px-[7px] py-[3px] text-xs leading-none font-semibold whitespace-nowrap";
const GREEN = "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]";
const AMBER = "bg-[var(--tint-amber-bg)] text-[var(--tint-amber-fg)]";
const ERROR =
  "rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300";
import { coursesApi } from "./courses-api";

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** EL-4: one attempt at a time; the deadline comes from the server and the attempt submits itself at zero. */
export function QuizRunner({
  lesson,
  onFinished,
}: {
  lesson: LessonDetail;
  onFinished: () => void;
}) {
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
      <div className="tw grid justify-items-start gap-3 rounded-[10px] border bg-card p-4 text-foreground">
        <p className="text-sm text-muted-foreground">
          {quiz.drawCount && quiz.drawCount < quiz.questionIds.length
            ? `${quiz.drawCount} câu rút ngẫu nhiên từ ${quiz.questionIds.length}`
            : `${quiz.questionIds.length} câu hỏi`}{" "}
          ·{" "}
          {quiz.timeLimitSeconds
            ? `${Math.round(quiz.timeLimitSeconds / 60)} phút`
            : "không giới hạn thời gian"}{" "}
          · đạt từ {quiz.passPercent}%
        </p>
        {(quiz.bestPercent !== null || quiz.attemptsLeft !== null) && (
          <div className="flex flex-wrap gap-1.5">
            {quiz.bestPercent !== null && (
              <span className={cn(CHIP, quiz.passed ? GREEN : AMBER)}>
                Điểm cao nhất: {quiz.bestPercent}%{quiz.passed ? " · Đạt" : ""}
              </span>
            )}
            {quiz.attemptsLeft !== null && (
              <span className={cn(CHIP, "bg-secondary text-muted-foreground")}>
                Còn {quiz.attemptsLeft}/{quiz.maxAttempts} lần làm
              </span>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className={ERROR}>
            {error}
          </p>
        )}
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={!quiz.openAttemptId && quiz.attemptsLeft === 0}
          onClick={() => void start()}
        >
          <Icon name="play" size={15} />
          {quiz.openAttemptId
            ? "Làm tiếp"
            : quiz.bestPercent === null
              ? "Bắt đầu làm bài"
              : "Làm lại"}
        </button>
      </div>
    );

  const review = new Map(attempt.review?.map((item) => [item.questionId, item]) ?? []);
  const pick = (questionId: string, value: string | boolean, multiple: boolean) => {
    dirty.current = true;
    setAnswers((current) => {
      const previous = current[questionId] ?? [];
      return {
        ...current,
        [questionId]: multiple
          ? previous.includes(value)
            ? previous.filter((item) => item !== value)
            : [...previous, value]
          : [value],
      };
    });
  };

  const answered = attempt.questions.filter((question) => answers[question.id]?.length).length;

  return (
    <form
      className="tw grid gap-3 text-foreground"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {running && (
        <div className="sticky top-0 z-[1] flex flex-wrap items-center gap-x-3 gap-y-1 bg-background py-2 text-xs text-muted-foreground">
          <span>
            Đã trả lời {answered}/{attempt.questions.length}
          </span>
          <span className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-secondary">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${(answered / Math.max(1, attempt.questions.length)) * 100}%` }}
            />
          </span>
          {saved !== "idle" && (
            <span className={cn(saved === "failed" && "text-red-600")} role="status">
              {saved === "saving"
                ? "Đang lưu nháp…"
                : saved === "saved"
                  ? "Đã lưu nháp"
                  : "Chưa lưu được nháp — kiểm tra kết nối"}
            </span>
          )}
          {left !== null && (
            <span
              className={cn(
                CHIP,
                "tabular-nums",
                left < 60_000 ? "bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)]" : AMBER,
              )}
              role="timer"
              aria-live="off"
            >
              Còn lại {clock(left)}
            </span>
          )}
        </div>
      )}
      {attempt.submittedAt && (
        <p
          className={cn("rounded-[10px] px-4 py-3 text-sm", attempt.passed ? GREEN : AMBER)}
          role="status"
        >
          Kết quả: {attempt.score}/{attempt.maxScore} điểm ·{" "}
          <strong className="font-semibold">{attempt.passed ? "Đạt" : "Chưa đạt"}</strong>
        </p>
      )}
      <ol className="grid gap-3">
        {attempt.questions.map((question, index) => {
          const result = review.get(question.id);
          const choices =
            question.kind === "true_false"
              ? [
                  { id: true, text: "Đúng" },
                  { id: false, text: "Sai" },
                ]
              : question.options;
          const multiple = question.kind === "multiple";
          return (
            <li
              key={question.id}
              className={cn(
                "rounded-[10px] border bg-card p-4",
                result && (result.correct ? "border-emerald-500" : "border-red-400"),
              )}
            >
              <fieldset className="grid min-w-0 gap-2" disabled={!running}>
                <legend className="mb-2 grid gap-1">
                  <small className="text-xs text-muted-foreground">
                    Câu {index + 1} · {question.points} điểm
                    {multiple ? " · chọn tất cả đáp án đúng" : ""}
                    {result && (result.correct ? " · Đúng" : " · Sai")}
                  </small>
                  <b className="text-[15px] leading-snug font-semibold">{question.prompt}</b>
                </legend>
                {choices.map((choice) => (
                  <label
                    key={String(choice.id)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:bg-secondary has-checked:border-brand has-checked:bg-brand-soft has-disabled:cursor-default has-disabled:hover:bg-transparent has-checked:has-disabled:hover:bg-brand-soft"
                  >
                    <input
                      type={multiple ? "checkbox" : "radio"}
                      name={question.id}
                      checked={(answers[question.id] ?? []).includes(choice.id)}
                      onChange={() => pick(question.id, choice.id, multiple)}
                    />
                    <span className="flex-1">{choice.text}</span>
                    {result?.answer.includes(choice.id) && (
                      <small className={cn(CHIP, GREEN)}>✓ đáp án</small>
                    )}
                  </label>
                ))}
                {result?.explanation && (
                  <p className="text-[13px] text-muted-foreground">{result.explanation}</p>
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>
      {error && (
        <p role="alert" className={ERROR}>
          {error}
        </p>
      )}
      <div className="flex justify-end border-t pt-3.5">
        {running ? (
          <button type="submit" className={BTN_PRIMARY} disabled={busy}>
            <Icon name="send" size={15} />
            Nộp bài
          </button>
        ) : (
          <button type="button" className={BTN_GHOST} onClick={() => void start()}>
            Làm lại
          </button>
        )}
      </div>
    </form>
  );
}
