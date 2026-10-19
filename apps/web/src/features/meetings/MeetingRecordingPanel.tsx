import { useCallback, useEffect, useState } from "react";
import type { MeetingRecording, MeetingRecordings } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useMeeting } from "../../app/providers/MeetingContext";
import { Button } from "../../shared/ui/Primitives";
import { HlsPlayer } from "../../shared/ui/HlsPlayer";
import {
  getMeetingRecordingsApi,
  meetingRecordingPlaylist,
  requestRecordingTranscriptApi,
  shareMeetingRecordingApi,
  startMeetingRecordingApi,
  stopMeetingRecordingApi,
} from "./api";
import "./meeting-attendance.css";

const STATUS: Record<MeetingRecording["status"], string> = {
  recording: "Đang ghi",
  processing: "Đang xử lý",
  ready: "Sẵn sàng",
  failed: "Lỗi",
};
const CAPTIONS: Record<NonNullable<MeetingRecording["transcriptStatus"]>, string> = {
  processing: "đang tạo phụ đề",
  ready: "có phụ đề",
  failed: "tạo phụ đề lỗi",
};
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });

/** MT-1: host/co-hosts record the meeting; attendees (or the whole room, if shared) watch it back. */
export function MeetingRecordingPanel({ sessionId, live }: { sessionId: string; live: boolean }) {
  const { accessToken } = useApp();
  const { controlSocket } = useMeeting();
  const [data, setData] = useState<MeetingRecordings | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      setData(await getMeetingRecordingsApi(accessToken, sessionId));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không tải được bản ghi.");
    }
  }, [accessToken, sessionId]);

  useEffect(() => void load(), [load]);

  useEffect(() => {
    if (!live || !controlSocket) return;
    const changed = (change: { sessionId: string; part: string }) => {
      if (change.sessionId === sessionId && change.part === "recording") void load();
    };
    controlSocket.on("meeting_outcomes_changed", changed);
    return () => {
      controlSocket.off("meeting_outcomes_changed", changed);
    };
  }, [live, controlSocket, sessionId, load]);

  // Outside the call there are no socket updates; check back while a recording is being processed.
  const processing = data?.recordings.some(
    (item) => item.status === "processing" || item.status === "recording" || item.transcriptStatus === "processing",
  );
  useEffect(() => {
    if (live || !processing) return;
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [live, processing, load]);

  const run = async (task: () => Promise<unknown>) => {
    if (!accessToken) return;
    setBusy(true);
    setError("");
    try {
      await task();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không thực hiện được thao tác.");
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <p role="alert">{error}</p> : null;
  const active = data.recordings.find((item) => item.status === "recording");
  if (!data.recordings.length && !(live && data.canManage)) return null;

  return (
    <section className="meeting-attendance" aria-labelledby="meeting-recording-title">
      <div className="meeting-attendance-head">
        <h4 id="meeting-recording-title">Ghi hình</h4>
        {live && data.canManage &&
          (active ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => stopMeetingRecordingApi(accessToken!, active.id))}>
              Dừng ghi
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => startMeetingRecordingApi(accessToken!, sessionId))}>
              Bắt đầu ghi hình
            </Button>
          ))}
      </div>
      {active && (
        <p className="meeting-recording-live" role="status">
          ● Cuộc họp đang được ghi hình từ {clock(active.startedAt)}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <ul className="meeting-recording-list">
        {data.recordings.map((item) => (
          <li key={item.id}>
            <span>
              {clock(item.startedAt)}
              {item.durationSeconds ? ` · ${Math.max(1, Math.round(item.durationSeconds / 60))} phút` : ""} · {STATUS[item.status]}
              {item.transcriptStatus ? ` · ${CAPTIONS[item.transcriptStatus]}` : ""}
            </span>
            {data.canManage && item.status === "ready" && item.transcriptStatus !== "ready" && item.transcriptStatus !== "processing" && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => requestRecordingTranscriptApi(accessToken!, item.id))}>
                Tạo phụ đề
              </Button>
            )}
            {item.status === "ready" && (
              <Button size="sm" variant="ghost" onClick={() => setPlaying(playing === item.id ? null : item.id)}>
                {playing === item.id ? "Đóng" : "Xem lại"}
              </Button>
            )}
            {data.canManage && item.status !== "failed" && (
              <label>
                <input
                  type="checkbox"
                  checked={item.shared}
                  disabled={busy}
                  onChange={(event) => void run(() => shareMeetingRecordingApi(accessToken!, item.id, event.target.checked))}
                />
                Cả phòng xem được
              </label>
            )}
            {item.status === "failed" && item.error && <small>{item.error}</small>}
          </li>
        ))}
      </ul>
      {playing && (
        <div className="meeting-recording-player">
          <HlsPlayer
            src={meetingRecordingPlaylist(playing)}
            label="Bản ghi cuộc họp"
            captions={data.recordings.find((item) => item.id === playing)?.transcriptStatus === "ready"}
          />
        </div>
      )}
    </section>
  );
}
