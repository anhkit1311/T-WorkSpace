import { useEffect, useRef, useState } from "react";
import type { MeetingCalendarSession, MeetingScheduleItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { Avatar, Button } from "../../shared/ui/Primitives";
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

  return (
    <section className="meeting-prejoin" aria-labelledby="prejoin-title">
      <nav className="pj-crumbs" aria-label="Vị trí">
        <Button
          variant="secondary"
          size="sm"
          icon="chevron-left"
          onClick={onBack}
          disabled={joining}
        >
          Họp
        </Button>
        <span>
          Họp / {room.name} / <b>Phòng chờ</b>
        </span>
      </nav>

      <div className="pj-grid">
        <div className="pj-stage-col">
          <div className="pj-stage">
            {previewCam && previewStream ? (
              <video ref={previewVideoRef} autoPlay playsInline muted className="pj-stage__video" />
            ) : (
              <div className="pj-stage__placeholder">
                <span className="pj-stage__avatar">
                  {(user?.displayName || "Bạn").slice(0, 1).toUpperCase()}
                </span>
                <span>
                  {!previewEnabled
                    ? "Chưa kiểm tra camera"
                    : previewLoading
                      ? "Đang mở camera…"
                      : "Camera đang tắt"}
                </span>
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
              </div>
            )}
            <span className="pj-glass is-top-left">
              <span className={`mt-led ${previewStream ? "" : "is-off"}`} /> Xem trước ·{" "}
              {qualityLabel}
            </span>
            <span className="pj-glass is-top-right">
              <span className={`mt-led ${isConnected ? "" : "tone-red"}`} />{" "}
              {isConnected ? "Máy chủ đã kết nối" : "Mất kết nối"}
            </span>
            <span className="pj-glass is-name">{user?.displayName || "Bạn"} (bạn)</span>
            <div className="pj-controls">
              <button
                type="button"
                className={`pj-ctl ${previewMic ? "is-on" : "is-off"}`}
                disabled={joining}
                aria-pressed={previewMic}
                aria-label={previewMic ? "Tắt micro" : "Bật micro"}
                title={previewMic ? "Tắt micro" : "Bật micro"}
                onClick={togglePreviewMic}
              >
                <Icon name={previewMic ? "mic" : "mic-off"} size={18} />
              </button>
              <button
                type="button"
                className={`pj-ctl ${previewCam ? "is-on" : "is-off"}`}
                disabled={joining}
                aria-pressed={previewCam}
                aria-label={previewCam ? "Tắt camera" : "Bật camera"}
                title={previewCam ? "Tắt camera" : "Bật camera"}
                onClick={togglePreviewCam}
              >
                <Icon name={previewCam ? "camera" : "camera-off"} size={18} />
              </button>
            </div>
          </div>

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

          {previewStream && (
            <div className="pj-meter">
              <span className="pj-label">Mic</span>
              <MicLevelMeter stream={previewStream} enabled={previewMic} />
            </div>
          )}

          {previewEnabled && (
            <div className="pj-devices">
              <label className="pj-dev">
                <span className="pj-label">Micro</span>
                <select
                  aria-label="Chọn micro"
                  value={audioInputId}
                  onChange={(event) => setAudioInputId(event.target.value)}
                >
                  <option value="">Thiết bị mặc định</option>
                  {deviceList("audioinput", "Micro")}
                </select>
              </label>
              <label className="pj-dev">
                <span className="pj-label">Camera</span>
                <select
                  aria-label="Chọn camera"
                  value={videoInputId}
                  onChange={(event) => setVideoInputId(event.target.value)}
                >
                  <option value="">Thiết bị mặc định</option>
                  {deviceList("videoinput", "Camera")}
                </select>
              </label>
              {"setSinkId" in HTMLMediaElement.prototype && (
                <label className="pj-dev">
                  <span className="pj-label">Loa</span>
                  <select
                    aria-label="Chọn loa"
                    value={outputDeviceId}
                    onChange={(event) => setOutputDeviceId(event.target.value)}
                  >
                    <option value="">Thiết bị mặc định</option>
                    {deviceList("audiooutput", "Loa")}
                  </select>
                </label>
              )}
              <div className="pj-dev">
                <span className="pj-label" id="pj-quality">
                  Chất lượng
                </span>
                <div className="pj-seg" role="group" aria-labelledby="pj-quality">
                  {QUALITY.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={quality === item.value ? "is-active" : ""}
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

        <aside className="pj-side">
          <div>
            <p className="mt-eyebrow">
              <span className={`mt-led ${live ? "is-pulse" : "is-off"}`} />
              {live
                ? `Đang diễn ra · bắt đầu ${clock(live.startedAt)}`
                : plan
                  ? `Lịch họp · ${clock(plan.startsAt)}–${clock(plan.endsAt)}`
                  : "Phòng họp · chưa có phiên nào"}
            </p>
            <h1 id="prejoin-title" className="pj-title">
              {title}
            </h1>
            <p className="pj-sub">
              {room.workspace}
              {title !== room.name ? ` · ${room.name}` : ""}
              {dialIn && <span className="pj-mono"> · Mã {code}</span>}
            </p>
          </div>

          {calendarLoaded && (
            <div className="pj-card pj-people" role="status">
              {people.length ? (
                <span className="mt-stack">
                  {people.slice(0, 3).map((name, index) => (
                    <Avatar key={`${name}-${index}`} name={name} size="sm" />
                  ))}
                  {people.length > 3 && (
                    <span className="mt-stack__more">+{people.length - 3}</span>
                  )}
                </span>
              ) : (
                <span className="pj-people__icon">
                  <Icon name="users" size={16} />
                </span>
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

          {plan?.agenda?.length ? (
            <div className="pj-card">
              <p className="pj-label">Chương trình</p>
              <ol className="pj-agenda">
                {plan.agenda.map((item, index) => (
                  <li key={index}>
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <div className="pj-checks">
            <p className="pj-label">Kiểm tra trước khi vào</p>
            <ul>
              <li>
                <span className={`mt-led ${micTone}`} />
                <b>Micro</b>
                <em>{micText}</em>
              </li>
              <li>
                <span className={`mt-led ${camTone}`} />
                <b>Camera</b>
                <em>{camTone === "" ? `${camText} · ${qualityLabel}` : camText}</em>
              </li>
              <li>
                <span className={`mt-led ${isConnected ? "" : "tone-red"}`} />
                <b>Máy chủ họp</b>
                <em>{isConnected ? "Đã kết nối" : "Mất kết nối"}</em>
              </li>
              {plan?.waitingRoom && (
                <li>
                  <span className="mt-led tone-amber" />
                  <b>Phòng chờ đang bật</b>
                  <em>Chủ trì sẽ duyệt</em>
                </li>
              )}
              {plan?.muteOnJoin && (
                <li>
                  <span className="mt-led tone-amber" />
                  <b>Tắt mic khi vào</b>
                  <em>Theo cài đặt phòng</em>
                </li>
              )}
            </ul>
          </div>

          <div className="pj-actions">
            <Button
              size="lg"
              icon="video"
              disabled={joining || !isConnected}
              loading={joining}
              onClick={() => void join()}
            >
              {joining ? "Đang kết nối…" : plan?.waitingRoom ? "Xin vào phòng" : "Vào phòng"}
            </Button>
            {joining ? (
              <Button variant="secondary" onClick={onCancelJoin}>
                Hủy tham gia
              </Button>
            ) : (
              <div className="pj-actions__row">
                <Button
                  variant="secondary"
                  icon="mic-off"
                  disabled={!isConnected}
                  onClick={() => void join({ mic: false })}
                >
                  Vào với mic tắt
                </Button>
                <Button
                  variant="secondary"
                  icon="volume"
                  disabled={!isConnected}
                  onClick={() => void join({ mic: false, camera: false })}
                >
                  Chỉ nghe
                </Button>
              </div>
            )}
          </div>

          {(plan?.autoRecord || dialIn) && (
            <p className="pj-note">
              {plan?.autoRecord && <span className="mt-led tone-red" />}
              <span>
                {plan?.autoRecord && (
                  <>
                    Phiên này <b>tự động ghi hình</b>.{" "}
                  </>
                )}
                {dialIn && (
                  <>
                    Không có mic? Gọi <b className="pj-mono">{dialIn.number}</b> từ máy lẻ, nhập{" "}
                    <b className="pj-mono">{dialIn.code}#</b>.
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
