import { useState } from "react";
import type { MeetingAttendance } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Button } from "../../shared/ui/Primitives";
import { downloadMeetingAttendanceApi, getMeetingAttendanceApi } from "./api";
import "./meeting-attendance.css";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
const minutes = (seconds: number) => `${Math.round(seconds / 60)} phút`;

/** MT-2: join/leave times and time present per person; loaded on demand, host and co-hosts only. */
export function MeetingAttendancePanel({ sessionId }: { sessionId: string }) {
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
  const load = () => run(async () => setAttendance(await getMeetingAttendanceApi(accessToken!, sessionId)));
  const exportFile = () =>
    run(() =>
      downloadMeetingAttendanceApi(accessToken!, sessionId, `tham-du-${(attendance?.startedAt ?? "").slice(0, 10)}.csv`),
    );

  return (
    <section className="meeting-attendance" aria-labelledby="meeting-attendance-title">
      <div className="meeting-attendance-head">
        <h4 id="meeting-attendance-title">Điểm danh</h4>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void load()}>
          {attendance ? "Làm mới" : "Xem"}
        </Button>
        {attendance && (
          <Button size="sm" variant="secondary" icon="download" disabled={busy} onClick={() => void exportFile()}>
            Xuất Excel
          </Button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {attendance && (
        <table>
          <caption>
            {attendance.rows.length} người · phiên dài {minutes(attendance.durationSeconds)}
            {attendance.endedAt ? "" : " (đang diễn ra)"}
          </caption>
          <thead>
            <tr>
              <th scope="col">Thành viên</th>
              <th scope="col">Vào</th>
              <th scope="col">Rời</th>
              <th scope="col">Có mặt</th>
            </tr>
          </thead>
          <tbody>
            {attendance.rows.map((row) => (
              <tr key={row.userId}>
                <th scope="row">{row.displayName}</th>
                <td>{time(row.firstJoinedAt)}</td>
                <td>{row.lastLeftAt ? time(row.lastLeftAt) : "Trong phòng"}</td>
                <td>
                  {minutes(row.presentSeconds)} ({Math.round(row.ratio * 100)}%)
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
