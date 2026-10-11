// Mesh vs SFU media lab. Each participant is a separate headless Chrome process
// with fake camera/mic; the SFU path runs the real API + mediasoup in-process.
//
//   npm run lab -- --mode=sfu --clients=2,4,6 --seconds=60
//   npm run lab -- --mode=mesh --clients=2,4,6 --seconds=60
//
// Fixtures (users/workspace) are created per tier and deleted afterwards by exact id.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir, cpus, totalmem, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { Server as SocketServer } from "socket.io";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");
const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value = "true"] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);
const mode = args.mode === "mesh" ? "mesh" : "sfu";
const tiers = String(args.clients ?? "2,4,6")
  .split(",")
  .map(Number)
  .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
const seconds = Math.min(600, Math.max(10, Number(args.seconds ?? 60)));
const warmup = Math.min(120, Math.max(5, Number(args.warmup ?? 15)));
const layer = args.layer === undefined ? null : Number(args.layer);
// --selection=visible|speaker|combined: stream-selection policy on a virtual 1280x720 gallery.
const selection = ["visible", "speaker", "combined"].includes(args.selection) ? args.selection : null;
// --speak=<seconds>: scripted talkers, each peer speaks for one slot of a round-robin cycle.
const speakSlotMs = args.speak ? Math.max(2, Number(args.speak)) * 1000 : null;
const label =
  args.label ??
  [
    mode,
    layer === null ? null : `layer${layer}`,
    args.simulcast === "0" ? "nosimulcast" : null,
    args.render === "0" ? "norender" : null,
    args.policy === "relay" ? "relay" : null,
    selection ? `sel-${selection}` : null,
    speakSlotMs ? `speak${speakSlotMs / 1000}s` : null,
  ]
    .filter(Boolean)
    .join("-");
const apiPort = Number(args.apiPort ?? 3101);
const labPort = Number(args.labPort ?? 3102);
const chromePath =
  args.chrome ??
  [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((path) => existsSync(path));
if (!chromePath) throw new Error("Chrome/Edge not found; pass --chrome=<path>");
if (!tiers.length) throw new Error("--clients must list values between 1 and 12");

// ---------- client bundle ----------
const buildDir = join(here, ".build");
await mkdir(buildDir, { recursive: true });
await build({
  entryPoints: [join(here, "client/lab.ts")],
  bundle: true,
  format: "iife",
  target: "chrome120",
  outfile: join(buildDir, "lab.js"),
  logLevel: "warning",
});
const assets = {
  "/lab.html": [await readFile(join(here, "client/lab.html")), "text/html; charset=utf-8"],
  "/lab.js": [await readFile(join(buildDir, "lab.js")), "text/javascript; charset=utf-8"],
};

// ---------- API (SFU) in-process ----------
const labOrigin = `http://127.0.0.1:${labPort}`;
process.env.WEB_ORIGIN = labOrigin;
process.env.SOCKET_ADAPTER = "local";
// Browsers do not gather loopback candidates, so an SFU announcing 127.0.0.1 is only
// reachable over ICE-TCP. Announce the LAN address to keep media on UDP.
const lanCandidates = Object.entries(networkInterfaces()).flatMap(([name, items]) =>
  (items ?? [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => ({ name, address: item.address })),
);
// Prefer a physical LAN adapter over VPN/virtual switches.
const lanIp = (
  lanCandidates.find((c) => /^(192\.168|10\.)/.test(c.address) && !/vEthernet|VPN|WSL/i.test(c.name)) ??
  lanCandidates.find((c) => !/vEthernet|VPN|WSL/i.test(c.name)) ??
  lanCandidates[0]
)?.address;
const announcedIp = args.announcedIp ?? lanIp ?? "127.0.0.1";
process.env.MEDIASOUP_ANNOUNCED_IP = announcedIp;
const { pool } = await import("../../dist/api/infrastructure/database/db.js");
const { createApiServer } = await import("../../dist/api/server.js");
const { createAccessToken } = await import("../../dist/api/modules/auth/tokens.js");
const { createWorkspace, addWorkspaceMember, getWorkspaceChannels } = await import(
  "../../dist/api/modules/workspaces/service.js"
);
const { roomManager } = await import("../../dist/api/modules/meetings/media/room-manager.js");
// --join=1: peers join an existing room on a running API (UI verification), nothing is measured.
const joinMode = args.join === "1";
const api = mode === "sfu" && !joinMode ? createApiServer() : null;
if (api) await new Promise((resolve) => api.listen(apiPort, "127.0.0.1", resolve));

// ---------- static page + mesh relay ----------
const lab = createServer((request, response) => {
  const asset = assets[(request.url ?? "/").split("?")[0]];
  if (!asset) {
    response.statusCode = 404;
    response.end();
    return;
  }
  response.setHeader("Content-Type", asset[1]);
  response.end(asset[0]);
});
const relay = new SocketServer(lab, { cors: { origin: labOrigin } });
relay.on("connection", (socket) => {
  socket.on("join", async ({ room }) => {
    const ids = [...(relay.sockets.adapter.rooms.get(room) ?? [])];
    await socket.join(room);
    socket.data.room = room;
    socket.emit("peers", ids);
  });
  socket.on("signal", (message) => relay.to(message.to).emit("signal", { ...message, from: socket.id }));
  socket.on("disconnect", () => {
    if (socket.data.room) relay.to(socket.data.room).emit("peer_left", socket.id);
  });
});
await new Promise((resolve) => lab.listen(labPort, "127.0.0.1", resolve));

// ---------- CDP helpers ----------
class Cdp {
  static async open(url) {
    const cdp = new Cdp();
    cdp.ws = new WebSocket(url);
    cdp.id = 0;
    cdp.pending = new Map();
    cdp.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const waiter = cdp.pending.get(message.id);
      if (!waiter) return;
      cdp.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    };
    await new Promise((resolve, reject) => {
      cdp.ws.onopen = resolve;
      cdp.ws.onerror = reject;
    });
    return cdp;
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout ${method}`));
      }, 15000);
    });
  }
  close() {
    this.ws.close();
  }
}

async function launchChrome(url, index) {
  const profile = join(tmpdir(), `media-lab-${process.pid}-${index}-${randomUUID()}`);
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--disable-features=WebRtcHideLocalIpsWithMdns",
      // Fake-camera frames come from the GPU process, which fails in headless mode here;
      // SwiftShader keeps the track live (same software path for mesh and SFU runs).
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--no-first-run",
      "--no-default-browser-check",
      "--mute-audio",
      url,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  // A browser that starts after the timeout must not survive as an orphan peer.
  const fail = (error) => {
    child.kill();
    throw error;
  };
  const browserUrl = await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Chrome did not start")), 20000);
    child.stderr.on("data", (chunk) => {
      buffer += chunk;
      const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.once("exit", () => reject(new Error("Chrome exited early")));
  }).catch(fail);
  const browser = await Cdp.open(browserUrl);
  const port = new URL(browserUrl).port;
  let pageUrl;
  for (let attempt = 0; attempt < 50 && !pageUrl; attempt++) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
    pageUrl = targets.find((t) => t.type === "page" && t.url.includes("lab.html"))
      ?.webSocketDebuggerUrl;
    if (!pageUrl) await delay(200);
  }
  if (!pageUrl) fail(new Error("Lab page target not found"));
  const page = await Cdp.open(pageUrl);
  return { child, browser, page, profile };
}

async function evaluate(client, expression) {
  const result = await client.page.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  return result.result.value;
}

async function cpuSeconds(client) {
  const info = await client.browser.send("SystemInfo.getProcessInfo");
  return info.processInfo.reduce((sum, item) => sum + item.cpuTime, 0);
}

async function workerCpuMs() {
  const usage = await roomManager.resourceUsage();
  return usage.reduce((sum, item) => sum + item.usage.ru_utime + item.usage.ru_stime, 0);
}

// ---------- statistics ----------
const finite = (values) => values.filter((v) => typeof v === "number" && Number.isFinite(v));
const mean = (values) => {
  const v = finite(values);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const percentile = (values, p) => {
  const v = finite(values).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)] : null;
};
const round = (value, digits = 1) =>
  value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits;

// ---------- one tier ----------
async function runTier(n) {
  const users = Array.from({ length: n }, () => randomUUID());
  const runId = randomUUID();
  let workspace = null;
  const clients = [];
  try {
    for (const id of users)
      await pool.query(
        `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only',$3,true)`,
        [id, `lab-${id}@example.test`, `Lab ${id.slice(0, 4)}`],
      );
    let room;
    if (joinMode) {
      for (const id of users) await addWorkspaceMember(args.workspace, id);
      room = { id: args.room };
    } else {
      workspace = await createWorkspace(users[0], `Media lab ${runId.slice(0, 8)}`);
      for (const id of users.slice(1)) await addWorkspaceMember(workspace.id, id);
      room = (await getWorkspaceChannels(users[0], workspace.id)).find((c) => c.type === "video");
    }
    // Talk schedule starts once every client should be connected; until then all are silent.
    const speakEpoch = speakSlotMs ? Date.now() + n * 1500 + 5000 : null;
    for (let i = 0; i < n; i++) {
      const query = new URLSearchParams({ mode, peer: `p${i}`, room: mode === "sfu" ? room.id : runId });
      if (selection) query.set("selection", selection);
      if (speakSlotMs) {
        query.set("speak", "1");
        query.set("epoch", String(speakEpoch));
        query.set("slot", String(speakSlotMs));
        query.set("index", String(i));
        query.set("count", String(n));
      }
      if (args.render === "0") query.set("render", "0");
      if (mode === "sfu") {
        query.set("api", joinMode ? (args.api ?? "http://localhost:3001") : `http://127.0.0.1:${apiPort}`);
        query.set("token", await createAccessToken(users[i]));
        if (layer !== null) query.set("layer", String(layer));
        if (args.simulcast === "0") query.set("simulcast", "0");
        if (args.policy === "relay") query.set("policy", "relay");
      } else query.set("relay", labOrigin);
      clients.push(await launchChrome(`${labOrigin}/lab.html?${query}`, i));
      await delay(1500);
    }
    // Wait until every client receives video from every other client.
    const deadline = Date.now() + 60000;
    for (;;) {
      const states = await Promise.all(
        clients.map((c) =>
          evaluate(c, "({ready: __lab.ready, error: __lab.error, frames: Object.keys(__lab.firstFrames).length, logs: __lab.logs.slice(-8), videos: [...document.querySelectorAll('video')].map(v => v.readyState + ':' + v.videoWidth + ':' + v.paused), down: __lab.samples.at(-1)?.downVideoKbps, up: __lab.samples.at(-1)?.upVideoKbps, upAll: __lab.samples.at(-1)?.upKbps, downAll: __lab.samples.at(-1)?.downKbps})"),
        ),
      );
      const failed = states.find((s) => s?.error);
      if (failed) throw new Error(`client error: ${failed.error}`);
      if (states.every((s) => s?.ready && s.frames >= n - 1)) break;
      if (Date.now() > deadline)
        throw new Error(`tier ${n}: not all video connected ${JSON.stringify(states)}`);
      await delay(1000);
    }
    if (joinMode) {
      console.log(`[join] ${n} peers in room ${room.id}; holding ${args.hold ?? 300}s`);
      await delay(Number(args.hold ?? 300) * 1000);
      return { summary: { clients: n, joined: true } };
    }
    console.log(`[${label}] ${n} clients connected, warmup ${warmup}s`);
    await delay(warmup * 1000);

    const windowStart = await Promise.all(clients.map((c) => evaluate(c, "performance.now()")));
    const wallStart = Date.now();
    const cpuSamples = clients.map(() => []);
    const serverSamples = [];
    let lastCpu = await Promise.all(clients.map(cpuSeconds));
    let lastWorker = mode === "sfu" ? await workerCpuMs() : 0;
    let lastProcess = process.cpuUsage();
    let lastTime = performance.now();
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      await delay(2000);
      const now = performance.now();
      const elapsed = (now - lastTime) / 1000;
      const cpu = await Promise.all(clients.map(cpuSeconds));
      cpu.forEach((value, i) => cpuSamples[i].push(((value - lastCpu[i]) / elapsed) * 100));
      const node = process.cpuUsage(lastProcess);
      const worker = mode === "sfu" ? await workerCpuMs() : 0;
      serverSamples.push({
        workerCpuPct: mode === "sfu" ? ((worker - lastWorker) / 1000 / elapsed) * 100 : null,
        nodeCpuPct: ((node.user + node.system) / 1e6 / elapsed) * 100,
        rssMiB: process.memoryUsage().rss / 2 ** 20,
      });
      lastCpu = cpu;
      lastWorker = worker;
      lastProcess = process.cpuUsage();
      lastTime = now;
    }

    const perClient = [];
    for (let i = 0; i < n; i++) {
      const data = await evaluate(clients[i], "__lab");
      const window = data.samples.filter((s) => s.t >= windowStart[i] - 1);
      perClient.push({
        peer: `p${i}`,
        joinedAtMs: round(data.joinedAt, 0),
        firstFrameMs: round(mean(Object.values(data.firstFrames)), 0),
        samples: window,
        cpuPct: cpuSamples[i],
        mean: {
          upKbps: round(mean(window.map((s) => s.upKbps))),
          downKbps: round(mean(window.map((s) => s.downKbps))),
          upVideoKbps: round(mean(window.map((s) => s.upVideoKbps))),
          downVideoKbps: round(mean(window.map((s) => s.downVideoKbps))),
          rttMs: round(mean(window.map((s) => s.rttMs)), 2),
          audioJitterMs: round(mean(window.map((s) => s.audioJitterMs)), 2),
          videoJitterMs: round(mean(window.map((s) => s.videoJitterMs)), 2),
          lossPct: round(mean(window.map((s) => s.lossPct)), 3),
          activeEncoders: round(mean(window.map((s) => s.activeEncoders))),
          sendWidth: round(mean(window.map((s) => s.sendWidth)), 0),
          recvFps: round(mean(window.map((s) => s.recvFpsAvg))),
          jitterBufferMs: round(mean(window.map((s) => s.jitterBufferMs)), 1),
          nackPerMin: round(((window.at(-1)?.nackCount ?? 0) - (window[0]?.nackCount ?? 0)) / (seconds / 60), 1),
          protocols: [...new Set(window.map((s) => s.protocols))].join("|"),
          cpuPct: round(mean(cpuSamples[i])),
          limited: window.filter((s) => s.qualityLimitation).length / Math.max(1, window.length),
        },
      });
    }
    const speaker = speakSlotMs
      ? await speakerMetrics(clients, n, speakEpoch, speakSlotMs, wallStart, Date.now())
      : null;
    const pick = (key) => perClient.map((c) => c.mean[key]);
    const summary = {
      clients: n,
      upKbps: { mean: round(mean(pick("upKbps"))), p95: round(percentile(pick("upKbps"), 95)) },
      downKbps: { mean: round(mean(pick("downKbps"))), p95: round(percentile(pick("downKbps"), 95)) },
      clientCpuPct: { mean: round(mean(pick("cpuPct"))), p95: round(percentile(pick("cpuPct"), 95)) },
      activeEncoders: round(mean(pick("activeEncoders"))),
      rttMs: round(mean(pick("rttMs")), 2),
      audioJitterMs: round(mean(pick("audioJitterMs")), 2),
      videoJitterMs: round(mean(pick("videoJitterMs")), 2),
      lossPct: round(mean(pick("lossPct")), 3),
      recvFps: round(mean(pick("recvFps"))),
      jitterBufferMs: round(mean(pick("jitterBufferMs")), 1),
      nackPerMin: round(mean(pick("nackPerMin")), 1),
      protocols: [...new Set(pick("protocols"))].join("|"),
      firstFrameMs: round(mean(perClient.map((c) => c.firstFrameMs)), 0),
      qualityLimitedShare: round(mean(pick("limited")), 2),
      serverWorkerCpuPct: round(mean(serverSamples.map((s) => s.workerCpuPct))),
      serverNodeCpuPct: round(mean(serverSamples.map((s) => s.nodeCpuPct))),
      serverRssMiB: round(Math.max(...serverSamples.map((s) => s.rssMiB))),
      downVideoKbps: {
        mean: round(mean(pick("downVideoKbps"))),
        p95: round(percentile(pick("downVideoKbps"), 95)),
      },
      ...(speaker ? { speaker } : {}),
    };
    if (args.diag && mode === "sfu") {
      const legs = { producer: [], consumer: [] };
      for (const roomState of roomManager.rooms.values())
        for (const peer of roomState.peers.values()) {
          for (const producer of peer.producers.values())
            if (producer.kind === "video")
              legs.producer.push(
                ...(await producer.getStats()).map((x) => ({
                  rid: x.rid,
                  jitter: x.jitter,
                  lost: x.packetsLost,
                  count: x.packetCount,
                  nack: x.nackCount,
                  bitrate: x.bitrate,
                })),
              );
          for (const consumer of peer.consumers.values())
            if (consumer.kind === "video")
              legs.consumer.push(
                ...(await consumer.getStats())
                  .filter((x) => x.type === "outbound-rtp")
                  .map((x) => ({
                    lost: x.packetsLost,
                    count: x.packetCount,
                    nack: x.nackCount,
                    retransmitted: x.packetsRetransmitted,
                    bitrate: x.bitrate,
                    score: x.score,
                  })),
              );
        }
      console.log("diag", JSON.stringify(legs));
      for (const client of clients) {
        const raw = await client.page.send("Runtime.evaluate", {
          expression: "__labRaw()",
          awaitPromise: true,
          returnByValue: true,
        });
        console.log("raw", JSON.stringify(raw.result.value));
      }
    }
    console.log(`[${label}] ${n} clients`, JSON.stringify(summary));
    return { runId, summary, perClient, server: serverSamples, speakerDetail: speaker?.detail };
  } finally {
    for (const client of clients) {
      await client.browser.send("Browser.close").catch(() => undefined);
      client.browser.close();
      client.page.close();
      client.child.kill();
    }
    await delay(1500);
    for (const client of clients)
      await rm(client.profile, { recursive: true, force: true }).catch(() => undefined);
    // Cleanup must not mask the tier's own error, and must run even if one step fails.
    try {
      if (workspace) await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspace.id]);
      // In --join mode the room outlives the fixtures: drop sessions they hosted
      // (host_id has no ON DELETE action) before deleting the lab users.
      await pool.query(`DELETE FROM meeting_sessions WHERE host_id=ANY($1::uuid[])`, [users]);
      await pool.query(
        `DELETE FROM users WHERE id=ANY($1::uuid[]) AND email LIKE 'lab-%@example.test'`,
        [users],
      );
    } catch (error) {
      console.error(`[${label}] fixture cleanup failed: ${error.message}`);
    }
  }
}

// Speaker detection against the known schedule. For each slot fully inside the window and
// each client: latency = first active_speaker event naming the scheduled talker minus the
// slot start; a slot with no such event before it ends is missed. Events naming someone else
// while a talker is scheduled are counted as wrong (late or spurious switches).
async function speakerMetrics(clients, n, epoch, slot, from, to) {
  const states = await Promise.all(
    clients.map((c) => evaluate(c, "({socketId: __lab.socketId, events: __lab.speakerEvents, layerRequests: __lab.layerRequests})")),
  );
  const indexOf = new Map(states.map((state, i) => [state.socketId, i]));
  const latencies = [];
  let missed = 0,
    wrong = 0,
    slots = 0;
  const firstSlot = Math.ceil((from - epoch) / slot);
  const lastSlot = Math.floor((to - epoch) / slot) - 1;
  for (let k = firstSlot; k <= lastSlot; k++) {
    const start = epoch + k * slot;
    const talker = k % n;
    for (const state of states) {
      slots++;
      const events = state.events.filter((e) => e.at >= start && e.at < start + slot);
      const hit = events.find((e) => indexOf.get(e.socketId) === talker);
      if (hit) latencies.push(hit.at - start);
      else missed++;
      wrong += events.filter((e) => e.socketId && indexOf.get(e.socketId) !== talker).length;
    }
  }
  return {
    slotSeconds: slot / 1000,
    slots,
    detectionMs: {
      mean: round(mean(latencies), 0),
      p50: round(percentile(latencies, 50), 0),
      p95: round(percentile(latencies, 95), 0),
    },
    missedShare: round(slots ? missed / slots : null, 3),
    wrongEventsPerSlot: round(slots ? wrong / slots : null, 3),
    layerRequestsPerClient: round(mean(states.map((state) => state.layerRequests)), 1),
    detail: { latencies },
  };
}

const environment = {
  date: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform} ${process.arch}`,
  cpu: cpus()[0]?.model,
  logicalCores: cpus().length,
  memoryGiB: round(totalmem() / 2 ** 30, 2),
  browser: chromePath,
  network: "all clients and the SFU on one host; SFU announced on the LAN address",
  capture: "Chromium fake device, ideal 960x540@30 (delivers 20 fps), VP8/Opus, SwiftShader",
  remoteRendering: args.render === "0" ? "off (decode only)" : "160x90 <video> per remote track",
  sfuEncodings: "simulcast q/h/f 150/400/1200 kbps (production client)",
  meshEncodings: "single encoding, maxBitrate 1200 kbps per peer connection",
  consumerLayer: selection
    ? `${selection} policy on a virtual 1280x720 gallery (apps/web speaker-policy.ts)`
    : layer ?? "auto (app policy: >6 consumers -> 0, >2 -> 1, else 2)",
  talkers: speakSlotMs
    ? `scripted: 180 Hz tone, 4 Hz syllable modulation, round-robin ${speakSlotMs / 1000}s slots`
    : "Chromium fake microphone (continuous beep)",
  speakerObserver: "mediasoup ActiveSpeakerObserver 300 ms, AudioLevelObserver 400 ms / -60 dBov",
  sfuAnnouncedIp: mode === "sfu" ? announcedIp : null,
  icePolicy: args.policy === "relay" ? `relay only via ${process.env.TURN_URLS}` : "all",
  warmupSeconds: warmup,
  measureSeconds: seconds,
};
const outDir = join(root, "docs/evidence/media-lab");
await mkdir(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const outFile = join(outDir, `${label}-${stamp}.json`);
const results = [];
// --join runs measure nothing, so they leave no evidence file.
const save = () =>
  joinMode ? Promise.resolve() : writeFile(outFile, JSON.stringify({ label, mode, environment, results }, null, 2));
try {
  for (const n of tiers) {
    try {
      results.push(await runTier(n));
    } catch (error) {
      // A tier that cannot complete (e.g. host saturation) is recorded, not hidden.
      console.error(`[${label}] ${n} clients failed: ${error.message}`);
      results.push({ summary: { clients: n, failed: error.message.slice(0, 500) } });
    }
    await save();
    await delay(3000);
  }
} finally {
  relay.close();
  await new Promise((resolve) => lab.close(resolve));
  if (api) {
    roomManager.close();
    await new Promise((resolve) => api.close(resolve));
  }
  await pool.end();
}
if (!joinMode) console.log(`raw results: ${outFile}`);
