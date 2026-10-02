import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessageItem, MeetingScheduleItem, WorkspaceItem } from "@doan/shared";
import { getChannelsApi, getMessagesApi, getWorkspacesApi } from "../chat/api";
import {
  getMeetingHistoryApi,
  getMeetingSchedulesApi,
  saveMeetingScheduleApi,
  cancelMeetingScheduleApi,
  type MeetingHistoryItem,
} from "./api";
import { useApp } from "../../app/providers/AppContext";
import { useMeeting } from "../../app/providers/MeetingContext";
import { MeetingControls } from "./MeetingControls";
import { useSocket } from "../../app/providers/SocketContext";
import { Badge, Button } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import "./meeting-ui.css";
import "./meeting-schedules.css";

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
    "PRODID:-//CollabSpace//Meeting Schedule//VI",
    "BEGIN:VEVENT",
    `UID:${item.id}@collabspace`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(item.startsAt)}`,
    `DTEND:${stamp(item.endsAt)}`,
    `SUMMARY:${escape(item.title)}`,
    `DESCRIPTION:${escape(item.description)}`,
    `LOCATION:${escape(`${item.workspaceName} - ${item.roomName} (CollabSpace)`)}`,
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
    void element.setSinkId?.(outputDeviceId).catch(() => {});
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

function ParticipantTile({
  isLocal,
  displayName,
  stream,
  hasVideo,
  hasAudio,
  muted = false,
  pinned = false,
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
  const [sidePanel, setSidePanel] = useState<"none" | "people" | "chat">("none");
  const [callMessages, setCallMessages] = useState<ChatMessageItem[]>([]);
  const [callDraft, setCallDraft] = useState("");
  const [callChatError, setCallChatError] = useState("");
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
        .catch(() => {});
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
      if (message.channelId === roomId)
        setCallMessages((previous) =>
          previous.some((item) => item.id === message.id) ? previous : [...previous, message],
        );
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
      .catch(() => {
        if (active)
          setPreviewError(
            "Không truy cập được camera hoặc micro. Hãy kiểm tra quyền thiết bị rồi thử lại.",
          );
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

  const selected = rooms.find((room) => room.id === selectedId);

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
    setScheduleRoomId(item?.roomId ?? selectedId ?? rooms[0]?.id ?? "");
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
      return (
        <Badge tone="amber">
          <Icon name="admin" size={11} /> Chủ nhóm
        </Badge>
      );
    }
    if (role === "admin") {
      return (
        <Badge tone="blue">
          <Icon name="admin" size={11} /> Quản trị viên
        </Badge>
      );
    }
    return (
      <Badge tone="neutral">
        <Icon name="users" size={11} /> Thành viên
      </Badge>
    );
  };

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
          <header className="page-hero">
            <h1 className="meeting-page-title">Cuộc họp video</h1>
            <p className="meeting-page-description">
              Chọn phòng trong nhóm của bạn và kiểm tra thiết bị trước khi tham gia.
            </p>
          </header>

          {loading ? (
            <p role="status" className="loading-note">
              Đang tải danh sách phòng họp…
            </p>
          ) : rooms.length === 0 ? (
            <div className="state-card state-card--compact">
              <span className="state-card__icon">
                <Icon name="video" size={26} />
              </span>
              <h3>Chưa có phòng họp nào</h3>
              <p>
                Bạn chưa có phòng họp nào trong các nhóm hiện tại. Hãy tạo nhóm hoặc nhờ Quản trị
                viên thêm bạn vào nhóm.
              </p>
              <Button variant="secondary" size="sm" onClick={() => setActiveView("overview")}>
                Xem nhóm làm việc
              </Button>
            </div>
          ) : (
            <div className="meeting-lobby-wrap">
              {/* Left Column: Room Cards */}
              <div className="meeting-rooms-section">
                <div className="meeting-section-header">
                  <h3>Chọn phòng họp ({rooms.length})</h3>
                  <Badge tone="neutral">Phòng của nhóm</Badge>
                </div>

                {rooms.map((room) => (
                  <button
                    type="button"
                    key={room.id}
                    className={`meeting-room-card ${room.id === selectedId ? "is-selected" : ""}`}
                    aria-pressed={room.id === selectedId}
                    onClick={() => openChannel(room.workspaceId, room.id, true)}
                  >
                    <div className="meeting-room-card__header">
                      <h4 className="meeting-room-card__title">
                        <Icon name="video" size={16} style={{ color: "#bcd2dd" }} />
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
              {rooms.length > 0 && (
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
                      {rooms
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
            ) : schedules.length === 0 ? (
              <p className="meeting-schedule-empty">
                Chưa có lịch họp sắp tới trong các nhóm của bạn.
              </p>
            ) : (
              <div className="meeting-schedule-list">
                {schedules.map((item) => {
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
                        <button type="button" onClick={() => downloadCalendarEvent(item)}>
                          Thêm vào lịch
                        </button>
                        {item.canManage && (
                          <>
                            <button type="button" onClick={() => openScheduleForm(item)}>
                              Sửa
                            </button>
                            {cancelScheduleId === item.id ? (
                              <>
                                <button
                                  type="button"
                                  disabled={savingSchedule}
                                  onClick={() => void cancelSchedule(item.id)}
                                >
                                  Xác nhận huỷ
                                </button>
                                <button type="button" onClick={() => setCancelScheduleId("")}>
                                  Giữ lại
                                </button>
                              </>
                            ) : (
                              <button type="button" onClick={() => setCancelScheduleId(item.id)}>
                                Huỷ lịch
                              </button>
                            )}
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
              <div className="meeting-history-list">
                {history.map((item) => (
                  <article className="meeting-history-item" key={item.id}>
                    <span className="meeting-history-icon">
                      <Icon name="video" size={16} />
                    </span>
                    <div>
                      <strong>{item.name}</strong>
                      <time dateTime={item.joinedAt}>
                        {new Date(item.joinedAt).toLocaleString("vi-VN", {
                          day: "numeric",
                          month: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <Badge tone={item.leftAt ? "neutral" : "amber"}>
                      {item.leftAt ? "Đã kết thúc" : "Chưa ghi nhận rời phòng"}
                    </Badge>
                  </article>
                ))}
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
            <div role="group" aria-label="Kiểu hiển thị">
              <button
                type="button"
                className={layout === "grid" ? "is-active" : ""}
                aria-pressed={layout === "grid"}
                onClick={() => setLayout("grid")}
              >
                Lưới
              </button>
              <button
                type="button"
                className={layout === "spotlight" ? "is-active" : ""}
                aria-pressed={layout === "spotlight"}
                onClick={() => setLayout("spotlight")}
              >
                Tiêu điểm
              </button>
            </div>
          </div>
          <div className={`meeting-stage-layout ${sidePanel !== "none" ? "has-panel" : ""}`}>
            {/* Video Grid */}
            <div
              className={`meeting-video-grid ${layout === "spotlight" ? "is-spotlight" : ""} ${meeting.localScreenStream || meeting.remotePeers.some((peer) => peer.screenStream) ? "has-share" : ""}`}
            >
              {/* Local Video Tile */}
              <ParticipantTile
                isLocal={true}
                displayName={user?.displayName || "Bạn"}
                stream={meeting.localStream}
                hasVideo={meeting.camera && Boolean(meeting.localStream)}
                hasAudio={meeting.mic}
                muted={true}
                pinned={pinnedId === "local" || (!pinnedId && layout === "spotlight")}
                onPin={() => {
                  setPinnedId(pinnedId === "local" ? "" : "local");
                  setLayout("spotlight");
                }}
              />

              {/* Remote Peers Video Tiles */}
              {meeting.remotePeers.map((peer) => (
                <ParticipantTile
                  key={peer.socketId}
                  isLocal={false}
                  displayName={peer.displayName}
                  stream={peer.mediaStream}
                  hasVideo={Boolean(peer.videoTrack)}
                  hasAudio={Boolean(peer.audioTrack)}
                  pinned={pinnedId === peer.socketId}
                  onPin={() => {
                    setPinnedId(pinnedId === peer.socketId ? "" : peer.socketId);
                    setLayout("spotlight");
                  }}
                  outputDeviceId={outputDeviceId}
                />
              ))}
            </div>

            {sidePanel !== "none" && (
              <aside
                className="meeting-side-panel"
                aria-label={sidePanel === "people" ? "Người tham gia" : "Chat cuộc họp"}
              >
                <div className="meeting-side-panel-head">
                  <strong>{sidePanel === "people" ? "Người tham gia" : "Chat cuộc họp"}</strong>
                  <button
                    type="button"
                    aria-label="Đóng bảng phụ"
                    onClick={() => setSidePanel("none")}
                  >
                    <Icon name="x" size={16} />
                  </button>
                </div>
                {sidePanel === "people" ? (
                  <div className="meeting-people-list">
                    <div>
                      <span>{user?.displayName || "Bạn"} · bạn</span>
                      <button
                        type="button"
                        onClick={() => {
                          setPinnedId("local");
                          setLayout("spotlight");
                        }}
                      >
                        Ghim
                      </button>
                    </div>
                    {meeting.remotePeers.map((peer) => (
                      <div key={peer.socketId}>
                        <span>{peer.displayName}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setPinnedId(peer.socketId);
                            setLayout("spotlight");
                          }}
                        >
                          Ghim
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="meeting-chat-list" role="log" aria-label="Tin nhắn cuộc họp">
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
              title={meeting.mic ? "Tắt micro" : "Bật micro"}
            >
              <Icon name={meeting.mic ? "mic" : "mic-off"} size={18} />
            </button>

            <button
              type="button"
              className={`meeting-dock-btn ${!meeting.camera ? "is-muted" : ""}`}
              aria-label={meeting.camera ? "Tắt camera" : "Bật camera"}
              aria-pressed={meeting.camera}
              onClick={() => void meeting.toggleCamera()}
              title={meeting.camera ? "Tắt camera" : "Bật camera"}
            >
              <Icon name={meeting.camera ? "camera" : "camera-off"} size={18} />
            </button>

            <button
              type="button"
              className={`meeting-dock-btn ${meeting.sharing ? "is-active" : ""}`}
              aria-label={meeting.sharing ? "Dừng chia sẻ màn hình" : "Chia sẻ màn hình"}
              aria-pressed={meeting.sharing}
              onClick={() => void meeting.toggleScreenShare()}
              title={meeting.sharing ? "Dừng chia sẻ màn hình" : "Chia sẻ màn hình"}
            >
              <Icon name="share" size={18} />
            </button>

            <button
              type="button"
              className={`meeting-dock-btn ${sidePanel === "chat" ? "is-active" : ""}`}
              aria-label="Chat cuộc họp"
              aria-pressed={sidePanel === "chat"}
              title="Chat cuộc họp"
              onClick={() => setSidePanel(sidePanel === "chat" ? "none" : "chat")}
            >
              <Icon name="message" size={18} />
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
              onClick={() => void meeting.leaveCall()}
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
    </div>
  );
}
