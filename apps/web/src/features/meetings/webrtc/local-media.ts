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
