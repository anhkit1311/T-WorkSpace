import { useCallback, useEffect, useState } from "react";
import type { MeetingRecording, MeetingRecordings } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useMeeting } from "../../app/providers/MeetingContext";
import { Button } from "../../shared/ui/Primitives";
import { HlsPlayer } from "../../shared/ui/HlsPlayer";
import {
  createMeetingTaskApi,
  getMeetingRecordingsApi,
  meetingRecordingLinkApi,
  requestRecordingTranscriptApi,
  shareMeetingRecordingApi,
  startMeetingRecordingApi,
  stopMeetingRecordingApi,
} from "./api";
import { Icon } from "../../shared/ui/Icon";
import { META, PANEL, PANEL_TITLE } from "./panel-ui";

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
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());

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
    setSrc(null);
    if (!playing || !accessToken) return;
    let alive = true;
    void meetingRecordingLinkApi(accessToken, playing).then(
      (url) => alive && setSrc(url),
      (failure: Error) => alive && setError(failure.message),
    );
    return () => {
      alive = false;
    };
    // A refreshed token must not restart the player.
  }, [playing]);

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
    (item) =>
      item.status === "processing" ||
      item.status === "recording" ||
      item.transcriptStatus === "processing",
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
    <section className={PANEL} aria-labelledby={`recording-${sessionId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`recording-${sessionId}`} className={PANEL_TITLE}>
          <Icon name="video" size={16} className="text-muted-foreground" />
          Ghi hình
        </h3>
        {live &&
          data.canManage &&
          (active ? (
            <Button
              size="sm"
              variant="danger"
              className="ml-auto"
              disabled={busy}
              onClick={() => void run(() => stopMeetingRecordingApi(accessToken!, active.id))}
            >
              Dừng ghi
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              disabled={busy}
              onClick={() => void run(() => startMeetingRecordingApi(accessToken!, sessionId))}
            >
              Bắt đầu ghi hình
            </Button>
          ))}
      </div>
      {active && (
        <p className="flex items-center gap-2 text-[13px] font-medium text-red-600" role="status">
          <i className="size-2 rounded-full bg-red-500 motion-safe:animate-pulse" />
          Cuộc họp đang được ghi hình từ {clock(active.startedAt)}
        </p>
      )}
      {error && (
        <p className={META} role="alert">
          {error}
        </p>
      )}
      {playing && src && (
        <div className="overflow-hidden rounded-lg bg-black">
          <HlsPlayer
            src={src}
            label="Bản ghi cuộc họp"
            captions={
              data.recordings.find((item) => item.id === playing)?.transcriptStatus === "ready"
            }
          />
        </div>
      )}
      <ul className="grid gap-2.5">
        {data.recordings.map((item) => (
          <li key={item.id} className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {item.status === "ready" && (
                <Button
                  size="sm"
                  variant={playing === item.id ? "secondary" : "primary"}
                  icon={playing === item.id ? "x" : "play"}
                  onClick={() => setPlaying(playing === item.id ? null : item.id)}
                >
                  {playing === item.id ? "Đóng" : "Xem lại"}
                </Button>
              )}
              <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">
                Bắt đầu {clock(item.startedAt)}
                {item.durationSeconds
                  ? ` · ${Math.max(1, Math.round(item.durationSeconds / 60))} phút`
                  : ""}{" "}
                · {STATUS[item.status]}
                {item.transcriptStatus ? ` · ${CAPTIONS[item.transcriptStatus]}` : ""}
              </span>
              {data.canManage &&
                item.status === "ready" &&
                item.transcriptStatus !== "ready" &&
                item.transcriptStatus !== "processing" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(() => requestRecordingTranscriptApi(accessToken!, item.id))
                    }
                  >
                    Tạo phụ đề
                  </Button>
                )}
              {data.canManage && item.status !== "failed" && (
                <label className="flex cursor-pointer items-center gap-1.5 text-[13px]">
                  <input
                    type="checkbox"
                    className="size-4 accent-foreground"
                    checked={item.shared}
                    disabled={busy}
                    onChange={(event) =>
                      void run(() =>
                        shareMeetingRecordingApi(accessToken!, item.id, event.target.checked),
                      )
                    }
                  />
                  Cả phòng xem được
                </label>
              )}
            </div>
            {item.status === "failed" && item.error && (
              <small className="text-xs text-red-600">{item.error}</small>
            )}
            {item.aiSummary && (
              <div className="grid gap-2 rounded-lg bg-[var(--tint-violet-bg)] px-3.5 py-3">
                <strong className="flex items-center gap-1.5 text-[13px] font-semibold text-[var(--tint-violet-fg)]">
                  <Icon name="sparkles" size={14} />
                  Tóm tắt (AI, cần kiểm tra lại)
                </strong>
                <p className="leading-relaxed whitespace-pre-wrap">{item.aiSummary}</p>
                {item.aiActions.length > 0 && (
                  <ul className="grid gap-1">
                    {item.aiActions.map((action) => (
                      <li key={action} className="flex flex-wrap items-center gap-2 text-[13px]">
                        <span className="min-w-0 flex-1">• {action}</span>
                        {data.canManage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy || added.has(action)}
                            onClick={() =>
                              void run(async () => {
                                await createMeetingTaskApi(accessToken!, sessionId, {
                                  clientTaskId: crypto.randomUUID(),
                                  title: action,
                                  assigneeId: null,
                                  dueAt: null,
                                });
                                setAdded((current) => new Set(current).add(action));
                              })
                            }
                          >
                            {added.has(action) ? "Đã thêm" : "Thêm vào việc cần làm"}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
