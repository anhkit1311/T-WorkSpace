import type {
  RtpCodecCapability,
  WorkerLogLevel,
  WorkerLogTag,
  WorkerSettings,
} from "mediasoup/types";

export const mediasoupConfig = {
  worker: {
    rtcMinPort: Number(process.env.MEDIASOUP_MIN_PORT ?? 40000),
    rtcMaxPort: Number(process.env.MEDIASOUP_MAX_PORT ?? 49999),
    logLevel: "warn" as WorkerLogLevel,
    logTags: ["info", "ice", "dtls", "rtp", "srtp", "rtcp"] as WorkerLogTag[],
  } satisfies WorkerSettings,

  router: {
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
        preferredPayloadType: 111,
      },
      {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
        parameters: {
          "x-google-start-bitrate": 1000,
        },
        preferredPayloadType: 96,
      },
    ] satisfies RtpCodecCapability[],
  },

  webRtcTransport: {
    listenIps: [
      {
        ip: "0.0.0.0",
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP ?? "127.0.0.1",
      },
    ],
    initialAvailableOutgoingBitrate: 1_000_000,
    maxSctpMessageSize: 262_144,
  },
};
