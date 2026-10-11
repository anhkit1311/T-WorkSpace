// Media lab client: one headless Chrome instance = one participant.
// SFU mode reuses the production MediasoupClientService; mesh mode opens one
// RTCPeerConnection per remote peer (full mesh) over a tiny relay.
import { io, type Socket } from "socket.io-client";
import { MediasoupClientService } from "../../../apps/web/src/features/meetings/webrtc/mediasoup-service";
import type { TransportOptions } from "../../../packages/shared/src/index";
import {
  bestGridLayout,
  layerForTile,
  pageSizeFor,
  paginate,
} from "../../../apps/web/src/features/meetings/grid-layout";
import {
  applyLayerPolicy,
  isLayerPolicy,
  type LayerDemand,
} from "../../../apps/web/src/features/meetings/speaker-policy";

type Mode = "sfu" | "mesh";
interface Sample {
  t: number;
  upKbps: number;
  downKbps: number;
  upVideoKbps: number;
  downVideoKbps: number;
  rttMs: number | null;
  audioJitterMs: number | null;
  videoJitterMs: number | null;
  lossPct: number | null;
  activeEncoders: number;
  sendWidth: number | null;
  sendFps: number | null;
  qualityLimitation: string | null;
  recvVideoTracks: number;
  recvFpsAvg: number | null;
  freezeCount: number;
  jitterBufferMs: number | null;
  nackCount: number;
  framesDecoded: number;
  protocols: string;
}
interface LabState {
  mode: Mode;
  ready: boolean;
  error: string | null;
  joinedAt: number | null;
  firstFrames: Record<string, number>;
  samples: Sample[];
  logs: string[];
  socketId: string | null;
  /** active_speaker events as received, wall clock (shared with the harness on one host). */
  speakerEvents: { socketId: string | null; at: number; serverAt: number }[];
  layerRequests: number;
}

const params = new URLSearchParams(location.search);
const mode = (params.get("mode") ?? "sfu") as Mode;
const peerName = params.get("peer") ?? "peer";
const state: LabState = {
  mode,
  ready: false,
  error: null,
  joinedAt: null,
  firstFrames: {},
  samples: [],
  logs: [],
  socketId: null,
  speakerEvents: [],
  layerRequests: 0,
};
(window as unknown as { __lab: LabState }).__lab = state;
const started = performance.now();
const log = (text: string) => {
  const line = document.createElement("div");
  line.textContent = `[${((performance.now() - started) / 1000).toFixed(1)}s] ${text}`;
  state.logs.push(line.textContent);
  document.getElementById("log")?.append(line);
};

// ?speak=1&epoch=<ms>&slot=<ms>&index=i&count=n: a scripted talker. Peer i "speaks" during
// slot i of every n-slot cycle counted from a wall-clock epoch shared by all clients, so the
// harness knows who should be the dominant speaker at any moment. The voice is a 180 Hz tone
// amplitude-modulated at 4 Hz (syllable rate) and gated to silence outside the slot.
function scriptedVoice(): MediaStreamTrack {
  const context = new AudioContext();
  const voice = context.createOscillator();
  voice.frequency.value = 180;
  const syllables = context.createOscillator();
  syllables.frequency.value = 4;
  const depth = context.createGain();
  depth.gain.value = 0.35;
  const envelope = context.createGain();
  envelope.gain.value = 0.5;
  syllables.connect(depth).connect(envelope.gain);
  const gate = context.createGain();
  gate.gain.value = 0;
  const output = context.createMediaStreamDestination();
  voice.connect(envelope).connect(gate).connect(output);
  voice.start();
  syllables.start();
  void context.resume();
  const epoch = Number(params.get("epoch"));
  const slot = Number(params.get("slot"));
  const index = Number(params.get("index"));
  const count = Number(params.get("count"));
  let speaking = false;
  setInterval(() => {
    const now = Date.now();
    const active = now >= epoch && Math.floor((now - epoch) / slot) % count === index;
    if (active === speaking) return;
    speaking = active;
    gate.gain.setTargetAtTime(active ? 1 : 0, context.currentTime, 0.01);
  }, 10);
  return output.stream.getAudioTracks()[0];
}

async function captureLocal(): Promise<MediaStream> {
  const begin = performance.now();
  const scripted = params.get("speak") === "1";
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: !scripted,
    video: {
      width: { ideal: Number(params.get("width") ?? 960) },
      height: { ideal: Number(params.get("height") ?? 540) },
      frameRate: { ideal: 30 },
    },
  });
  if (scripted) stream.addTrack(scriptedVoice());
  log(`getUserMedia ${Math.round(performance.now() - begin)}ms`);
  stream.getTracks().forEach((track) => track.addEventListener("ended", () => log(`local ${track.kind} ended`)));
  return stream;
}

function attachRemote(key: string, track: MediaStreamTrack) {
  log(`track ${track.kind} ${key.slice(0, 12)} ${track.readyState} muted=${track.muted}`);
  // render=0: keep receiving/decoding but skip DOM playback (first frame comes from stats).
  if (params.get("render") === "0") return;
  if (track.kind !== "video") {
    const audio = document.createElement("audio");
    audio.srcObject = new MediaStream([track]);
    audio.autoplay = true;
    audio.muted = true;
    document.getElementById("tiles")?.append(audio);
    return;
  }
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  // Small tiles keep software compositing cost low; decoding is unaffected.
  video.width = 160;
  video.height = 90;
  video.srcObject = new MediaStream([track]);
  document.getElementById("tiles")?.append(video);
  // requestVideoFrameCallback does not fire in headless mode; poll decoded size instead.
  const poll = setInterval(() => {
    if (video.videoWidth > 0) {
      state.firstFrames[key] ??= performance.now() - started;
      clearInterval(poll);
    }
  }, 50);
  void video.play().catch(() => undefined);
}

// ---------- shared stats aggregation ----------
interface Counter {
  bytes: number;
  t: number;
}
const previous = new Map<string, Counter>();
const lossPrevious = new Map<string, { lost: number; received: number }>();
const bufferPrevious = new Map<string, { delay: number; emitted: number }>();
function rate(id: string, bytes: number, t: number): number {
  const old = previous.get(id);
  previous.set(id, { bytes, t });
  if (!old || bytes < old.bytes || t <= old.t) return 0;
  return ((bytes - old.bytes) * 8) / (t - old.t); // bits per ms = kbps
}

async function collect(reports: RTCStatsReport[]): Promise<Sample> {
  const t = performance.now();
  const sample: Sample = {
    t: Math.round(t - started),
    upKbps: 0,
    downKbps: 0,
    upVideoKbps: 0,
    downVideoKbps: 0,
    rttMs: null,
    audioJitterMs: null,
    videoJitterMs: null,
    lossPct: null,
    activeEncoders: 0,
    sendWidth: null,
    sendFps: null,
    qualityLimitation: null,
    recvVideoTracks: 0,
    recvFpsAvg: null,
    freezeCount: 0,
    jitterBufferMs: null,
    nackCount: 0,
    framesDecoded: 0,
    protocols: "",
  };
  const rtts: number[] = [];
  const audioJitter: number[] = [];
  const videoJitter: number[] = [];
  const recvFps: number[] = [];
  let deltaLost = 0;
  let bufferDelay = 0;
  let bufferEmitted = 0;
  const protocols = new Set<string>();
  let deltaReceived = 0;
  reports.forEach((report, index) => {
    report.forEach((stat) => {
      const key = `${index}:${stat.id}`;
      if (stat.type === "outbound-rtp") {
        const kbps = rate(key, (stat.bytesSent ?? 0) + (stat.headerBytesSent ?? 0), t);
        sample.upKbps += kbps;
        if (stat.kind === "video") {
          sample.upVideoKbps += kbps;
          if (kbps > 1) sample.activeEncoders++;
          if ((stat.frameWidth ?? 0) > (sample.sendWidth ?? 0)) {
            sample.sendWidth = stat.frameWidth ?? null;
            sample.sendFps = stat.framesPerSecond ?? null;
          }
          if (stat.qualityLimitationReason && stat.qualityLimitationReason !== "none")
            sample.qualityLimitation = stat.qualityLimitationReason;
        }
      } else if (stat.type === "inbound-rtp") {
        const kbps = rate(key, (stat.bytesReceived ?? 0) + (stat.headerBytesReceived ?? 0), t);
        sample.downKbps += kbps;
        // mediasoup's bandwidth-probation padding (mid "probator", SSRC 1234) is real
        // traffic but not media: keep its bytes, exclude it from quality metrics.
        if (stat.mid === "probator") return;
        const old = lossPrevious.get(key);
        const lost = Math.max(0, stat.packetsLost ?? 0);
        const received = stat.packetsReceived ?? 0;
        if (old && received >= old.received && lost >= old.lost) {
          deltaLost += lost - old.lost;
          deltaReceived += received - old.received;
        }
        lossPrevious.set(key, { lost, received });
        if (typeof stat.jitter === "number")
          (stat.kind === "video" ? videoJitter : audioJitter).push(stat.jitter * 1000);
        if (stat.kind === "video") {
          sample.downVideoKbps += kbps;
          sample.recvVideoTracks++;
          if (typeof stat.framesPerSecond === "number") recvFps.push(stat.framesPerSecond);
          sample.freezeCount += stat.freezeCount ?? 0;
          sample.nackCount += stat.nackCount ?? 0;
          sample.framesDecoded += stat.framesDecoded ?? 0;
          if (params.get("render") === "0" && (stat.framesDecoded ?? 0) > 0)
            state.firstFrames[`${index}:${stat.ssrc}`] ??= t - started;
          const prior = bufferPrevious.get(key);
          const delay = stat.jitterBufferDelay ?? 0;
          const emitted = stat.jitterBufferEmittedCount ?? 0;
          if (prior && emitted > prior.emitted) {
            bufferDelay += delay - prior.delay;
            bufferEmitted += emitted - prior.emitted;
          }
          bufferPrevious.set(key, { delay, emitted });
        }
      } else if (
        stat.type === "candidate-pair" &&
        stat.nominated &&
        stat.state === "succeeded" &&
        typeof stat.currentRoundTripTime === "number"
      ) {
        rtts.push(stat.currentRoundTripTime * 1000);
        const localCandidate = report.get(stat.localCandidateId);
        // protocol and candidate type, e.g. "udp/host" or "udp/relay" (TURN)
        if (localCandidate)
          protocols.add(
            `${localCandidate.protocol}/${localCandidate.candidateType}` +
              (localCandidate.relayProtocol ? `/turn-${localCandidate.relayProtocol}` : ""),
          );
      }
    });
  });
  const avg = (values: number[]) =>
    values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  sample.rttMs = avg(rtts);
  sample.audioJitterMs = avg(audioJitter);
  sample.videoJitterMs = avg(videoJitter);
  sample.recvFpsAvg = avg(recvFps);
  sample.jitterBufferMs = bufferEmitted ? (bufferDelay / bufferEmitted) * 1000 : null;
  sample.protocols = [...protocols].join(",");
  sample.lossPct =
    deltaReceived + deltaLost > 0 ? (deltaLost / (deltaReceived + deltaLost)) * 100 : null;
  return sample;
}

function startSampling(getReports: () => Promise<RTCStatsReport[]>) {
  const tick = async () => {
    try {
      state.samples.push(await collect(await getReports()));
    } catch (error) {
      log(`stats error ${String(error)}`);
    }
  };
  void tick();
  setInterval(tick, Number(params.get("interval") ?? 2000));
}

// ---------- SFU mode (production client + signaling) ----------
function ack<T>(socket: Socket, event: string, data: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    socket
      .timeout(15000)
      .emit(event, data, (error: Error | null, response: T & { success: boolean; error?: string }) => {
        if (error) reject(error);
        else if (!response.success) reject(new Error(response.error ?? `${event} failed`));
        else resolve(response);
      });
  });
}

async function runSfu() {
  const api = params.get("api")!;
  const roomId = params.get("room")!;
  const layer = params.get("layer");
  const socket = io(api, {
    auth: { token: params.get("token") },
    transports: ["websocket"],
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  state.socketId = socket.id ?? null;
  const local = await captureLocal();
  const service = new MediasoupClientService();
  // Listen before joining: a producer created while our transports are still being set up
  // would otherwise be missed (it is neither in the join snapshot nor seen as an event).
  const pendingProducers: string[] = [];
  let consumeReady: ((producerId: string) => void) | null = null;
  socket.on("new_producer", (producer: { producerId: string }) => {
    if (consumeReady) consumeReady(producer.producerId);
    else pendingProducers.push(producer.producerId);
  });
  const joined = await ack<{
    routerRtpCapabilities: unknown;
    existingProducers: { producerId: string }[];
  }>(socket, "join_meeting", { roomId });
  await service.loadDevice(joined.routerRtpCapabilities);
  // ?policy=relay forces both transports through the TURN server returned by the API.
  const policy = params.get("policy") === "relay" ? "relay" : undefined;
  const sendParams = await ack<{ params: TransportOptions }>(socket, "create_webrtc_transport", { roomId });
  if (policy) sendParams.params.iceTransportPolicy = policy;
  const send = service.initSendTransport(
    sendParams.params,
    async (dtlsParameters) => {
      await ack(socket, "connect_webrtc_transport", {
        roomId,
        transportId: send.id,
        dtlsParameters,
      });
    },
    async (kind, rtpParameters, appData) =>
      (
        await ack<{ producerId: string }>(socket, "produce", {
          roomId,
          transportId: send.id,
          kind,
          rtpParameters,
          appData,
        })
      ).producerId,
  );
  const recvParams = await ack<{ params: TransportOptions }>(socket, "create_webrtc_transport", { roomId });
  if (policy) recvParams.params.iceTransportPolicy = policy;
  const recv = service.initRecvTransport(recvParams.params, async (dtlsParameters) => {
    await ack(socket, "connect_webrtc_transport", {
      roomId,
      transportId: recv.id,
      dtlsParameters,
    });
  });
  const consumed = new Set<string>();
  const consume = async (producerId: string) => {
    if (consumed.has(producerId)) return;
    consumed.add(producerId);
    const response = await ack<{ params: never }>(socket, "consume", {
      roomId,
      producerId,
      rtpCapabilities: service.rtpCapabilities,
    });
    const consumer = await service.consume(response.params);
    if (consumer.kind === "video")
      videoOwners.set(consumer.id, (response.params as { producerSocketId: string }).producerSocketId);
    attachRemote(producerId, consumer.track);
    await ack(socket, "resume_consumer", { roomId, consumerId: consumer.id });
    if (consumer.kind === "video") await applyLayers();
  };
  // ?selection=visible|speaker|combined runs the app's stream-selection policy on a virtual
  // 1280x720 gallery (the page itself renders nothing with render=0).
  const selection = params.get("selection");
  const videoOwners = new Map<string, string>();
  const applied = new Map<string, number | null>();
  const lastSpokeAt: Record<string, number> = {};
  let speakerId: string | null = null;
  const applySelection = async () => {
    if (!isLayerPolicy(selection)) return;
    const owners = [...videoOwners.entries()].filter(([id]) =>
      service.getVideoConsumerIds().includes(id),
    );
    const page = paginate(owners, pageSizeFor(1280), 0).items;
    const grid = bestGridLayout(page.length, 1280, 720, 16);
    const base: LayerDemand = Object.fromEntries(
      owners.map(([, owner]) => [owner, page.some(([, o]) => o === owner) ? layerForTile(grid.tileWidth) : null]),
    );
    const target = applyLayerPolicy(base, selection, speakerId, lastSpokeAt, Date.now());
    for (const [consumerId, owner] of owners) {
      const next = target[owner] ?? null;
      const before = applied.has(consumerId) ? applied.get(consumerId)! : 2;
      if (applied.has(consumerId) && before === next) continue;
      applied.set(consumerId, next);
      state.layerRequests++;
      if (next === null) await ack(socket, "pause_consumer", { roomId, consumerId });
      else {
        if (before === null) await ack(socket, "resume_consumer", { roomId, consumerId });
        await ack(socket, "consumer_layer", { roomId, consumerId, spatialLayer: next });
      }
    }
  };
  socket.on("active_speaker", (data: { socketId: string | null; at: number }) => {
    state.speakerEvents.push({ socketId: data.socketId, at: Date.now(), serverAt: data.at });
    speakerId = data.socketId;
    if (data.socketId) lastSpokeAt[data.socketId] = Date.now();
    void applySelection().catch((error) => log(`selection ${String(error)}`));
  });
  socket.on("audio_levels", (data: { levels: { socketId: string }[] }) => {
    for (const level of data.levels) lastSpokeAt[level.socketId] = Date.now();
  });
  if (isLayerPolicy(selection))
    setInterval(() => void applySelection().catch((error) => log(`selection ${String(error)}`)), 2000);
  // Same policy as MeetingContext: >6 video consumers -> layer 0, >2 -> 1, else 2.
  // A numeric ?layer= forces one layer for every consumer instead.
  const applyLayers = async () => {
    if (isLayerPolicy(selection)) return applySelection();
    const consumers = service.getVideoConsumerIds();
    const spatialLayer =
      layer !== null && layer !== "auto"
        ? Number(layer)
        : consumers.length > 6
          ? 0
          : consumers.length > 2
            ? 1
            : 2;
    for (const consumerId of consumers)
      await ack(socket, "consumer_layer", { roomId, consumerId, spatialLayer });
  };
  // Diagnostic: simulcast=0 publishes the camera as a single-encoding "screen" source.
  const videoSource = params.get("simulcast") === "0" ? "screen" : "webcam";
  for (const track of local.getTracks())
    await service.produce(track, track.kind === "audio" ? "mic" : videoSource);
  const consumeLogged = (producerId: string) =>
    void consume(producerId).catch((error) => log(`consume ${String(error)}`));
  consumeReady = consumeLogged;
  pendingProducers.splice(0).forEach(consumeLogged);
  // Same as MeetingContext: re-snapshot once transports exist to catch concurrent joiners.
  const latest = await ack<{ existingProducers: { producerId: string }[] }>(socket, "join_meeting", {
    roomId,
  });
  for (const producer of [...joined.existingProducers, ...latest.existingProducers])
    await consume(producer.producerId);
  state.joinedAt = performance.now() - started;
  state.ready = true;
  log(`sfu joined as ${peerName}`);
  (window as unknown as { __labRaw: () => Promise<unknown> }).__labRaw = async () =>
    [...(await recv.getStats()).values()]
      .filter((x) => x.type === "inbound-rtp")
      .map((x) => ({
        kind: x.kind,
        ssrc: x.ssrc,
        mid: x.mid,
        received: x.packetsReceived,
        lost: x.packetsLost,
        nack: x.nackCount,
        jitter: x.jitter,
        frames: x.framesDecoded,
        rtx: x.retransmittedPacketsReceived,
        bytes: x.bytesReceived,
      }));
  startSampling(async () => [await send.getStats(), await recv.getStats()]);
}

// ---------- Mesh mode (one RTCPeerConnection per remote peer) ----------
async function runMesh() {
  const relay = io(params.get("relay")!, { transports: ["websocket"] });
  const room = params.get("room")!;
  const maxBitrate = Number(params.get("maxBitrate") ?? 1_200_000);
  const local = await captureLocal();
  const peers = new Map<string, RTCPeerConnection>();
  const create = (remote: string) => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    peers.set(remote, pc);
    for (const track of local.getTracks()) {
      const sender = pc.addTrack(track, local);
      if (track.kind === "video") {
        const apply = () => {
          const parameters = sender.getParameters();
          if (!parameters.encodings?.length) return;
          parameters.encodings[0].maxBitrate = maxBitrate;
          void sender.setParameters(parameters).catch(() => undefined);
        };
        pc.addEventListener("connectionstatechange", () => {
          if (pc.connectionState === "connected") apply();
        });
      }
    }
    pc.onicecandidate = (event) => {
      if (event.candidate) relay.emit("signal", { to: remote, candidate: event.candidate });
    };
    pc.ontrack = (event) => attachRemote(`${remote}:${event.track.kind}`, event.track);
    pc.onconnectionstatechange = () => log(`pc ${remote.slice(0, 5)} ${pc.connectionState}`);
    return pc;
  };
  relay.on("peers", async (ids: string[]) => {
    // Newcomer offers to everyone already in the room.
    for (const remote of ids) {
      const pc = create(remote);
      await pc.setLocalDescription(await pc.createOffer());
      relay.emit("signal", { to: remote, description: pc.localDescription });
    }
    state.joinedAt = performance.now() - started;
    state.ready = true;
    log(`mesh joined as ${peerName}, offered to ${ids.length}`);
  });
  relay.on(
    "signal",
    async (message: {
      from: string;
      description?: RTCSessionDescriptionInit;
      candidate?: RTCIceCandidateInit;
    }) => {
      const pc = peers.get(message.from) ?? create(message.from);
      if (message.description) {
        await pc.setRemoteDescription(message.description);
        if (message.description.type === "offer") {
          await pc.setLocalDescription(await pc.createAnswer());
          relay.emit("signal", { to: message.from, description: pc.localDescription });
        }
      } else if (message.candidate) {
        await pc.addIceCandidate(message.candidate).catch(() => undefined);
      }
    },
  );
  relay.on("peer_left", (id: string) => {
    peers.get(id)?.close();
    peers.delete(id);
  });
  relay.emit("join", { room });
  startSampling(() => Promise.all([...peers.values()].map((pc) => pc.getStats())));
}

(mode === "sfu" ? runSfu() : runMesh()).catch((error) => {
  state.error = error instanceof Error ? error.message : String(error);
  log(`fatal ${state.error}`);
});
