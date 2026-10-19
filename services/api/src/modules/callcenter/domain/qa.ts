// V7: chấm điểm chất lượng cuộc gọi theo phiếu tiêu chí của phòng ban. Quy tắc thuần, test không cần DB.

export const QA_MAX_SCORE = 10;

export interface QaCriterion {
  id: string;
  label: string;
  weight: number;
}

export interface QaScoreItem extends QaCriterion {
  score: number;
}

/**
 * Weighted percentage of a review. Every criterion must be scored 0..10; a score for a criterion
 * that is not on the sheet is an error. Returns the snapshot kept with the review.
 */
export function scoreReview(criteria: QaCriterion[], scores: unknown): { percent: number; items: QaScoreItem[] } | string {
  if (!criteria.length) return "Phòng ban chưa có tiêu chí chấm điểm.";
  if (typeof scores !== "object" || scores === null || Array.isArray(scores)) return "scores phải là {criterionId: điểm}.";
  const given = scores as Record<string, unknown>;
  const known = new Set(criteria.map((criterion) => criterion.id));
  if (Object.keys(given).some((key) => !known.has(key))) return "Có tiêu chí không thuộc phiếu chấm.";
  const items: QaScoreItem[] = [];
  for (const criterion of criteria) {
    const score = given[criterion.id];
    if (!Number.isInteger(score) || (score as number) < 0 || (score as number) > QA_MAX_SCORE)
      return `Tiêu chí "${criterion.label}" cần điểm nguyên từ 0 đến ${QA_MAX_SCORE}.`;
    items.push({ ...criterion, score: score as number });
  }
  const earned = items.reduce((sum, item) => sum + item.score * item.weight, 0);
  const possible = items.reduce((sum, item) => sum + QA_MAX_SCORE * item.weight, 0);
  return { percent: Math.round((earned / possible) * 10000) / 100, items };
}

/** E2: a review below the department's threshold sends the agent to the coaching course, once per review. */
export const needsCoaching = (percent: number, threshold: number, coachingCourseId: string | null, alreadyAssigned: boolean) =>
  coachingCourseId !== null && !alreadyAssigned && percent < threshold;
