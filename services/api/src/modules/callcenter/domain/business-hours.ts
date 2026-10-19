export interface OpeningWindow {
  weekday: number; // 0 = Sunday
  opens: string; // HH:MM[:SS]
  closes: string;
}

export const CALL_CENTER_TIME_ZONE = "Asia/Ho_Chi_Minh";

const minutes = (time: string) => {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
};

/** Weekday and minute-of-day of `at` in the call center's time zone. */
export function localTime(at: Date, timeZone = CALL_CENTER_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
  return { weekday, minute: Number(part("hour")) * 60 + Number(part("minute")) };
}

/** A department with no configured hours is always open; otherwise `at` must fall in a window. */
export function isOpen(windows: readonly OpeningWindow[], at: Date, timeZone = CALL_CENTER_TIME_ZONE): boolean {
  if (!windows.length) return true;
  const now = localTime(at, timeZone);
  return windows.some(
    (window) =>
      window.weekday === now.weekday && minutes(window.opens) <= now.minute && now.minute < minutes(window.closes),
  );
}
