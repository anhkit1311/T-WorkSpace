import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessageItem, MeetingScheduleItem, WorkspaceItem, MeetingState } from "@doan/shared";
import { getChannelsApi, getMessagesApi, getWorkspacesApi } from "../chat/api";
import {
  getMeetingHistoryApi,
  getMeetingSchedulesApi,
  saveMeetingScheduleApi,
  cancelMeetingScheduleApi,
  type MeetingHistoryItem,
} from "./api";
import { useApp } from "../../app/providers/AppContext";
import { useMeeting, type RemotePeer } from "../../app/providers/MeetingContext";
import { bestGridLayout, layerForTile, pageSizeFor, paginate } from "./grid-layout";
import { handToastTitle, raisedHandUserIds } from "./hand-raise";
import { MeetingControls } from "./MeetingControls";
import { mapMediaError } from "./webrtc/local-media";
import { useSocket } from "../../app/providers/SocketContext";
import { Badge, Button, Chip, IconButton, ListItem, ConfirmDialog } from "../../shared/ui/Primitives";
import { AnimatePresence } from "motion/react";
import { meetingShortcut } from "../../shared/lib/interaction";
import { Icon } from "../../shared/ui/Icon";
import "./meeting-ui.css";
import "./meeting-schedules.css";
import "./meeting-panels.css";

type Room = {
  id: string;
  name: string;
  workspace: string;
  workspaceId: string;
  role: WorkspaceItem["role"];
};

function localDateTime(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function downloadCalendarEvent(item: MeetingScheduleItem) {
  const escape = (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const stamp = (value: string) =>
    new Date(value)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//nexo//Meeting Schedule//VI",
    "BEGIN:VEVENT",
    `UID:${item.id}@collabspace`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(item.startsAt)}`,
    `DTEND:${stamp(item.endsAt)}`,
    `SUMMARY:${escape(item.title)}`,
    `DESCRIPTION:${escape(item.description)}`,
    `LOCATION:${escape(`${item.workspaceName} - ${item.roomName} (nexo)`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([calendar], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `lich-hop-${item.id.slice(0, 8)}.ics`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function Video({ stream, muted = false }: { stream: MediaStream | null; muted?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
    return () => {
      if (ref.current) ref.current.srcObject = null;
    };
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className="rtc-video-element" />;
}

function Audio({ stream, outputDeviceId }: { stream: MediaStream; outputDeviceId?: string }) {
  const {notify} = useApp();
  const notice = useRef(notify);
  notice.current = notify;
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
    return () => {
      if (ref.current) ref.current.srcObject = null;
    };
  }, [stream]);
  useEffect(() => {
    if (!outputDeviceId || !ref.current) return;
    const element = ref.current as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    void element.setSinkId?.(outputDeviceId).catch(() => notice.current("Không chọn được loa", "Âm thanh tiếp tục phát qua thiết bị mặc định. Hãy kiểm tra quyền thiết bị.", "warning"));
  }, [outputDeviceId]);
  return <audio ref={ref} autoPlay />;
}

function useAudioActivity(stream: MediaStream | null, enabled: boolean) {
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    if (!stream || !enabled) {
      setIsSpeaking(false);
      return;
    }
    const audioTracks = stream.getAudioTracks();
    if (!audioTracks.length || !audioTracks[0].enabled) {
      setIsSpeaking(false);
      return;
    }

    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let activityTimer: number | undefined;

    try {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtxClass) return;
      audioCtx = new AudioCtxClass();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;
      source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let silenceCounter = 0;

      const checkAudio = () => {
        if (!analyser) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        if (avg > 14) {
          silenceCounter = 0;
          setIsSpeaking(true);
        } else {
          silenceCounter++;
          if (silenceCounter > 8) {
            setIsSpeaking(false);
          }
        }
        activityTimer = window.setTimeout(checkAudio, 100);
      };

      activityTimer = window.setTimeout(checkAudio, 100);
    } catch {
      // AudioContext could be blocked if no user interaction yet
    }

    return () => {
      if (activityTimer !== undefined) window.clearTimeout(activityTimer);
      try {
        source?.disconnect();
        if (audioCtx && audioCtx.state !== "closed") {
          void audioCtx.close();
        }
      } catch {
        // ignore
      }
    };
  }, [stream, enabled]);

  return isSpeaking;
}

const GRID_GAP = 16;
const FILMSTRIP_PAGE_SIZE = 5;
const FILMSTRIP_TILE_WIDTH = 200;
interface GridTile {
  id: string;
  peer: RemotePeer | null;
}

function ParticipantTile({
  isLocal,
  displayName,
  stream,
  hasVideo,
  hasAudio,
  muted = false,
  pinned = false,
  raisedHand = false,
  onPin,
  outputDeviceId,
}: {
  isLocal: boolean;
  displayName: string;
  stream: MediaStream | null;
  hasVideo: boolean;
  hasAudio: boolean;
  muted?: boolean;
  pinned?: boolean;
  raisedHand?: boolean;
  onPin?: () => void;
  outputDeviceId?: string;
}) {
  const isSpeaking = useAudioActivity(stream, hasAudio);

  return (
    <article
      className={`video-tile ${isSpeaking ? "is-speaking" : ""} ${pinned ? "is-pinned" : ""}`}
    >
      {hasVideo && stream ? (
        <Video stream={stream} muted={muted} />
      ) : (
        <div className="participant-visual">{displayName.slice(0, 1).toUpperCase()}</div>
      )}
      {!isLocal && stream && <Audio stream={stream} outputDeviceId={outputDeviceId} />}
      {onPin && (
        <button
          type="button"
          className="meeting-pin"
          onClick={onPin}
          aria-label={pinned ? `Bỏ ghim ${displayName}` : `Ghim ${displayName}`}
          title={pinned ? "Bỏ ghim" : "Ghim người tham gia"}
        >
          <Icon name="star" size={14} />
        </button>
      )}
      {raisedHand && (
        <span className="participant-hand" role="img" aria-label="Đang giơ tay" title="Đang giơ tay">
          <Icon name="hand" size={14} />
        </span>
      )}
      <div className="participant-label">
        <Icon
          name={hasAudio ? "mic" : "mic-off"}
          size={13}
          style={{ color: hasAudio ? "#10b981" : "#ef4444" }}
        />
        <span>
          {displayName} {isLocal ? "(bạn)" : ""}
        </span>
        {isSpeaking && (
          <span className="speaking-indicator" title="Đang nói" aria-label="Đang nói">
            <span className="speaking-bar" />
            <span className="speaking-bar" />
            <span className="speaking-bar" />
          </span>
        )}
      </div>
    </article>
  );
}

export function MeetingPage() {
  const { accessToken, user, notify, setActiveView, route, navigate, openChannel } = useApp();
  const meeting = useMeeting();
  const { isConnected, socket, joinChannel, leaveChannel, sendMessage } = useSocket();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [navigationError, setNavigationError] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [participantCount, setParticipantCount] = useState(1);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<MeetingHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [schedules, setSchedules] = useState<MeetingScheduleItem[]>([]);
  const [schedulesLoading, setSchedulesLoading] = useState(true);
  const [schedulesError, setSchedulesError] = useState("");
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState("");
  const [scheduleTitle, setScheduleTitle] = useState("");
  const [scheduleDescription, setScheduleDescription] = useState("");
  const [scheduleRoomId, setScheduleRoomId] = useState("");
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [cancelScheduleId, setCancelScheduleId] = useState("");

  // Lobby preview state
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewCam, setPreviewCam] = useState(true);
  const [previewMic, setPreviewMic] = useState(true);
  const [previewError, setPreviewError] = useState("");
  const [previewRetry, setPreviewRetry] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioInputId, setAudioInputId] = useState("");
  const [videoInputId, setVideoInputId] = useState("");
  const [outputDeviceId, setOutputDeviceId] = useState("");
  const [quality, setQuality] = useState<"low" | "standard" | "high">("standard");
  const [layout, setLayout] = useState<"grid" | "spotlight">("grid");
  const [pinnedId, setPinnedId] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });
  const [gridPage, setGridPage] = useState(0);
  const [sidePanel, setSidePanel] = useState<"none" | "people" | "chat">("none");
  const [callMessages, setCallMessages] = useState<ChatMessageItem[]>([]);
  const [callDraft, setCallDraft] = useState("");
  const [callChatError, setCallChatError] = useState("");
  const callListRef = useRef<HTMLDivElement>(null);
  const followCallChat = useRef(true);
  const panelRef = useRef(sidePanel);
  panelRef.current = sidePanel;
  const [callUnread, setCallUnread] = useState(0);
  useEffect(() => {
    const list = callListRef.current;
    if(sidePanel === "chat") {
      setCallUnread(0);
      if(list && followCallChat.current) list.scrollTop = list.scrollHeight;
    }
  },[callMessages,sidePanel]);
  const [meetingState, setMeetingState] = useState<MeetingState | null>(null);
  const raisedHands = raisedHandUserIds(meetingState);
  // Confirm the local hand state from the server, whether it changed via H or the button.
  const myRaisedHand = meetingState?.participants.find((p) => p.userId === user?.id)?.raisedHand;
  const lastRaisedHand = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const title = handToastTitle(lastRaisedHand.current, myRaisedHand);
    lastRaisedHand.current = myRaisedHand;
    if (title) notify(title, undefined, "info");
  }, [myRaisedHand]);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const requestLeave = () => {
    if (meeting.sharing || meetingState?.participants.some(p => p.userId === user?.id && p.role === "host")) setLeaveConfirm(true);
    else void meeting.leaveCall();
  };
  useEffect(() => {
    if (!meeting.inCall) return;
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof Element && Boolean(event.target.closest('input,textarea,select,[contenteditable="true"]'));
      const key = meetingShortcut(event,typing,Boolean(document.querySelector('[role="dialog"]')));
      if (!key) return;
      event.preventDefault();
      if (key === "m") void meeting.toggleMic();
      if (key === "v") void meeting.toggleCamera();
      if (key === "s") void meeting.toggleScreenShare();
      if (key === "c") setSidePanel(old => old === "chat" ? "none" : "chat");
      if (key === "escape") setSidePanel("none");
      if (key === "h") {
        const me = meetingState?.participants.find(p => p.userId === user?.id);
        if (me) void meeting.controlSocket?.timeout(10000).emitWithAck("meeting_action",{roomId:meeting.roomId,action:"hand",enabled:!me.raisedHand}).then(result => {if(!result.success)setCallChatError(result.error || "Không thể giơ tay.");}).catch(reason => setCallChatError(reason.message));
      }
    };
    document.addEventListener("keydown",onKey);
    return () => document.removeEventListener("keydown",onKey);
  },[meeting,meetingState,user?.id]);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!previewEnabled || !navigator.mediaDevices?.enumerateDevices) return;
    let active = true;
    const refresh = () => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((list) => {
          if (active) setDevices(list);
        })
        .catch(reason => {if(active)setPreviewError(reason instanceof Error ? reason.message : "Không liệt kê được thiết bị.");});
    };
    refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, [previewEnabled, previewRetry]);

  useEffect(() => {
    if (!meeting.inCall || !meeting.roomId || !accessToken) return;
    const roomId = meeting.roomId;
    let active = true;
    setCallMessages([]);
    joinChannel(roomId);
    void getMessagesApi(accessToken, roomId, 50)
      .then((items) => {
        if (active) setCallMessages(items);
      })
      .catch((reason) => {
        if (active)
          setCallChatError(
            reason instanceof Error ? reason.message : "Không tải được chat cuộc họp.",
          );
      });
    const onMessage = (message: ChatMessageItem) => {
      if (message.channelId === roomId) {
        if(panelRef.current !== "chat" && message.authorId !== user?.id) setCallUnread(count => count+1);
        setCallMessages((previous) =>
          previous.some((item) => item.id === message.id) ? previous : [...previous, message],
        );
      }
    };
    socket?.on("new_message", onMessage);
    return () => {
      active = false;
      leaveChannel(roomId);
      socket?.off("new_message", onMessage);
    };
  }, [meeting.inCall, meeting.roomId, accessToken, joinChannel, leaveChannel, socket]);

  useEffect(() => {
    if (!accessToken) return;
    let mounted = true;
    getWorkspacesApi(accessToken)
      .then(async (workspaces) => {
        const lists = await Promise.all(
          workspaces.map(async (workspace) =>
            (await getChannelsApi(accessToken, workspace.id))
              .filter(
                (channel) =>
                  channel.type !== "text" && !channel.archivedAt && !workspace.archivedAt,
              )
              .map((channel) => ({
                id: channel.id,
                name: channel.name,
                workspace: workspace.name,
                workspaceId: workspace.id,
                role: workspace.role,
              })),
          ),
        );
        if (mounted) {
          const next = lists.flat();
          setRooms(next);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (mounted) setError(cause instanceof Error ? cause.message : "Không tải được phòng họp.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [accessToken]);

  useEffect(() => {
    if (loading || route.view !== "meetings") return;
    const available = route.workspaceId
      ? rooms.filter((room) => room.workspaceId === route.workspaceId)
      : rooms;
    const target = route.channelId
      ? available.find((room) => room.id === route.channelId)
      : available[0];
    setSelectedId(target?.id ?? "");
    setNavigationError(
      (route.workspaceId || route.channelId) && !target
        ? "Phòng họp không tồn tại hoặc bạn không có quyền truy cập liên kết này."
        : "",
    );
    if (target && !route.channelId)
      navigate({ view: "meetings", workspaceId: target.workspaceId, channelId: target.id }, true);
  }, [loading, rooms, route.view, route.workspaceId, route.channelId, navigate]);

  useEffect(() => {
    if (!accessToken || meeting.inCall) return;
    let active = true;
    setHistoryLoading(true);
    getMeetingHistoryApi(accessToken)
      .then((items) => {
        if (active) {
          setHistory(items);
          setHistoryError("");
        }
      })
      .catch((cause: unknown) => {
        if (active)
          setHistoryError(
            cause instanceof Error ? cause.message : "Không tải được lịch sử cuộc họp.",
          );
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accessToken, meeting.inCall]);

  useEffect(() => {
    if (!accessToken || meeting.inCall) return;
    let active = true;
    setSchedulesLoading(true);
    getMeetingSchedulesApi(accessToken)
      .then((items) => {
        if (active) {
          setSchedules(items);
          setSchedulesError("");
        }
      })
      .catch((cause) => {
        if (active)
          setSchedulesError(cause instanceof Error ? cause.message : "Không tải được lịch họp.");
      })
      .finally(() => {
        if (active) setSchedulesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accessToken, meeting.inCall]);

  // Only request device access after the user chooses to check the preview.
  useEffect(() => {
    if (meeting.inCall) {
      if (previewStream) {
        previewStream.getTracks().forEach((t) => t.stop());
        setPreviewStream(null);
      }
      return;
    }

    if (!previewEnabled) return;

    let active = true;
    let acquiredStream: MediaStream | null = null;
    setPreviewError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setPreviewError("Trình duyệt này không hỗ trợ truy cập camera và micro.");
      return;
    }
    setPreviewLoading(true);
    navigator.mediaDevices
      .getUserMedia({
        video: {
          deviceId: videoInputId ? { ideal: videoInputId } : undefined,
          width: { ideal: quality === "high" ? 1280 : quality === "low" ? 640 : 960 },
          height: { ideal: quality === "high" ? 720 : quality === "low" ? 360 : 540 },
        },
        audio: audioInputId ? { deviceId: { ideal: audioInputId } } : true,
      })
      .then((stream) => {
        acquiredStream = stream;
        if (active) {
          stream.getVideoTracks().forEach((track) => {
            track.enabled = previewCam;
          });
          stream.getAudioTracks().forEach((track) => {
            track.enabled = previewMic;
          });
          setPreviewStream(stream);
        } else {
          stream.getTracks().forEach((t) => t.stop());
        }
      })
      .catch((reason) => {
        if (active) setPreviewError(mapMediaError(reason));
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });

    return () => {
      active = false;
      acquiredStream?.getTracks().forEach((t) => t.stop());
    };
  }, [meeting.inCall, previewEnabled, previewRetry, audioInputId, videoInputId, quality]);

  useEffect(() => {
    if (previewVideoRef.current) previewVideoRef.current.srcObject = previewStream;
  }, [previewStream, previewCam]);

  const togglePreviewCam = () => {
    const next = !previewCam;
    previewStream?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setPreviewCam(next);
  };

  const togglePreviewMic = () => {
    const next = !previewMic;
    previewStream?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setPreviewMic(next);
  };

  const visibleRooms = route.workspaceId
    ? rooms.filter((room) => room.workspaceId === route.workspaceId)
    : rooms;
  const visibleSchedules = route.workspaceId
    ? schedules.filter((item) => item.workspaceId === route.workspaceId)
    : schedules;
  const selected = visibleRooms.find((room) => room.id === selectedId) ?? rooms.find((room) => room.id === selectedId);

  useEffect(() => {
    if (meeting.interruptedRoomId && rooms.some((room) => room.id === meeting.interruptedRoomId)) {
      const room = rooms.find((item) => item.id === meeting.interruptedRoomId);
      if (room) openChannel(room.workspaceId, room.id, true);
    }
  }, [meeting.interruptedRoomId, rooms]);

  async function enterRoom(roomId = selected?.id, scheduleId = route.scheduleId) {
    if (!roomId) return;
    setJoining(true);
    setError("");
    try {
      if (previewStream) {
        previewStream.getTracks().forEach((t) => t.stop());
        setPreviewStream(null);
      }
      const room = rooms.find((item) => item.id === roomId);
      if (room)
        navigate({
          view: "meetings",
          workspaceId: room.workspaceId,
          channelId: room.id,
          scheduleId,
        });
      await meeting.joinCall(
        roomId,
        {
          audioInputId,
          videoInputId,
          quality,
          micEnabled: previewMic,
          cameraEnabled: previewCam,
        },
        scheduleId,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể vào phòng họp.");
    } finally {
      setJoining(false);
    }
  }

  function openScheduleForm(item?: MeetingScheduleItem) {
    const start = new Date(Date.now() + 3_600_000);
    start.setMinutes(0, 0, 0);
    if (start.getTime() < Date.now() + 60_000) start.setHours(start.getHours() + 1);
    setEditingScheduleId(item?.id ?? "");
    setScheduleTitle(item?.title ?? "");
    setScheduleDescription(item?.description ?? "");
    setScheduleRoomId(item?.roomId ?? selectedId ?? visibleRooms[0]?.id ?? rooms[0]?.id ?? "");
    setScheduleStart(localDateTime(item ? new Date(item.startsAt) : start));
    setScheduleEnd(
      localDateTime(item ? new Date(item.endsAt) : new Date(start.getTime() + 3_600_000)),
    );
    setSchedulesError("");
    setScheduleFormOpen(true);
  }

  async function submitSchedule(event: FormEvent) {
    event.preventDefault();
    if (!accessToken) return;
    const startsAt = new Date(scheduleStart);
    const endsAt = new Date(scheduleEnd);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
      setSchedulesError("Chọn thời gian bắt đầu và kết thúc hợp lệ.");
      return;
    }
    setSavingSchedule(true);
    setSchedulesError("");
    try {
      const saved = await saveMeetingScheduleApi(
        accessToken,
        {
          roomId: scheduleRoomId,
          title: scheduleTitle.trim(),
          description: scheduleDescription.trim(),
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
        editingScheduleId || undefined,
      );
      setSchedules((previous) =>
        [...previous.filter((item) => item.id !== saved.id), saved].sort(
          (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
        ),
      );
      setScheduleFormOpen(false);
      notify(
        "Đã lưu lịch họp",
        `${saved.title} · ${new Date(saved.startsAt).toLocaleString("vi-VN")}`,
        "success",
      );
    } catch (cause) {
      setSchedulesError(cause instanceof Error ? cause.message : "Không lưu được lịch họp.");
    } finally {
      setSavingSchedule(false);
    }
  }

  async function cancelSchedule(id: string) {
    if (!accessToken) return;
    setSavingSchedule(true);
    try {
      await cancelMeetingScheduleApi(accessToken, id);
      setSchedules((previous) => previous.filter((item) => item.id !== id));
      setSchedulesError("");
      setCancelScheduleId("");
      notify("Đã huỷ lịch họp", "Lịch họp đã được gỡ khỏi danh sách của nhóm.", "success");
    } catch (cause) {
      setSchedulesError(cause instanceof Error ? cause.message : "Không huỷ được lịch họp.");
    } finally {
      setSavingSchedule(false);
    }
  }

  async function sendCallChat(event: FormEvent) {
    event.preventDefault();
    const text = callDraft.trim();
    if (!text || !meeting.roomId || !isConnected) return;
    try {
      const message = await sendMessage(meeting.roomId, text);
      setCallMessages((previous) =>
        previous.some((item) => item.id === message.id) ? previous : [...previous, message],
      );
      setCallDraft("");
      setCallChatError("");
    } catch (reason) {
      setCallChatError(reason instanceof Error ? reason.message : "Không gửi được tin nhắn.");
    }
  }

  const renderRoleBadge = (role: WorkspaceItem["role"]) => {
    if (role === "owner") {
      return <Chip icon="admin">Chủ nhóm</Chip>;
    }
    if (role === "admin") {
      return <Chip icon="admin">Quản trị viên</Chip>;
    }
    return <Chip icon="users">Thành viên</Chip>;
  };

  // ----- Dynamic grid -----
  useEffect(() => {
    const element = gridRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setGridSize((old) =>
        Math.abs(old.width - width) < 1 && Math.abs(old.height - height) < 1
          ? old
          : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [meeting.inCall, layout]);
  const allTiles: GridTile[] = [
    { id: "local", peer: null },
    ...meeting.remotePeers.map((peer) => ({ id: peer.socketId, peer })),
  ];
  const spotlightId =
    layout === "spotlight" ? (allTiles.some((tile) => tile.id === pinnedId) ? pinnedId : "local") : "";
  const spotlightTile = allTiles.find((tile) => tile.id === spotlightId) ?? null;
  const stripTiles = layout === "spotlight" ? allTiles.filter((tile) => tile.id !== spotlightId) : allTiles;
  const pagedTiles = paginate(
    stripTiles,
    layout === "spotlight" ? FILMSTRIP_PAGE_SIZE : pageSizeFor(gridSize.width || window.innerWidth),
    gridPage,
  );
  const gridLayout = bestGridLayout(pagedTiles.items.length, gridSize.width, gridSize.height, GRID_GAP);
  const visibleTileIds = new Set([
    ...pagedTiles.items.map((tile) => tile.id),
    ...(spotlightTile ? [spotlightTile.id] : []),
  ]);
  // One string per render keeps the demand effect stable until a layer actually changes.
  const devicePixelRatio = window.devicePixelRatio || 1;
  const demandKey =
    gridSize.width > 0
      ? meeting.remotePeers
          .map((peer) => {
            const width = !visibleTileIds.has(peer.socketId)
              ? 0
              : peer.socketId === spotlightId
                ? gridSize.width
                : layout === "spotlight"
                  ? FILMSTRIP_TILE_WIDTH
                  : gridLayout.tileWidth;
            return `${peer.socketId}=${layerForTile(width, devicePixelRatio) ?? "off"}`;
          })
          .join("|")
      : "";
  const { setVideoDemand } = meeting;
  useEffect(() => {
    const entries = demandKey ? demandKey.split("|").map((item) => item.split("=")) : [];
    for (const [socketId, layer] of entries)
      setVideoDemand(socketId, layer === "off" ? null : Number(layer));
    return () => {
      for (const [socketId] of entries) setVideoDemand(socketId, undefined);
    };
  }, [demandKey, setVideoDemand]);
  const togglePin = (id: string) => {
    setPinnedId(pinnedId === id ? "" : id);
    setLayout("spotlight");
  };
  const renderTile = (tile: GridTile, main = false) =>
    tile.peer ? (
      <ParticipantTile
        key={tile.id}
        isLocal={false}
        displayName={tile.peer.displayName}
        stream={tile.peer.mediaStream}
        hasVideo={Boolean(tile.peer.videoTrack)}
        hasAudio={Boolean(tile.peer.audioTrack)}
        pinned={main || pinnedId === tile.id}
        raisedHand={raisedHands.has(tile.peer.userId)}
        onPin={() => togglePin(tile.id)}
        outputDeviceId={outputDeviceId}
      />
    ) : (
      <ParticipantTile
        key="local"
        isLocal={true}
        displayName={user?.displayName || "Bạn"}
        stream={meeting.localStream}
        hasVideo={meeting.camera && Boolean(meeting.localStream)}
        hasAudio={meeting.mic}
        muted={true}
        pinned={main || pinnedId === "local"}
        raisedHand={Boolean(user && raisedHands.has(user.id))}
        onPin={() => togglePin("local")}
      />
    );

  return (
    <div className="meetings-page">
      {navigationError && (
        <section className="state-card" role="alert">
          <h3>Không thể mở phòng họp</h3>
          <p>{navigationError}</p>
          <Button variant="secondary" size="sm" onClick={() => setActiveView("overview")}>
            Về trang chủ
          </Button>
        </section>
      )}
      {/* Global Error Notice */}
      {error && (
        <div role="alert" className="inline-alert inline-alert--spaced">
          {error}
        </div>
      )}

      {!meeting.inCall ? (
        <div>
          {meeting.waitingRoomId && (
            <MeetingControls
              roomId={meeting.waitingRoomId}
              waiting
              onJoin={() => void enterRoom(meeting.waitingRoomId)}
              onCancel={() => void meeting.leaveCall()}
            />
          )}
          {meeting.interruptedRoomId && (
            <div className="meeting-return-notice" role="status">
              Kết nối cuộc họp đã bị ngắt. Thiết bị đã được tắt; chọn “Tham gia” để kết nối lại.
            </div>
          )}
          {loading ? (
            <>
              <header className="page-hero">
                <h1 className="meeting-page-title">Cuộc họp video</h1>
                <p className="meeting-page-description">
                  Chọn phòng trong nhóm của bạn và kiểm tra thiết bị trước khi tham gia.
                </p>
              </header>
              <p role="status" className="loading-note">
                Đang tải danh sách phòng họp…
              </p>
            </>
          ) : visibleRooms.length === 0 ? (
            <>
              <header className="page-hero">
                <h1 className="meeting-page-title">Cuộc họp video</h1>
                <p className="meeting-page-description">
                  Chọn phòng trong nhóm của bạn và kiểm tra thiết bị trước khi tham gia.
                </p>
              </header>
              <div className="state-card state-card--compact">
                <span className="state-card__icon">
                  <Icon name="video" size={26} />
                </span>
                <h3>Chưa có phòng họp nào</h3>
                <p>
                  Nhóm này hiện chưa có phòng họp khả dụng hoặc đã lưu trữ. Hãy kiểm tra cài đặt
                  kênh của nhóm.
                </p>
                <Button variant="secondary" size="sm" onClick={() => setActiveView("overview")}>
                  Xem nhóm làm việc
                </Button>
              </div>
            </>
          ) : (
            <div className="meeting-lobby-wrap">
              {/* Left Column: Header + Room Cards */}
              <div className="meeting-rooms-section">
                <header className="page-hero">
                  <h1 className="meeting-page-title">Cuộc họp video</h1>
                  <p className="meeting-page-description">
                    Chọn phòng trong nhóm của bạn và kiểm tra thiết bị trước khi tham gia.
                  </p>
                </header>

                <div className="meeting-section-header">
                  <h3>Chọn phòng họp ({visibleRooms.length})</h3>
                  <Chip icon="video">Phòng của nhóm</Chip>
                </div>

                {visibleRooms.map((room) => (
                  <button
                    type="button"
                    key={room.id}
                    className={`meeting-room-card ${room.id === selectedId ? "is-selected" : ""}`}
                    aria-pressed={room.id === selectedId}
                    onClick={() => openChannel(room.workspaceId, room.id, true)}
                  >
                    <div className="meeting-room-card__header">
                      <h4 className="meeting-room-card__title">
                        <span className="meeting-room-card__icon" aria-hidden="true">
                          <Icon name="video" size={18} />
                        </span>
                        {room.name}
                      </h4>
                      {renderRoleBadge(room.role)}
                    </div>
                    <div className="meeting-room-card__meta">
                      <span>
                        Thuộc nhóm: <strong>{room.workspace}</strong>
                      </span>
                      <span>· Có thể tham gia</span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Right Column: Lobby Device Check & Join Preview */}
              <div className="meeting-lobby-preview-box">
                <div>
                  <h3
                    style={{
                      fontSize: "16px",
                      fontWeight: 650,
                      margin: "0 0 4px",
                      color: "var(--text)",
                    }}
                  >
                    Trước khi vào phòng
                  </h3>
                  <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: 0 }}>
                    Kiểm tra camera và microphone của bạn trước khi bắt đầu tham gia.
                  </p>
                </div>

                <div className="meeting-preview-screen">
                  {previewCam && previewStream ? (
                    <video
                      ref={previewVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="meeting-preview-video"
                    />
                  ) : (
                    <div className="meeting-preview-placeholder">
                      <div className="meeting-preview-avatar">
                        {(user?.displayName || "Bạn").slice(0, 1).toUpperCase()}
                      </div>
                      <span style={{ fontSize: "13px" }}>
                        {previewEnabled ? "Camera đang tắt" : "Chưa kiểm tra camera"}
                      </span>
                    </div>
                  )}
                </div>
                {!previewEnabled && (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="camera"
                    onClick={() => setPreviewEnabled(true)}
                  >
                    Kiểm tra camera và micro
                  </Button>
                )}
                {previewLoading && (
                  <p className="meeting-device-status" role="status">
                    Đang chờ quyền truy cập thiết bị…
                  </p>
                )}
                {previewError && (
                  <div className="meeting-device-error" role="alert">
                    <span>{previewError}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPreviewRetry((value) => value + 1)}
                    >
                      Thử lại
                    </Button>
                  </div>
                )}

                <div className="meeting-preview-controls">
                  <button
                    type="button"
                    className={`lobby-control-btn ${!previewCam ? "is-muted" : ""}`}
                    disabled={joining}
                    aria-pressed={previewCam}
                    onClick={togglePreviewCam}
                  >
                    <Icon name={previewCam ? "camera" : "camera-off"} size={16} />
                    <span>{previewCam ? "Tắt Camera" : "Bật Camera"}</span>
                  </button>

                  <button
                    type="button"
                    className={`lobby-control-btn ${!previewMic ? "is-muted" : ""}`}
                    disabled={joining}
                    aria-pressed={previewMic}
                    onClick={togglePreviewMic}
                  >
                    <Icon name={previewMic ? "mic" : "mic-off"} size={16} />
                    <span>{previewMic ? "Tắt Mic" : "Bật Mic"}</span>
                  </button>
                </div>

                {previewEnabled && (
                  <div className="meeting-device-grid">
                    <label>
                      Micro
                      <select
                        aria-label="Chọn micro"
                        value={audioInputId}
                        onChange={(event) => setAudioInputId(event.target.value)}
                      >
                        <option value="">Thiết bị mặc định</option>
                        {devices
                          .filter((device) => device.kind === "audioinput")
                          .map((device, index) => (
                            <option key={device.deviceId || index} value={device.deviceId}>
                              {device.label || `Micro ${index + 1}`}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Camera
                      <select
                        aria-label="Chọn camera"
                        value={videoInputId}
                        onChange={(event) => setVideoInputId(event.target.value)}
                      >
                        <option value="">Thiết bị mặc định</option>
                        {devices
                          .filter((device) => device.kind === "videoinput")
                          .map((device, index) => (
                            <option key={device.deviceId || index} value={device.deviceId}>
                              {device.label || `Camera ${index + 1}`}
                            </option>
                          ))}
                      </select>
                    </label>
                    {"setSinkId" in HTMLMediaElement.prototype && (
                      <label>
                        Loa
                        <select
                          aria-label="Chọn loa"
                          value={outputDeviceId}
                          onChange={(event) => setOutputDeviceId(event.target.value)}
                        >
                          <option value="">Thiết bị mặc định</option>
                          {devices
                            .filter((device) => device.kind === "audiooutput")
                            .map((device, index) => (
                              <option key={device.deviceId || index} value={device.deviceId}>
                                {device.label || `Loa ${index + 1}`}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                    <label>
                      Chất lượng video
                      <select
                        aria-label="Chọn chất lượng video"
                        value={quality}
                        onChange={(event) =>
                          setQuality(event.target.value as "low" | "standard" | "high")
                        }
                      >
                        <option value="low">Tiết kiệm dữ liệu · 360p</option>
                        <option value="standard">Cân bằng · 540p</option>
                        <option value="high">Rõ nét · 720p</option>
                      </select>
                    </label>
                    <p className="meeting-device-help">
                      Làm mờ và thay nền chưa được xử lý trong luồng video hiện tại.
                    </p>
                  </div>
                )}

                <p className="meeting-connectivity" role="status">
                  <span className={isConnected ? "is-online" : ""} />{" "}
                  {isConnected
                    ? "Máy chủ đã kết nối · sẵn sàng tham gia"
                    : "Mất kết nối · chưa thể tham gia"}
                </p>

                <div className="meeting-lobby-action">
                  <Button
                    size="lg"
                    icon="video"
                    disabled={joining || !selected || !isConnected}
                    loading={joining}
                    onClick={() => void enterRoom()}
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    {joining ? "Đang kết nối…" : `Tham gia ${selected?.name ?? "phòng họp"}`}
                  </Button>
                  {joining && (
                    <Button variant="secondary" onClick={() => void meeting.leaveCall()}>
                      Hủy tham gia
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
          <section className="meeting-schedules" aria-label="Lịch họp sắp tới">
            <div className="meeting-schedules-head">
              <div>
                <h2>Lịch họp sắp tới</h2>
                <p>Lên kế hoạch trong phòng của nhóm và tham gia trực tiếp khi đến giờ.</p>
              </div>
              {visibleRooms.length > 0 && (
                <Button
                  size="sm"
                  icon="plus"
                  onClick={() =>
                    scheduleFormOpen ? setScheduleFormOpen(false) : openScheduleForm()
                  }
                >
                  {scheduleFormOpen ? "Đóng biểu mẫu" : "Lên lịch họp"}
                </Button>
              )}
            </div>
            {scheduleFormOpen && (
              <form className="meeting-schedule-form" onSubmit={submitSchedule}>
                <div className="meeting-schedule-form-grid">
                  <label className="meeting-schedule-wide">
                    Tên cuộc họp
                    <input
                      required
                      minLength={3}
                      maxLength={120}
                      value={scheduleTitle}
                      onChange={(event) => setScheduleTitle(event.target.value)}
                      placeholder="Ví dụ: Họp tiến độ đồ án"
                    />
                  </label>
                  <label>
                    Phòng họp
                    <select
                      required
                      value={scheduleRoomId}
                      onChange={(event) => setScheduleRoomId(event.target.value)}
                    >
                      {visibleRooms
                        .filter(
                          (room) =>
                            !editingScheduleId ||
                            room.workspaceId ===
                              schedules.find((item) => item.id === editingScheduleId)?.workspaceId,
                        )
                        .map((room) => (
                          <option key={room.id} value={room.id}>
                            {room.workspace} · {room.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Bắt đầu
                    <input
                      required
                      type="datetime-local"
                      value={scheduleStart}
                      onChange={(event) => setScheduleStart(event.target.value)}
                    />
                  </label>
                  <label>
                    Kết thúc
                    <input
                      required
                      type="datetime-local"
                      value={scheduleEnd}
                      onChange={(event) => setScheduleEnd(event.target.value)}
                    />
                  </label>
                  <label className="meeting-schedule-wide">
                    Nội dung chuẩn bị
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={scheduleDescription}
                      onChange={(event) => setScheduleDescription(event.target.value)}
                      placeholder="Nội dung, tài liệu cần chuẩn bị…"
                    />
                  </label>
                </div>
                <div className="meeting-schedule-form-actions">
                  <span>Thời gian theo múi giờ của thiết bị bạn.</span>
                  <Button
                    type="submit"
                    size="sm"
                    loading={savingSchedule}
                    disabled={savingSchedule}
                  >
                    {editingScheduleId ? "Lưu thay đổi" : "Tạo lịch họp"}
                  </Button>
                </div>
              </form>
            )}
            {schedulesError && (
              <p className="meeting-schedule-error" role="alert">
                {schedulesError}
              </p>
            )}
            {schedulesLoading ? (
              <p className="meeting-schedule-empty" role="status">
                Đang tải lịch họp…
              </p>
            ) : visibleSchedules.length === 0 ? (
              <div className="meeting-schedule-empty-wrap">
                <div className="meeting-schedule-list" role="list" aria-label="Lịch họp mẫu xem trước">
                  <ListItem
                    role="listitem"
                    icon="calendar"
                    title="Đồng bộ tiến độ Sprint 4"
                    subtitle="Đồ án tốt nghiệp • Phòng họp chung"
                    metaPrimary="09:00"
                    metaSecondary="07/10"
                    onClick={() => {}}
                  />
                  <ListItem
                    role="listitem"
                    icon="video"
                    title="Review giao diện nexo Web"
                    subtitle="Nhóm Thiết kế • Phòng họp 1"
                    metaPrimary="15:00"
                    metaSecondary="08/10"
                    onClick={() => {}}
                  />
                </div>
                <p className="meeting-schedule-empty">
                  Chưa có lịch họp sắp tới trong nhóm này.
                </p>
              </div>
            ) : (
              <div className="meeting-schedule-list">
                {visibleSchedules.map((item) => {
                  const start = new Date(item.startsAt);
                  const end = new Date(item.endsAt);
                  return (
                    <article className="meeting-schedule-item" key={item.id}>
                      <div className="meeting-schedule-date">
                        <strong>
                          {start.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}
                        </strong>
                        <span>
                          {start.toLocaleTimeString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="meeting-schedule-content">
                        <h3>{item.title}</h3>
                        <p>
                          {item.workspaceName} · {item.roomName} · đến{" "}
                          {end.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                        </p>
                        {item.description && (
                          <p className="meeting-schedule-description">{item.description}</p>
                        )}
                        <span>Tạo bởi {item.organizerName}</span>
                      </div>
                      <div className="meeting-schedule-actions">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon="video"
                          disabled={!isConnected || joining}
                          loading={joining}
                          onClick={() => void enterRoom(item.roomId, item.id)}
                        >
                          Tham gia
                        </Button>
                        <Button
                          size="sm"
                          variant="text"
                          icon="calendar"
                          onClick={() => downloadCalendarEvent(item)}
                        >
                          Thêm vào lịch
                        </Button>
                        {item.canManage && (
                          <>
                            <Button
                              size="sm"
                              variant="text"
                              icon="edit"
                              onClick={() => openScheduleForm(item)}
                            >
                              Sửa
                            </Button>
                            <Button
                              size="sm"
                              variant="text"
                              onClick={() => setCancelScheduleId(item.id)}
                            >
                              Huỷ lịch
                            </Button>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
          <section className="meeting-history" aria-label="Lịch sử cuộc họp">
            <h2>Cuộc họp gần đây</h2>
            {historyLoading ? (
              <p role="status">Đang tải lịch sử cuộc họp…</p>
            ) : historyError ? (
              <p role="alert">{historyError}</p>
            ) : history.length === 0 ? (
              <div className="meeting-history-empty-wrap">
                <div className="meeting-history-list" role="list" aria-label="Lịch sử cuộc họp mẫu">
                  <ListItem
                    role="listitem"
                    icon="video"
                    title="Phòng họp chung — Đồ án tốt nghiệp"
                    subtitle="Đã kết thúc • Thời lượng 42 phút"
                    metaPrimary="10:30"
                    metaSecondary="Hôm qua"
                    onClick={() => {}}
                  />
                  <ListItem
                    role="listitem"
                    icon="video"
                    title="Thảo luận kiến trúc Backend SFU"
                    subtitle="Đã kết thúc • Thời lượng 28 phút"
                    metaPrimary="14:15"
                    metaSecondary="04/10"
                    onClick={() => {}}
                  />
                </div>
                <p>Bạn chưa tham gia cuộc họp nào.</p>
              </div>
            ) : (
              <div className="meeting-history-list" role="list">
                {history.map((item) => {
                  const joinedDate = new Date(item.joinedAt);
                  const timeStr = Number.isNaN(joinedDate.getTime())
                    ? ""
                    : joinedDate.toLocaleTimeString("vi-VN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                  const dateStr = Number.isNaN(joinedDate.getTime())
                    ? ""
                    : joinedDate.toLocaleDateString("vi-VN", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      });
                  return (
                    <ListItem
                      key={item.id}
                      role="listitem"
                      icon="video"
                      title={item.name}
                      subtitle={item.leftAt ? "Đã kết thúc phiên họp" : "Chưa ghi nhận rời phòng"}
                      metaPrimary={timeStr || (item.leftAt ? "Đã kết thúc" : "Đang mở")}
                      metaSecondary={dateStr}
                      onClick={() => {}}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : (
        /* In-Call Active Video Room */
        <div className="meeting-room-active">
          {!isConnected && (
            <div className="meeting-reconnecting-overlay" role="alert">
              <span className="network-reconnect-dot" />
              <span>Đang gián đoạn kết nối máy chủ · Hệ thống đang tự động khôi phục…</span>
            </div>
          )}

          <header className="meeting-active-header">
            <h2>
              <Icon name="video" size={18} style={{ color: "#bcd2dd" }} />
              {rooms.find((room) => room.id === meeting.roomId)?.name ?? "Phòng họp trực tuyến"}
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Badge tone={isConnected ? "green" : "amber"}>
                <Icon name="users" size={12} /> {participantCount} người tham gia
              </Badge>
              <Badge tone="blue">WebRTC SFU</Badge>
            </div>
          </header>

          {/* Shared Screen View */}
          <MeetingControls
            roomId={meeting.roomId}
            waiting={false}
            onJoin={() => {}}
            onCancel={() => void meeting.leaveCall()}
            onCount={setParticipantCount}
            onState={setMeetingState}
          />
          {meeting.localScreenStream && (
            <div className="shared-screen">
              <Video stream={meeting.localScreenStream} muted />
              <span>Bạn đang chia sẻ màn hình</span>
            </div>
          )}
          {meeting.remotePeers
            .filter((peer) => peer.screenStream)
            .map((peer) => (
              <div className="shared-screen" key={`screen-${peer.socketId}`}>
                <Video stream={peer.screenStream} />
                <span>{peer.displayName} đang chia sẻ màn hình</span>
              </div>
            ))}

          <div className="meeting-stage-toolbar">
            <span>{participantCount} người trong phòng</span>
            <div className="meeting-layout-switch" role="group" aria-label="Kiểu hiển thị">
              <Button
                size="sm"
                variant={layout === "grid" ? "primary" : "ghost"}
                icon="grid"
                aria-pressed={layout === "grid"}
                onClick={() => setLayout("grid")}
              >
                Lưới
              </Button>
              <Button
                size="sm"
                variant={layout === "spotlight" ? "primary" : "ghost"}
                icon="monitor"
                aria-pressed={layout === "spotlight"}
                onClick={() => setLayout("spotlight")}
              >
                Tiêu điểm
              </Button>
            </div>
          </div>
          <div className={`meeting-stage-layout ${sidePanel !== "none" ? "has-panel" : ""}`}>
            {/* Dynamic video grid: best-fit columns, paging, demand-driven SFU layers */}
            <div
              ref={gridRef}
              className={`meeting-video-grid ${layout === "spotlight" ? "is-spotlight" : ""} ${meeting.localScreenStream || meeting.remotePeers.some((peer) => peer.screenStream) ? "has-share" : ""}`}
              style={
                layout === "grid" && gridLayout.tileWidth > 0
                  ? { gridTemplateColumns: `repeat(${gridLayout.columns}, ${Math.floor(gridLayout.tileWidth)}px)` }
                  : undefined
              }
            >
              {layout === "spotlight" && spotlightTile && (
                <div className="meeting-spotlight-main">{renderTile(spotlightTile, true)}</div>
              )}
              {layout === "spotlight" ? (
                <div className="meeting-filmstrip">{pagedTiles.items.map((tile) => renderTile(tile))}</div>
              ) : (
                pagedTiles.items.map((tile) => renderTile(tile))
              )}
            </div>
            {pagedTiles.pageCount > 1 && (
              <nav className="meeting-grid-pager" aria-label="Trang người tham gia">
                <button
                  type="button"
                  aria-label="Trang trước"
                  disabled={pagedTiles.page === 0}
                  onClick={() => setGridPage(pagedTiles.page - 1)}
                >
                  <Icon name="chevron-left" size={16} />
                </button>
                <span>
                  Trang {pagedTiles.page + 1}/{pagedTiles.pageCount}
                </span>
                <button
                  type="button"
                  aria-label="Trang sau"
                  disabled={pagedTiles.page >= pagedTiles.pageCount - 1}
                  onClick={() => setGridPage(pagedTiles.page + 1)}
                >
                  <Icon name="chevron-right" size={16} />
                </button>
              </nav>
            )}
            {/* Off-page peers keep their audio while their video is paused at the SFU. */}
            {meeting.remotePeers
              .filter((peer) => !visibleTileIds.has(peer.socketId))
              .map((peer) => (
                <Audio key={peer.socketId} stream={peer.mediaStream} outputDeviceId={outputDeviceId} />
              ))}

            {sidePanel !== "none" && (
              <aside
                className="meeting-side-panel"
                aria-label={sidePanel === "people" ? "Người tham gia" : "Chat cuộc họp"}
              >
                <div className="meeting-side-panel-head">
                  <strong>{sidePanel === "people" ? "Người tham gia" : "Chat cuộc họp"}</strong>
                  <IconButton icon="x" label="Đóng bảng phụ" onClick={() => setSidePanel("none")} />
                </div>
                {sidePanel === "people" ? (
                  <div className="meeting-people-list">
                    <div>
                      <span>{user?.displayName || "Bạn"} · bạn</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="pin"
                        onClick={() => {
                          setPinnedId("local");
                          setLayout("spotlight");
                        }}
                      >
                        Ghim
                      </Button>
                    </div>
                    {meeting.remotePeers.map((peer) => (
                      <div key={peer.socketId}>
                        <span>{peer.displayName}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="pin"
                          onClick={() => {
                            setPinnedId(peer.socketId);
                            setLayout("spotlight");
                          }}
                        >
                          Ghim
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div ref={callListRef} className="meeting-chat-list" role="log" aria-label="Tin nhắn cuộc họp" onScroll={event => {const el=event.currentTarget;followCallChat.current=el.scrollHeight-el.scrollTop-el.clientHeight<90;}}>
                      {callMessages.length ? (
                        callMessages.map((item) => (
                          <p key={item.id}>
                            <strong>{item.authorName}</strong>
                            <span>{item.content}</span>
                          </p>
                        ))
                      ) : (
                        <p>Chưa có tin nhắn. Bắt đầu trao đổi cùng mọi người.</p>
                      )}
                    </div>
                    {callChatError && (
                      <p className="meeting-chat-error" role="alert">
                        {callChatError}
                      </p>
                    )}
                    <form
                      className="meeting-chat-compose"
                      onSubmit={(event) => void sendCallChat(event)}
                    >
                      <input
                        value={callDraft}
                        onChange={(event) => setCallDraft(event.target.value)}
                        maxLength={4000}
                        placeholder="Nhắn trong cuộc họp…"
                        aria-label="Nội dung chat cuộc họp"
                      />
                      <button
                        type="submit"
                        disabled={!callDraft.trim() || !isConnected}
                        aria-label="Gửi tin nhắn cuộc họp"
                      >
                        <Icon name="send" size={16} />
                      </button>
                    </form>
                  </>
                )}
              </aside>
            )}
          </div>

          {/* Controls Dock */}
          <div className="meeting-controls-dock" role="toolbar" aria-label="Điều khiển cuộc họp">
            <button
              type="button"
              className={`meeting-dock-btn ${!meeting.mic ? "is-muted" : ""}`}
              aria-label={meeting.mic ? "Tắt micro" : "Bật micro"}
              aria-pressed={meeting.mic}
              onClick={() => void meeting.toggleMic()}
              title={meeting.mic ? "Tắt micro (M)" : "Bật micro (M)"}
            >
              <Icon name={meeting.mic ? "mic" : "mic-off"} size={18} />
            </button>

            <button
              type="button"
              className={`meeting-dock-btn ${!meeting.camera ? "is-muted" : ""}`}
              aria-label={meeting.camera ? "Tắt camera" : "Bật camera"}
              aria-pressed={meeting.camera}
              onClick={() => void meeting.toggleCamera()}
              title={meeting.camera ? "Tắt camera (V)" : "Bật camera (V)"}
            >
              <Icon name={meeting.camera ? "camera" : "camera-off"} size={18} />
            </button>

            <button
              type="button"
              className={`meeting-dock-btn ${meeting.sharing ? "is-active" : ""}`}
              aria-label={meeting.sharing ? "Dừng chia sẻ màn hình" : "Chia sẻ màn hình"}
              aria-pressed={meeting.sharing}
              onClick={() => void meeting.toggleScreenShare()}
              title={meeting.sharing ? "Dừng chia sẻ màn hình (S)" : "Chia sẻ màn hình (S)"}
            >
              <Icon name="share" size={18} />
            </button>

            <button
              type="button"
              className={`meeting-dock-btn ${sidePanel === "chat" ? "is-active" : ""}`}
              aria-label="Chat cuộc họp"
              aria-pressed={sidePanel === "chat"}
              title="Chat cuộc họp (C)"
              onClick={() => setSidePanel(sidePanel === "chat" ? "none" : "chat")}
            >
              <Icon name="message" size={18} />
              {callUnread > 0 && <span className="badge" aria-label={`${callUnread} tin nhắn mới`}>{callUnread}</span>}
            </button>
            <button
              type="button"
              className={`meeting-dock-btn ${sidePanel === "people" ? "is-active" : ""}`}
              aria-label="Xem người tham gia"
              aria-pressed={sidePanel === "people"}
              title="Người tham gia"
              onClick={() => setSidePanel(sidePanel === "people" ? "none" : "people")}
            >
              <Icon name="users" size={18} />
            </button>
            <button
              type="button"
              className="meeting-dock-btn is-leave"
              aria-label="Rời khỏi phòng họp"
              onClick={requestLeave}
              title="Rời khỏi phòng họp"
            >
              <Icon name="phone" size={16} />
              <span>Rời phòng</span>
            </button>
          </div>

          {/* QoS Statistics Panel */}
          <div className="meeting-qos-card">
            <div className="meeting-qos-info">
              <strong>Đo kiểm chất lượng mạng thời gian thực (QoS Metrics)</strong>
              <p>
                Độ trễ RTT: <strong>{meeting.qos?.rtt ?? "—"} ms</strong> · Băng thông:{" "}
                <strong>{meeting.qos?.bitrate ?? "—"} kbps</strong> · Tỷ lệ mất gói:{" "}
                <strong>{meeting.qos?.packetLoss ?? "—"}%</strong> · Jitter:{" "}
                <strong>{meeting.qos?.jitter ?? "—"} ms</strong>
              </p>
            </div>
            <div className="meeting-qos-actions">
              <Button
                size="sm"
                variant="secondary"
                disabled={!meeting.qosHistory.length}
                onClick={() => {
                  meeting.exportQosCsv();
                  notify("Thành công", "Đã xuất báo cáo QoS định dạng CSV.", "success");
                }}
              >
                Xuất CSV
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!meeting.qosHistory.length}
                onClick={() => {
                  meeting.exportQosJson();
                  notify("Thành công", "Đã xuất báo cáo QoS định dạng JSON.", "success");
                }}
              >
                Xuất JSON
              </Button>
            </div>
          </div>
        </div>
      )}
      <AnimatePresence>{leaveConfirm && <ConfirmDialog title="Rời phòng" description={meeting.sharing ? "Bạn đang chia sẻ màn hình. Rời phòng sẽ dừng chia sẻ và ngắt thiết bị của bạn." : "Bạn đang là host. Rời phòng sẽ chuyển quyền host cho người phù hợp; nếu không còn người tham gia, phiên sẽ kết thúc."} confirmLabel="Rời phòng" loading={leaving} onClose={() => setLeaveConfirm(false)} onConfirm={() => {setLeaving(true); void meeting.leaveCall().finally(() => {setLeaving(false);setLeaveConfirm(false);});}} />}</AnimatePresence>
      <AnimatePresence>{cancelScheduleId && <ConfirmDialog title="Huỷ lịch" description="Hủy lịch họp này? Lịch sẽ không còn xuất hiện trong danh sách cuộc họp sắp tới của nhóm." confirmLabel="Xác nhận huỷ" loading={savingSchedule} onClose={() => setCancelScheduleId("")} onConfirm={() => void cancelSchedule(cancelScheduleId)} />}</AnimatePresence>
    </div>
  );
}
