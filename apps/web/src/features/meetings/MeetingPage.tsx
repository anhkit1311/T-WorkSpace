import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MeetingState } from "@doan/shared";
import type { ChatMessageItem, WorkspaceItem } from "@doan/shared";
import { getChannelsApi, getMessagesApi, getWorkspacesApi } from "../chat/api";
import { getDialInApi, downloadMeetingAttendanceApi, getMeetingRecordingsApi } from "./api";
import { MeetingsCalendar } from "./MeetingsCalendar";
import { MeetingClock } from "./MeetingClock";
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
import { Button, ConfirmDialog, STATE_CARD } from "../../shared/ui/Primitives";
import { initialsOf, UserAvatar } from "../../shared/ui/kit/user-avatar";
import { cn } from "../../shared/lib/utils";
import { AnimatePresence } from "motion/react";
import { meetingShortcut } from "../../shared/lib/interaction";
import { Icon, type IconName } from "../../shared/ui/Icon";

// The room is dark in both themes, so its chrome uses fixed zinc tones instead of the theme tokens.
const canShareScreen = Boolean(navigator.mediaDevices?.getDisplayMedia);
const ROOM_ICON =
  "grid size-9 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-zinc-300 transition-colors hover:bg-[#27272a] hover:text-white disabled:cursor-default disabled:opacity-50";
const ROOM_ICON_ON = "bg-[#27272a] text-white";
const ROOM_BTN =
  "inline-flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-[#27272a] px-2.5 text-xs font-medium text-zinc-100 transition-colors hover:bg-[#27272a] disabled:cursor-default disabled:opacity-50";
const TILE_BADGE =
  "inline-flex h-[22px] items-center gap-1 rounded-full px-2 text-[11px] font-bold tracking-wider uppercase";
const SHARED_SCREEN =
  "tw relative mx-auto aspect-video max-h-[45vh] overflow-hidden rounded-xl border border-[#27272a] bg-black";
const SHARED_LABEL =
  "absolute top-4 left-4 rounded-full bg-black/75 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur";
const PANEL_HEADING =
  "m-0 px-1.5 pt-2 pb-1 text-xs leading-4 font-semibold tracking-wider text-zinc-400 uppercase";
const PERSON = "flex items-center gap-2.5 rounded-md p-1.5 text-[13.5px]";
const DOCK_BTN =
  "relative grid h-11 min-w-11 shrink-0 cursor-pointer place-items-center rounded-xl border-0 bg-[#1c1c1f] p-0 text-zinc-100 transition-colors hover:bg-[#2a2a2e] disabled:opacity-50";
const DOCK_ON = "bg-[#dbe6ff] text-[#12295e] hover:bg-[#dbe6ff]";
const DOCK_OFF = "bg-[#3a1616] text-[#ff8a8a]";
const DOCK_SPLIT = "flex h-11 shrink-0 items-center rounded-xl bg-[#1c1c1f] text-zinc-100";
const DOCK_SPLIT_MAIN =
  "grid h-11 w-10 cursor-pointer place-items-center rounded-l-xl hover:bg-white/10 disabled:cursor-default disabled:opacity-50";
const DOCK_CHEVRON =
  "grid h-11 w-6 cursor-pointer place-items-center rounded-r-xl border-0 bg-transparent p-0 text-inherit hover:bg-white/10";
const DOCK_BADGE =
  "absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#2f6bff] px-1 text-[11px] font-semibold text-white";

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
function networkTone(
  rtt: number | null | undefined,
  loss: number | null | undefined,
  connected: boolean,
) {
  if (!connected) return "bad";
  return (rtt ?? 0) > 300 || (loss ?? 0) > 5 ? "weak" : "good";
}

function Video({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
    return () => {
      if (ref.current) ref.current.srcObject = null;
    };
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className="size-full object-cover" />;
}

function Audio({
  track,
  outputDeviceId,
}: {
  track: MediaStreamTrack | null;
  outputDeviceId?: string;
}) {
  const { notify } = useApp();
  const notice = useRef(notify);
  notice.current = notify;
  const ref = useRef<HTMLAudioElement>(null);
  // Audio-only stream: camera tracks coming and going must not reload the player mid-sentence.
  useEffect(() => {
    if (ref.current) ref.current.srcObject = track ? new MediaStream([track]) : null;
    return () => {
      if (ref.current) ref.current.srcObject = null;
    };
  }, [track]);
  useEffect(() => {
    if (!outputDeviceId || !ref.current) return;
    const element = ref.current as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    void element
      .setSinkId?.(outputDeviceId)
      .catch(() =>
        notice.current(
          "Không chọn được loa",
          "Âm thanh tiếp tục phát qua thiết bị mặc định. Hãy kiểm tra quyền thiết bị.",
          "warning",
        ),
      );
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

const GRID_GAP = 10;
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
    getDialInApi(accessToken, roomId).then(
      (info) => alive && setDialIn(info),
      () => alive && setDialIn(null),
    );
    return () => {
      alive = false;
    };
  }, [accessToken, roomId]);
  if (!dialIn) return null;
  const code = `${dialIn.code.slice(0, 3)} ${dialIn.code.slice(3)}`;
  return (
    <span
      className="tw inline-flex h-[34px] items-center gap-[7px] rounded-lg border border-zinc-800 px-3 text-xs font-semibold whitespace-nowrap text-zinc-300 max-[1280px]:hidden"
      title={`Từ máy lẻ: gọi ${dialIn.number}, nhập mã ${dialIn.code} rồi nhấn #`}
    >
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
  iconSize = 18,
}: {
  label: string;
  icon: IconName;
  items: MenuItem[];
  buttonClass: string;
  placement?: "up" | "down";
  iconSize?: number;
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
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={buttonClass}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name={icon} size={iconSize} />
      </button>
      {open && (
        <div
          className={cn(
            "tw motion-pop absolute z-[120] flex min-w-[220px] flex-col rounded-xl border border-zinc-800 bg-[#111113] p-1.5 text-zinc-100 shadow-[0_16px_32px_-12px_rgba(0,0,0,.8)]",
            placement === "up"
              ? "bottom-[calc(100%+10px)] left-1/2 -translate-x-1/2"
              : "top-[calc(100%+6px)] right-0",
          )}
          role="menu"
          aria-label={label}
        >
          {items.map((item, index) =>
            "heading" in item ? (
              <div
                key={index}
                className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-[.08em] text-zinc-500 uppercase"
                role="presentation"
              >
                {item.heading}
              </div>
            ) : (
              <button
                key={index}
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={item.checked}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px]",
                  item.danger
                    ? "text-red-400 hover:bg-red-400/15"
                    : "text-zinc-300 hover:bg-zinc-800 hover:text-white",
                )}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon && <Icon name={item.icon} size={16} />}
                <span className="flex-1">{item.label}</span>
                {item.checked && <Icon name="check" size={14} className="text-green-400" />}
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
  host = false,
  speaking,
  dominant = false,
  onPin,
  isMainSpotlight = false,
  strip = false,
}: {
  isLocal: boolean;
  displayName: string;
  stream: MediaStream | null;
  hasVideo: boolean;
  hasAudio: boolean;
  pinned?: boolean;
  raisedHand?: boolean;
  host?: boolean;
  /** Server-side audio level for remote peers; local tiles analyse their own track. */
  speaking?: boolean;
  dominant?: boolean;
  onPin?: () => void;
  isMainSpotlight?: boolean;
  /** A small tile in the filmstrip beside the spotlight. */
  strip?: boolean;
}) {
  const analysed = useAudioActivity(stream, hasAudio && speaking === undefined);
  const isSpeaking = speaking ?? analysed;

  const initials = initialsOf(displayName) || "?";

  return (
    <article
      className={cn(
        "tw group/tile relative overflow-hidden border border-[#27272a] bg-[#1c1c1f] transition-shadow",
        strip
          ? "pointer-events-auto h-[76px] w-[132px] flex-none rounded-lg shadow-[0_8px_20px_-10px_rgba(0,0,0,0.8)]"
          : "aspect-video rounded-xl",
        // The spotlight tile is as large as the stage allows while staying 16:9.
        isMainSpotlight &&
          "h-[min(calc(84vw*9/16),calc(100vh-165px))] max-h-[min(540px,100%)] w-[min(84vw,calc((100vh-165px)*16/9))] max-w-[min(960px,100%)]",
        isSpeaking &&
          "border-emerald-500 shadow-[0_0_0_1px_#10b981,0_0_22px_-2px_rgba(16,185,129,0.65)]",
      )}
      data-dominant={dominant || undefined}
    >
      {hasVideo && stream ? (
        <Video stream={stream} />
      ) : (
        <div className="flex size-full items-center justify-center">
          <div
            className={cn(
              "inline-flex rounded-full border-2 border-transparent transition-colors",
              strip ? "p-0.5" : "p-[3px]",
              isSpeaking && "border-emerald-500",
            )}
          >
            <div
              className={cn(
                "grid place-items-center rounded-full bg-[#2f3a55] font-bold text-[#cfdcff] select-none",
                strip ? "size-[34px] text-sm" : "size-[76px] text-[26px]",
              )}
              title={displayName}
            >
              <span>{initials}</span>
            </div>
          </div>
        </div>
      )}
      {onPin && (
        <button
          type="button"
          className={cn(
            "absolute z-[3] grid size-[30px] cursor-pointer place-items-center rounded-full border border-white/15 transition-opacity group-hover/tile:opacity-100 focus-visible:opacity-100",
            strip ? "top-1 right-1 size-6" : "top-2.5 right-2.5",
            pinned ? "bg-white text-black opacity-100" : "bg-black/60 text-white opacity-0",
          )}
          onClick={onPin}
          aria-label={pinned ? `Bỏ ghim ${displayName}` : `Ghim ${displayName}`}
          title={pinned ? "Bỏ ghim" : "Ghim người tham gia"}
        >
          <Icon name="pin" size={14} />
        </button>
      )}
      {(raisedHand || host) && (
        <span
          className={cn("absolute z-[3] flex gap-1.5", strip ? "top-1 left-1" : "top-2.5 left-2.5")}
        >
          {raisedHand && (
            <span
              className={cn(TILE_BADGE, "bg-amber-500 text-[#3b2504]")}
              role="img"
              aria-label="Đang giơ tay"
              title="Đang giơ tay"
            >
              <Icon name="hand" size={13} /> {!strip && "Giơ tay"}
            </span>
          )}
          {host && !strip && (
            <span className={cn(TILE_BADGE, "bg-black/60 text-emerald-300 backdrop-blur")}>
              Chủ trì
            </span>
          )}
        </span>
      )}
      <div
        className={cn(
          "absolute z-[3] inline-flex items-center gap-1.5 rounded-full bg-black/60 font-semibold text-white backdrop-blur",
          strip
            ? "bottom-1 left-1 h-5 max-w-[calc(100%-8px)] px-[7px] text-[11px]"
            : "bottom-2.5 left-2.5 h-6 max-w-[calc(100%-20px)] px-2.5 text-xs",
        )}
      >
        {!hasAudio && (
          <Icon
            name="mic-off"
            size={13}
            className="shrink-0 text-red-400"
            aria-label="Micro đang tắt"
          />
        )}
        <span className="truncate">
          {displayName} {isLocal ? "(bạn)" : ""}
        </span>
        {isSpeaking && (
          <span
            className="inline-flex shrink-0 items-center gap-0.5"
            title="Đang nói"
            aria-label="Đang nói"
          >
            {["h-[9px]", "h-3.5 [animation-delay:0.18s]", "h-2 [animation-delay:0.36s]"].map(
              (bar) => (
                <span
                  key={bar}
                  className={cn(
                    "w-[3px] rounded-sm bg-emerald-500 motion-safe:animate-[speaking-pulse_0.6s_ease-in-out_infinite_alternate]",
                    bar,
                  )}
                />
              ),
            )}
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
    if (
      wasInCall.current &&
      !meeting.inCall &&
      !meeting.interruptedRoomId &&
      route.view === "meetings"
    )
      navigate({ view: "meetings", workspaceId: route.workspaceId }, true);
    wasInCall.current = meeting.inCall;
  }, [meeting.inCall, meeting.interruptedRoomId]);
  const [layout, setLayout] = useState<"grid" | "spotlight" | "auto">("spotlight");
  const [adminToastDismissed, setAdminToastDismissed] = useState(false);
  const [audioDevices, setAudioDevices] = useState<{ id: string; label: string }[]>([]);
  const [videoDevices, setVideoDevices] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        const mics = devices
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
        const cams = devices
          .filter((d) => d.kind === "videoinput")
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
        setAudioDevices(mics);
        setVideoDevices(cams);
      })
      .catch(() => {});
  }, [meeting.inCall]);

  const handleCopyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      notify("Đã sao chép liên kết", "Đã chép đường dẫn cuộc họp vào bộ nhớ tạm.", "success");
    } catch {
      notify("Liên kết cuộc họp", window.location.href, "info");
    }
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => {});
    } else {
      void document.exitFullscreen().catch(() => {});
    }
  };

  const [layerPolicy, setLayerPolicy] = useState<LayerPolicy>(() => {
    try {
      const saved = localStorage.getItem("tws:layerPolicy");
      return isLayerPolicy(saved) ? saved : "combined";
    } catch {
      return "combined";
    }
  });
  const changeLayerPolicy = (next: LayerPolicy) => {
    setLayerPolicy(next);
    try {
      localStorage.setItem("tws:layerPolicy", next);
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
  const [sidePanel, setSidePanel] = useState<"none" | "people" | "chat" | "notes" | "network">(
    "none",
  );

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
    if (sidePanel === "chat") {
      setCallUnread(0);
      if (list && followCallChat.current)
        list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    }
  }, [callMessages, sidePanel]);
  const control = useMeetingControl(meeting.inCall ? meeting.roomId : "");
  // The host note sits over the speaker's name label; it is a hint, so it leaves on its own.
  useEffect(() => {
    if (!control.canManage || adminToastDismissed) return;
    const timer = window.setTimeout(() => setAdminToastDismissed(true), 6000);
    return () => window.clearTimeout(timer);
  }, [control.canManage, adminToastDismissed]);
  const meetingState = control.state;
  const meetingSessionId = meetingState?.id;
  // REC chip in the top bar: is a recording running in this session?
  const [recording, setRecording] = useState(false);
  const { controlSocket } = meeting;
  useEffect(() => {
    if (!accessToken || !meetingSessionId) return setRecording(false);
    let alive = true;
    const load = () =>
      getMeetingRecordingsApi(accessToken, meetingSessionId).then(
        (data) =>
          alive && setRecording(data.recordings.some((item) => item.status === "recording")),
        () => alive && setRecording(false),
      );
    void load();
    const changed = (change: { sessionId: string; part: string }) => {
      if (change.sessionId === meetingSessionId && change.part === "recording") void load();
    };
    controlSocket?.on("meeting_outcomes_changed", changed);
    return () => {
      alive = false;
      controlSocket?.off("meeting_outcomes_changed", changed);
    };
  }, [accessToken, meetingSessionId, controlSocket]);
  const participantCount = control.admitted.length || meeting.remotePeers.length + 1;
  const panelTabs: [typeof sidePanel, string, number?][] = [
    ["people", "Mọi người", participantCount],
    ["chat", "Chat", callUnread],
    ["notes", "Biên bản"],
  ];
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
    for (const person of hands)
      notify(`${person.displayName} đang giơ tay`, undefined, "info", undefined, { icon: "hand" });
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
      const typing =
        event.target instanceof Element &&
        Boolean(event.target.closest('input,textarea,select,[contenteditable="true"]'));
      const key = meetingShortcut(
        event,
        typing,
        Boolean(document.querySelector('[role="dialog"]')),
      );
      if (!key) return;
      event.preventDefault();
      if (key === "m") void meeting.toggleMic();
      if (key === "v") void meeting.toggleCamera();
      if (key === "s") void meeting.toggleScreenShare();
      if (key === "c") setSidePanel((old) => (old === "chat" ? "none" : "chat"));
      if (key === "escape") setSidePanel("none");
      if (key === "h" && control.me) void control.action("hand", undefined, !control.me.raisedHand);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [meeting, control]);
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
        if (panelRef.current !== "chat" && message.authorId !== user?.id)
          setCallUnread((count) => count + 1);
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
      await downloadMeetingAttendanceApi(
        accessToken,
        meetingState.id,
        `diem-danh-${meetingState.startedAt.slice(0, 10)}.xlsx`,
      );
      notify(
        "Đã xuất điểm danh",
        "Giờ vào, giờ rời và thời gian có mặt của từng người trong phiên họp.",
        "success",
      );
    } catch (failure) {
      notify(
        "Không xuất được điểm danh",
        failure instanceof Error ? failure.message : "Hãy thử lại.",
        "warning",
      );
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

  async function enterRoom(
    roomId: string,
    scheduleId = route.scheduleId,
    choice = joinChoice.current,
  ) {
    setJoining(true);
    setError("");
    joinChoice.current = choice;
    try {
      localStorage.setItem(
        "meeting:lastWorkspace",
        rooms.find((item) => item.id === roomId)?.workspaceId ?? "",
      );
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
  const stripTiles = staged
    ? allTiles.length === 1
      ? allTiles
      : allTiles.filter((tile) => tile.id !== spotlightId)
    : allTiles;
  const pagedTiles = paginate(
    stripTiles,
    staged ? FILMSTRIP_PAGE_SIZE : pageSizeFor(gridSize.width || window.innerWidth),
    gridPage,
  );
  const gridLayout = bestGridLayout(
    pagedTiles.items.length,
    gridSize.width,
    gridSize.height,
    GRID_GAP,
  );
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
      ? control.admitted.map((p) => ({
          userId: p.userId,
          displayName: p.displayName,
          role: p.role,
          raisedHand: p.raisedHand,
        }))
      : [
          {
            userId: user?.id ?? "local",
            displayName: user?.displayName || "Bạn",
            role: "member" as const,
            raisedHand: false,
          },
          ...meeting.remotePeers.map((peer) => ({
            userId: peer.userId,
            displayName: peer.displayName,
            role: "member" as const,
            raisedHand: false,
          })),
        ]
  ).map((person) => {
    const isMe = person.userId === user?.id;
    const peer = meeting.remotePeers.find((item) => item.userId === person.userId);
    return {
      ...person,
      isMe,
      tileId: isMe ? "local" : (peer?.socketId ?? ""),
      micOn: isMe ? meeting.mic : Boolean(peer?.audioTrack),
    };
  });
  const personMenu = (person: (typeof roster)[number]): MenuItem[] => {
    const items: MenuItem[] = [];
    if (person.tileId)
      items.push({
        label: pinnedId === person.tileId ? "Bỏ ghim" : "Ghim lên khung chính",
        icon: "pin",
        onSelect: () => togglePin(person.tileId),
      });
    if (control.canManage && !person.isMe && person.role !== "host") {
      items.push({
        label: "Tắt micro",
        icon: "mic-off",
        onSelect: () =>
          control.setConfirmation({
            name: "mute",
            target: person.userId,
            label: "Tắt nguồn mic",
            description: `Tắt nguồn microphone của ${person.displayName}? Người này phải tự bật lại thiết bị.`,
          }),
      });
      if (control.isHost) {
        items.push({
          label: person.role === "cohost" ? "Bỏ đồng chủ trì" : "Đặt làm đồng chủ trì",
          icon: "user-plus",
          onSelect: () => void control.action("cohost", person.userId, person.role !== "cohost"),
        });
        items.push({
          label: "Chuyển quyền chủ trì",
          icon: "shield",
          onSelect: () =>
            control.setConfirmation({
              name: "transfer",
              target: person.userId,
              label: "Chuyển host",
              description: `Chuyển quyền host cho ${person.displayName}? Bạn sẽ mất quyền host và không thể tự lấy lại quyền.`,
            }),
        });
      }
      items.push({
        label: "Loại khỏi phiên",
        icon: "logout",
        danger: true,
        onSelect: () =>
          control.setConfirmation({
            name: "kick",
            target: person.userId,
            label: "Loại khỏi phiên",
            description: `Ngắt kết nối của ${person.displayName} và loại người này khỏi phiên họp hiện tại?`,
          }),
      });
    }
    return items.length ? items : [{ heading: "Không có tùy chọn" }];
  };
  const moreMenu: MenuItem[] = [
    { heading: "Bố cục" },
    { label: "Lưới", icon: "grid", checked: layout === "grid", onSelect: () => setLayout("grid") },
    {
      label: "Tiêu điểm",
      icon: "monitor",
      checked: layout === "spotlight",
      onSelect: () => setLayout("spotlight"),
    },
    {
      label: "Người đang nói",
      icon: "mic",
      checked: layout === "auto",
      onSelect: () => setLayout("auto"),
    },
    { heading: "Cuộc họp" },
    { label: "Chất lượng mạng", icon: "activity", onSelect: () => setSidePanel("network") },
    { label: "Biên bản và ghi hình", icon: "record", onSelect: () => setSidePanel("notes") },
    ...(control.canManage && meetingState
      ? ([
          { heading: "Điều hành" },
          {
            label: meetingState.waitingEnabled ? "Tắt phòng chờ" : "Bật phòng chờ",
            icon: "clock",
            onSelect: () => void control.action("waiting", undefined, !meetingState.waitingEnabled),
          },
          {
            label: meetingState.locked ? "Mở khóa phòng" : "Khóa phòng",
            icon: "lock",
            onSelect: () => void control.action("lock", undefined, !meetingState.locked),
          },
          ...(control.isHost
            ? [
                {
                  label: "Kết thúc cho tất cả",
                  icon: "x" as IconName,
                  danger: true,
                  onSelect: () =>
                    control.setConfirmation({
                      name: "end",
                      label: "Xác nhận kết thúc",
                      description: "Kết thúc phiên này và ngắt media của mọi người?",
                    }),
                },
              ]
            : []),
        ] as MenuItem[])
      : []),
  ];
  const audioMenuItems: MenuItem[] = [
    { heading: "Microphone" },
    ...(audioDevices.length > 0
      ? audioDevices.map((d) => ({
          label: d.label,
          checked: true,
          onSelect: () => notify("Microphone", `Đang sử dụng: ${d.label}`, "info"),
        }))
      : [{ label: "Microphone mặc định", checked: true, onSelect: () => {} }]),
    { heading: "Cài đặt âm thanh" },
    { label: "Kiểm tra loa & mic", icon: "activity", onSelect: () => setSidePanel("network") },
  ];

  const videoMenuItems: MenuItem[] = [
    { heading: "Camera" },
    ...(videoDevices.length > 0
      ? videoDevices.map((d) => ({
          label: d.label,
          checked: true,
          onSelect: () => notify("Camera", `Đang sử dụng: ${d.label}`, "info"),
        }))
      : [{ label: "Camera mặc định", checked: true, onSelect: () => {} }]),
    { heading: "Cài đặt hình ảnh" },
    { label: "Chất lượng đường truyền", icon: "activity", onSelect: () => setSidePanel("network") },
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
        host={tile.peer.userId === meetingState?.hostId}
        speaking={meeting.speakingIds.includes(tile.id)}
        dominant={meeting.activeSpeakerId === tile.id && meeting.remotePeers.length > 1}
        onPin={() => togglePin(tile.id)}
        isMainSpotlight={main}
        strip={staged && !main}
      />
    ) : (
      <ParticipantTile
        key={main ? "local-main" : "local-filmstrip"}
        isLocal={true}
        displayName={user?.displayName || "Bạn"}
        stream={meeting.localStream}
        hasVideo={meeting.camera && Boolean(meeting.localStream)}
        hasAudio={meeting.mic}
        pinned={main || pinnedId === "local"}
        raisedHand={Boolean(user && raisedHands.has(user.id))}
        host={Boolean(user && user.id === meetingState?.hostId)}
        dominant={meeting.activeSpeakerId === "local" && meeting.remotePeers.length > 1}
        onPin={() => togglePin("local")}
        isMainSpotlight={main}
        strip={staged && !main}
      />
    );

  return (
    <div className="box-border w-full p-(--page-pad)">
      {/* Global Error Notice */}
      {error && (
        <div
          role="alert"
          className="tw mb-4 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13.5px] text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
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
            <div
              className="tw mb-4 flex items-start gap-2.5 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13.5px] text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
              role="status"
            >
              <Icon name="warning" size={16} className="mt-0.5 shrink-0" />
              <span>
                <b className="block font-semibold">Kết nối cuộc họp bị ngắt</b>
                Hệ thống đang tự vào lại khi mạng ổn định; nếu không được, chọn “Vào phòng”.
              </span>
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
              <p role="status" className="tw py-6 text-center text-sm text-muted-foreground!">
                Đang mở phòng họp…
              </p>
            ) : (
              <section className={STATE_CARD} role="alert">
                <h3>Không thể mở phòng họp</h3>
                <p>Phòng họp không tồn tại hoặc bạn không có quyền truy cập liên kết này.</p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate({ view: "meetings" })}
                >
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
        <div
          className="dark fixed inset-0 z-(--z-overlay) flex flex-col gap-3 overflow-hidden bg-[#09090b] px-4 pt-3 pb-[88px] text-zinc-100 [color-scheme:dark] max-md:px-2 max-md:pt-2 max-md:pb-[84px]"
          role="region"
          aria-label="Phòng họp"
        >
          {!isConnected && (
            <div
              className="tw absolute top-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-red-600/90 px-4.5 py-2 text-[13px] font-semibold text-white shadow-lg backdrop-blur"
              role="alert"
            >
              <span className="size-2 rounded-full bg-white motion-safe:animate-pulse" />
              <span>Đang gián đoạn kết nối máy chủ · Hệ thống đang tự động khôi phục…</span>
            </div>
          )}

          <header className="tw relative z-30 flex min-h-[46px] min-w-0 shrink-0 items-center gap-2.5 text-zinc-100 max-md:gap-1.5">
            <h2 className="m-0 truncate text-[15px] leading-5 font-semibold tracking-normal text-zinc-100">
              {roomName}
            </h2>
            {meetingState?.startedAt ? (
              <MeetingClock
                since={meetingState.startedAt}
                className="shrink-0 text-[13px] text-zinc-400 tabular-nums"
              />
            ) : (
              <span className="shrink-0 text-[13px] text-zinc-400 tabular-nums">00:00</span>
            )}
            {recording && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#3a1616] px-2.5 py-0.5 text-xs font-semibold text-[#ff8a8a]">
                <span className="size-[7px] rounded-full bg-red-500 motion-safe:animate-pulse" />
                Đang ghi hình
              </span>
            )}
            <span className="truncate text-[13px] text-zinc-400 max-md:hidden">
              {participantCount} người trong phòng{meetingState?.locked ? " · đã khóa" : ""}
            </span>
            <span className="flex-1" />
            {accessToken && <DialInBadge accessToken={accessToken} roomId={meeting.roomId} />}
            <button
              type="button"
              className={ROOM_ICON}
              // For a host the button locks at once, so it is named by what a click does.
              title={
                control.canManage
                  ? meetingState?.locked
                    ? "Mở khóa phòng"
                    : "Khóa phòng: không cho ai vào thêm"
                  : meetingState?.locked
                    ? "Phòng đã khóa"
                    : "Bảo mật phòng"
              }
              aria-label={
                control.canManage
                  ? meetingState?.locked
                    ? "Mở khóa phòng"
                    : "Khóa phòng"
                  : "Bảo mật phòng"
              }
              aria-pressed={control.canManage ? Boolean(meetingState?.locked) : undefined}
              onClick={() => {
                if (control.canManage && meetingState) {
                  void control.action("lock", undefined, !meetingState.locked);
                } else {
                  notify(
                    "Bảo mật phòng",
                    meetingState?.locked
                      ? "Phòng đang được khóa."
                      : "Phòng đang hoạt động an toàn.",
                    "info",
                  );
                }
              }}
            >
              <Icon name={meetingState?.locked ? "lock" : "shield"} size={17} />
            </button>
            <button
              type="button"
              className={ROOM_ICON}
              title="Thêm người tham gia / Sao chép liên kết"
              aria-label="Thêm người tham gia"
              onClick={handleCopyInviteLink}
            >
              <Icon name="user-plus" size={17} />
            </button>
            <button
              type="button"
              className={cn(ROOM_ICON, layout === "grid" && ROOM_ICON_ON, "max-md:hidden")}
              title="Bật/tắt chế độ xem lưới"
              aria-label="Chế độ xem lưới"
              aria-pressed={layout === "grid"}
              onClick={() => setLayout(layout === "grid" ? "spotlight" : "grid")}
            >
              <Icon name="grid-2x2" size={17} />
            </button>
            <button
              type="button"
              className={ROOM_ICON}
              title="Toàn màn hình"
              aria-label="Toàn màn hình"
              onClick={toggleFullScreen}
            >
              <Icon name="maximize" size={17} />
            </button>
            <button
              type="button"
              className={cn(
                ROOM_ICON,
                "w-auto gap-1.5 px-2 text-xs tabular-nums",
                !isConnected
                  ? "text-red-400"
                  : tone === "good"
                    ? "text-emerald-400"
                    : "text-amber-400",
                sidePanel === "network" && ROOM_ICON_ON,
              )}
              title={networkLabel}
              aria-label={`Chất lượng mạng: ${networkLabel}`}
              onClick={() => setSidePanel(sidePanel === "network" ? "none" : "network")}
            >
              <Icon name={isConnected ? "wifi" : "warning"} size={15} />
              {isConnected && meeting.qos?.rtt != null && <span>{meeting.qos.rtt} ms</span>}
            </button>
            <button
              type="button"
              className={ROOM_ICON}
              title="Thu nhỏ: làm việc khác, cuộc họp vẫn tiếp tục"
              aria-label="Thu nhỏ cuộc họp"
              onClick={() => navigate({ view: "overview" })}
            >
              <Icon name="minus" size={16} />
            </button>
          </header>

          {control.error && (
            <p
              className="tw shrink-0 rounded-md bg-[#3a1616] px-3 py-2 text-[13px] text-[#ff8a8a]"
              role="alert"
            >
              {control.error}
            </p>
          )}
          {meeting.localScreenStream && (
            <div className={SHARED_SCREEN}>
              <Video stream={meeting.localScreenStream} />
              <span className={SHARED_LABEL}>Bạn đang chia sẻ màn hình</span>
            </div>
          )}
          {meeting.remotePeers
            .filter((peer) => peer.screenStream)
            .map((peer) => (
              <div className={SHARED_SCREEN} key={`screen-${peer.socketId}`}>
                <Video stream={peer.screenStream} />
                <span className={SHARED_LABEL}>{peer.displayName} đang chia sẻ màn hình</span>
              </div>
            ))}

          <div
            className={cn(
              "relative grid min-h-0 flex-1 gap-3 overflow-hidden",
              sidePanel !== "none"
                ? "grid-cols-[minmax(0,1fr)_344px]"
                : "grid-cols-[minmax(0,1fr)]",
            )}
          >
            {/* Dynamic video grid: best-fit columns, paging, demand-driven SFU layers */}
            <div
              ref={gridRef}
              className={cn(
                "relative size-full min-w-0",
                staged
                  ? "flex items-center justify-center overflow-hidden"
                  : // gap-2.5 is GRID_GAP: bestGridLayout sizes the tiles around it.
                    "grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] content-center justify-center gap-2.5",
              )}
              style={
                layout === "grid" && gridLayout.tileWidth > 0
                  ? {
                      gridTemplateColumns: `repeat(${gridLayout.columns}, ${Math.floor(gridLayout.tileWidth)}px)`,
                    }
                  : undefined
              }
            >
              {staged && spotlightTile && (
                <div className="relative z-[1] flex size-full items-center justify-center">
                  {renderTile(spotlightTile, true)}
                </div>
              )}
              {staged ? (
                <div className="pointer-events-none absolute top-3 right-3 z-[15] flex max-h-[calc(100%-24px)] flex-col gap-2 overflow-y-auto">
                  {pagedTiles.items.map((tile) => renderTile(tile))}
                </div>
              ) : (
                pagedTiles.items.map((tile) => renderTile(tile))
              )}
            </div>
            {pagedTiles.pageCount > 1 && (
              <nav
                className="tw flex items-center justify-center gap-3 text-[13px] text-zinc-300"
                aria-label="Trang người tham gia"
              >
                <button
                  type="button"
                  className={cn(
                    ROOM_ICON,
                    "size-8 rounded-full border border-solid border-[#27272a]",
                  )}
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
                  className={cn(
                    ROOM_ICON,
                    "size-8 rounded-full border border-solid border-[#27272a]",
                  )}
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
              <Audio key={peer.socketId} track={peer.audioTrack} outputDeviceId={outputDeviceId} />
            ))}

            {sidePanel !== "none" && (
              <aside
                className="tw z-[25] flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-[#111113] text-zinc-100 max-md:fixed max-md:inset-[62px_8px_84px] max-md:z-[3]"
                aria-label={sidePanelTitle}
              >
                <div className="tw flex shrink-0 items-center gap-1 border-b p-2">
                  <div className="flex min-w-0 flex-1 gap-1" role="group" aria-label="Bảng phụ">
                    {panelTabs.map(([id, label, count]) => (
                      <button
                        key={id}
                        type="button"
                        className={cn(
                          "flex-1 cursor-pointer rounded-md px-1.5 py-1.5 text-[13px] font-medium whitespace-nowrap",
                          sidePanel === id
                            ? "bg-[#27272a] text-zinc-100"
                            : "text-zinc-400 hover:text-zinc-100",
                        )}
                        aria-pressed={sidePanel === id}
                        onClick={() => setSidePanel(id)}
                      >
                        {label}
                        {count ? (
                          <small className="ml-1 text-xs text-zinc-400">{count}</small>
                        ) : null}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={ROOM_ICON}
                    aria-label="Đóng bảng phụ"
                    title="Đóng bảng phụ"
                    onClick={() => setSidePanel("none")}
                  >
                    <Icon name="x" size={16} />
                  </button>
                </div>

                {sidePanel === "notes" ? (
                  meetingState?.id ? (
                    // The room is dark whatever the app theme, so the panel takes the dark tokens.
                    <div className="dark min-h-0 flex-1 overflow-y-auto p-3">
                      <MeetingOutcomesPanel sessionId={meetingState.id} live />
                    </div>
                  ) : (
                    <p className="tw p-3 text-[13px] text-zinc-400">Đang tải phiên họp…</p>
                  )
                ) : sidePanel === "network" ? (
                  <div className="tw grid min-h-0 content-start gap-3 overflow-y-auto p-3 text-[13px] text-zinc-100">
                    <b className="text-sm font-semibold">{sidePanelTitle}</b>
                    <dl className="grid grid-cols-2 gap-2">
                      {(
                        [
                          ["Độ trễ (RTT)", `${meeting.qos?.rtt ?? "—"} ms`],
                          ["Băng thông", `${meeting.qos?.bitrate ?? "—"} kbps`],
                          ["Mất gói", `${meeting.qos?.packetLoss ?? "—"}%`],
                          ["Jitter", `${meeting.qos?.jitter ?? "—"} ms`],
                          ["Kết nối", meeting.qos?.transportPath?.toUpperCase() ?? "—"],
                          ["Âm bị che", `${meeting.qos?.audioConcealed?.toFixed(1) ?? "—"}%`],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} className="rounded-lg bg-[#1c1c1f] px-2.5 py-2">
                          <dt className="text-xs text-zinc-400">{label}</dt>
                          <dd className="font-semibold tabular-nums">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <span className="text-zinc-400">
                      Chất lượng nhận:{" "}
                      <strong className="font-semibold text-zinc-100">
                        {NETWORK_CAP_LABEL[String(meeting.networkCap)]}
                      </strong>
                    </span>
                    <label className="grid gap-1 text-xs text-zinc-400">
                      Chọn luồng video
                      <select
                        className="h-[34px] rounded-md border bg-[#1c1c1f] px-2 text-[13px] text-zinc-100"
                        value={layerPolicy}
                        onChange={(event) => changeLayerPolicy(event.target.value as LayerPolicy)}
                        title="Chính sách chọn lớp simulcast cho các ô video"
                      >
                        <option value="combined">Kết hợp</option>
                        <option value="visible">Theo ô hiển thị</option>
                        <option value="speaker">Theo người nói</option>
                      </select>
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={ROOM_BTN}
                        disabled={!meeting.qosHistory.length}
                        onClick={() => {
                          meeting.exportQosCsv();
                          notify("Thành công", "Đã xuất báo cáo QoS định dạng CSV.", "success");
                        }}
                      >
                        Xuất CSV
                      </button>
                      <button
                        type="button"
                        className={ROOM_BTN}
                        disabled={!meeting.qosHistory.length}
                        onClick={() => {
                          meeting.exportQosJson();
                          notify("Thành công", "Đã xuất báo cáo QoS định dạng JSON.", "success");
                        }}
                      >
                        Xuất JSON
                      </button>
                    </div>
                  </div>
                ) : sidePanel === "people" ? (
                  <div className="tw grid min-h-0 flex-1 content-start gap-0.5 overflow-y-auto p-2 text-zinc-100">
                    {keepsRegister && (
                      <div className="flex items-center gap-2 px-1.5 pb-1 text-xs text-zinc-400">
                        <span className="flex-1">{participantCount} người trong phòng</span>
                        <button
                          type="button"
                          className={ROOM_BTN}
                          disabled={exportingAttendance}
                          onClick={() => void handleExportAttendanceCsv()}
                          title="Giờ vào, giờ rời và thời gian có mặt của từng người (mở được bằng Excel)"
                        >
                          <Icon name="download" size={14} />
                          {exportingAttendance ? "Đang xuất…" : "Xuất điểm danh"}
                        </button>
                      </div>
                    )}
                    {control.canManage && waitingPeople.length > 0 && (
                      <section className="grid gap-0.5">
                        <h3 className={PANEL_HEADING}>Đang chờ vào ({waitingPeople.length})</h3>
                        {waitingPeople.map((person) => (
                          <div key={person.userId} className={PERSON}>
                            <UserAvatar name={person.displayName} className="size-7 text-[11px]" />
                            <span className="min-w-0 flex-1 truncate">{person.displayName}</span>
                            <button
                              type="button"
                              className={cn(ROOM_BTN, "bg-zinc-50 text-zinc-900 hover:bg-zinc-200")}
                              disabled={control.busy}
                              onClick={() => void control.action("admit", person.userId)}
                            >
                              Cho vào
                            </button>
                          </div>
                        ))}
                      </section>
                    )}
                    <section className="grid gap-0.5">
                      <h3 className={PANEL_HEADING}>Trong cuộc họp ({participantCount})</h3>
                      {roster.map((person) => (
                        <div key={person.userId} className={PERSON}>
                          <UserAvatar name={person.displayName} className="size-7 text-[11px]" />
                          <span className="grid min-w-0 flex-1">
                            <span className="truncate">
                              {person.displayName}
                              {person.isMe ? " (bạn)" : ""}
                            </span>
                            <small className="truncate text-xs text-zinc-400">
                              {person.role === "host"
                                ? "Chủ trì"
                                : person.role === "cohost"
                                  ? "Đồng chủ trì"
                                  : "Thành viên"}
                              {studentIdOf(person.displayName) &&
                                ` · MSSV ${studentIdOf(person.displayName)}`}
                            </small>
                          </span>
                          {person.raisedHand && (
                            <Icon
                              name="hand"
                              size={16}
                              className="shrink-0 text-amber-400"
                              aria-label="Đang giơ tay"
                            />
                          )}
                          <Icon
                            name={person.micOn ? "mic" : "mic-off"}
                            size={16}
                            className={cn(
                              "shrink-0",
                              person.micOn ? "text-zinc-400" : "text-[#ff8a8a]",
                            )}
                            aria-label={person.micOn ? "Micro đang bật" : "Micro đang tắt"}
                          />
                          <PopoverMenu
                            label={`Tùy chọn cho ${person.displayName}`}
                            icon="more"
                            buttonClass={cn(ROOM_ICON, "size-7")}
                            placement="down"
                            items={personMenu(person)}
                          />
                        </div>
                      ))}
                    </section>
                  </div>
                ) : (
                  <>
                    <div
                      ref={callListRef}
                      className="tw grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto p-3 text-[13.5px] text-zinc-100"
                      role="log"
                      aria-label="Tin nhắn cuộc họp"
                      onScroll={(event) => {
                        const el = event.currentTarget;
                        followCallChat.current =
                          el.scrollHeight - el.scrollTop - el.clientHeight < 90;
                      }}
                    >
                      {callMessages.length ? (
                        callMessages.map((item) => (
                          <p key={item.id} className="m-0 grid justify-items-start gap-0.5">
                            <strong className="text-xs font-semibold text-zinc-400">
                              {item.authorName}
                            </strong>
                            <span className="rounded-[10px] bg-[#1c1c1f] px-2.5 py-1.5 break-words whitespace-pre-wrap">
                              {item.content}
                            </span>
                          </p>
                        ))
                      ) : (
                        <p className="m-0 text-zinc-400">
                          Chưa có tin nhắn. Bắt đầu trao đổi cùng mọi người.
                        </p>
                      )}
                    </div>
                    {callChatError && (
                      <p className="tw px-3 pb-1 text-xs text-[#ff8a8a]" role="alert">
                        {callChatError}
                      </p>
                    )}
                    <form
                      className="tw flex shrink-0 gap-1.5 border-t p-2"
                      onSubmit={(event) => void sendCallChat(event)}
                    >
                      <input
                        className="h-[34px] min-w-0 flex-1 rounded-full bg-[#1c1c1f] px-3 text-[13px] text-zinc-100 placeholder:text-zinc-500"
                        value={callDraft}
                        onChange={(event) => setCallDraft(event.target.value)}
                        maxLength={4000}
                        placeholder="Nhắn trong cuộc họp…"
                        aria-label="Nội dung chat cuộc họp"
                      />
                      <button
                        type="submit"
                        className={ROOM_ICON}
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

          {/* One-off note for hosts, bottom left above the dock */}
          {!adminToastDismissed && control.canManage && (
            <div
              className="tw absolute bottom-[140px] left-4 z-50 inline-flex items-center gap-2.5 rounded-xl border border-[#27272a] bg-[#111113] py-2 pr-2 pl-3.5 text-[13px] text-zinc-100 shadow-lg max-md:bottom-[148px]"
              role="status"
            >
              <Icon name="info" size={16} className="text-[#6b95ff]" />
              <span>Quyền quản trị viên đã được cấp!</span>
              <button
                type="button"
                className={cn(ROOM_ICON, "size-7")}
                onClick={() => setAdminToastDismissed(true)}
                aria-label="Đóng thông báo"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          )}

          {/* Control dock: floats centred over the bottom of the stage */}
          <div
            className="tw fixed bottom-4 left-1/2 z-[var(--z-dropdown)] flex w-max max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-2 rounded-2xl border border-[#27272a] bg-[#111113] p-2 shadow-[0_16px_32px_-16px_rgba(0,0,0,0.7)] max-md:bottom-2.5 max-md:justify-start max-md:overflow-x-auto"
            role="toolbar"
            aria-label="Điều khiển cuộc họp"
          >
            <div className={cn(DOCK_SPLIT, !meeting.mic && DOCK_OFF)}>
              <button
                type="button"
                className={DOCK_SPLIT_MAIN}
                aria-label={meeting.mic ? "Tắt micro" : "Bật micro"}
                aria-pressed={meeting.mic}
                onClick={() => void meeting.toggleMic()}
                title={meeting.mic ? "Tắt micro (M)" : "Bật micro (M)"}
              >
                <Icon name={meeting.mic ? "mic" : "mic-off"} size={18} />
              </button>
              <PopoverMenu
                label="Chọn micro"
                icon="chevron-up"
                iconSize={13}
                buttonClass={DOCK_CHEVRON}
                placement="up"
                items={audioMenuItems}
              />
            </div>

            <div className={cn(DOCK_SPLIT, !meeting.camera && DOCK_OFF)}>
              <button
                type="button"
                className={DOCK_SPLIT_MAIN}
                aria-label={meeting.camera ? "Tắt camera" : "Bật camera"}
                aria-pressed={meeting.camera}
                onClick={() => void meeting.toggleCamera()}
                title={meeting.camera ? "Tắt camera (V)" : "Bật camera (V)"}
              >
                <Icon name={meeting.camera ? "camera" : "camera-off"} size={18} />
              </button>
              <PopoverMenu
                label="Chọn camera"
                icon="chevron-up"
                iconSize={13}
                buttonClass={DOCK_CHEVRON}
                placement="up"
                items={videoMenuItems}
              />
            </div>

            <button
              type="button"
              // Phone browsers have no screen capture; the button would only fail and push Leave away.
              className={cn(
                DOCK_BTN,
                meeting.sharing && DOCK_ON,
                !canShareScreen && !meeting.sharing && "hidden",
              )}
              aria-label={meeting.sharing ? "Dừng chia sẻ màn hình" : "Chia sẻ màn hình"}
              aria-pressed={meeting.sharing}
              onClick={() => void meeting.toggleScreenShare()}
              title={meeting.sharing ? "Dừng chia sẻ màn hình (S)" : "Chia sẻ màn hình (S)"}
            >
              <Icon name="monitor" size={18} />
            </button>

            <div className={cn(DOCK_SPLIT, control.me?.raisedHand && DOCK_ON)}>
              <button
                type="button"
                className={DOCK_SPLIT_MAIN}
                aria-label={control.me?.raisedHand ? "Hạ tay" : "Giơ tay"}
                aria-pressed={Boolean(control.me?.raisedHand)}
                aria-keyshortcuts="H"
                disabled={!control.me || control.busy}
                onClick={() =>
                  control.me && void control.action("hand", undefined, !control.me.raisedHand)
                }
                title={control.me?.raisedHand ? "Hạ tay (H)" : "Giơ tay (H)"}
              >
                <Icon name="hand" size={18} />
              </button>
              <PopoverMenu
                label="Biểu cảm"
                icon="chevron-up"
                iconSize={13}
                buttonClass={DOCK_CHEVRON}
                placement="up"
                items={[
                  {
                    label: "Vỗ tay 👏",
                    onSelect: () => notify("Phản hồi", "Bạn đã vỗ tay 👏", "info"),
                  },
                  {
                    label: "Thích 👍",
                    onSelect: () => notify("Phản hồi", "Bạn đã thả like 👍", "info"),
                  },
                  {
                    label: "Tim ❤️",
                    onSelect: () => notify("Phản hồi", "Bạn đã thả tim ❤️", "info"),
                  },
                  {
                    label: "Cười 😂",
                    onSelect: () => notify("Phản hồi", "Bạn đã cười 😂", "info"),
                  },
                ]}
              />
            </div>

            <span className="mx-1 h-6 w-px shrink-0 bg-[#27272a]" aria-hidden="true" />

            <button
              type="button"
              className={cn(DOCK_BTN, sidePanel === "chat" && DOCK_ON)}
              aria-label="Chat cuộc họp"
              aria-pressed={sidePanel === "chat"}
              title="Chat cuộc họp (C)"
              onClick={() => setSidePanel(sidePanel === "chat" ? "none" : "chat")}
            >
              <Icon name="message" size={18} />
              {callUnread > 0 && <span className={DOCK_BADGE}>{callUnread}</span>}
            </button>

            <button
              type="button"
              className={cn(DOCK_BTN, sidePanel === "people" && DOCK_ON)}
              aria-label="Mọi người"
              aria-pressed={sidePanel === "people"}
              title="Mọi người trong phòng"
              onClick={() => setSidePanel(sidePanel === "people" ? "none" : "people")}
            >
              <Icon name="users" size={18} />
              <span className={DOCK_BADGE}>{participantCount}</span>
            </button>

            <button
              type="button"
              className={cn(DOCK_BTN, sidePanel === "notes" && DOCK_ON)}
              aria-label="Biên bản cuộc họp"
              aria-pressed={sidePanel === "notes"}
              title="Biên bản, ghi hình và việc cần làm"
              onClick={() => setSidePanel(sidePanel === "notes" ? "none" : "notes")}
            >
              <Icon name="file" size={18} />
            </button>

            <PopoverMenu
              label="Tùy chọn khác"
              icon="more-horizontal"
              buttonClass={DOCK_BTN}
              placement="up"
              items={moreMenu}
            />

            <span className="mx-1 h-6 w-px shrink-0 bg-[#27272a]" aria-hidden="true" />
            <button
              type="button"
              // Pinned to the end of the scrolling dock on phones, so Leave never scrolls out of view.
              className="flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-xl bg-red-500 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-red-600 max-md:sticky max-md:right-0 max-md:shadow-[-12px_0_12px_-4px_#111113]"
              aria-label="Rời khỏi phòng họp"
              onClick={requestLeave}
              title="Rời khỏi phòng họp"
            >
              <Icon name="phone-off" size={18} />
              <span className="max-md:hidden">Rời phòng</span>
            </button>
          </div>
          {control.canManage && waitingPeople.length > 0 && (
            <div
              className="tw fixed bottom-6 left-4 z-[var(--z-dropdown)] flex h-10 max-w-[calc(100vw-32px)] items-center gap-2.5 rounded-full border border-[#5b4515] bg-[#2a2418] pr-1.5 pl-3 text-[13px] text-amber-200 max-md:bottom-[92px]"
              role="status"
            >
              <span className="size-2 shrink-0 rounded-full bg-amber-400 motion-safe:animate-pulse" />
              <span className="truncate">
                <b className="font-semibold text-white">{waitingPeople[0].displayName}</b>
                {waitingPeople.length > 1 ? ` và ${waitingPeople.length - 1} người khác` : ""} đang
                chờ vào
              </span>
              <button
                type="button"
                className="h-7 shrink-0 cursor-pointer rounded-full bg-amber-500 px-3 text-xs font-bold text-[#3b2504] disabled:cursor-default disabled:opacity-60"
                disabled={control.busy}
                onClick={() => void control.action("admit", waitingPeople[0].userId)}
              >
                Cho vào
              </button>
            </div>
          )}
          <span
            className="tw fixed right-5 bottom-[34px] z-[99] text-[11px] tracking-widest text-zinc-600 uppercase max-lg:hidden"
            aria-hidden="true"
          >
            Phím tắt · M · V · S · C · H
          </span>
          {control.confirmDialog}
        </div>
      )}
      <AnimatePresence>
        {leaveConfirm && (
          <ConfirmDialog
            title="Rời phòng"
            description={
              meeting.sharing
                ? "Bạn đang chia sẻ màn hình. Rời phòng sẽ dừng chia sẻ và ngắt thiết bị của bạn."
                : "Bạn đang là host. Rời phòng sẽ chuyển quyền host cho người phù hợp; nếu không còn người tham gia, phiên sẽ kết thúc."
            }
            confirmLabel="Rời phòng"
            loading={leaving}
            onClose={() => setLeaveConfirm(false)}
            onConfirm={() => {
              setLeaving(true);
              void meeting.leaveCall().finally(() => {
                setLeaving(false);
                setLeaveConfirm(false);
              });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
