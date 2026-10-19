import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessageItem, MeetingScheduleItem, WorkspaceItem, MeetingState } from "@doan/shared";
import { getChannelsApi, getMessagesApi, getWorkspacesApi } from "../chat/api";
import {
  getMeetingHistoryApi,
  getMeetingSchedulesApi,
  saveMeetingScheduleApi,
  cancelMeetingScheduleApi,
  getMyCommitteesApi,
  getDialInApi,
  type MeetingHistoryItem,
} from "./api";
import { useApp } from "../../app/providers/AppContext";
import { useMeeting, type RemotePeer } from "../../app/providers/MeetingContext";
import { bestGridLayout, layerForTile, pageSizeFor, paginate } from "./grid-layout";
import {
  applyLayerPolicy,
  isLayerPolicy,
  spotlightDelay,
  type LayerPolicy,
} from "./speaker-policy";
import { handToastTitle, raisedHandUserIds } from "./hand-raise";
import { MeetingControls } from "./MeetingControls";
import { MeetingOutcomesPanel } from "./MeetingOutcomesPanel";
import { mapMediaError, micConstraints } from "./webrtc/local-media";
import { MicLevelMeter } from "./MicLevelMeter";
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

/** Room filters from real data: schedules, committees (MT-3) and the user's role in the group. */
export const MEETING_BRANCH_PILLS = ["Tất cả", "Có lịch sắp tới", "Hội đồng bảo vệ", "Nhóm tôi quản lý"] as const;

export const THESIS_RUBRICS = [
  { id: "r1", name: "Tổng quan đề tài & Mục tiêu nghiên cứu", weight: 20 },
  { id: "r2", name: "Kiến trúc hệ thống & Demo sản phẩm", weight: 40 },
  { id: "r3", name: "Báo cáo tiến độ & Kỹ năng thuyết trình", weight: 20 },
  { id: "r4", name: "Trả lời câu hỏi phản biện của hội đồng", weight: 20 },
];

/**
 * The council scoring and live-quiz side panels were UI prototypes (scores were never saved). Real
 * committee scoring is MeetingCommitteePanel (MT-3) and quizzes live in e-learning; kept hidden.
 */
const SHOW_PROTOTYPE_PANELS = false;

export const QUIZ_QUESTION = "Kiến trúc WebRTC SFU phân phối luồng media như thế nào?";
export const QUIZ_OPTIONS = [
  "Server SFU chọn lọc và chuyển tiếp (Selective Forwarding Unit)",
  "P2P thuần túy giữa từng client (Peer-to-Peer Full Mesh)",
  "Client-Server qua HTTP polling định kỳ",
  "Tải qua RTSP broadcast streaming",
];

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

// Video elements never play sound: remote audio plays once, from the stable <Audio> list in the room.
function Video({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
    return () => {
      if (ref.current) ref.current.srcObject = null;
    };
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className="rtc-video-element" />;
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

/** M1: lets someone without a computer join by phone: dial the meeting number, type the code. */
function DialInBadge({ accessToken, roomId }: { accessToken: string; roomId: string }) {
  const [dialIn, setDialIn] = useState<{ number: string; code: string } | null>(null);
  useEffect(() => {
    let alive = true;
    getDialInApi(accessToken, roomId).then((info) => alive && setDialIn(info), () => alive && setDialIn(null));
    return () => {
      alive = false;
    };
  }, [accessToken, roomId]);
  if (!dialIn) return null;
  const code = `${dialIn.code.slice(0, 3)} ${dialIn.code.slice(3)}`;
  return (
    <Badge tone="neutral">
      <span title={`Từ máy lẻ: gọi ${dialIn.number}, nhập mã ${dialIn.code} rồi nhấn #`}>
        <Icon name="phone" size={12} /> Gọi {dialIn.number} · mã {code}
      </span>
    </Badge>
  );
}

function ParticipantTile({
  isLocal,
  displayName,
  stream,
  hasVideo,
  hasAudio,
  pinned = false,
  raisedHand = false,
  speaking,
  dominant = false,
  onPin,
}: {
  isLocal: boolean;
  displayName: string;
  stream: MediaStream | null;
  hasVideo: boolean;
  hasAudio: boolean;
  pinned?: boolean;
  raisedHand?: boolean;
  /** Server-side audio level for remote peers; local tiles analyse their own track. */
  speaking?: boolean;
  dominant?: boolean;
  onPin?: () => void;
}) {
  const analysed = useAudioActivity(stream, hasAudio && speaking === undefined);
  const isSpeaking = speaking ?? analysed;

  return (
    <article
      className={`video-tile ${isSpeaking ? "is-speaking" : ""} ${dominant ? "is-dominant" : ""} ${pinned ? "is-pinned" : ""}`}
    >
      {hasVideo && stream ? (
        <Video stream={stream} />
      ) : (
        <div className="participant-visual">{displayName.slice(0, 1).toUpperCase()}</div>
      )}
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
  const [scheduleAgenda, setScheduleAgenda] = useState("");
  // MT-3: committees the user sits on; a schedule can make its meeting that committee's room.
  const [committees, setCommittees] = useState<{ id: string; code: string; name: string }[]>([]);
  const [scheduleCommitteeId, setScheduleCommitteeId] = useState("");
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
  const [layout, setLayout] = useState<"grid" | "spotlight" | "auto">("grid");
  const [layerPolicy, setLayerPolicy] = useState<LayerPolicy>(() => {
    try {
      const saved = localStorage.getItem("nexo:layerPolicy");
      return isLayerPolicy(saved) ? saved : "combined";
    } catch {
      return "combined";
    }
  });
  const changeLayerPolicy = (next: LayerPolicy) => {
    setLayerPolicy(next);
    try {
      localStorage.setItem("nexo:layerPolicy", next);
    } catch {
      // Storage may be blocked; the choice still applies to this call.
    }
  };
  const [autoSpotlightId, setAutoSpotlightId] = useState("");
  const lastSpotlightSwitch = useRef(0);
  const [policyTick, setPolicyTick] = useState(0);
  const [pinnedId, setPinnedId] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridSize, setGridSize] = useState({ width: 0, height: 0 });
  const [gridPage, setGridPage] = useState(0);
  const [sidePanel, setSidePanel] = useState<
    "none" | "people" | "chat" | "notes" | "council" | "quiz"
  >("none");
  const [meetingPill, setMeetingPill] = useState<string>("Tất cả");

  // Thesis council state (Hội đồng Chấm Đồ án)
  const [isPrivateSession, setIsPrivateSession] = useState(false);
  const [rubricScores, setRubricScores] = useState<Record<string, number>>({
    r1: 8.5,
    r2: 9.0,
    r3: 8.0,
    r4: 8.5,
  });
  const [councilComment, setCouncilComment] = useState(
    "Đề tài ứng dụng công nghệ tốt, demo chạy mượt mà, trả lời phản biện rõ ràng.",
  );
  const councilTotal =
    Math.round(
      THESIS_RUBRICS.reduce((acc, r) => acc + (rubricScores[r.id] ?? 8) * r.weight, 0),
    ) / 100;

  // Live quiz state
  const [quizActive, setQuizActive] = useState(true);
  const [myQuizVote, setMyQuizVote] = useState<number | null>(null);
  const [quizVotes, setQuizVotes] = useState<Record<number, number>>({ 0: 14, 1: 3, 2: 1, 3: 0 });

  const [callMessages, setCallMessages] = useState<ChatMessageItem[]>([]);
  const [callDraft, setCallDraft] = useState("");
  const [callChatError, setCallChatError] = useState("");
  const callListRef = useRef<HTMLDivElement>(null);
  const followCallChat = useRef(true);
  const panelRef = useRef(sidePanel);
  panelRef.current = sidePanel;
  const [callUnread, setCallUnread] = useState(0);
  const sidePanelTitle =
    sidePanel === "people"
      ? "Người tham gia & Điểm danh"
      : sidePanel === "council"
        ? "Hội đồng Chấm Đồ án"
        : sidePanel === "quiz"
          ? "Live Quiz Trắc nghiệm"
          : sidePanel === "notes"
            ? "Ghi chú & việc cần làm"
            : "Chat cuộc họp";
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
    if (accessToken) void getMyCommitteesApi(accessToken).then(setCommittees, () => setCommittees([]));
  }, [accessToken]);

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
        audio: micConstraints(audioInputId),
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

  const scheduledRooms = new Set(visibleSchedules.filter((item) => new Date(item.endsAt) > new Date()).map((item) => item.roomId));
  const committeeRooms = new Set(visibleSchedules.filter((item) => item.committeeId).map((item) => item.roomId));
  const pillMatches = (pill: string, room: Room) =>
    pill === "Có lịch sắp tới"
      ? scheduledRooms.has(room.id)
      : pill === "Hội đồng bảo vệ"
        ? committeeRooms.has(room.id)
        : pill === "Nhóm tôi quản lý"
          ? room.role === "owner" || room.role === "admin"
          : true;
  const pillCount = (pill: string) => visibleRooms.filter((room) => pillMatches(pill, room)).length;
  const filteredRooms = visibleRooms.filter((room) => {
    return pillMatches(meetingPill, room);
  });
  const displayRooms = filteredRooms.length ? filteredRooms : visibleRooms;
  const selected = displayRooms.find((room) => room.id === selectedId) ?? displayRooms[0] ?? visibleRooms.find((room) => room.id === selectedId) ?? rooms.find((room) => room.id === selectedId);

  const handleExportAttendanceCsv = () => {
    const now = new Date();
    const dateFormatted = now.toLocaleDateString("vi-VN");
    const attendees = [
      {
        name: user?.displayName || "Bạn",
        mssv: "52100845",
        role: "Chủ trì cuộc họp",
        joinedAt: now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
        status: "Hiện diện",
      },
      ...meeting.remotePeers.map((peer, idx) => {
        const mssvMatch = peer.displayName.match(/\b(5\d{7})\b/);
        return {
          name: peer.displayName,
          mssv: mssvMatch ? mssvMatch[1] : `52200${100 + idx}`,
          role: "Thành viên",
          joinedAt: now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
          status: "Hiện diện",
        };
      }),
    ];
    const headers = "STT,Họ và tên,MSSV,Vai trò,Thời gian tham gia,Ngày,Trạng thái\n";
    const rows = attendees
      .map(
        (a, i) =>
          `${i + 1},"${a.name}","${a.mssv}","${a.role}","${a.joinedAt}","${dateFormatted}","${a.status}"`,
      )
      .join("\n");
    const blob = new Blob(["\uFEFF" + headers + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `diem-danh-phong-${(meeting.roomId || "tdtu").slice(0, 8)}-${now.toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notify(
      "Xuất điểm danh thành công",
      `Đã xuất file điểm danh gồm ${attendees.length} người tham gia theo chuẩn MSSV TDTU.`,
      "success",
    );
  };

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
    setScheduleAgenda((item?.agenda ?? []).join("\n"));
    setScheduleCommitteeId(item?.committeeId ?? "");
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
          agenda: scheduleAgenda
            .split("\n")
            .map((line) => line.replace(/^\s*[-•*]\s*/, "").trim())
            .filter(Boolean),
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          ...(committees.length ? { committeeId: scheduleCommitteeId || null } : {}),
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
  const staged = layout !== "grid";
  const remoteFallback = meeting.remotePeers[0]?.socketId ?? "local";
  const spotlightId =
    layout === "spotlight"
      ? allTiles.some((tile) => tile.id === pinnedId)
        ? pinnedId
        : "local"
      : layout === "auto"
        ? allTiles.some((tile) => tile.id === autoSpotlightId)
          ? autoSpotlightId
          : remoteFallback
        : "";
  const spotlightTile = allTiles.find((tile) => tile.id === spotlightId) ?? null;
  const stripTiles = staged ? allTiles.filter((tile) => tile.id !== spotlightId) : allTiles;
  const pagedTiles = paginate(
    stripTiles,
    staged ? FILMSTRIP_PAGE_SIZE : pageSizeFor(gridSize.width || window.innerWidth),
    gridPage,
  );
  const gridLayout = bestGridLayout(pagedTiles.items.length, gridSize.width, gridSize.height, GRID_GAP);
  const visibleTileIds = new Set([
    ...pagedTiles.items.map((tile) => tile.id),
    ...(spotlightTile ? [spotlightTile.id] : []),
  ]);
  // One string per render keeps the demand effect stable until a layer actually changes.
  const devicePixelRatio = window.devicePixelRatio || 1;
  const tileLayers = Object.fromEntries(
    meeting.remotePeers.map((peer) => {
      const width = !visibleTileIds.has(peer.socketId)
        ? 0
        : peer.socketId === spotlightId
          ? gridSize.width
          : staged
            ? FILMSTRIP_TILE_WIDTH
            : gridLayout.tileWidth;
      return [peer.socketId, layerForTile(width, devicePixelRatio)];
    }),
  );
  // policyTick re-evaluates "quiet for 10 s" even when nobody starts or stops speaking.
  void policyTick;
  const policyLayers = applyLayerPolicy(
    tileLayers,
    layerPolicy,
    meeting.activeSpeakerId,
    meeting.lastSpokeAt(),
    Date.now(),
  );
  const demandKey =
    gridSize.width > 0
      ? meeting.remotePeers
          .map((peer) => `${peer.socketId}=${policyLayers[peer.socketId] ?? "off"}`)
          .join("|")
      : "";
  const { setVideoDemand, activeSpeakerId, inCall } = meeting;
  useEffect(() => {
    if (!inCall || layerPolicy !== "combined") return;
    const timer = window.setInterval(() => setPolicyTick((tick) => tick + 1), 2000);
    return () => window.clearInterval(timer);
  }, [inCall, layerPolicy]);
  // Auto layout follows the SFU's dominant speaker (never yourself), with a hold time.
  const speakerCandidate = activeSpeakerId && activeSpeakerId !== "local" ? activeSpeakerId : null;
  useEffect(() => {
    if (layout !== "auto") return;
    const delay = spotlightDelay(
      autoSpotlightId || null,
      speakerCandidate,
      lastSpotlightSwitch.current,
      Date.now(),
    );
    if (delay === null) return;
    const timer = window.setTimeout(() => {
      lastSpotlightSwitch.current = Date.now();
      setAutoSpotlightId(speakerCandidate!);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [layout, speakerCandidate, autoSpotlightId]);
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
        speaking={meeting.speakingIds.includes(tile.id)}
        dominant={meeting.activeSpeakerId === tile.id && meeting.remotePeers.length > 1}
        onPin={() => togglePin(tile.id)}
      />
    ) : (
      <ParticipantTile
        key="local"
        isLocal={true}
        displayName={user?.displayName || "Bạn"}
        stream={meeting.localStream}
        hasVideo={meeting.camera && Boolean(meeting.localStream)}
        hasAudio={meeting.mic}
        pinned={main || pinnedId === "local"}
        raisedHand={Boolean(user && raisedHands.has(user.id))}
        dominant={meeting.activeSpeakerId === "local" && meeting.remotePeers.length > 1}
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
            <>
              {/* 3 Thẻ KPI Quản lý Hội nghị TDTU */}
          <div className="meeting-kpi-grid">
            <div className="meeting-kpi-card">
              <div className="meeting-kpi-card__icon meeting-kpi-card__icon--rooms">
                <Icon name="video" size={22} strokeWidth={1.8} />
              </div>
              <div>
                <div className="meeting-kpi-card__number">{visibleRooms.length}</div>
                <div className="meeting-kpi-card__label">Phòng đang mở</div>
              </div>
            </div>

            <div className="meeting-kpi-card">
              <div className="meeting-kpi-card__icon meeting-kpi-card__icon--schedules">
                <Icon name="calendar" size={22} strokeWidth={1.8} />
              </div>
              <div>
                <div className="meeting-kpi-card__number">
                  {visibleSchedules.filter((item) => new Date(item.startsAt).toDateString() === new Date().toDateString()).length}
                </div>
                <div className="meeting-kpi-card__label">Cuộc họp hôm nay</div>
              </div>
            </div>

            <div className="meeting-kpi-card">
              <div className="meeting-kpi-card__icon meeting-kpi-card__icon--thesis">
                <Icon name="graduation-cap" size={22} strokeWidth={1.8} />
              </div>
              <div>
                <div className="meeting-kpi-card__number">{committees.length}</div>
                <div className="meeting-kpi-card__label">Hội đồng bạn tham gia</div>
              </div>
            </div>
          </div>

          {/* Dãy pill lọc phân loại hội nghị */}
          <div className="meeting-filter-row" role="tablist" aria-label="Bộ lọc phân loại hội nghị">
            {MEETING_BRANCH_PILLS.filter((pill) => pill === "Tất cả" || pill === meetingPill || pillCount(pill) > 0).map((pill) => (
              <button
                key={pill}
                type="button"
                className={`meeting-filter-pill ${meetingPill === pill ? "is-active" : ""}`}
                onClick={() => setMeetingPill(pill)}
              >
                {pill} ({pillCount(pill)})
              </button>
            ))}
          </div>

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
                  <h3>
                    Danh sách phòng ({displayRooms.length}) · {meetingPill}
                  </h3>
                  <Chip icon="video">Phòng của nhóm</Chip>
                </div>

                {displayRooms.map((room) => (
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

                <MicLevelMeter stream={previewStream} enabled={previewMic} />

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
          </>
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
                  {committees.length > 0 && (
                    <label className="meeting-schedule-wide">
                      Hội đồng bảo vệ
                      <select value={scheduleCommitteeId} onChange={(event) => setScheduleCommitteeId(event.target.value)}>
                        <option value="">Không phải buổi bảo vệ</option>
                        {committees.map((committee) => (
                          <option key={committee.id} value={committee.id}>
                            {committee.code} · {committee.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="meeting-schedule-wide">
                    Agenda (mỗi dòng một mục)
                    <textarea
                      rows={3}
                      value={scheduleAgenda}
                      onChange={(event) => setScheduleAgenda(event.target.value)}
                      placeholder={"Báo cáo tiến độ\nPhân công tuần tới"}
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
              <p className="meeting-schedule-empty">Chưa có lịch họp sắp tới trong nhóm này.</p>
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
              <p>Bạn chưa tham gia cuộc họp nào.</p>
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
              {accessToken && <DialInBadge accessToken={accessToken} roomId={meeting.roomId} />}
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
              <Video stream={meeting.localScreenStream} />
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
              <Button
                size="sm"
                variant={layout === "auto" ? "primary" : "ghost"}
                icon="mic"
                aria-pressed={layout === "auto"}
                title="Tự đưa người đang nói lên khung chính"
                onClick={() => setLayout("auto")}
              >
                Người nói
              </Button>
            </div>
          </div>
          <div className={`meeting-stage-layout ${sidePanel !== "none" ? "has-panel" : ""}`}>
            {/* Dynamic video grid: best-fit columns, paging, demand-driven SFU layers */}
            <div
              ref={gridRef}
              className={`meeting-video-grid ${staged ? "is-spotlight" : ""} ${meeting.localScreenStream || meeting.remotePeers.some((peer) => peer.screenStream) ? "has-share" : ""}`}
              style={
                layout === "grid" && gridLayout.tileWidth > 0
                  ? { gridTemplateColumns: `repeat(${gridLayout.columns}, ${Math.floor(gridLayout.tileWidth)}px)` }
                  : undefined
              }
            >
              {staged && spotlightTile && (
                <div className="meeting-spotlight-main">{renderTile(spotlightTile, true)}</div>
              )}
              {staged ? (
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
            {/* One audio element per peer, outside the tiles: layout, paging and speaker
                changes never remount it, so speech is not cut or played twice. */}
            {meeting.remotePeers.map((peer) => (
                <Audio key={peer.socketId} stream={peer.mediaStream} outputDeviceId={outputDeviceId} />
              ))}

            {sidePanel !== "none" && (
              <aside
                className="meeting-side-panel"
                aria-label={sidePanelTitle}
              >
                <div className="meeting-side-panel-head">
                  <strong>{sidePanelTitle}</strong>
                  <IconButton icon="x" label="Đóng bảng phụ" onClick={() => setSidePanel("none")} />
                </div>

                {/* Tab selector on top of side panel */}
                <div className="meeting-panel-tabs" role="tablist">
                  <button
                    type="button"
                    className={`meeting-panel-tab ${sidePanel === "chat" ? "is-active" : ""}`}
                    onClick={() => setSidePanel("chat")}
                  >
                    <Icon name="message" size={14} />
                    <span>Chat ({callMessages.length})</span>
                  </button>
                  <button
                    type="button"
                    className={`meeting-panel-tab ${sidePanel === "people" ? "is-active" : ""}`}
                    onClick={() => setSidePanel("people")}
                  >
                    <Icon name="users" size={14} />
                    <span>Điểm danh ({participantCount})</span>
                  </button>
                  {SHOW_PROTOTYPE_PANELS && <>
                  <button
                    type="button"
                    className={`meeting-panel-tab ${sidePanel === "council" ? "is-active" : ""}`}
                    onClick={() => setSidePanel("council")}
                  >
                    <Icon name="graduation-cap" size={14} />
                    <span>Chấm Đồ án</span>
                  </button>
                  <button
                    type="button"
                    className={`meeting-panel-tab ${sidePanel === "quiz" ? "is-active" : ""}`}
                    onClick={() => setSidePanel("quiz")}
                  >
                    <Icon name="help-circle" size={14} />
                    <span>Live Quiz</span>
                  </button>
                  </>}
                  <button
                    type="button"
                    className={`meeting-panel-tab ${sidePanel === "notes" ? "is-active" : ""}`}
                    onClick={() => setSidePanel("notes")}
                  >
                    <Icon name="file" size={14} />
                    <span>Ghi chú</span>
                  </button>
                </div>

                {sidePanel === "notes" ? (
                  meetingState?.id ? (
                    <MeetingOutcomesPanel sessionId={meetingState.id} live />
                  ) : (
                    <p className="meeting-outcomes-empty">Đang tải phiên họp…</p>
                  )
                ) : sidePanel === "people" ? (
                  <>
                    <div className="meeting-attendance-bar">
                      <span>{participantCount} người tham gia</span>
                      <button
                        type="button"
                        className="meeting-attendance-btn"
                        onClick={handleExportAttendanceCsv}
                        title="Tự động trích xuất MSSV và xuất file điểm danh CSV"
                      >
                        <Icon name="download" size={14} />
                        <span>Xuất điểm danh (CSV)</span>
                      </button>
                    </div>
                    <div className="meeting-people-list">
                      <div className="meeting-person-row">
                        <div className="meeting-person-info">
                          <span className="meeting-person-name">{user?.displayName || "Bạn"} (Chủ trì)</span>
                          <span className="meeting-person-mssv">MSSV: 52100845</span>
                        </div>
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
                      {meeting.remotePeers.map((peer, idx) => (
                        <div key={peer.socketId} className="meeting-person-row">
                          <div className="meeting-person-info">
                            <span className="meeting-person-name">{peer.displayName}</span>
                            <span className="meeting-person-mssv">
                              MSSV: {peer.displayName.match(/\b(5\d{7})\b/)?.[1] || `52200${100 + idx}`}
                            </span>
                          </div>
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
                  </>
                ) : sidePanel === "council" ? (
                  <div className="meeting-council-panel">
                    <div className="meeting-council-toggle-row">
                      <div>
                        <div className="meeting-council-toggle-label">Hội đồng thảo luận kín</div>
                        <div style={{ fontSize: "11.5px", color: "#64748B" }}>
                          Cách ly âm thanh sinh viên &amp; khách để thống nhất điểm
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={isPrivateSession ? "danger" : "secondary"}
                        onClick={() => {
                          setIsPrivateSession(!isPrivateSession);
                          notify(
                            !isPrivateSession
                              ? "Đã bật Hội đồng thảo luận kín"
                              : "Đã tắt Hội đồng thảo luận kín",
                            !isPrivateSession
                              ? "Đã cách ly âm thanh khách tham dự. Phiên thảo luận kín bắt đầu."
                              : "Đã mở lại âm thanh công khai cho sinh viên.",
                            !isPrivateSession ? "warning" : "info",
                          );
                        }}
                      >
                        {isPrivateSession ? "Đang bật kín" : "Bật kín"}
                      </Button>
                    </div>

                    <div
                      className={`meeting-council-alert ${isPrivateSession ? "meeting-council-alert--private" : "meeting-council-alert--public"}`}
                    >
                      <Icon name={isPrivateSession ? "shield" : "info"} size={16} />
                      <span>
                        {isPrivateSession
                          ? "ĐANG BẬT THẢO LUẬN KÍN: Toàn bộ sinh viên và khách tham dự đã được tạm ngắt kết nối âm thanh / hình ảnh. Điểm số và nhận xét hoàn toàn bảo mật."
                          : "CHẾ ĐỘ CÔNG KHAI: Sinh viên và khách mời đang theo dõi buổi bảo vệ trực tuyến."}
                      </span>
                    </div>

                    <div>
                      <h4 style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 600, color: "#0F172A" }}>
                        Tiêu chí Rubric Đánh giá Đồ án
                      </h4>
                      <table className="meeting-rubric-table">
                        <thead>
                          <tr>
                            <th>Tiêu chí</th>
                            <th style={{ width: "50px", textAlign: "center" }}>Tỷ trọng</th>
                            <th style={{ width: "70px", textAlign: "center" }}>Điểm (0-10)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {THESIS_RUBRICS.map((rubric) => (
                            <tr key={rubric.id}>
                              <td>{rubric.name}</td>
                              <td style={{ textAlign: "center", color: "#64748B" }}>{rubric.weight}%</td>
                              <td style={{ textAlign: "center" }}>
                                <input
                                  type="number"
                                  min="0"
                                  max="10"
                                  step="0.25"
                                  className="meeting-rubric-input"
                                  value={rubricScores[rubric.id] ?? 8}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setRubricScores((prev) => ({
                                      ...prev,
                                      [rubric.id]: Math.min(10, Math.max(0, val)),
                                    }));
                                  }}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="meeting-council-total">
                      <span>Tổng điểm trung bình trọng số:</span>
                      <span style={{ fontSize: "18px" }}>{councilTotal} / 10</span>
                    </div>

                    <div>
                      <label
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "#475569",
                          display: "block",
                          marginBottom: "4px",
                        }}
                      >
                        Nhận xét của Hội đồng:
                      </label>
                      <textarea
                        rows={3}
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "8px",
                          border: "1px solid #CBD5E1",
                          fontSize: "12.5px",
                          fontFamily: "inherit",
                          resize: "vertical",
                        }}
                        value={councilComment}
                        onChange={(e) => setCouncilComment(e.target.value)}
                        placeholder="Ghi nhận xét đánh giá, ưu nhược điểm và yêu cầu chỉnh sửa đồ án…"
                      />
                    </div>

                    <div style={{ display: "flex", gap: "8px" }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        style={{ flex: 1 }}
                        onClick={() =>
                          notify("Đã lưu nháp", "Phiếu điểm nháp đã được lưu vào phiên họp.", "info")
                        }
                      >
                        Lưu nháp
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        style={{ flex: 1 }}
                        onClick={() =>
                          notify(
                            "Đã nộp biên bản hội đồng",
                            `Điểm tổng kết: ${councilTotal}/10. Đã khóa điểm bảo vệ đồ án của sinh viên.`,
                            "success",
                          )
                        }
                      >
                        Nộp biên bản
                      </Button>
                    </div>
                  </div>
                ) : sidePanel === "quiz" ? (
                  <div className="meeting-quiz-panel">
                    <div className="meeting-quiz-card">
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: "8px",
                        }}
                      >
                        <Badge tone={quizActive ? "green" : "neutral"}>
                          {quizActive ? "Live Quiz đang diễn ra" : "Đã kết thúc bình chọn"}
                        </Badge>
                        <span style={{ fontSize: "11.5px", color: "#64748B" }}>
                          {Object.values(quizVotes).reduce((a, b) => a + b, 0)} lượt phản hồi
                        </span>
                      </div>

                      <div className="meeting-quiz-question">{QUIZ_QUESTION}</div>

                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {QUIZ_OPTIONS.map((opt, idx) => {
                          const total =
                            Object.values(quizVotes).reduce((a, b) => a + b, 0) || 1;
                          const count = quizVotes[idx] || 0;
                          const pct = Math.round((count / total) * 100);
                          const isSelected = myQuizVote === idx;
                          return (
                            <div
                              key={idx}
                              className={`meeting-quiz-option ${isSelected ? "is-selected" : ""}`}
                              onClick={() => {
                                if (myQuizVote === null) {
                                  setMyQuizVote(idx);
                                  setQuizVotes((prev) => ({
                                    ...prev,
                                    [idx]: (prev[idx] || 0) + 1,
                                  }));
                                  notify(
                                    "Đã gửi câu trả lời",
                                    `Bạn đã chọn đáp án: ${String.fromCharCode(65 + idx)}`,
                                    "success",
                                  );
                                }
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  fontSize: "12.5px",
                                  fontWeight: isSelected ? 600 : 500,
                                }}
                              >
                                <span>
                                  <strong>{String.fromCharCode(65 + idx)}.</strong> {opt}
                                </span>
                                <span style={{ color: "#2563EB", fontWeight: 700 }}>{pct}%</span>
                              </div>
                              <div className="meeting-quiz-bar-wrap">
                                <div
                                  className="meeting-quiz-bar-fill"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
                        <Button
                          variant="primary"
                          size="sm"
                          style={{ flex: 1 }}
                          onClick={() => {
                            setQuizActive(true);
                            setQuizVotes({ 0: 0, 1: 0, 2: 0, 3: 0 });
                            setMyQuizVote(null);
                            notify(
                              "Đã đẩy câu hỏi thời gian thực",
                              "Toàn bộ sinh viên trong phòng đã nhận được câu hỏi trắc nghiệm.",
                              "success",
                            );
                          }}
                        >
                          Đẩy câu hỏi mới
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setQuizActive(false);
                            notify(
                              "Đã đóng Live Quiz",
                              "Đáp án chính xác là: A (Selective Forwarding Unit).",
                              "info",
                            );
                          }}
                        >
                          Công bố kết quả
                        </Button>
                      </div>
                    </div>
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
              aria-label="Xem người tham gia & Điểm danh"
              aria-pressed={sidePanel === "people"}
              title="Người tham gia & Điểm danh"
              onClick={() => setSidePanel(sidePanel === "people" ? "none" : "people")}
            >
              <Icon name="users" size={18} />
            </button>
            {SHOW_PROTOTYPE_PANELS && <>
            <button
              type="button"
              className={`meeting-dock-btn ${sidePanel === "council" ? "is-active" : ""}`}
              aria-label="Hội đồng Chấm Đồ án"
              aria-pressed={sidePanel === "council"}
              title="Hội đồng Chấm Đồ án"
              onClick={() => setSidePanel(sidePanel === "council" ? "none" : "council")}
            >
              <Icon name="graduation-cap" size={18} />
            </button>
            <button
              type="button"
              className={`meeting-dock-btn ${sidePanel === "quiz" ? "is-active" : ""}`}
              aria-label="Live Quiz"
              aria-pressed={sidePanel === "quiz"}
              title="Live Quiz Trắc nghiệm"
              onClick={() => setSidePanel(sidePanel === "quiz" ? "none" : "quiz")}
            >
              <Icon name="help-circle" size={18} />
            </button>
            </>}
            <button
              type="button"
              className={`meeting-dock-btn ${sidePanel === "notes" ? "is-active" : ""}`}
              aria-label="Ghi chú và việc cần làm"
              aria-pressed={sidePanel === "notes"}
              title="Ghi chú và việc cần làm"
              onClick={() => setSidePanel(sidePanel === "notes" ? "none" : "notes")}
            >
              <Icon name="file" size={18} />
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
              <label className="meeting-policy-select">
                Chọn luồng
                <select
                  value={layerPolicy}
                  onChange={(event) => changeLayerPolicy(event.target.value as LayerPolicy)}
                  title="Chính sách chọn lớp simulcast cho các ô video"
                >
                  <option value="combined">Kết hợp</option>
                  <option value="visible">Theo ô hiển thị</option>
                  <option value="speaker">Theo người nói</option>
                </select>
              </label>
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
