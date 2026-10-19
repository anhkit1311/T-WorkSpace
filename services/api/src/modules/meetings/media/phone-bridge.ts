import { randomInt } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import type { Consumer, PlainTransport } from "mediasoup/types";
import type { ProducerInfo } from "@doan/shared";
import { config } from "../../../config/config.js";
import { spawnFfmpeg } from "../recording/ffmpeg.js";
import { releasePort, sdp, takePort } from "../recording/recorder.js";
import { roomManager } from "./room-manager.js";

// M1: a phone call in a meeting room. Asterisk only speaks G.711 and the SFU only Opus, so FFmpeg
// transcodes both ways:
//   uplink   Asterisk ExternalMedia (PCMU) -> FFmpeg -> Opus RTP -> PlainTransport producer
//   downlink every other microphone -> PlainTransport consumers -> FFmpeg amix -> PCMU -> Asterisk
// The downlink restarts when the set of microphones changes (polled, like the recorder).

const POLL_MS = 2000;
const LISTEN_DELAY_MS = 800;
const DIR = "phone";

const log = (event: string, details: Record<string, unknown>) =>
  console.error(JSON.stringify({ level: "warn", event, ...details }));

/** FFmpeg's filter that mixes `count` decoded RTP inputs into one stream labelled [a]. */
export function mixFilter(count: number) {
  const labels = Array.from({ length: count }, (_, i) => `[a${i}]`);
  const resampled = labels.map((label, i) => `[0:a:${i}]aresample=async=1${label}`);
  return [...resampled, count === 1 ? "[a0]anull[a]" : `${labels.join("")}amix=inputs=${count}:duration=longest:normalize=0[a]`].join(";");
}

function stopFfmpeg(child: ChildProcess | null) {
  if (!child || child.exitCode !== null) return;
  // "q" also stops FFmpeg inside a container, where killing the docker exec client would not.
  child.stdin?.end("q");
  setTimeout(() => child.exitCode === null && child.kill(), 3000).unref();
}

function spawnLogged(args: string[], event: string) {
  const child = spawnFfmpeg(args, true);
  child.stderr!.on("data", (chunk: Buffer) => log(event, { message: chunk.toString().trim().slice(0, 300) }));
  child.on("error", (error) => log(event, { message: error.message }));
  return child;
}

export class PhoneLeg {
  /** FFmpeg listens here for the caller's voice; Asterisk's ExternalMedia sends to it. */
  readonly listenPort = takePort();
  private readonly sendPort = takePort();
  private readonly name: string;
  private uplink: ChildProcess | null = null;
  private downlink: ChildProcess | null = null;
  private downTransports: PlainTransport[] = [];
  private downPorts: number[] = [];
  private downKey = "";
  private timer: NodeJS.Timeout | null = null;
  private busy: Promise<void> = Promise.resolve();
  private closed = false;
  private producer: ProducerInfo | null = null;

  constructor(
    readonly roomId: string,
    readonly socketId: string,
    private readonly userId: string,
    private readonly displayName: string,
  ) {
    this.name = socketId.replace(/[^A-Za-z0-9-]/g, "-");
  }

  /** Starts both directions once Asterisk has said where it listens; resolves with the new microphone. */
  async connect(asterisk: { address: string; port: number }): Promise<ProducerInfo> {
    await mkdir(path.join(config.mediaDir, DIR), { recursive: true });
    const ssrc = randomInt(1, 2 ** 31);
    const { producer, port, rtcpPort } = await roomManager.addPhonePeer(this.roomId, this.socketId, this.userId, this.displayName, ssrc);
    this.producer = producer;
    const upSdp = `${DIR}/${this.name}-up.sdp`;
    await writeFile(
      path.join(config.mediaDir, upSdp),
      ["v=0", "o=- 0 0 IN IP4 127.0.0.1", "s=nexo-phone", `c=IN IP4 ${asterisk.address}`, "t=0 0", `m=audio ${this.listenPort} RTP/AVP 0`, "a=rtpmap:0 PCMU/8000", "a=recvonly", ""].join("\r\n"),
    );
    this.uplink = spawnLogged(
      [
        "-protocol_whitelist", "file,udp,rtp", "-fflags", "nobuffer", "-analyzeduration", "0", "-f", "sdp", "-i", upSdp,
        "-map", "0:a:0", "-c:a", "libopus", "-application", "voip", "-b:a", "24k", "-ar", "48000", "-ac", "2",
        "-payload_type", "111", "-ssrc", String(ssrc), "-f", "rtp", `rtp://${config.phoneSfuHost}:${port}?rtcpport=${rtcpPort}&pkt_size=1200`,
      ],
      "phone_uplink_ffmpeg",
    );
    this.timer = setInterval(() => this.tick(asterisk), POLL_MS);
    this.tick(asterisk);
    return producer;
  }

  /** How many others (web peers' microphones) the caller can hear right now. */
  others = () => (roomManager.recordingSource(this.roomId)?.producers ?? []).filter((item) => item.socketId !== this.socketId).length;

  private tick(asterisk: { address: string; port: number }) {
    this.busy = this.busy.then(async () => {
      if (this.closed) return;
      const source = roomManager.recordingSource(this.roomId);
      const mics = (source?.producers ?? [])
        .filter((item) => item.kind === "audio" && item.socketId !== this.socketId)
        .sort((a, b) => a.producerId.localeCompare(b.producerId));
      const key = mics.map((item) => item.producerId).join(",");
      if (key === this.downKey) return;
      await this.stopDownlink();
      this.downKey = key;
      if (!source || !mics.length) return;
      try {
        const streams: { consumer: Consumer; port: number }[] = [];
        for (const mic of mics) {
          const port = takePort();
          this.downPorts.push(port);
          const transport = await source.router.createPlainTransport({ listenIp: "127.0.0.1", rtcpMux: false, comedia: false });
          this.downTransports.push(transport);
          await transport.connect({ ip: "127.0.0.1", port, rtcpPort: port + 1 });
          streams.push({ consumer: await transport.consume({ producerId: mic.producerId, rtpCapabilities: source.router.rtpCapabilities, paused: true }), port });
        }
        const downSdp = `${DIR}/${this.name}-down.sdp`;
        await writeFile(path.join(config.mediaDir, downSdp), sdp(streams));
        this.downlink = spawnLogged(
          [
            "-protocol_whitelist", "file,udp,rtp", "-fflags", "nobuffer", "-f", "sdp", "-i", downSdp,
            "-filter_complex", mixFilter(streams.length), "-map", "[a]", "-ac", "1", "-ar", "8000", "-c:a", "pcm_mulaw",
            // A fixed source port: Asterisk's strict RTP keeps the first source it learnt.
            "-f", "rtp", `rtp://${asterisk.address}:${asterisk.port}?localrtpport=${this.sendPort}`,
          ],
          "phone_downlink_ffmpeg",
        );
        await new Promise((resolve) => setTimeout(resolve, LISTEN_DELAY_MS));
        for (const { consumer } of streams) await consumer.resume();
      } catch (error) {
        log("phone_downlink_failed", { message: error instanceof Error ? error.message : String(error) });
        await this.stopDownlink();
        this.downKey = ""; // try again on the next tick
      }
    });
  }

  private async stopDownlink() {
    stopFfmpeg(this.downlink);
    this.downlink = null;
    for (const transport of this.downTransports) transport.close();
    for (const port of this.downPorts) releasePort(port);
    this.downTransports = [];
    this.downPorts = [];
  }

  /** Leaves the room; resolves with the microphone that closed (for producer_closed). */
  async close(): Promise<string[]> {
    if (this.closed) return [];
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    await this.busy;
    await this.stopDownlink();
    stopFfmpeg(this.uplink);
    releasePort(this.listenPort);
    releasePort(this.sendPort);
    const { closedProducerIds } = this.producer ? roomManager.leaveRoom(this.roomId, this.socketId) : { closedProducerIds: [] };
    await rm(path.join(config.mediaDir, DIR, `${this.name}-up.sdp`), { force: true }).catch(() => {});
    await rm(path.join(config.mediaDir, DIR, `${this.name}-down.sdp`), { force: true }).catch(() => {});
    return closedProducerIds;
  }
}
