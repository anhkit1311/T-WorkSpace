import { useEffect, useRef, useState } from "react";
import type { MeetingCalendarSession, MeetingScheduleItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import { cn } from "../../shared/lib/utils";
import { Icon } from "../../shared/ui/Icon";
import { getDialInApi, getMeetingCalendarApi } from "./api";
import { MicLevelMeter } from "./MicLevelMeter";
import { mapMediaError, mediaConstraints, type JoinMediaOptions } from "./webrtc/local-media";

export type PreJoinChoice = JoinMediaOptions & { outputDeviceId: string };

type Quality = "low" | "standard" | "high";
const QUALITY: { value: Quality; label: string; title: string }[] = [
  { value: "low", label: "360p", title: "Tiết kiệm dữ liệu · 360p" },
  { value: "standard", label: "720p", title: "Rõ nét · 720p" },
  { value: "high", label: "1080p", title: "Full HD · 1080p" },
];
const BTN =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 text-[13.5px] font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-primary text-primary-foreground hover:bg-primary/90`;
const BTN_GHOST = `${BTN} border bg-card text-foreground hover:bg-secondary`;
const GLASS =
  "absolute flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-0.5 text-[12.5px] text-white";
const DEVICE = "grid gap-1 text-xs text-muted-foreground";
const SELECT = "h-[34px] w-full min-w-0 rounded-md border bg-card px-2 text-[13px] text-foreground";
// Keyed by the device check's tone.
const DOT: Record<string, string> = {
  "": "bg-emerald-500",
  "tone-red": "bg-red-500",
  "tone-amber": "bg-amber-500",
  "is-off": "bg-border",
};
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
  });

/** The check before entering one room: preview camera and mic, pick devices, see the plan and who is already in. */
export function PreJoinScreen({
  room,
  scheduleId,
  autoPreview,
  joining,
  onJoin,
  onCancelJoin,
  onBack,
}: {
  room: { id: string; name: string; workspaceId: string; workspace: string };
  scheduleId?: string;
  /** Off while a dropped call rejoins on its own, so the preview does not compete for the camera. */
  autoPreview: boolean;
  joining: boolean;
  onJoin: (choice: PreJoinChoice) => Promise<boolean>;
  onCancelJoin: () => void;
  onBack: () => void;
}) {
  const { accessToken, user } = useApp();
  const { isConnected } = useSocket();
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  // The user picked this room, so asking for the camera here is expected.
  const [previewEnabled, setPreviewEnabled] = useState(autoPreview);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewCam, setPreviewCam] = useState(true);
  const [previewMic, setPreviewMic] = useState(true);
  const [previewError, setPreviewError] = useState("");
  const [previewRetry, setPreviewRetry] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioInputId, setAudioInputId] = useState("");
  const [videoInputId, setVideoInputId] = useState("");
  const [outputDeviceId, setOutputDeviceId] = useState("");
  const [quality, setQuality] = useState<Quality>("standard");
  const [live, setLive] = useState<MeetingCalendarSession | null>(null);
  const [plan, setPlan] = useState<MeetingScheduleItem | null>(null);
  const [calendarLoaded, setCalendarLoaded] = useState(false);
  const [dialIn, setDialIn] = useState<{ number: string; code: string } | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    const now = Date.now();
    // From yesterday (a meeting still running) to next week (joining a schedule early).
    getMeetingCalendarApi(accessToken, new Date(now - 86_400_000), new Date(now + 7 * 86_400_000))
      .then((calendar) => {
        if (!active) return;
        setLive(
          calendar.sessions.find((session) => session.roomId === room.id && !session.endedAt) ??
            null,
        );
        setPlan(calendar.schedules.find((item) => item.id === scheduleId) ?? null);
        setCalendarLoaded(true);
      })
      .catch(() => active && setCalendarLoaded(false));
    getDialInApi(accessToken, room.id).then(
      (info) => active && setDialIn(info),
      () => active && setDialIn(null),
    );
    return () => {
      active = false;
    };
  }, [accessToken, room.id, scheduleId]);

  useEffect(() => {
    if (!previewEnabled || !navigator.mediaDevices?.enumerateDevices) return;
    let active = true;
    const refresh = () => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((list) => {
          if (active) setDevices(list);
        })
        .catch((reason) => {
          if (active)
            setPreviewError(
              reason instanceof Error ? reason.message : "Không liệt kê được thiết bị.",
            );
        });
    };
    refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, [previewEnabled, previewRetry]);

  useEffect(() => {
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
      .getUserMedia(mediaConstraints({ audioInputId, videoInputId, quality }))
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
  }, [previewEnabled, previewRetry, audioInputId, videoInputId, quality]);

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

  /** "Vào với mic tắt" and "Chỉ nghe" join with the mic (and camera) off, whatever the preview shows. */
  const join = async (override: { mic?: boolean; camera?: boolean } = {}) => {
    // Free the camera for the call; bring the preview back if joining fails.
    previewStream?.getTracks().forEach((t) => t.stop());
    setPreviewStream(null);
    const joined = await onJoin({
      audioInputId,
      videoInputId,
      quality,
      micEnabled: override.mic ?? previewMic,
      cameraEnabled: override.camera ?? previewCam,
      outputDeviceId,
    });
    if (!joined && previewEnabled) setPreviewRetry((value) => value + 1);
  };

  const hasAudio = Boolean(previewStream?.getAudioTracks().length);
  const hasVideo = Boolean(previewStream?.getVideoTracks().length);
  const qualityLabel = QUALITY.find((item) => item.value === quality)?.label ?? "720p";
  const people = live?.people ?? [];
  const title = plan?.title ?? live?.title ?? room.name;
  const code = dialIn ? `${dialIn.code.slice(0, 3)} ${dialIn.code.slice(3)}` : "";
  const deviceCheck = (has: boolean, on: boolean) =>
    !previewEnabled
      ? (["is-off", "Chưa kiểm tra"] as const)
      : !has
        ? (["tone-red", "Không dùng được"] as const)
        : on
          ? (["", "Hoạt động"] as const)
          : (["is-off", "Đang tắt"] as const);
  const [micTone, micText] = deviceCheck(hasAudio, previewMic);
  const [camTone, camText] = deviceCheck(hasVideo, previewCam);
  const deviceList = (kind: MediaDeviceKind, fallback: string) =>
    devices
      .filter((device) => device.kind === kind)
      .map((device, index) => (
        <option key={device.deviceId || index} value={device.deviceId}>
          {device.label || `${fallback} ${index + 1}`}
        </option>
      ));

  const displayName = user?.displayName || "Bạn";
  const check = (tone: string, label: string, text: string) => (
    <li className="flex items-center gap-2.5 py-1.5 text-[13px]">
      <span className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
      <b className="font-medium">{label}</b>
      <span className="ml-auto text-muted-foreground">{text}</span>
    </li>
  );

  return (
    <section
      className="tw mx-auto grid w-full max-w-[1080px] gap-4 text-foreground"
      aria-labelledby="prejoin-title"
    >
      <nav
        className="flex items-center gap-2.5 text-[13px] text-muted-foreground"
        aria-label="Vị trí"
      >
        <button type="button" className={BTN_GHOST} onClick={onBack} disabled={joining}>
          <Icon name="chevron-left" size={16} />
          Họp
        </button>
        <span className="truncate">
          Họp / {room.name} / <b className="font-semibold text-foreground">Phòng chờ</b>
        </span>
      </nav>

      <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-9 max-lg:grid-cols-1 max-lg:gap-5">
        <div className="grid gap-2.5">
          {/* The preview is a dark stage in both themes. */}
          <div className="relative grid aspect-[16/10] place-items-center overflow-hidden rounded-[14px] bg-zinc-900 text-zinc-50">
            {previewCam && previewStream ? (
              <video
                ref={previewVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute inset-0 size-full -scale-x-100 object-cover"
              />
            ) : (
              <div className="grid justify-items-center gap-3 text-[13px] text-zinc-300">
                <span className="grid size-20 place-items-center rounded-full bg-[#2f3a55] text-[28px] font-semibold text-[#cfdcff]">
                  {displayName.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  {!previewEnabled
                    ? "Chưa kiểm tra camera"
                    : previewLoading
                      ? "Đang mở camera…"
                      : "Camera đang tắt"}
                </span>
                {!previewEnabled && (
                  <button
                    type="button"
                    className={cn(BTN, "bg-zinc-50 text-zinc-900 hover:bg-zinc-200")}
                    onClick={() => setPreviewEnabled(true)}
                  >
                    <Icon name="camera" size={16} />
                    Kiểm tra camera và micro
                  </button>
                )}
              </div>
            )}
            <span className={cn(GLASS, "top-3 left-3.5")}>{displayName} (bạn)</span>
            <span className={cn(GLASS, "top-3 right-3.5")}>
              <span
                className={cn("size-2 rounded-full", isConnected ? "bg-emerald-400" : "bg-red-400")}
              />
              {isConnected ? `Đã kết nối · ${qualityLabel}` : "Mất kết nối"}
            </span>
            <div className="absolute bottom-3.5 left-1/2 flex -translate-x-1/2 gap-2.5">
              {(
                [
                  [previewMic, "micro", "mic", "mic-off", togglePreviewMic],
                  [previewCam, "camera", "camera", "camera-off", togglePreviewCam],
                ] as const
              ).map(([on, name, iconOn, iconOff, toggle]) => (
                <button
                  key={name}
                  type="button"
                  className={cn(
                    "grid size-[46px] cursor-pointer place-items-center rounded-full text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    on ? "bg-white/15 hover:bg-white/25" : "bg-red-500 hover:bg-red-600",
                  )}
                  disabled={joining}
                  aria-pressed={on}
                  aria-label={`${on ? "Tắt" : "Bật"} ${name}`}
                  title={`${on ? "Tắt" : "Bật"} ${name}`}
                  onClick={toggle}
                >
                  <Icon name={on ? iconOn : iconOff} size={19} />
                </button>
              ))}
            </div>
          </div>

          {previewLoading && (
            <p className="m-0 text-[13px] text-muted-foreground" role="status">
              Đang chờ quyền truy cập thiết bị…
            </p>
          )}
          {previewError && (
            <div
              className="flex items-center gap-2.5 rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700 dark:bg-red-950 dark:text-red-300"
              role="alert"
            >
              <span className="flex-1">{previewError}</span>
              <button
                type="button"
                className={BTN_GHOST}
                onClick={() => setPreviewRetry((value) => value + 1)}
              >
                Thử lại
              </button>
            </div>
          )}

          {previewStream && <MicLevelMeter stream={previewStream} enabled={previewMic} />}

          {previewEnabled && (
            <div className="grid grid-cols-4 gap-2 max-md:grid-cols-2">
              <label className={DEVICE}>
                Micro
                <select
                  className={SELECT}
                  aria-label="Chọn micro"
                  value={audioInputId}
                  onChange={(event) => setAudioInputId(event.target.value)}
                >
                  <option value="">Thiết bị mặc định</option>
                  {deviceList("audioinput", "Micro")}
                </select>
              </label>
              <label className={DEVICE}>
                Camera
                <select
                  className={SELECT}
                  aria-label="Chọn camera"
                  value={videoInputId}
                  onChange={(event) => setVideoInputId(event.target.value)}
                >
                  <option value="">Thiết bị mặc định</option>
                  {deviceList("videoinput", "Camera")}
                </select>
              </label>
              {"setSinkId" in HTMLMediaElement.prototype && (
                <label className={DEVICE}>
                  Loa
                  <select
                    className={SELECT}
                    aria-label="Chọn loa"
                    value={outputDeviceId}
                    onChange={(event) => setOutputDeviceId(event.target.value)}
                  >
                    <option value="">Thiết bị mặc định</option>
                    {deviceList("audiooutput", "Loa")}
                  </select>
                </label>
              )}
              <div className={DEVICE}>
                <span id="pj-quality">Chất lượng</span>
                <div
                  className="flex h-[34px] rounded-md bg-secondary p-[3px]"
                  role="group"
                  aria-labelledby="pj-quality"
                >
                  {QUALITY.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={cn(
                        "flex-1 cursor-pointer rounded-[5px] text-xs font-medium",
                        quality === item.value
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground",
                      )}
                      aria-pressed={quality === item.value}
                      title={item.title}
                      onClick={() => setQuality(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <aside className="grid gap-3.5">
          <div className="grid gap-1">
            <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <span
                className={cn(
                  "size-2 rounded-full",
                  live ? "bg-red-500 motion-safe:animate-pulse" : "bg-border",
                )}
              />
              {live
                ? `Đang diễn ra · bắt đầu ${clock(live.startedAt)}`
                : plan
                  ? `Lịch họp · ${clock(plan.startsAt)}–${clock(plan.endsAt)}`
                  : "Phòng họp · chưa có phiên nào"}
            </span>
            <h1
              id="prejoin-title"
              className="m-0 text-2xl leading-[1.25] font-bold tracking-normal text-foreground"
            >
              {title}
            </h1>
            <span className="text-[13px] text-muted-foreground">
              {room.workspace}
              {title !== room.name ? ` · ${room.name}` : ""}
              {dialIn && <span className="font-mono"> · Mã {code}</span>}
            </span>
          </div>

          {calendarLoaded && (
            <div
              className="flex items-center gap-2.5 text-[13px] text-muted-foreground"
              role="status"
            >
              {people.length ? (
                <span className="flex shrink-0">
                  {people.slice(0, 3).map((name, index) => (
                    <UserAvatar
                      key={`${name}-${index}`}
                      name={name}
                      className="-ml-2 size-[26px] text-[10.5px] ring-2 ring-background first:ml-0"
                    />
                  ))}
                </span>
              ) : (
                <Icon name="users" size={16} />
              )}
              <span>
                {people.length === 0
                  ? "Chưa có ai trong phòng. Bạn sẽ là người mở phiên."
                  : people.length <= 2
                    ? `${people.join(", ")} đang trong phòng`
                    : `${people.slice(0, 2).join(", ")} và ${people.length - 2} người khác đang trong phòng`}
              </span>
            </div>
          )}

          <div className="grid gap-2">
            <button
              type="button"
              className={cn(BTN_PRIMARY, "h-11 text-[15px]")}
              disabled={joining || !isConnected}
              onClick={() => void join()}
            >
              <Icon name="video" size={18} />
              {joining ? "Đang kết nối…" : plan?.waitingRoom ? "Xin vào phòng" : "Vào phòng"}
            </button>
            {joining ? (
              <button type="button" className={BTN_GHOST} onClick={onCancelJoin}>
                Hủy tham gia
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={BTN_GHOST}
                  disabled={!isConnected}
                  onClick={() => void join({ mic: false })}
                >
                  <Icon name="mic-off" size={16} />
                  Vào với mic tắt
                </button>
                <button
                  type="button"
                  className={BTN_GHOST}
                  disabled={!isConnected}
                  onClick={() => void join({ mic: false, camera: false })}
                >
                  <Icon name="volume" size={16} />
                  Chỉ nghe
                </button>
              </div>
            )}
          </div>

          <ul className="border-t pt-2" aria-label="Kiểm tra trước khi vào">
            {check(micTone, "Micro", micText)}
            {check(camTone, "Camera", camTone === "" ? `${camText} · ${qualityLabel}` : camText)}
            {check(
              isConnected ? "" : "tone-red",
              "Máy chủ họp",
              isConnected ? "Đã kết nối" : "Mất kết nối",
            )}
            {plan?.waitingRoom && check("tone-amber", "Phòng chờ đang bật", "Chủ trì sẽ duyệt")}
            {plan?.muteOnJoin && check("tone-amber", "Tắt mic khi vào", "Theo cài đặt phòng")}
          </ul>

          {plan?.agenda?.length ? (
            <div className="border-t pt-3">
              <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Chương trình
              </span>
              <ol className="mt-1.5 grid gap-1.5 text-[13px]">
                {plan.agenda.map((item, index) => (
                  <li key={index} className="flex gap-2.5">
                    <b className="font-mono font-medium text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </b>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {(plan?.autoRecord || dialIn) && (
            <p className="m-0 flex items-start gap-2 border-t pt-3 text-[13px] text-muted-foreground">
              {plan?.autoRecord && (
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-red-500" />
              )}
              <span>
                {plan?.autoRecord && (
                  <>
                    Phiên này <b className="font-semibold text-foreground">tự động ghi hình</b>
                    .{" "}
                  </>
                )}
                {dialIn && (
                  <>
                    Không có mic? Gọi <b className="font-mono">{dialIn.number}</b> từ máy lẻ, nhập{" "}
                    <b className="font-mono">{dialIn.code}#</b>.
                  </>
                )}
              </span>
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
