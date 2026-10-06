import { useEffect, useRef, useState } from "react";
import type { MeetingState } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useMeeting } from "../../app/providers/MeetingContext";
import { Button, ConfirmDialog } from "../../shared/ui/Primitives";
import { AnimatePresence } from "motion/react";
import "./meeting-controls.css";
import { hostActionToast } from "./host-action-toast";
export function MeetingControls({
  roomId,
  waiting,
  onJoin,
  onCancel,
  onCount,
  onState,
}: {
  roomId: string;
  waiting: boolean;
  onJoin: () => void;
  onCancel: () => void;
  onCount?: (count: number) => void;
  onState?: (state: MeetingState | null) => void;
}) {
  const { user, notify } = useApp();
  const { controlSocket: socket } = useMeeting();
  const [state, setState] = useState<MeetingState | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const countRef = useRef(onCount);
  const stateCallback = useRef(onState);
  stateCallback.current = onState;
  useEffect(() => { stateCallback.current?.(state); }, [state]);
  const [confirmation, setConfirmation] = useState<{name:string; target?:string; label:string; description:string} | null>(null);
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
    // Resolve the name before the request: a kicked participant leaves the state.
    const targetName = state?.participants.find((p) => p.userId === targetUserId)?.displayName;
    setBusy(true);
    setError("");
    try {
      const data = await socket
        .timeout(10000)
        .emitWithAck("meeting_action", { roomId, action: name, targetUserId, enabled });
      if (!data.success) throw new Error(data.error);
      setConfirmation(null);
      const done = hostActionToast(name, targetName, enabled);
      if (done) notify(done, undefined, "info");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không điều hành được cuộc họp.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="meeting-controls" aria-label="Điều hành phiên họp">
      {error && (
        <p className="meeting-controls-alert" role="alert">
          {error}
        </p>
      )}
      {waiting && (
        <div className="meeting-controls-waiting" role="status">
          <strong>{me?.state === "admitted" ? "Bạn đã được duyệt" : "Đang ở phòng chờ"}</strong>
          <p>
            Thiết bị chưa phát vào phòng.{" "}
            {me?.state === "admitted"
              ? "Bấm vào họp để sử dụng lựa chọn mic/camera của bạn."
              : "Chờ host hoặc co-host duyệt."}
          </p>
          {me?.state === "admitted" && (
            <Button size="sm" variant="primary" onClick={onJoin}>
              Vào họp sau khi được duyệt
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Rời phòng chờ
          </Button>
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
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                aria-pressed={me.raisedHand}
                title={me.raisedHand ? "Hạ tay (H)" : "Giơ tay (H)"} aria-keyshortcuts="H"
                onClick={() => void action("hand", undefined, !me.raisedHand)}
              >
                {me.raisedHand ? "Hạ tay" : "Giơ tay"}
              </Button>
            )}
            {canManage && (
              <div className="meeting-host-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  aria-pressed={state.waitingEnabled}
                  onClick={() => void action("waiting", undefined, !state.waitingEnabled)}
                >
                  {state.waitingEnabled ? "Tắt phòng chờ" : "Bật phòng chờ"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  aria-pressed={state.locked}
                  onClick={() => void action("lock", undefined, !state.locked)}
                >
                  {state.locked ? "Mở khóa phòng" : "Khóa phòng"}
                </Button>
                {isHost && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => setConfirmation({name:"end",label:"Xác nhận kết thúc",description:"Kết thúc phiên này và ngắt media của mọi người?"})}
                  >
                    Kết thúc cho tất cả
                  </Button>
                )}
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
                    <div className="meeting-participant-actions">
                      {p.state === "waiting" ? (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={busy}
                          onClick={() => void action("admit", p.userId)}
                        >
                          Duyệt vào phòng
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() => setConfirmation({name:"mute",target:p.userId,label:"Tắt nguồn mic",description:`Tắt nguồn microphone của ${p.displayName}? Người này phải tự bật lại thiết bị.`})}
                          >
                            Tắt nguồn mic
                          </Button>
                          {isHost && (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => void action("cohost", p.userId, p.role !== "cohost")}
                              >
                                {p.role === "cohost" ? "Bỏ co-host" : "Đặt co-host"}
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => setConfirmation({name:"transfer",target:p.userId,label:"Chuyển host",description:`Chuyển quyền host cho ${p.displayName}? Bạn sẽ mất quyền host và không thể tự lấy lại quyền.`})}
                              >
                                Chuyển host
                              </Button>
                            </>
                          )}
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() => setConfirmation({name:"kick",target:p.userId,label:"Loại khỏi phiên",description:`Ngắt kết nối của ${p.displayName} và loại người này khỏi phiên họp hiện tại?`})}
                      >
                        Loại khỏi phiên
                      </Button>
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
      <AnimatePresence>{confirmation && <ConfirmDialog title={confirmation.label} description={confirmation.description} confirmLabel={confirmation.label} loading={busy} onClose={() => setConfirmation(null)} onConfirm={() => void action(confirmation.name,confirmation.target)} />}</AnimatePresence>
    </section>
  );
}
