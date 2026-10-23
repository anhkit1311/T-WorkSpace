import { useEffect, useState } from "react";
import type { MeetingState } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useMeeting } from "../../app/providers/MeetingContext";
import { Button, ConfirmDialog } from "../../shared/ui/Primitives";
import { AnimatePresence } from "motion/react";
import "./meeting-controls.css";
import { hostActionToast } from "./host-action-toast";

export type MeetingConfirmation = { name: string; target?: string; label: string; description: string };

/** The server's view of the session (people, roles, hands, lock) and the host actions on it. */
export function useMeetingControl(roomId: string) {
  const { user, notify } = useApp();
  const { controlSocket: socket } = useMeeting();
  const [state, setState] = useState<MeetingState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<MeetingConfirmation | null>(null);
  useEffect(() => {
    setState(null);
    if (!socket || !roomId) return;
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
  const me = state?.participants.find((p) => p.userId === user?.id);
  const isHost = me?.role === "host";
  const canManage = isHost || me?.role === "cohost";
  const admitted = state?.participants.filter((p) => p.state === "admitted") ?? [];
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
  const confirmDialog = (
    <AnimatePresence>
      {confirmation && (
        <ConfirmDialog
          title={confirmation.label}
          description={confirmation.description}
          confirmLabel={confirmation.label}
          loading={busy}
          onClose={() => setConfirmation(null)}
          onConfirm={() => void action(confirmation.name, confirmation.target)}
        />
      )}
    </AnimatePresence>
  );
  return { state, me, isHost, canManage, admitted, error, busy, action, setConfirmation, confirmDialog };
}

/** Waiting room card shown before the host lets the user in. */
export function MeetingControls({
  roomId,
  onJoin,
  onCancel,
}: {
  roomId: string;
  onJoin: () => void;
  onCancel: () => void;
}) {
  const { me, error } = useMeetingControl(roomId);
  return (
    <section className="meeting-controls" aria-label="Phòng chờ">
      {error && (
        <p className="meeting-controls-alert" role="alert">
          {error}
        </p>
      )}
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
    </section>
  );
}
