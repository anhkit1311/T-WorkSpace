// EL-5: watch time of a video lesson. Pure rules, tested without a database.

export type WatchRange = [number, number];

/** Share of the video a learner must have played before the lesson counts as done. */
export const WATCH_REQUIRED = 0.9;

/**
 * Seconds of video one report may add: playback at up to 2x (plus a little for network delay)
 * since the previous report, and at most 30 s for the first one, so a script cannot claim the
 * whole video at once.
 */
export function maxReportSeconds(sinceLastReportMs: number | null): number {
  return sinceLastReportMs === null ? 30 : Math.min(30, (2.2 * sinceLastReportMs) / 1000);
}

/** Adds the played stretch [from, to] (clamped to the video and to `cap` seconds) and merges overlaps. */
export function addWatched(ranges: WatchRange[], from: number, to: number, duration: number, cap: number): WatchRange[] {
  const start = Math.max(0, Math.min(from, duration));
  const end = Math.min(to, duration, start + cap);
  const all = end > start ? [...ranges, [start, end] as WatchRange] : [...ranges];
  const merged: WatchRange[] = [];
  for (const [a, b] of all.sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

export const watchedSeconds = (ranges: WatchRange[]) => ranges.reduce((sum, [a, b]) => sum + (b - a), 0);

export const watchedEnough = (ranges: WatchRange[], duration: number) => duration > 0 && watchedSeconds(ranges) >= duration * WATCH_REQUIRED;
