import { useEffect, useState } from "react";
import type { MeetingAttendance } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Button } from "../../shared/ui/Primitives";
import { downloadMeetingAttendanceApi, getMeetingAttendanceApi } from "./api";
import { Icon } from "../../shared/ui/Icon";
import { cn } from "../../shared/lib/utils";
import { META, PANEL, PANEL_TITLE } from "./panel-ui";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
const minutes = (seconds: number) => `${Math.round(seconds / 60)} phút`;

/** MT-2: join/leave times and time present per person; loaded on demand, host and co-hosts only. */
export function MeetingAttendancePanel({
  sessionId,
  auto = false,
}: {
  sessionId: string;
  /** Load at once and hide quietly when the viewer may not see it (the meeting report). */
  auto?: boolean;
}) {
  const { accessToken } = useApp();
  const [attendance, setAttendance] = useState<MeetingAttendance | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (task: () => Promise<void>) => {
    if (!accessToken) return;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không tải được danh sách tham dự.");
    } finally {
      setBusy(false);
    }
  };
  const load = () =>
    run(async () => setAttendance(await getMeetingAttendanceApi(accessToken!, sessionId)));
  const exportFile = () =>
    run(() =>
      downloadMeetingAttendanceApi(
        accessToken!,
        sessionId,
        `tham-du-${(attendance?.startedAt ?? "").slice(0, 10)}.xlsx`,
      ),
    );

  useEffect(() => {
    if (auto) void load();
  }, [auto, sessionId]); // load reads the current token; it is not a trigger

  if (auto && error && !attendance) return null;
  const average = attendance?.rows.length
    ? Math.round(
        (attendance.rows.reduce((sum, row) => sum + row.ratio, 0) / attendance.rows.length) * 100,
      )
    : null;
  return (
    <section className={PANEL} aria-labelledby={`attendance-${sessionId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`attendance-${sessionId}`} className={PANEL_TITLE}>
          <Icon name="users" size={16} className="text-muted-foreground" />
          Điểm danh
        </h3>
        {attendance && (
          <span className={META}>
            {attendance.rows.length} người · phiên dài {minutes(attendance.durationSeconds)}
            {average !== null && ` · có mặt TB ${average}%`}
            {attendance.endedAt ? "" : " (đang diễn ra)"}
          </span>
        )}
        <span className="ml-auto flex gap-1.5">
          {!auto && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
              {attendance ? "Làm mới" : "Xem"}
            </Button>
          )}
          {attendance && (
            <Button
              size="sm"
              variant="ghost"
              icon="download"
              disabled={busy}
              onClick={() => void exportFile()}
            >
              Xuất Excel
            </Button>
          )}
        </span>
      </div>
      {error && (
        <p className={META} role="alert">
          {error}
        </p>
      )}
      {attendance && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-[13.5px] [&_td]:border-t [&_td]:px-3 [&_td]:py-2 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_tbody_th]:border-t [&_tbody_th]:font-medium">
            <thead className="bg-background text-xs text-muted-foreground [&_th]:font-semibold">
              <tr>
                <th scope="col">Thành viên</th>
                <th scope="col">Vào</th>
                <th scope="col">Rời</th>
                <th scope="col" className="w-[38%]">
                  Có mặt
                </th>
              </tr>
            </thead>
            <tbody>
              {attendance.rows.map((row) => {
                const percent = Math.round(row.ratio * 100);
                return (
                  <tr key={row.userId}>
                    <th scope="row">{row.displayName}</th>
                    <td className="tabular-nums">{time(row.firstJoinedAt)}</td>
                    <td className="tabular-nums">
                      {row.lastLeftAt ? time(row.lastLeftAt) : "Trong phòng"}
                    </td>
                    <td>
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-secondary">
                          <i
                            className={cn(
                              "block h-full rounded-full",
                              percent >= 70 ? "bg-emerald-500" : "bg-amber-500",
                            )}
                            style={{ width: `${percent}%` }}
                          />
                        </span>
                        <small className="w-[86px] text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                          {minutes(row.presentSeconds)} · {percent}%
                        </small>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
