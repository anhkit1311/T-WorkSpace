import { useEffect, useState } from "react";

/** Time since a meeting started (m:ss, h:mm:ss after an hour), ticking every second. */
export function MeetingClock({
  since,
  className = "meeting-topbar__clock",
}: {
  since: string;
  className?: string;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const total = Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    <time className={className}>
      {total >= 3600 ? `${Math.floor(total / 3600)}:` : ""}
      {pad(Math.floor(total / 60) % 60)}:{pad(total % 60)}
    </time>
  );
}
