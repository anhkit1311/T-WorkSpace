// EL-4: question bank and automatic grading. Pure rules, tested without a database.

export type QuestionKind = "single" | "multiple" | "true_false";
export type QuestionOption = { id: string; text: string };
/** single/multiple: the correct option ids; true_false: [true] or [false]. */
export type Answer = (string | boolean)[];

export interface GradableQuestion {
  id: string;
  kind: QuestionKind;
  options: QuestionOption[];
  answer: Answer;
  points: number;
}

/** Returns an error message, or null when the question is well formed. */
export function questionProblem(kind: QuestionKind, options: QuestionOption[], answer: Answer): string | null {
  if (kind === "true_false") {
    if (options.length) return "Câu đúng/sai không có phương án.";
    return answer.length === 1 && typeof answer[0] === "boolean" ? null : "Câu đúng/sai cần đáp án true hoặc false.";
  }
  if (options.length < 2 || options.length > 10) return "Cần từ 2 đến 10 phương án.";
  const ids = new Set(options.map((option) => option.id));
  if (ids.size !== options.length || options.some((option) => !option.id || !option.text.trim()))
    return "Phương án phải có mã riêng và nội dung.";
  if (answer.some((item) => typeof item !== "string" || !ids.has(item)) || new Set(answer).size !== answer.length)
    return "Đáp án phải là mã của các phương án.";
  if (kind === "single" && answer.length !== 1) return "Câu một lựa chọn có đúng một đáp án.";
  if (kind === "multiple" && answer.length < 1) return "Câu nhiều lựa chọn cần ít nhất một đáp án.";
  return null;
}

/** All or nothing: a multiple-choice answer scores only when it picks exactly the right options. */
export function isCorrect(question: GradableQuestion, response: unknown): boolean {
  if (!Array.isArray(response)) return false;
  if (question.kind === "true_false") return response.length === 1 && response[0] === question.answer[0];
  const picked = new Set(response);
  return picked.size === response.length && picked.size === question.answer.length && question.answer.every((id) => picked.has(id));
}

export function gradeAttempt(questions: GradableQuestion[], answers: Record<string, unknown>, passPercent: number) {
  let score = 0;
  let maxScore = 0;
  const results = questions.map((question) => {
    const correct = isCorrect(question, answers[question.id]);
    maxScore += question.points;
    if (correct) score += question.points;
    return { questionId: question.id, correct };
  });
  const percent = maxScore ? Math.round((score / maxScore) * 10000) / 100 : 0;
  return { score, maxScore, percent, passed: percent >= passPercent, results };
}

/** A late submission (network, clock skew) is accepted within this grace; after it the attempt is graded empty. */
export const SUBMIT_GRACE_MS = 30_000;
export const isLate = (deadline: Date | null, now: Date) => deadline !== null && +now > +deadline + SUBMIT_GRACE_MS;

/**
 * Questions of a new attempt: `count` of them drawn at random (all when null), in random order
 * when `shuffle` or when drawing, else in the quiz's order. `random` is injectable for tests.
 */
export function drawQuestions<T>(ids: T[], count: number | null, shuffle: boolean, random: () => number = Math.random): T[] {
  const pool = [...ids];
  if (!shuffle && (count === null || count >= pool.length)) return pool;
  for (let index = pool.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [pool[index], pool[other]] = [pool[other], pool[index]];
  }
  return count === null ? pool : pool.slice(0, count);
}

/** Option order of one question in one attempt: stable across reloads, different between attempts. */
export function shuffledOptions<T extends { id: string }>(options: T[], seed: string): T[] {
  const weight = (value: string) => {
    let hash = 2166136261; // FNV-1a
    for (const char of seed + value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash >>> 0;
  };
  return [...options].sort((a, b) => weight(a.id) - weight(b.id));
}

/** Draft answers: only questions of the attempt, each an array of at most 10 short values. */
export function draftProblem(answers: unknown, questionIds: string[]): string | null {
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) return "answers phải là {questionId: đáp án}.";
  const allowed = new Set(questionIds);
  for (const [key, value] of Object.entries(answers)) {
    if (!allowed.has(key)) return "Câu hỏi không thuộc lượt làm bài.";
    if (!Array.isArray(value) || value.length > 10 || value.some((item) => typeof item === "string" ? item.length > 40 : typeof item !== "boolean"))
      return "Đáp án không hợp lệ.";
  }
  return null;
}
