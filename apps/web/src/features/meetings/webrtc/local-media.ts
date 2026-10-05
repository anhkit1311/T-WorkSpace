export interface JoinMediaOptions {
  audioInputId?: string;
  videoInputId?: string;
  quality?: "low" | "standard" | "high";
  micEnabled?: boolean;
  cameraEnabled?: boolean;
}

export function mediaConstraints(options: JoinMediaOptions): MediaStreamConstraints {
  const dimensions =
    options.quality === "low"
      ? { width: 640, height: 360 }
      : options.quality === "high"
        ? { width: 1280, height: 720 }
        : { width: 960, height: 540 };
  return {
    audio:
      options.micEnabled === false
        ? false
        : options.audioInputId
          ? { deviceId: { ideal: options.audioInputId } }
          : true,
    video:
      options.cameraEnabled === false
        ? false
        : {
            deviceId: options.videoInputId ? { ideal: options.videoInputId } : undefined,
            width: { ideal: dimensions.width },
            height: { ideal: dimensions.height },
          },
  };
}

export async function publishSelectedTracks(
  stream: MediaStream,
  options: JoinMediaOptions,
  publish: (track: MediaStreamTrack, source: "mic" | "webcam") => Promise<unknown>,
) {
  for (const track of stream.getTracks()) {
    const allowed =
      track.kind === "audio" ? options.micEnabled !== false : options.cameraEnabled !== false;
    track.enabled = allowed;
    if (allowed) await publish(track, track.kind === "audio" ? "mic" : "webcam");
  }
}

export type MediaErrorSource = "mic" | "webcam" | "screen";

const blockedMessage =
  "Trình duyệt đang chặn micro/camera. Bấm biểu tượng ổ khóa cạnh thanh địa chỉ, cho phép quyền rồi thử lại.";

/** Friendly Vietnamese text for a getUserMedia/getDisplayMedia failure (never the raw browser message). */
export function mapMediaError(error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return blockedMessage;
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "Không tìm thấy thiết bị.";
    case "NotReadableError":
    case "TrackStartError":
      return "Thiết bị đang được ứng dụng khác sử dụng.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "Thiết bị đã chọn không còn khả dụng.";
    default:
      return "Không truy cập được thiết bị. Hãy kiểm tra thiết bị rồi thử lại.";
  }
}

export function mediaErrorTitle(source: MediaErrorSource, turningOn = true): string {
  if (source === "screen") return "Không chia sẻ được màn hình";
  const device = source === "mic" ? "micro" : "camera";
  return `${turningOn ? "Không bật được" : "Không tắt được"} ${device}`;
}

/**
 * Closing the browser's screen picker rejects with NotAllowedError (or AbortError);
 * that is the user's choice, not a failure. An OS-level block says "by system".
 */
export function isScreenPickerCancel(error: unknown): boolean {
  if (!(error instanceof Error || error instanceof DOMException)) return false;
  if (error.name === "AbortError") return true;
  return error.name === "NotAllowedError" && !/system/i.test(error.message);
}
