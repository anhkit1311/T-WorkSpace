import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import type { Consumer, PlainTransport, Router } from "mediasoup/types";
import type { ProducerInfo } from "@doan/shared";
import { config } from "../../../config/config.js";
import { spawnFfmpeg } from "./ffmpeg.js";

// MT-1 live side. Each stream the SFU forwards goes through its own PlainTransport to a UDP port
// FFmpeg listens on; FFmpeg only copies the packets into a Matroska "part" (no decoding), so the
// recording costs almost no CPU during the meeting. A new part starts whenever the set of
// streams changes (someone joins, the speaker changes); parts overlap briefly at a switch and
// the manifest keeps their start times so post-processing can cut them back to back.

export type RecordedProducer = ProducerInfo & { paused: boolean };
export type RoomSource = { router: Router; dominantSocketId: string | null; producers: RecordedProducer[] };

export type PartInfo = { file: string; audio: number; video: boolean; startedAt: number; endedAt: number | null };
export type Manifest = { parts: PartInfo[] };

const POLL_MS = 2000;
/** A different choice of streams must hold this long before a new part starts. */
const SWITCH_HOLD_MS = 4000;
/** FFmpeg must be listening before the SFU sends; packets before that are lost. */
const LISTEN_DELAY_MS = 1500;

/** Everyone's microphone, and one picture: a screen share, else the speaker, else any camera. */
export function chooseStreams(producers: RecordedProducer[], dominantSocketId: string | null) {
  const audio = producers.filter((item) => item.kind === "audio").sort((a, b) => a.producerId.localeCompare(b.producerId));
  const videos = producers.filter((item) => item.kind === "video" && !item.paused);
  const video =
    videos.find((item) => item.source === "screen") ??
    videos.find((item) => item.socketId === dominantSocketId) ??
    videos[0] ??
    null;
  return { audio, video, key: [...audio.map((item) => item.producerId), video?.producerId ?? "-"].join(",") };
}

// RTP/RTCP port pairs shared by every recording on this instance.
const usedPorts = new Set<number>();
export function takePort() {
  for (let port = config.recordingRtpMinPort; port + 1 <= config.recordingRtpMaxPort; port += 2)
    if (!usedPorts.has(port)) {
      usedPorts.add(port);
      return port;
    }
  throw new Error("No free recording ports");
}
export const releasePort = (port: number) => usedPorts.delete(port);

type Stream = { transport: PlainTransport; consumer: Consumer; port: number };

class LivePart {
  private streams: Stream[] = [];
  private ports: number[] = [];
  private transports: PlainTransport[] = [];
  private ffmpeg: ChildProcess | null = null;
  private exited: Promise<void> = Promise.resolve();

  constructor(readonly info: PartInfo) {}

  async start(source: RoomSource, choice: ReturnType<typeof chooseStreams>, dir: string) {
    const items = [...choice.audio, ...(choice.video ? [choice.video] : [])];
    try {
      for (const item of items) {
        const port = takePort();
        this.ports.push(port);
        const transport = await source.router.createPlainTransport({ listenIp: "127.0.0.1", rtcpMux: false, comedia: false });
        this.transports.push(transport);
        await transport.connect({ ip: "127.0.0.1", port, rtcpPort: port + 1 });
        const consumer = await transport.consume({ producerId: item.producerId, rtpCapabilities: source.router.rtpCapabilities, paused: true });
        this.streams.push({ transport, consumer, port });
      }
      const sdpFile = this.info.file.replace(/\.mkv$/, ".sdp");
      await writeFile(path.join(config.mediaDir, dir, sdpFile), sdp(this.streams));
      this.ffmpeg = spawnFfmpeg(
        [
          "-protocol_whitelist", "file,udp,rtp", "-analyzeduration", "3M", "-probesize", "2M",
          "-f", "sdp", "-i", `${dir}/${sdpFile}`, "-map", "0", "-c", "copy",
          "-max_interleave_delta", "2000000", "-y", "-f", "matroska", `${dir}/${this.info.file}`,
        ],
        true,
      );
      const child = this.ffmpeg;
      child.stderr!.on("data", (chunk: Buffer) =>
        console.error(JSON.stringify({ level: "warn", event: "recording_ffmpeg", message: chunk.toString().trim().slice(0, 300) })),
      );
      this.exited = new Promise((resolve) => {
        child.on("close", () => resolve());
        child.on("error", () => resolve());
      });
      await new Promise((resolve) => setTimeout(resolve, LISTEN_DELAY_MS));
      this.info.startedAt = Date.now();
      for (const stream of this.streams) await stream.consumer.resume();
      // A part has to start on a keyframe; ask twice in case the first one is lost.
      for (const delay of [0, 1500])
        setTimeout(() => this.streams.forEach((stream) => stream.consumer.kind === "video" && void stream.consumer.requestKeyFrame().catch(() => {})), delay);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async stop() {
    this.info.endedAt ??= Date.now();
    const child = this.ffmpeg;
    if (child && child.exitCode === null) {
      child.stdin?.end("q");
      const timer = setTimeout(() => child.kill(), 10000);
      await this.exited;
      clearTimeout(timer);
    }
    for (const transport of this.transports) transport.close();
    for (const port of this.ports) releasePort(port);
    this.ports = [];
    this.transports = [];
    this.streams = [];
  }
}

/**
 * Records one room until stop() or until the room empties. The part list is kept in
 * manifest.json next to the parts, so a restart can still process what was recorded.
 */
export class RoomRecorder {
  private manifest: Manifest = { parts: [] };
  private current: LivePart | null = null;
  private currentKey = "";
  private pending: { key: string; since: number } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private busy: Promise<void> = Promise.resolve();
  private stopped = false;
  readonly done: Promise<Manifest>;
  private finish!: (manifest: Manifest) => void;

  constructor(
    private readonly dir: string,
    private readonly source: () => RoomSource | null,
  ) {
    this.done = new Promise((resolve) => (this.finish = resolve));
  }

  async start() {
    await mkdir(path.join(config.mediaDir, this.dir), { recursive: true });
    await this.tick();
    this.timer = setInterval(() => void this.tick(), POLL_MS);
  }

  stop(): Promise<Manifest> {
    if (!this.stopped) {
      this.stopped = true;
      if (this.timer) clearInterval(this.timer);
      this.busy = this.busy.then(async () => {
        await this.current?.stop();
        this.current = null;
        await this.save();
        this.finish(this.manifest);
      });
    }
    return this.done;
  }

  private tick() {
    this.busy = this.busy.then(async () => {
      if (this.stopped) return;
      const source = this.source();
      if (!source) return void this.stop();
      const choice = chooseStreams(source.producers, source.dominantSocketId);
      if (choice.key === this.currentKey) return void (this.pending = null);
      const now = Date.now();
      if (this.pending?.key !== choice.key) this.pending = { key: choice.key, since: now };
      // Waiting is only worth it while the current part still has its picture.
      const urgent = !this.current || (this.current.info.video && !choice.video);
      if (!urgent && now - this.pending.since < SWITCH_HOLD_MS) return;
      this.pending = null;
      await this.switchTo(source, choice).catch((error) =>
        console.error(JSON.stringify({ level: "error", event: "recording_part_failed", message: String(error) })),
      );
    });
    return this.busy;
  }

  private async switchTo(source: RoomSource, choice: ReturnType<typeof chooseStreams>) {
    const previous = this.current;
    let next: LivePart | null = null;
    if (choice.audio.length || choice.video) {
      next = new LivePart({
        file: `part-${String(this.manifest.parts.length + 1).padStart(4, "0")}.mkv`,
        audio: choice.audio.length,
        video: Boolean(choice.video),
        startedAt: Date.now(),
        endedAt: null,
      });
      // On failure the previous part keeps running and the next tick tries again.
      await next.start(source, choice, this.dir);
      this.manifest.parts.push(next.info);
    }
    this.current = next;
    this.currentKey = choice.key;
    // The new part is already capturing, so the old one can stop without a gap.
    await previous?.stop();
    await this.save();
  }

  private save() {
    return writeFile(path.join(config.mediaDir, this.dir, "manifest.json"), JSON.stringify(this.manifest));
  }
}

export function sdp(streams: { consumer: Consumer; port: number }[]) {
  const lines = ["v=0", "o=- 0 0 IN IP4 127.0.0.1", "s=nexo-recording", "c=IN IP4 127.0.0.1", "t=0 0"];
  for (const { consumer, port } of streams) {
    const codec = consumer.rtpParameters.codecs[0];
    const [, name] = codec.mimeType.split("/");
    lines.push(
      `m=${consumer.kind} ${port} RTP/AVP ${codec.payloadType}`,
      `a=rtpmap:${codec.payloadType} ${name}/${codec.clockRate}${codec.channels ? `/${codec.channels}` : ""}`,
      `a=rtcp:${port + 1}`,
      "a=recvonly",
    );
  }
  return lines.join("\r\n") + "\r\n";
}
