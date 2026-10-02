import { useEffect, useRef, useState } from "react";
import type { MeetingState } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useMeeting } from "../../app/providers/MeetingContext";
import "./meeting-controls.css";
export function MeetingControls({
  roomId,
  waiting,
  onJoin,
  onCancel,
  onCount,
}: {
  roomId: string;
  waiting: boolean;
  onJoin: () => void;
  onCancel: () => void;
  onCount?: (count: number) => void;
}) {
  const { user } = useApp();
  const { controlSocket: socket } = useMeeting();
  const [state, setState] = useState<MeetingState | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [endConfirm, setEndConfirm] = useState(false);
  const countRef = useRef(onCount);
  countRef.current = onCount;
  useEffect(() => {
    if (!socket) return;
    let active = true;
    let generation = 0;
    const load = () => {
      const request = ++generation;
      void socket
        .timeout(10000)
        .emitWithAck("meeting_state", { roomId })
        .then((data: { success: boolean; state: MeetingState | null; error?: string }) => {
          if (!active || request !== generation) return;
          if (!data.success) throw new Error(data.error);
          setState(data.state);
          countRef.current?.(
            data.state?.participants.filter((p) => p.state === "admitted").length ?? 0,
          );
        })
        .catch((reason) => {
          if (active) setError(reason.message);
        });
    };
    const changed = (data: { roomId: string }) => {
      if (data.roomId === roomId) load();
    };
    load();
    socket.on("meeting_state_changed", changed);
    socket.on("connect", load);
    return () => {
      active = false;
      socket.off("meeting_state_changed", changed);
      socket.off("connect", load);
    };
  }, [socket, roomId]);
  const me = state?.participants.find((p) => p.userId === user?.id),
    isHost = me?.role === "host",
    canManage = isHost || me?.role === "cohost";
  const action = async (name: string, targetUserId?: string, enabled?: boolean) => {
    if (!socket || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await socket
        .timeout(10000)
        .emitWithAck("meeting_action", { roomId, action: name, targetUserId, enabled });
      if (!data.success) throw new Error(data.error);
      setEndConfirm(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không điều hành được cuộc họp.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="meeting-controls" aria-label="Điều hành phiên họp">
      {error && <p role="alert">{error}</p>}
      {waiting && (
        <div role="status">
          <strong>{me?.state === "admitted" ? "Bạn đã được duyệt" : "Đang ở phòng chờ"}</strong>
          <p>
            Thiết bị chưa phát vào phòng.{" "}
            {me?.state === "admitted"
              ? "Bấm vào họp để sử dụng lựa chọn mic/camera của bạn."
              : "Chờ host hoặc co-host duyệt."}
          </p>
          {me?.state === "admitted" && <button onClick={onJoin}>Vào họp sau khi được duyệt</button>}
          <button onClick={onCancel}>Rời phòng chờ</button>
        </div>
      )}
      {state && (
        <>
          <p className="meeting-session-meta">
            Phiên {state.id.slice(0, 8)} ·{" "}
            {state.participants.filter((p) => p.state === "admitted").length}/{state.maxUsers} người
            · {state.locked ? "Đã khóa" : "Đang mở"} ·{" "}
            {state.waitingEnabled ? "Có phòng chờ" : "Vào trực tiếp"}
          </p>
          <details open={waiting}>
            <summary>Người tham gia và điều hành</summary>
            {!waiting && me && (
              <button
                disabled={busy}
                aria-pressed={me.raisedHand}
                onClick={() => void action("hand", undefined, !me.raisedHand)}
              >
                {me.raisedHand ? "Hạ tay" : "Giơ tay"}
              </button>
            )}
            {canManage && (
              <div className="meeting-host-actions">
                <button
                  disabled={busy}
                  aria-pressed={state.waitingEnabled}
                  onClick={() => void action("waiting", undefined, !state.waitingEnabled)}
                >
                  {state.waitingEnabled ? "Tắt phòng chờ" : "Bật phòng chờ"}
                </button>
                <button
                  disabled={busy}
                  aria-pressed={state.locked}
                  onClick={() => void action("lock", undefined, !state.locked)}
                >
                  {state.locked ? "Mở khóa phòng" : "Khóa phòng"}
                </button>
                {isHost && (
                  <button disabled={busy} onClick={() => setEndConfirm(true)}>
                    Kết thúc cho tất cả
                  </button>
                )}
              </div>
            )}
            {endConfirm && (
              <div role="alert">
                <p>Kết thúc phiên này và ngắt media của mọi người?</p>
                <button disabled={busy} onClick={() => void action("end")}>
                  Xác nhận kết thúc
                </button>
                <button onClick={() => setEndConfirm(false)}>Hủy</button>
              </div>
            )}
            <ul>
              {state.participants.map((p) => (
                <li key={p.userId}>
                  <span>
                    {p.displayName}
                    {p.userId === user?.id ? " (Bạn)" : ""} ·{" "}
                    {p.role === "host" ? "Host" : p.role === "cohost" ? "Co-host" : "Thành viên"}
                    {p.state === "waiting" ? " · Chờ duyệt" : ""}
                    {p.raisedHand ? " · Đang giơ tay" : ""}
                    {p.connections > 1 ? ` · ${p.connections} tab` : ""}
                  </span>
                  {canManage && p.userId !== user?.id && p.role !== "host" && (
                    <div>
                      {p.state === "waiting" ? (
                        <button disabled={busy} onClick={() => void action("admit", p.userId)}>
                          Duyệt vào phòng
                        </button>
                      ) : (
                        <>
                          <button disabled={busy} onClick={() => void action("mute", p.userId)}>
                            Tắt nguồn mic
                          </button>
                          {isHost && (
                            <>
                              <button
                                disabled={busy}
                                onClick={() => void action("cohost", p.userId, p.role !== "cohost")}
                              >
                                {p.role === "cohost" ? "Bỏ co-host" : "Đặt co-host"}
                              </button>
                              <button
                                disabled={busy}
                                onClick={() => void action("transfer", p.userId)}
                              >
                                Chuyển host
                              </button>
                            </>
                          )}
                        </>
                      )}
                      <button disabled={busy} onClick={() => void action("kick", p.userId)}>
                        Loại khỏi phiên
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <small>
              Host rời tab cuối: chuyển cho co-host đang có mặt, sau đó người đã vào sớm nhất. Nếu
              không còn ai đã được duyệt, phiên kết thúc. Host chỉ tắt nguồn mic; mỗi người tự bật
              lại thiết bị.
            </small>
          </details>
        </>
      )}
    </section>
  );
}
