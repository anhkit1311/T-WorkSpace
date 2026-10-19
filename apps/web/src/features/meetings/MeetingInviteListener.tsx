import { useEffect, useRef } from "react";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";

/** M2: an agent moved this user's call to video; offer the room wherever the user is in the app. */
export function MeetingInviteListener() {
  const { socket } = useSocket();
  const { notify, navigate } = useApp();
  // notify/navigate change identity every render; the subscription should not.
  const actions = useRef({ notify, navigate });
  actions.current = { notify, navigate };
  useEffect(() => {
    if (!socket) return;
    const onInvite = (data: { workspaceId: string; roomId: string; from: string }) =>
      actions.current.notify("Mời tham gia họp video", `${data.from} mời bạn chuyển cuộc gọi sang họp video.`, "info", {
        label: "Tham gia",
        onClick: () => actions.current.navigate({ view: "meetings", workspaceId: data.workspaceId, channelId: data.roomId }),
      });
    socket.on("meeting_invite", onInvite);
    return () => void socket.off("meeting_invite", onInvite);
  }, [socket]);
  return null;
}
