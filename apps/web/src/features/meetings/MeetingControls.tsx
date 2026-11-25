import { useEffect, useState } from "react";
import type { MeetingState } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useMeeting } from "../../app/providers/MeetingContext";
import { Button, ConfirmDialog } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { cn } from "../../shared/lib/utils";
import { AnimatePresence } from "motion/react";
import { hostActionToast } from "./host-action-toast";

export type MeetingConfirmation = {
  name: string;
  target?: string;
  label: string;
  description: string;
};

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
  return {
    state,
    me,
    isHost,
    canManage,
    admitted,
    error,
    busy,
    action,
    setConfirmation,
    confirmDialog,
  };
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
  const admitted = me?.state === "admitted";
  return (
    <section className="tw my-3 grid gap-2.5" aria-label="Phòng chờ">
      {error && (
        <p
          className="rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13.5px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          role="alert"
        >
          {error}
        </p>
      )}
      <div className="flex items-start gap-3.5 rounded-xl border bg-card px-4.5 py-4" role="status">
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-[10px]",
            admitted
              ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
              : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
          )}
        >
          <Icon name={admitted ? "check" : "clock"} size={18} />
        </span>
        <div className="grid min-w-0 flex-1 justify-items-start gap-0.5">
          <b className="flex items-center gap-2 text-[15px] font-semibold">
            {admitted ? "Bạn đã được duyệt" : "Đang ở phòng chờ"}
            {!admitted && (
              <span className="size-1.5 rounded-full bg-amber-500 motion-safe:animate-pulse" />
            )}
          </b>
          <p className="m-0! text-[13.5px] text-muted-foreground!">
            Thiết bị chưa phát vào phòng.{" "}
            {me?.state === "admitted"
              ? "Bấm vào họp để sử dụng lựa chọn mic/camera của bạn."
              : "Chờ host hoặc co-host duyệt."}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {admitted && (
              <Button size="sm" variant="primary" onClick={onJoin}>
                Vào họp
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Rời phòng chờ
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
