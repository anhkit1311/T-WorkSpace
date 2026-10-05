/** Distance from the bottom (px) still treated as "reading the latest messages". */
export const LATEST_THRESHOLD = 160;

/**
 * Whether the list shows the newest messages. A message-context window (search hit,
 * pinned banner) is never the latest page, even when scrolled to its end.
 */
export function isAtLatest({
  inContext,
  distanceFromBottom,
  threshold = LATEST_THRESHOLD,
}: {
  inContext: boolean;
  distanceFromBottom: number;
  threshold?: number;
}): boolean {
  return !inContext && distanceFromBottom <= threshold;
}

export function jumpToLatestLabel(newCount: number): string {
  return newCount > 0
    ? `Xuống tin mới nhất (${newCount > 99 ? "99+" : newCount} tin mới)`
    : "Xuống tin mới nhất";
}
