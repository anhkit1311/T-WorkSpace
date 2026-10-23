import type { MeetingCalendar } from "@doan/shared";

export type CalendarEvent = {
  key: string;
  title: string;
  workspaceName: string;
  workspaceId: string;
  roomId: string;
  start: Date;
  end: Date;
  status: "live" | "upcoming" | "past";
  scheduleId: string | null;
  sessionId: string | null;
  people: string[];
  canManage: boolean;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Vietnam has had no daylight saving since 1975, so a fixed offset is exact.
const VN_OFFSET = 7 * HOUR;
export const FIRST_HOUR = 7;
export const LAST_HOUR = 21;
// Shortest block drawn, so a quick or clipped meeting stays clickable: 15 minutes.
const MIN_HEIGHT = (0.25 / (LAST_HOUR - FIRST_HOUR)) * 100;

/** Monday 00:00 Vietnam time of the week holding `date`. */
export function weekStart(date: Date): Date {
  const local = date.getTime() + VN_OFFSET;
  const dayStart = local - (((local % DAY) + DAY) % DAY);
  const weekday = (new Date(dayStart).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(dayStart - weekday * DAY - VN_OFFSET);
}

/** One event per schedule (with its session attached) plus one per meeting started without a schedule. */
export function calendarEvents(data: MeetingCalendar, now: Date): CalendarEvent[] {
  const events = new Map<string, CalendarEvent>();
  for (const item of data.schedules)
    events.set(item.id, {
      key: item.id,
      title: item.title,
      workspaceName: item.workspaceName,
      workspaceId: item.workspaceId,
      roomId: item.roomId,
      start: new Date(item.startsAt),
      end: new Date(item.endsAt),
      status: "upcoming",
      scheduleId: item.id,
      sessionId: null,
      people: [],
      canManage: item.canManage,
    });
  const sessions: CalendarEvent[] = [];
  // A running session wins its schedule, then the latest one; a schedule's other sessions show on their own.
  const ordered = [...data.sessions].sort(
    (a, b) => Number(Boolean(a.endedAt)) - Number(Boolean(b.endedAt)) || b.startedAt.localeCompare(a.startedAt),
  );
  for (const item of ordered) {
    const owner = item.scheduleId ? events.get(item.scheduleId) : undefined;
    const live = !item.endedAt;
    if (owner && !owner.sessionId) {
      owner.sessionId = item.id;
      owner.people = item.people;
      // A session that ended before the slot did leaves it joinable; the clock decides "past" below.
      if (live) owner.status = "live";
      continue;
    }
    const start = new Date(item.startedAt);
    sessions.push({
      key: item.id,
      title: item.title ?? item.roomName,
      workspaceName: item.workspaceName,
      workspaceId: item.workspaceId,
      roomId: item.roomId,
      start,
      end: item.endedAt ? new Date(item.endedAt) : new Date(Math.max(now.getTime(), start.getTime() + HOUR / 4)),
      status: live ? "live" : "past",
      scheduleId: item.scheduleId,
      sessionId: item.id,
      people: item.people,
      canManage: false,
    });
  }
  for (const item of events.values()) if (item.status === "upcoming" && item.end <= now) item.status = "past";
  return [...events.values(), ...sessions].sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Places a day's events in the 7h–21h frame, as percentages of its height; parts outside the frame
 * are clipped to its edge. Overlapping events split the width into columns.
 */
export function layoutDay(events: CalendarEvent[], day: Date) {
  const dayStart = day.getTime();
  const dayEnd = dayStart + DAY;
  const frameStart = dayStart + FIRST_HOUR * HOUR;
  const frameLength = (LAST_HOUR - FIRST_HOUR) * HOUR;
  const position = (time: number) => (Math.min(Math.max(time - frameStart, 0), frameLength) / frameLength) * 100;
  const inDay = events
    .filter((item) => item.start.getTime() < dayEnd && item.end.getTime() > dayStart)
    .sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());

  const laid: { event: CalendarEvent; top: number; height: number; column: number; columns: number }[] = [];
  let group: typeof laid = [];
  let columnEnds: number[] = [];
  let groupEnd = -Infinity;
  const closeGroup = () => {
    for (const item of group) item.columns = columnEnds.length;
    group = [];
    columnEnds = [];
  };
  for (const event of inDay) {
    const start = Math.max(event.start.getTime(), dayStart);
    const end = Math.min(event.end.getTime(), dayEnd);
    if (start >= groupEnd) closeGroup();
    let column = columnEnds.findIndex((columnEnd) => columnEnd <= start);
    if (column < 0) column = columnEnds.push(end) - 1;
    else columnEnds[column] = end;
    groupEnd = Math.max(groupEnd, end);
    const top = Math.min(position(start), 100 - MIN_HEIGHT);
    const item = { event, top, height: Math.max(position(end) - top, MIN_HEIGHT), column, columns: 1 };
    group.push(item);
    laid.push(item);
  }
  closeGroup();
  return laid;
}
