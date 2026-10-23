import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MeetingState } from "@doan/shared";
import type { ChatMessageItem, WorkspaceItem } from "@doan/shared";
import { getChannelsApi, getMessagesApi, getWorkspacesApi } from "../chat/api";
import { getDialInApi, downloadMeetingAttendanceApi } from "./api";
import { MeetingsCalendar } from "./MeetingsCalendar";
import { useApp } from "../../app/providers/AppContext";
import { useMeeting, type RemotePeer } from "../../app/providers/MeetingContext";
import { bestGridLayout, layerForTile, pageSizeFor, paginate } from "./grid-layout";
import {
  applyLayerPolicy,
  isLayerPolicy,
  spotlightDelay,
  type LayerPolicy,
} from "./speaker-policy";
import { handToastTitle, newAttention, raisedHandUserIds } from "./hand-raise";
import { MeetingControls, useMeetingControl } from "./MeetingControls";
import { MeetingOutcomesPanel } from "./MeetingOutcomesPanel";
import { PreJoinScreen, type PreJoinChoice } from "./PreJoinScreen";
import { useSocket } from "../../app/providers/SocketContext";
import { Avatar, Button, IconButton, ConfirmDialog } from "../../shared/ui/Primitives";
import { AnimatePresence } from "motion/react";
import { meetingShortcut } from "../../shared/lib/interaction";
import { Icon, type IconName } from "../../shared/ui/Icon";
import "./meeting-ui.css";
import "./meeting-panels.css";

type Room = {
  id: string;
  name: string;
  workspace: string;
  workspaceId: string;
  role: WorkspaceItem["role"];
};

/** Room filters from real data: schedules and the user's role in the group. */
const NETWORK_CAP_LABEL: Record<string, string> = {
  2: "Tốt (theo ô hiển thị)",
  1: "Đã hạ xuống trung bình (mạng yếu)",
  0: "Đã hạ xuống thấp (mạng yếu)",
  null: "Chỉ âm thanh (mạng rất yếu)",
};

// Video elements never play sound: remote audio plays once, from the stable <Audio> list in the room.
/** A student number (8 digits starting with 5) when the display name carries one. */
const studentIdOf = (name: string) => name.match(/\b(5\d{7})\b/)?.[1] ?? "";

/** Header network state from the latest QoS sample. */
function networkTone(rtt: number | null | undefined, loss: number | null | undefined, connected: boolean) {
  if (!connected) return "bad";
  return (rtt ?? 0) > 300 || (loss ?? 0) > 5 ? "weak" : "good";
}

function MeetingClock({ since }: { since: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const total = Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    <time className="meeting-topbar__clock">
      {total >= 3600 ? `${Math.floor(total / 3600)}:` : ""}
      {pad(Math.floor(total / 60) % 60)}:{pad(total % 60)}
    </time>
  );
}

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
    <span className="meeting-topbar__meta" title={`Từ máy lẻ: gọi ${dialIn.number}, nhập mã ${dialIn.code} rồi nhấn #`}>
      <Icon name="phone" size={14} /> Gọi {dialIn.number} · mã {code}
    </span>
  );
}

type MenuItem =
  | { heading: string }
  | { label: string; onSelect: () => void; icon?: IconName; checked?: boolean; danger?: boolean };

/** A small menu that opens above (control bar) or below (people list) its round button. */
function PopoverMenu({
  label,
  icon,
  items,
  buttonClass,
  placement = "up",
}: {
  label: string;
  icon: IconName;
  items: MenuItem[];
  buttonClass: string;
  placement?: "up" | "down";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="meeting-menu" ref={ref}>
      <button
        type="button"
        className={buttonClass}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name={icon} size={18} />
      </button>
      {open && (
        <div className={`meeting-menu__list is-${placement}`} role="menu" aria-label={label}>
          {items.map((item, index) =>
            "heading" in item ? (
              <div key={index} className="meeting-menu__heading" role="presentation">
                {item.heading}
              </div>
            ) : (
              <button
                key={index}
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={item.checked}
                className={`meeting-menu__item ${item.danger ? "is-danger" : ""}`}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon && <Icon name={item.icon} size={16} />}
                <span>{item.label}</span>
                {item.checked && <Icon name="check" size={14} className="meeting-menu__check" />}
              </button>
            ),
          )}
        </div>
      )}
    </div>
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
        <div className="participant-visual">
          <Avatar name={displayName} size="lg" />
        </div>
      )}
      {onPin && (
        <button
          type="button"
          className="meeting-pin"
          onClick={onPin}
          aria-label={pinned ? `Bỏ ghim ${displayName}` : `Ghim ${displayName}`}
          title={pinned ? "Bỏ ghim" : "Ghim người tham gia"}
        >
          <Icon name="pin" size={14} />
        </button>
      )}
      {raisedHand && (
        <span className="participant-hand" role="img" aria-label="Đang giơ tay" title="Đang giơ tay">
          <Icon name="hand" size={14} />
        </span>
      )}
      <div className="participant-label">
        {!hasAudio && <Icon name="mic-off" size={13} className="participant-label__muted" aria-label="Micro đang tắt" />}
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
  const { accessToken, user, notify, route, navigate, openChannel } = useApp();
  const meeting = useMeeting();
  const { isConnected, socket, joinChannel, leaveChannel, sendMessage } = useSocket();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [groups, setGroups] = useState<WorkspaceItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [exportingAttendance, setExportingAttendance] = useState(false);
  const [error, setError] = useState("");
  const [outputDeviceId, setOutputDeviceId] = useState("");
  // Devices chosen before joining, reused when the waiting room lets the user in.
  const joinChoice = useRef<PreJoinChoice | null>(null);
  // Leaving or being removed returns to the calendar; a dropped call (interrupted) stays to rejoin.
  const wasInCall = useRef(false);
  useEffect(() => {
    if (wasInCall.current && !meeting.inCall && !meeting.interruptedRoomId && route.view === "meetings")
      navigate({ view: "meetings", workspaceId: route.workspaceId }, true);
    wasInCall.current = meeting.inCall;
  }, [meeting.inCall, meeting.interruptedRoomId]);
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
  const [sidePanel, setSidePanel] = useState<"none" | "people" | "chat" | "notes" | "network">("none");

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
      ? "Mọi người"
      : sidePanel === "notes"
        ? "Biên bản cuộc họp"
        : sidePanel === "network"
          ? "Chất lượng mạng"
          : "Chat cuộc họp";
  useEffect(() => {
    const list = callListRef.current;
    if(sidePanel === "chat") {
      setCallUnread(0);
      if(list && followCallChat.current) list.scrollTop = list.scrollHeight;
    }
  },[callMessages,sidePanel]);
  const control = useMeetingControl(meeting.inCall ? meeting.roomId : "");
  const meetingState = control.state;
  const participantCount = control.admitted.length || meeting.remotePeers.length + 1;
  // Corner toasts: someone waits to be let in (hosts only) or raises a hand.
  const previousState = useRef<MeetingState | null>(null);
  useEffect(() => {
    const { waiting, hands } = newAttention(previousState.current, meetingState, user?.id);
    previousState.current = meetingState;
    if (control.canManage)
      for (const person of waiting)
        notify(`${person.displayName} đang chờ vào phòng`, undefined, "info", {
          label: "Cho vào",
          onClick: () => void control.action("admit", person.userId),
        });
    for (const person of hands) notify(`${person.displayName} đang giơ tay`, undefined, "info", undefined, { icon: "hand" });
  }, [meetingState]);
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
    if (meeting.sharing || control.isHost) setLeaveConfirm(true);
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
      if (key === "h" && control.me) void control.action("hand", undefined, !control.me.raisedHand);
    };
    document.addEventListener("keydown",onKey);
    return () => document.removeEventListener("keydown",onKey);
  },[meeting,control]);
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
        if (mounted) setGroups(workspaces);
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

  const selected = rooms.find((room) => room.id === route.channelId);

  // The register comes from the server (join/leave of every connection); only the host and co-hosts keep it.
  const keepsRegister = control.canManage;
  const handleExportAttendanceCsv = async () => {
    if (!accessToken || !meetingState) return;
    setExportingAttendance(true);
    try {
      await downloadMeetingAttendanceApi(accessToken, meetingState.id, `diem-danh-${meetingState.startedAt.slice(0, 10)}.csv`);
      notify("Đã xuất điểm danh", "Giờ vào, giờ rời và thời gian có mặt của từng người trong phiên họp.", "success");
    } catch (failure) {
      notify("Không xuất được điểm danh", failure instanceof Error ? failure.message : "Hãy thử lại.", "warning");
    } finally {
      setExportingAttendance(false);
    }
  };

  useEffect(() => {
    if (meeting.interruptedRoomId && rooms.some((room) => room.id === meeting.interruptedRoomId)) {
      const room = rooms.find((item) => item.id === meeting.interruptedRoomId);
      if (room) openChannel(room.workspaceId, room.id, true);
    }
  }, [meeting.interruptedRoomId, rooms]);

  async function enterRoom(roomId: string, scheduleId = route.scheduleId, choice = joinChoice.current) {
    setJoining(true);
    setError("");
    joinChoice.current = choice;
    try {
      localStorage.setItem("meeting:lastWorkspace", rooms.find((item) => item.id === roomId)?.workspaceId ?? "");
    } catch {
      // Storage may be blocked; "Họp ngay" then starts from the first group.
    }
    if (choice) setOutputDeviceId(choice.outputDeviceId);
    try {
      const room = rooms.find((item) => item.id === roomId);
      if (room)
        navigate({
          view: "meetings",
          workspaceId: room.workspaceId,
          channelId: room.id,
          scheduleId,
        });
      await meeting.joinCall(roomId, choice ?? undefined, scheduleId);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể vào phòng họp.");
      return false;
    } finally {
      setJoining(false);
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
  const roomName = rooms.find((room) => room.id === meeting.roomId)?.name ?? "Phòng họp trực tuyến";
  const tone = networkTone(meeting.qos?.rtt, meeting.qos?.packetLoss, isConnected);
  const networkLabel = !isConnected
    ? "Mất kết nối"
    : meeting.qos?.rtt != null
      ? `${tone === "good" ? "Mạng tốt" : "Mạng yếu"} · ${meeting.qos.rtt} ms`
      : "Đang đo mạng…";
  const waitingPeople = meetingState?.participants.filter((p) => p.state === "waiting") ?? [];
  // Who is in the room: the server register when loaded, else the media peers.
  const roster = (
    control.admitted.length
      ? control.admitted.map((p) => ({ userId: p.userId, displayName: p.displayName, role: p.role, raisedHand: p.raisedHand }))
      : [
          { userId: user?.id ?? "local", displayName: user?.displayName || "Bạn", role: "member" as const, raisedHand: false },
          ...meeting.remotePeers.map((peer) => ({ userId: peer.userId, displayName: peer.displayName, role: "member" as const, raisedHand: false })),
        ]
  ).map((person) => {
    const isMe = person.userId === user?.id;
    const peer = meeting.remotePeers.find((item) => item.userId === person.userId);
    return { ...person, isMe, tileId: isMe ? "local" : (peer?.socketId ?? ""), micOn: isMe ? meeting.mic : Boolean(peer?.audioTrack) };
  });
  const personMenu = (person: (typeof roster)[number]): MenuItem[] => {
    const items: MenuItem[] = [];
    if (person.tileId)
      items.push({ label: pinnedId === person.tileId ? "Bỏ ghim" : "Ghim lên khung chính", icon: "pin", onSelect: () => togglePin(person.tileId) });
    if (control.canManage && !person.isMe && person.role !== "host") {
      items.push({
        label: "Tắt micro",
        icon: "mic-off",
        onSelect: () => control.setConfirmation({ name: "mute", target: person.userId, label: "Tắt nguồn mic", description: `Tắt nguồn microphone của ${person.displayName}? Người này phải tự bật lại thiết bị.` }),
      });
      if (control.isHost) {
        items.push({ label: person.role === "cohost" ? "Bỏ đồng chủ trì" : "Đặt làm đồng chủ trì", icon: "user-plus", onSelect: () => void control.action("cohost", person.userId, person.role !== "cohost") });
        items.push({
          label: "Chuyển quyền chủ trì",
          icon: "shield",
          onSelect: () => control.setConfirmation({ name: "transfer", target: person.userId, label: "Chuyển host", description: `Chuyển quyền host cho ${person.displayName}? Bạn sẽ mất quyền host và không thể tự lấy lại quyền.` }),
        });
      }
      items.push({
        label: "Loại khỏi phiên",
        icon: "logout",
        danger: true,
        onSelect: () => control.setConfirmation({ name: "kick", target: person.userId, label: "Loại khỏi phiên", description: `Ngắt kết nối của ${person.displayName} và loại người này khỏi phiên họp hiện tại?` }),
      });
    }
    return items.length ? items : [{ heading: "Không có tùy chọn" }];
  };
  const moreMenu: MenuItem[] = [
    { heading: "Bố cục" },
    { label: "Lưới", icon: "grid", checked: layout === "grid", onSelect: () => setLayout("grid") },
    { label: "Tiêu điểm", icon: "monitor", checked: layout === "spotlight", onSelect: () => setLayout("spotlight") },
    { label: "Người đang nói", icon: "mic", checked: layout === "auto", onSelect: () => setLayout("auto") },
    { heading: "Cuộc họp" },
    { label: "Chất lượng mạng", icon: "activity", onSelect: () => setSidePanel("network") },
    { label: "Biên bản và ghi hình", icon: "record", onSelect: () => setSidePanel("notes") },
    ...(control.canManage && meetingState
      ? ([
          { heading: "Điều hành" },
          { label: meetingState.waitingEnabled ? "Tắt phòng chờ" : "Bật phòng chờ", icon: "clock", onSelect: () => void control.action("waiting", undefined, !meetingState.waitingEnabled) },
          { label: meetingState.locked ? "Mở khóa phòng" : "Khóa phòng", icon: "lock", onSelect: () => void control.action("lock", undefined, !meetingState.locked) },
          ...(control.isHost
            ? [{ label: "Kết thúc cho tất cả", icon: "x" as IconName, danger: true, onSelect: () => control.setConfirmation({ name: "end", label: "Xác nhận kết thúc", description: "Kết thúc phiên này và ngắt media của mọi người?" }) }]
            : []),
        ] as MenuItem[])
      : []),
  ];
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
              onJoin={() => void enterRoom(meeting.waitingRoomId)}
              onCancel={() => void meeting.leaveCall()}
            />
          )}
          {meeting.interruptedRoomId && (
            <div className="meeting-return-notice" role="status">
              Kết nối cuộc họp đã bị ngắt. Hệ thống đang tự vào lại khi mạng ổn định; nếu không được, chọn “Vào phòng”.
            </div>
          )}
          {route.channelId ? (
            selected ? (
              <PreJoinScreen
                key={selected.id}
                room={selected}
                scheduleId={route.scheduleId}
                autoPreview={!meeting.interruptedRoomId}
                joining={joining}
                onJoin={(choice) => enterRoom(selected.id, route.scheduleId, choice)}
                onCancelJoin={() => void meeting.leaveCall()}
                onBack={() => navigate({ view: "meetings", workspaceId: route.workspaceId })}
              />
            ) : loading ? (
              <p role="status" className="loading-note">
                Đang mở phòng họp…
              </p>
            ) : (
              <section className="state-card" role="alert">
                <h3>Không thể mở phòng họp</h3>
                <p>Phòng họp không tồn tại hoặc bạn không có quyền truy cập liên kết này.</p>
                <Button variant="secondary" size="sm" onClick={() => navigate({ view: "meetings" })}>
                  Về lịch họp
                </Button>
              </section>
            )
          ) : (
          <MeetingsCalendar groups={groups} rooms={rooms} />
          )}
        </div>
      ) : (
        /* In-call room: full screen over the app, like Meet or Teams. */
        <div className="meeting-room-active" role="region" aria-label="Phòng họp">
          {!isConnected && (
            <div className="meeting-reconnecting-overlay" role="alert">
              <span className="network-reconnect-dot" />
              <span>Đang gián đoạn kết nối máy chủ · Hệ thống đang tự động khôi phục…</span>
            </div>
          )}

          <header className="meeting-topbar">
            <h2>{roomName}</h2>
            {meetingState?.startedAt && <MeetingClock since={meetingState.startedAt} />}
            <span className="meeting-topbar__meta">
              <Icon name="users" size={14} /> {participantCount}
            </span>
            {meetingState?.locked && (
              <span className="meeting-topbar__meta" title="Phòng đã khóa">
                <Icon name="lock" size={14} /> Đã khóa
              </span>
            )}
            {accessToken && <DialInBadge accessToken={accessToken} roomId={meeting.roomId} />}
            <span className="meeting-topbar__spacer" />
            <button
              type="button"
              className={`meeting-network is-${tone}`}
              aria-pressed={sidePanel === "network"}
              onClick={() => setSidePanel(sidePanel === "network" ? "none" : "network")}
              title={networkLabel}
              aria-label={`Chất lượng mạng: ${networkLabel}`}
            >
              <Icon name={isConnected ? "wifi" : "warning"} size={16} />
            </button>
            <button
              type="button"
              className="meeting-topbar__btn"
              title="Thu nhỏ: làm việc khác, cuộc họp vẫn tiếp tục"
              aria-label="Thu nhỏ cuộc họp"
              onClick={() => navigate({ view: "overview" })}
            >
              <Icon name="minus" size={16} />
            </button>
          </header>

          {control.error && (
            <p className="meeting-controls-alert" role="alert">
              {control.error}
            </p>
          )}
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
              <aside className="meeting-side-panel" aria-label={sidePanelTitle}>
                <div className="meeting-side-panel-head">
                  <strong>{sidePanelTitle}</strong>
                  <IconButton icon="x" label="Đóng bảng phụ" onClick={() => setSidePanel("none")} />
                </div>

                {sidePanel === "notes" ? (
                  meetingState?.id ? (
                    <MeetingOutcomesPanel sessionId={meetingState.id} live />
                  ) : (
                    <p className="meeting-outcomes-empty">Đang tải phiên họp…</p>
                  )
                ) : sidePanel === "network" ? (
                  <div className="meeting-network-panel">
                    <dl className="meeting-network-stats">
                      <div><dt>Độ trễ (RTT)</dt><dd>{meeting.qos?.rtt ?? "—"} ms</dd></div>
                      <div><dt>Băng thông</dt><dd>{meeting.qos?.bitrate ?? "—"} kbps</dd></div>
                      <div><dt>Mất gói</dt><dd>{meeting.qos?.packetLoss ?? "—"}%</dd></div>
                      <div><dt>Jitter</dt><dd>{meeting.qos?.jitter ?? "—"} ms</dd></div>
                    </dl>
                    <p className="meeting-network-cap">
                      Chất lượng nhận: <strong>{NETWORK_CAP_LABEL[String(meeting.networkCap)]}</strong>
                    </p>
                    <label className="meeting-policy-select">
                      Chọn luồng video
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
                    <div className="meeting-network-actions">
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
                ) : sidePanel === "people" ? (
                  <div className="meeting-people">
                    {keepsRegister && (
                      <div className="meeting-attendance-bar">
                        <span>{participantCount} người trong phòng</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="download"
                          disabled={exportingAttendance}
                          onClick={() => void handleExportAttendanceCsv()}
                          title="Giờ vào, giờ rời và thời gian có mặt của từng người (mở được bằng Excel)"
                        >
                          {exportingAttendance ? "Đang xuất…" : "Xuất điểm danh"}
                        </Button>
                      </div>
                    )}
                    {control.canManage && waitingPeople.length > 0 && (
                      <section className="meeting-people__group">
                        <h3>Đang chờ vào ({waitingPeople.length})</h3>
                        {waitingPeople.map((person) => (
                          <div key={person.userId} className="meeting-person-row">
                            <Avatar name={person.displayName} size="sm" />
                            <div className="meeting-person-info">
                              <span className="meeting-person-name">{person.displayName}</span>
                            </div>
                            <Button size="sm" disabled={control.busy} onClick={() => void control.action("admit", person.userId)}>
                              Cho vào
                            </Button>
                          </div>
                        ))}
                      </section>
                    )}
                    <section className="meeting-people__group">
                      <h3>Trong cuộc họp ({participantCount})</h3>
                      {roster.map((person) => (
                        <div key={person.userId} className="meeting-person-row">
                          <Avatar name={person.displayName} size="sm" />
                          <div className="meeting-person-info">
                            <span className="meeting-person-name">
                              {person.displayName}
                              {person.isMe ? " (bạn)" : ""}
                            </span>
                            <span className="meeting-person-mssv">
                              {person.role === "host" ? "Chủ trì" : person.role === "cohost" ? "Đồng chủ trì" : "Thành viên"}
                              {studentIdOf(person.displayName) && ` · MSSV ${studentIdOf(person.displayName)}`}
                            </span>
                          </div>
                          {person.raisedHand && <Icon name="hand" size={16} className="meeting-person-hand" aria-label="Đang giơ tay" />}
                          <Icon
                            name={person.micOn ? "mic" : "mic-off"}
                            size={16}
                            className={person.micOn ? "meeting-person-mic" : "meeting-person-mic is-off"}
                            aria-label={person.micOn ? "Micro đang bật" : "Micro đang tắt"}
                          />
                          <PopoverMenu
                            label={`Tùy chọn cho ${person.displayName}`}
                            icon="more"
                            buttonClass="meeting-person-more"
                            placement="down"
                            items={personMenu(person)}
                          />
                        </div>
                      ))}
                    </section>
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

          {/* Control bar: devices in the middle, panels and leave on the right. */}
          <div className="meeting-controls-dock" role="toolbar" aria-label="Điều khiển cuộc họp">
            <div className="meeting-dock-group meeting-dock-group--left">
              <span className="meeting-dock-room">{roomName}</span>
            </div>
            <div className="meeting-dock-group">
              <button
                type="button"
                className={`meeting-dock-btn ${!meeting.mic ? "is-muted" : ""}`}
                aria-label={meeting.mic ? "Tắt micro" : "Bật micro"}
                aria-pressed={meeting.mic}
                onClick={() => void meeting.toggleMic()}
                title={meeting.mic ? "Tắt micro (M)" : "Bật micro (M)"}
              >
                <Icon name={meeting.mic ? "mic" : "mic-off"} size={20} />
              </button>
              <button
                type="button"
                className={`meeting-dock-btn ${!meeting.camera ? "is-muted" : ""}`}
                aria-label={meeting.camera ? "Tắt camera" : "Bật camera"}
                aria-pressed={meeting.camera}
                onClick={() => void meeting.toggleCamera()}
                title={meeting.camera ? "Tắt camera (V)" : "Bật camera (V)"}
              >
                <Icon name={meeting.camera ? "camera" : "camera-off"} size={20} />
              </button>
              <button
                type="button"
                className={`meeting-dock-btn ${meeting.sharing ? "is-active" : ""}`}
                aria-label={meeting.sharing ? "Dừng chia sẻ màn hình" : "Chia sẻ màn hình"}
                aria-pressed={meeting.sharing}
                onClick={() => void meeting.toggleScreenShare()}
                title={meeting.sharing ? "Dừng chia sẻ màn hình (S)" : "Chia sẻ màn hình (S)"}
              >
                <Icon name="monitor" size={20} />
              </button>
              <button
                type="button"
                className={`meeting-dock-btn ${control.me?.raisedHand ? "is-active" : ""}`}
                aria-label={control.me?.raisedHand ? "Hạ tay" : "Giơ tay"}
                aria-pressed={Boolean(control.me?.raisedHand)}
                aria-keyshortcuts="H"
                disabled={!control.me || control.busy}
                onClick={() => control.me && void control.action("hand", undefined, !control.me.raisedHand)}
                title={control.me?.raisedHand ? "Hạ tay (H)" : "Giơ tay (H)"}
              >
                <Icon name="hand" size={20} />
              </button>
              <PopoverMenu label="Tùy chọn khác" icon="more" buttonClass="meeting-dock-btn" items={moreMenu} />
              <button
                type="button"
                className="meeting-dock-btn is-leave"
                aria-label="Rời khỏi phòng họp"
                onClick={requestLeave}
                title="Rời khỏi phòng họp"
              >
                <Icon name="phone" size={20} />
              </button>
            </div>
            <div className="meeting-dock-group meeting-dock-group--right">
              <button
                type="button"
                className={`meeting-dock-btn is-plain ${sidePanel === "people" ? "is-active" : ""}`}
                aria-label="Mọi người"
                aria-pressed={sidePanel === "people"}
                title="Mọi người"
                onClick={() => setSidePanel(sidePanel === "people" ? "none" : "people")}
              >
                <Icon name="users" size={20} />
                {control.canManage && waitingPeople.length > 0 && (
                  <span className="badge" aria-label={`${waitingPeople.length} người đang chờ`}>{waitingPeople.length}</span>
                )}
              </button>
              <button
                type="button"
                className={`meeting-dock-btn is-plain ${sidePanel === "chat" ? "is-active" : ""}`}
                aria-label="Chat cuộc họp"
                aria-pressed={sidePanel === "chat"}
                title="Chat cuộc họp (C)"
                onClick={() => setSidePanel(sidePanel === "chat" ? "none" : "chat")}
              >
                <Icon name="message" size={20} />
                {callUnread > 0 && <span className="badge" aria-label={`${callUnread} tin nhắn mới`}>{callUnread}</span>}
              </button>
              <button
                type="button"
                className={`meeting-dock-btn is-plain ${sidePanel === "notes" ? "is-active" : ""}`}
                aria-label="Biên bản cuộc họp"
                aria-pressed={sidePanel === "notes"}
                title="Biên bản: chương trình, ghi chú, việc cần làm, ghi hình"
                onClick={() => setSidePanel(sidePanel === "notes" ? "none" : "notes")}
              >
                <Icon name="file" size={20} />
              </button>
            </div>
          </div>
          {control.confirmDialog}
        </div>
      )}
      <AnimatePresence>{leaveConfirm && <ConfirmDialog title="Rời phòng" description={meeting.sharing ? "Bạn đang chia sẻ màn hình. Rời phòng sẽ dừng chia sẻ và ngắt thiết bị của bạn." : "Bạn đang là host. Rời phòng sẽ chuyển quyền host cho người phù hợp; nếu không còn người tham gia, phiên sẽ kết thúc."} confirmLabel="Rời phòng" loading={leaving} onClose={() => setLeaveConfirm(false)} onConfirm={() => {setLeaving(true); void meeting.leaveCall().finally(() => {setLeaving(false);setLeaveConfirm(false);});}} />}</AnimatePresence>
    </div>
  );
}
