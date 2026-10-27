import { useEffect, useRef, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { Button } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { getMeetingCalendarApi } from "./api";
import { MicLevelMeter } from "./MicLevelMeter";
import { mapMediaError, mediaConstraints, type JoinMediaOptions } from "./webrtc/local-media";

export type PreJoinChoice = JoinMediaOptions & { outputDeviceId: string };

/** The check before entering one room: preview camera and mic, pick devices, see who is already in. */
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
  const [quality, setQuality] = useState<"low" | "standard" | "high">("standard");
  const [people, setPeople] = useState<string[] | null>(null);
  const [title, setTitle] = useState<string>();
  const previewVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    const now = Date.now();
    // From yesterday (a meeting still running) to next week (joining a schedule early).
    getMeetingCalendarApi(accessToken, new Date(now - 86_400_000), new Date(now + 7 * 86_400_000))
      .then((calendar) => {
        if (!active) return;
        setPeople(calendar.sessions.find((session) => session.roomId === room.id && !session.endedAt)?.people ?? []);
        setTitle(calendar.schedules.find((item) => item.id === scheduleId)?.title);
      })
      .catch(() => active && setPeople(null));
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
          if (active) setPreviewError(reason instanceof Error ? reason.message : "Không liệt kê được thiết bị.");
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

  const join = async () => {
    // Free the camera for the call; bring the preview back if joining fails.
    previewStream?.getTracks().forEach((t) => t.stop());
    setPreviewStream(null);
    const joined = await onJoin({ audioInputId, videoInputId, quality, micEnabled: previewMic, cameraEnabled: previewCam, outputDeviceId });
    if (!joined && previewEnabled) setPreviewRetry((value) => value + 1);
  };

  return (
    <section className="meeting-prejoin" aria-labelledby="prejoin-title">
      <div className="meeting-prejoin__top">
        <Button variant="text" size="sm" icon="chevron-left" onClick={onBack} disabled={joining}>
          Lịch họp
        </Button>
      </div>

      <div className="meeting-prejoin__horizontal">
        {/* Cột trái: Khung xem trước camera và các nút bật/tắt nhanh */}
        <div className="meeting-prejoin__stage-col">
          <div className="meeting-preview-screen">
            {previewCam && previewStream ? (
              <video ref={previewVideoRef} autoPlay playsInline muted className="meeting-preview-video" />
            ) : (
              <div className="meeting-preview-placeholder">
                <div className="meeting-preview-avatar">{(user?.displayName || "Bạn").slice(0, 1).toUpperCase()}</div>
                <span className="meeting-preview-placeholder-text">{previewEnabled ? "Camera đang tắt" : "Chưa kiểm tra camera"}</span>
              </div>
            )}

            <div className="meeting-preview-floating-controls">
              <button
                type="button"
                className={`lobby-control-btn ${!previewCam ? "is-muted" : ""}`}
                disabled={joining}
                aria-pressed={previewCam}
                onClick={togglePreviewCam}
                title={previewCam ? "Tắt Camera" : "Bật Camera"}
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
                title={previewMic ? "Tắt Mic" : "Bật Mic"}
              >
                <Icon name={previewMic ? "mic" : "mic-off"} size={16} />
                <span>{previewMic ? "Tắt Mic" : "Bật Mic"}</span>
              </button>
            </div>
          </div>

          {!previewEnabled && (
            <Button variant="secondary" size="sm" icon="camera" onClick={() => setPreviewEnabled(true)}>
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
              <Button variant="ghost" size="sm" onClick={() => setPreviewRetry((value) => value + 1)}>
                Thử lại
              </Button>
            </div>
          )}

          <div className="meeting-prejoin__meter-box">
            <MicLevelMeter stream={previewStream} enabled={previewMic} />
          </div>
        </div>

        {/* Cột phải: Thông tin phòng họp, chọn thiết bị và nút vào phòng */}
        <div className="meeting-prejoin__side-col">
          <header className="meeting-prejoin__head">
            <h1 id="prejoin-title">{title ?? room.name}</h1>
            <p className="meeting-prejoin__sub">
              {room.workspace}
              {title ? ` · ${room.name}` : ""}
            </p>
            {people && (
              <div className="meeting-prejoin__people" role="status">
                <Icon name="users" size={15} />
                <span>{people.length ? `Đang trong phòng: ${people.join(", ")}` : "Chưa có ai trong phòng"}</span>
              </div>
            )}
          </header>

          <div className="meeting-prejoin__card">
            {previewEnabled && (
              <div className="meeting-device-grid">
                <label>
                  Micro
                  <select aria-label="Chọn micro" value={audioInputId} onChange={(event) => setAudioInputId(event.target.value)}>
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
                  <select aria-label="Chọn camera" value={videoInputId} onChange={(event) => setVideoInputId(event.target.value)}>
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
                    <select aria-label="Chọn loa" value={outputDeviceId} onChange={(event) => setOutputDeviceId(event.target.value)}>
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
                    onChange={(event) => setQuality(event.target.value as "low" | "standard" | "high")}
                  >
                    <option value="low">Tiết kiệm dữ liệu · 360p</option>
                    <option value="standard">Rõ nét · 720p</option>
                    <option value="high">Full HD · 1080p</option>
                  </select>
                </label>
              </div>
            )}

            <p className="meeting-connectivity" role="status">
              <span className={isConnected ? "is-online" : ""} />{" "}
              {isConnected ? "Máy chủ đã kết nối · sẵn sàng tham gia" : "Mất kết nối · chưa thể tham gia"}
            </p>

            <div className="meeting-lobby-action">
              <Button
                size="lg"
                icon="video"
                disabled={joining || !isConnected}
                loading={joining}
                onClick={() => void join()}
                style={{ width: "100%", justifyContent: "center" }}
              >
                {joining ? "Đang kết nối…" : "Vào phòng"}
              </Button>
              {joining && (
                <Button variant="secondary" onClick={onCancelJoin}>
                  Hủy tham gia
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
