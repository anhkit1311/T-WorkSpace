const DAY = 86_400_000;

export function dayGroup(iso: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const at = new Date(iso).getTime();
  return at >= start.getTime() ? "Hôm nay" : at >= start.getTime() - DAY ? "Hôm qua" : "Trước đó";
}

export function timeLabel(iso: string) {
  const date = new Date(iso);
  return dayGroup(iso) === "Hôm nay"
    ? date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
    : `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Items arrive newest first, so groups come out in Hôm nay → Hôm qua → Trước đó order. */
export function byDay<T extends { createdAt: string }>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const label = dayGroup(item.createdAt);
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return [...groups];
}

export const WEEK = 7 * DAY;
