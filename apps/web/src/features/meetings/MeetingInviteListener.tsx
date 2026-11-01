import { useEffect, useRef } from "react";
import type { MeetingScheduleNotice } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";

const NOTICE_TITLE: Record<MeetingScheduleNotice["kind"], string> = {
  created: "Lời mời họp mới",
  updated: "Lịch họp đã thay đổi",
  canceled: "Lịch họp đã bị hủy",
  reminder: "Còn 15 phút nữa là đến giờ họp",
};

/** M2 call-to-video invites and NV-MT1 schedule notices, offered wherever the user is in the app. */
export function MeetingInviteListener() {
  const { socket } = useSocket();
  const { notify, navigate } = useApp();
  // notify/navigate change identity every render; the subscription should not.
  const actions = useRef({ notify, navigate });
  actions.current = { notify, navigate };
  useEffect(() => {
    if (!socket) return;
    const open = (workspaceId: string, roomId: string) => () =>
      actions.current.navigate({ view: "meetings", workspaceId, channelId: roomId });
    const onInvite = (data: { workspaceId: string; roomId: string; from: string }) =>
      actions.current.notify("Mời tham gia họp video", `${data.from} mời bạn chuyển cuộc gọi sang họp video.`, "info", {
        label: "Tham gia",
        onClick: open(data.workspaceId, data.roomId),
      });
    const onNotice = (data: MeetingScheduleNotice) => {
      const when = new Date(data.startsAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
      actions.current.notify(
        NOTICE_TITLE[data.kind],
        `${data.title} · ${when}`,
        data.kind === "canceled" ? "warning" : "info",
        data.kind === "canceled" ? undefined : { label: data.kind === "reminder" ? "Vào phòng" : "Xem", onClick: open(data.workspaceId, data.roomId) },
      );
    };
    socket.on("meeting_invite", onInvite);
    socket.on("meeting_schedule_notice", onNotice);
    return () => {
      socket.off("meeting_invite", onInvite);
      socket.off("meeting_schedule_notice", onNotice);
    };
  }, [socket]);
  return null;
}
