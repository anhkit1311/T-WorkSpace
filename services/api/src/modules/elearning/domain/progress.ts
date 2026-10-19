import { presentMs } from "../../meetings/attendance.js";

// EL-5 / EL-6: completion and live-class attendance rules.

/** Share of the published lessons a learner has completed, 0..100. */
export function completionPercent(publishedLessons: number, completedLessons: number): number {
  return publishedLessons ? Math.round((Math.min(completedLessons, publishedLessons) / publishedLessons) * 100) : 0;
}

/** EL-6: present for at least 70% of the class counts as attended. */
export const ATTENDANCE_THRESHOLD = 0.7;

/**
 * Attendance of one learner in a live class held over [classStart, classEnd]; their meeting
 * connections are clipped to that span, and overlapping connections (two tabs) count once.
 */
export function liveAttendance(intervals: { from: number; to: number }[], classStart: number, classEnd: number) {
  const span = Math.max(1, classEnd - classStart);
  const clipped = intervals
    .map(({ from, to }) => ({ from: Math.max(from, classStart), to: Math.min(to, classEnd) }))
    .filter(({ from, to }) => to > from);
  const present = presentMs(clipped);
  const ratio = Math.min(1, present / span);
  return { presentSeconds: Math.round(present / 1000), ratio: Math.round(ratio * 10000) / 10000, attended: ratio >= ATTENDANCE_THRESHOLD };
}
