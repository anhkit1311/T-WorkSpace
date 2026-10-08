// Generates the thesis diagrams as SVG files in ../build/svg (rendered by render.mjs).
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { C, SUFFIX, svg, text, box, group, arrow, diamond, pill, ellipse, actor, cylinder, sequence } from "./kit.mjs";

const out = join(dirname(fileURLToPath(import.meta.url)), `../build/svg${SUFFIX}`);
await mkdir(out, { recursive: true });
const figs = {};

// ---------- Figure 2.1: ICE / STUN / TURN ----------
figs["fig-2-1-ice"] = svg(
  900,
  390,
  group(20, 50, 290, 250, "Home / office network", { dash: "6 4", stroke: C.clientS }) +
    box(45, 140, 150, 74, ["Browser", "mediasoup-client"], { fill: C.client, stroke: C.clientS, bold: true }) +
    box(235, 140, 80, 74, ["NAT /", "firewall"], { fill: "#f6f8fa", bold: true }) +
    box(400, 30, 190, 58, ["STUN server", "(coturn)"], { fill: C.net, stroke: C.netS, bold: true }) +
    box(400, 290, 190, 58, ["TURN relay", "(coturn)"], { fill: C.net, stroke: C.netS, bold: true }) +
    box(670, 130, 205, 94, ["SFU media server", "mediasoup worker", "public IP · ICE-Lite"], { fill: C.sfu, stroke: C.sfuS, bold: true }) +
    arrow([[195, 177], [235, 177]], { both: true }) +
    arrow([[315, 177], [670, 177]], { both: true, label: ["① direct path: host / server-reflexive", "candidate (UDP, fallback ICE-TCP)"], at: [492, 177] }) +
    arrow([[315, 152], [400, 70]], { dash: "6 4", label: "Binding request", at: [430, 118], noBg: true }) +
    arrow([[315, 203], [400, 315]], { dash: "6 4", both: true }) +
    arrow([[590, 315], [700, 315], [700, 224]], { dash: "6 4", both: true, label: ["② relay path", "(UDP blocked / symmetric NAT)"], at: [700, 262] }) +
    box(612, 330, 270, 52, null, { fill: "#fafbfc", stroke: "#d0d7de" }) +
    text(622, 346, "host: address of the local interface", { anchor: "start", size: 11 }) +
    text(622, 360, "srflx: public address learned via STUN", { anchor: "start", size: 11 }) +
    text(622, 374, "relay: address allocated on the TURN server", { anchor: "start", size: 11 }),
);

// ---------- Figure 2.2: Mesh / MCU / SFU ----------
function panel(ox, title, kind) {
  const pts = [[ox + 55, 85], [ox + 245, 85], [ox + 55, 245], [ox + 245, 245]];
  const names = ["A", "B", "C", "D"];
  let s = text(ox + 150, 30, title, { bold: true, size: 15 });
  const cx = ox + 150, cy = 165;
  if (kind === "mesh") {
    for (let i = 0; i < 4; i++)
      for (let j = i + 1; j < 4; j++)
        s += `<line x1="${pts[i][0]}" y1="${pts[i][1]}" x2="${pts[j][0]}" y2="${pts[j][1]}" stroke="${C.clientS}" stroke-width="1.6"/>`;
  } else {
    for (const p of pts) s += `<line x1="${p[0]}" y1="${p[1]}" x2="${cx}" y2="${cy}" stroke="${kind === "mcu" ? C.serverS : C.sfuS}" stroke-width="1.6"/>`;
    s += box(cx - 62, cy - 30, 124, 60, kind === "mcu" ? ["MCU", "decode·mix·encode"] : ["SFU", "forward only"], {
      fill: kind === "mcu" ? C.server : C.sfu, stroke: kind === "mcu" ? C.serverS : C.sfuS, bold: true, size: 13, subSize: 11.5,
    });
  }
  pts.forEach((p, i) => (s += box(p[0] - 32, p[1] - 17, 64, 34, `Client ${names[i]}`, { fill: C.client, stroke: C.clientS, size: 12 })));
  const foot = {
    mesh: ["per client: N−1 up, N−1 down", "N−1 encoders"],
    mcu: ["per client: 1 up, 1 down (mixed)", "server decodes and re-encodes"],
    sfu: ["per client: 1 up (simulcast), N−1 down", "server forwards RTP packets"],
  }[kind];
  s += text(ox + 150, 295, foot, { size: 12, color: C.muted });
  return s;
}
figs["fig-2-2-topologies"] = svg(960, 330, panel(10, "Mesh (P2P)", "mesh") + panel(330, "MCU", "mcu") + panel(650, "SFU", "sfu") +
  `<line x1="325" y1="15" x2="325" y2="315" stroke="#d0d7de"/><line x1="645" y1="15" x2="645" y2="315" stroke="#d0d7de"/>`);

// ---------- Figure 3.1: use cases ----------
{
  let s = group(175, 15, 560, 500, "nexo collaborative workspace", { stroke: C.ink, tx: 455 });
  const uc = (x, y, l) => ellipse(x, y, 118, 25, l);
  const L = 330, R = 590;
  const ucs = {
    signin: [L, 75, ["Register / sign in"]],
    choose: [L, 140, ["Choose workspace", "and channel"]],
    send: [L, 205, ["Send messages, threads,", "files, reactions"]],
    presence: [L, 270, ["See presence", "and typing"]],
    search: [L, 335, ["Search messages"]],
    join: [L, 400, ["Join a video channel"]],
    manage: [L, 465, ["Manage members,", "invitations, channels"]],
    invite: [R, 170, ["Open invitation link"]],
    devices: [R, 330, ["Control mic, camera,", "screen sharing"]],
    moderate: [R, 400, ["Moderate meeting: waiting", "room, lock, admit, end"]],
    qos: [R, 465, ["View and export QoS"]],
  };
  for (const [x, y, l] of Object.values(ucs)) s += uc(x, y, l);
  s += actor(70, 230, "Member") + actor(70, 440, ["Owner / Admin"]) + actor(840, 400, ["Host / Co-host"]) + actor(840, 95, "Guest");
  const link = (a, b) => (s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${C.line}" stroke-width="1.2"/>`);
  for (const k of ["signin", "choose", "send", "presence", "search", "join"]) link([88, 225], [ucs[k][0] - 118, ucs[k][1]]);
  link([88, 440], [ucs.manage[0] - 118, ucs.manage[1]]);
  link([822, 100], [ucs.invite[0] + 118, ucs.invite[1]]);
  link([822, 90], [ucs.signin[0] + 118, ucs.signin[1]]);
  link([822, 400], [ucs.moderate[0] + 118, ucs.moderate[1]]);
  link([822, 405], [ucs.qos[0] + 118, ucs.qos[1]]);
  link([822, 395], [ucs.devices[0] + 118, ucs.devices[1]]);
  s += arrow([[70, 400], [70, 290]], { open: true, label: "is a", at: [92, 345], noBg: true });
  s += arrow([[ucs.devices[0] - 100, ucs.devices[1] + 14], [ucs.join[0] + 112, ucs.join[1] - 10]], { dash: "5 4", open: true, label: "«extend»", at: [460, 375] });
  figs["fig-3-1-usecases"] = svg(910, 530, s);
}

// ---------- Figure 3.2: block diagram ----------
{
  let s = "";
  s += group(20, 20, 310, 600, "① Client block (browser SPA)", { fill: "#f6faff", stroke: C.clientS });
  const cb = (y, h, l) => box(40, y, 270, h, l, { fill: C.client, stroke: C.clientS, bold: true, subSize: 11.5, size: 13 });
  s += cb(55, 62, ["Views", "home · chat · meetings · tasks · admin"]);
  s += cb(135, 62, ["State and URL routing", "workspace / channel / meeting in URL"]);
  s += cb(215, 62, ["Real-time client", "socket.io-client, access token"]);
  s += cb(295, 62, ["Outbox and drafts", "IndexedDB, resend with same id"]);
  s += cb(400, 120, ["Media client", "mediasoup-client + WebRTC", "publish mic/camera (simulcast q/h/f)", "consume · QoS · layer demand"]);
  s += group(385, 20, 300, 450, "② Application & signalling server", { fill: "#fffaf4", stroke: C.serverS });
  const sb = (y, h, l) => box(405, y, 260, h, l, { fill: C.server, stroke: C.serverS, bold: true, subSize: 11.5, size: 13 });
  s += sb(55, 55, ["REST API", "history · files · search · admin"]);
  s += sb(125, 55, ["Socket.IO gateway", "chat · presence · signalling"]);
  s += sb(195, 55, ["Authentication & authorisation", "JWT · per-event RBAC check"]);
  s += sb(265, 70, ["Domain services", "chat · workspaces · meeting", "sessions · tasks"]);
  s += sb(355, 85, ["Room manager", "worker pool · room placement", "transports · producers · consumers"]);
  s += group(740, 20, 240, 450, "③ SFU media block", { fill: "#f5fbf7", stroke: C.sfuS });
  s += box(760, 55, 200, 185, null, { fill: C.sfu, stroke: C.sfuS });
  s += text(860, 75, "mediasoup worker 1 (C++)", { bold: true, size: 13 });
  s += box(775, 92, 170, 135, null, { fill: "#fff", stroke: C.sfuS, dash: "4 3" });
  s += text(860, 110, "Router = one meeting", { size: 12, bold: true });
  s += text(860, 168, ["send / receive", "WebRtcTransports", "Producers", "Consumers (layers,", "pause / resume)"], { size: 11.5 });
  s += box(760, 260, 200, 62, ["mediasoup worker 2 … N", "other meetings"], { fill: C.sfu, stroke: C.sfuS, bold: true, subSize: 11.5 });
  s += text(845, 380, ["forwards RTP without", "decoding: NACK · PLI ·", "simulcast layer selection"], { size: 11.5, color: C.muted });
  s += cylinder(395, 545, 230, 92, ["④ PostgreSQL", "data · adapter · presence TTL"]);
  s += box(760, 555, 200, 70, ["⑤ coturn", "STUN / TURN relay"], { fill: C.net, stroke: C.netS, bold: true, subSize: 11.5 });
  s += arrow([[310, 86], [405, 82]], { both: true, label: "HTTPS (REST)", at: [357, 70] });
  s += arrow([[310, 246], [357, 246], [357, 152], [405, 152]], { both: true, label: ["WSS", "Socket.IO"], at: [357, 200] });
  s += arrow([[535, 180], [535, 195]], {});
  s += arrow([[535, 250], [535, 265]], {});
  s += arrow([[535, 335], [535, 355]], {});
  s += arrow([[665, 397], [710, 397], [710, 150], [760, 150]], { label: "IPC", at: [710, 280] });
  s += arrow([[455, 470], [455, 545]], { both: true });
  s += text(465, 528, "SQL · LISTEN/NOTIFY", { anchor: "start", size: 11.5, color: C.muted });
  s += arrow([[310, 495], [725, 495], [725, 205], [760, 205]], { both: true, color: C.sfuS, sw: 2.2 });
  s += text(560, 483, "SRTP / RTCP over UDP (media plane)", { size: 11.5, color: C.sfuS });
  s += arrow([[175, 520], [175, 665], [860, 665], [860, 625]], { dash: "6 4", both: true, label: "relay only when no direct path", at: [520, 665] });
  s += arrow([[945, 555], [945, 322]], { dash: "6 4", both: true });
  figs["fig-3-2-block-diagram"] = svg(1000, 685, s);
}

// ---------- Figure 3.3: ERD ----------
{
  let s = "";
  const ent = (x, y, name, fields, fill = C.white) => {
    const h = 28 + fields.length * 19 + 6;
    let r = `<rect x="${x}" y="${y}" width="210" height="${h}" rx="4" fill="${fill}" stroke="${C.line}" stroke-width="1.4"/>`;
    r += `<rect x="${x}" y="${y}" width="210" height="26" rx="4" fill="#dbe4ee" stroke="${C.line}" stroke-width="1.4"/>`;
    r += text(x + 105, y + 13, name, { bold: true, size: 13, mono: true });
    fields.forEach((f, i) => {
      const [n, k] = f.split("#");
      r += text(x + 10, y + 42 + i * 19, n, { anchor: "start", size: 11.5, mono: true });
      if (k) r += text(x + 200, y + 42 + i * 19, k, { anchor: "end", size: 10.5, color: C.serverS, bold: true });
    });
    return { svg: r, x, y, w: 210, h };
  };
  const users = ent(20, 215, "users", ["id#PK", "email#UK", "password_hash", "display_name", "show_activity"]);
  const memb = ent(285, 30, "memberships", ["workspace_id#PK,FK", "user_id#PK,FK", "role: owner|admin|member"]);
  const ws = ent(545, 30, "workspaces", ["id#PK", "owner_id#FK", "name", "archived_at"]);
  const ch = ent(785, 30, "channels", ["id#PK", "workspace_id#FK", "type: text|voice|video", "is_private", "position"]);
  const cm = ent(785, 245, "channel_memberships", ["channel_id#PK,FK", "user_id#PK,FK"]);
  const msg = ent(285, 300, "messages", ["id#PK", "channel_id#FK", "author_id#FK", "client_message_id", "thread_root_id#FK", "content", "deleted_at"]);
  const ms = ent(545, 300, "meeting_sessions", ["id#PK", "channel_id#FK", "host_id#FK", "media_instance_id", "waiting_enabled, locked"]);
  const ma = ent(785, 370, "meeting_attendees", ["session_id#PK,FK", "user_id#PK,FK", "role: host|cohost|member", "state: waiting|admitted"]);
  for (const e of [users, memb, ws, ch, cm, msg, ms, ma]) s += e.svg;
  const rel = (pts, a, b, la, lb) => {
    s += arrow(pts, { none: true });
    s += text(la[0], la[1], a, { size: 11.5, bold: true, color: C.clientS });
    s += text(lb[0], lb[1], b, { size: 11.5, bold: true, color: C.clientS });
  };
  rel([[230, 250], [258, 250], [258, 70], [285, 70]], "1", "N", [240, 242], [276, 62]);
  rel([[545, 70], [495, 70]], "1", "N", [537, 62], [503, 62]);
  rel([[755, 60], [785, 60]], "1", "N", [762, 52], [778, 52]);
  rel([[930, 159], [930, 245]], "1", "N", [940, 170], [940, 236]);
  rel([[230, 290], [258, 290], [258, 340], [285, 340]], "1", "N", [240, 282], [276, 332]);
  rel([[820, 159], [820, 200], [400, 200], [400, 300]], "1", "N", [830, 170], [410, 292]);
  rel([[860, 159], [860, 228], [690, 228], [690, 300]], "1", "N", [870, 170], [700, 292]);
  rel([[755, 400], [785, 400]], "1", "N", [762, 392], [778, 392]);
  s += arrow([[495, 395], [515, 395], [515, 430], [495, 430]], { none: true });
  s += text(522, 413, ["thread", "root"], { anchor: "start", size: 10.5, color: C.muted });
  s += text(390, 485, "unique (author_id, client_message_id)", { size: 11, italic: true, color: C.serverS });
  s += text(650, 445, "one active session per channel", { size: 11, italic: true, color: C.serverS });
  s += text(125, 395, ["view channel_access =", "memberships × channels", "(+ channel_memberships)", "→ role, can_write"], { size: 11, italic: true, color: C.muted });
  figs["fig-3-3-erd"] = svg(1010, 500, s);
}

// ---------- Figure 3.4: message sequence ----------
figs["fig-3-4-seq-message"] = sequence(
  960,
  [
    { id: "U", label: ["Sender client", "(outbox)"], fill: C.client, stroke: C.clientS, w: 140 },
    { id: "A", label: ["Socket.IO", "API"], fill: C.server, stroke: C.serverS, w: 130 },
    { id: "D", label: "PostgreSQL", fill: C.data, stroke: C.dataS, w: 130 },
    { id: "R", label: ["Receivers with", "read access"], fill: C.client, stroke: C.clientS, w: 140 },
  ],
  [
    { from: "U", to: "U", text: "add to outbox (new id)" },
    { from: "U", to: "A", text: "send_message(channelId, clientMessageId, content)" },
    { from: "A", to: "D", text: "check current permission (channel_access)" },
    { from: "A", to: "D", text: "advisory lock (author, channel, clientMessageId)" },
    { frameStart: "alt", span: ["A", "R"] },
    { from: "A", to: "D", text: "first attempt: INSERT message; COMMIT" },
    { from: "A", to: "R", text: "new_message" },
    { frameElse: "[retry with the same id and content]" },
    { from: "A", to: "D", text: "SELECT stored message" },
    { note: "no second broadcast", over: ["A", "D"] },
    { frameEnd: true },
    { from: "A", to: "U", text: "ACK(stored message)", dash: true },
    { from: "U", to: "U", text: "remove from outbox" },
    { note: ["lost ACK → resend with the same clientMessageId", "reconnect → GET /messages?after=cursor to fetch missed messages"], over: ["U", "A"] },
  ],
  { margin: 100, gapY: 36 },
).svg;

// ---------- Figure 3.5: join sequence ----------
figs["fig-3-5-seq-join"] = sequence(
  960,
  [
    { id: "B", label: ["Browser", "(mediasoup-client)"], fill: C.client, stroke: C.clientS, w: 150 },
    { id: "A", label: ["Signalling", "API"], fill: C.server, stroke: C.serverS, w: 130 },
    { id: "S", label: ["mediasoup", "worker"], fill: C.sfu, stroke: C.sfuS, w: 130 },
    { id: "O", label: ["Other", "participants"], fill: C.client, stroke: C.clientS, w: 130 },
  ],
  [
    { from: "B", to: "A", text: "join_meeting(roomId)" },
    { from: "A", to: "A", text: "permission, limits, waiting room → admitted" },
    { from: "A", to: "S", text: "get or create Router on least-loaded worker" },
    { from: "A", to: "B", text: "routerRtpCapabilities, existing producers", dash: true },
    { from: "B", to: "B", text: "device.load(routerRtpCapabilities)" },
    { from: "B", to: "A", text: "create_webrtc_transport × 2 (send, receive)" },
    { from: "A", to: "S", text: "createWebRtcTransport (ICE-Lite, DTLS)" },
    { from: "A", to: "B", text: "iceParameters, iceCandidates, dtlsParameters", dash: true },
    { from: "B", to: "A", text: "connect_webrtc_transport(dtlsParameters)" },
    { from: "B", to: "A", text: "produce(camera, simulcast q/h/f)" },
    { from: "A", to: "O", text: "new_producer" },
    { from: "B", to: "A", text: "consume(producerId, rtpCapabilities)" },
    { from: "A", to: "S", text: "transport.consume({ paused: true })" },
    { from: "A", to: "B", text: "consumer parameters", dash: true },
    { from: "B", to: "A", text: "resume_consumer" },
    { from: "B", to: "S", text: "SRTP / RTCP media (UDP)" },
    { from: "B", to: "A", text: "consumer_layer / pause_consumer (per visible tile)" },
  ],
  { margin: 100, gapY: 33 },
).svg;

// ---------- Figure 3.6: scaling ----------
{
  let s = "";
  const cl = (x, l) => box(x, 20, 150, 46, l, { fill: C.client, stroke: C.clientS, bold: true });
  s += cl(60, "Client A") + cl(380, "Client B") + cl(640, "Client C");
  s += box(60, 160, 230, 80, ["API process 2", "Socket.IO · REST · room manager"], { fill: C.server, stroke: C.serverS, bold: true, subSize: 11.5 });
  s += box(380, 160, 230, 80, ["API process 1", "Socket.IO · REST · room manager"], { fill: C.server, stroke: C.serverS, bold: true, subSize: 11.5 });
  s += box(720, 160, 230, 80, ["SFU worker of process 1", "Router: meeting X"], { fill: C.sfu, stroke: C.sfuS, bold: true, subSize: 11.5 });
  s += cylinder(200, 310, 300, 100, ["PostgreSQL", "LISTEN/NOTIFY · socket_presence (TTL)", "api_instances leases · meeting_sessions"], { size: 12 });
  s += arrow([[135, 66], [135, 160]], { both: true, label: "WSS", at: [112, 135], noBg: true });
  s += arrow([[455, 66], [455, 160]], { both: true, label: "WSS", at: [432, 135], noBg: true });
  s += arrow([[680, 66], [560, 160]], { both: true, label: "WSS", at: [578, 118], noBg: true });
  s += arrow([[175, 240], [280, 310]], { both: true, label: "events, presence", at: [200, 278] });
  s += arrow([[495, 240], [420, 310]], { both: true, label: "events, presence", at: [500, 278] });
  s += arrow([[290, 200], [380, 200]], { none: true, dash: "3 4", label: ["no direct", "link"], at: [335, 200] });
  s += arrow([[610, 200], [720, 200]], { label: "IPC", at: [665, 190], noBg: true });
  s += arrow([[210, 66], [210, 100], [800, 100], [800, 160]], { color: C.sfuS, sw: 2, label: "media of meeting X (Client A)", at: [300, 100], labelColor: C.sfuS });
  s += arrow([[760, 66], [870, 160]], { color: C.sfuS, sw: 2, label: "media", at: [845, 112], labelColor: C.sfuS });
  s += text(560, 320, ["Room affinity: the session row stores the", "media instance that owns meeting X. Client A", "chats through API process 2, but asks", "GET /media-location and sends its media to", "the worker of API process 1."], { anchor: "start", size: 11.5, color: C.muted, lh: 16 });
  figs["fig-3-6-scaling"] = svg(1000, 425, s);
}

// ---------- Figure 4.1: authorisation pipeline ----------
{
  let s = "";
  const cx = 290;
  s += pill(cx, 35, 250, 40, "Socket event arrives");
  const ds = [
    [115, ["Burst ≤ 250 events", "per 10 s?"]],
    [205, ["Access token", "still valid?"]],
    [295, ["Write event: within", "120 writes / min?"]],
    [385, ["Channel event: current", "access in channel_access?"]],
    [475, ["Media event: inside this", "meeting and admitted?"]],
  ];
  let prev = 55;
  for (const [y, l] of ds) {
    s += arrow([[cx, prev], [cx, y - 34]], { label: prev === 55 ? null : "yes", at: [cx + 8, (prev + y - 34) / 2], noBg: true, anchor: "start" });
    s += diamond(cx, y, 250, 66, l);
    s += arrow([[cx + 125, y], [560, y]], { label: "no", at: [590 - 50, y - 10], noBg: true });
    prev = y + 33;
  }
  s += arrow([[cx, prev], [cx, 545]], { label: "yes", at: [cx + 8, (prev + 545) / 2], noBg: true, anchor: "start" });
  s += box(cx - 135, 545, 270, 50, ["Run the event handler", "reply through the acknowledgement"], { fill: C.server, stroke: C.serverS, bold: true, subSize: 11.5 });
  s += box(560, 90, 170, 420, ["Reject", "", "return the error", "in the", "acknowledgement;", "no state change"], { fill: C.warn, stroke: C.warnS, bold: true, size: 13 });
  s += text(cx - 170, 295, ["only for", "write events"], { size: 10.5, italic: true, color: C.muted });
  s += text(cx - 170, 385, ["join_channel,", "send_message,", "typing"], { size: 10.5, italic: true, color: C.muted });
  s += text(cx - 170, 475, ["transport, produce,", "consume, layer…"], { size: 10.5, italic: true, color: C.muted });
  figs["fig-4-1-authz"] = svg(760, 610, s);
}

// ---------- Figure 4.2: idempotent send ----------
{
  let s = "";
  const X = 300;
  s += pill(X, 35, 400, 42, ["send_message(channelId, clientMessageId, content)"], { size: 12.5 });
  const step = (y, l, h = 46, o = {}) => box(X - 175, y, 350, h, l, { fill: C.server, stroke: C.serverS, size: 12.5, ...o });
  s += arrow([[X, 56], [X, 80]]);
  s += step(80, ["Validate content (≤ 4,000 characters)", "and attachment"]);
  s += arrow([[X, 126], [X, 146]]);
  s += step(146, ["BEGIN; lock workspace and channel FOR SHARE;", "re-check write access inside the transaction"], 50);
  s += arrow([[X, 196], [X, 214]]);
  s += diamond(X, 246, 230, 62, ["Still allowed", "to write?"]);
  s += arrow([[X + 115, 246], [560, 246]], { label: "no", at: [520, 236], noBg: true });
  s += box(560, 224, 190, 44, ["403 FORBIDDEN", "(rollback)"], { fill: C.warn, stroke: C.warnS, size: 12.5 });
  s += arrow([[X, 277], [X, 300]], { label: "yes", at: [X + 8, 289], noBg: true, anchor: "start" });
  s += step(300, ["pg_advisory_xact_lock(author, channel,", "clientMessageId)"]);
  s += arrow([[X, 346], [X, 366]]);
  s += diamond(X, 400, 250, 66, ["Message with this", "clientMessageId exists?"]);
  s += arrow([[X, 433], [X, 466]], { label: "no", at: [X + 8, 450], noBg: true, anchor: "start" });
  s += step(466, ["INSERT message, mentions, notifications;", "COMMIT"]);
  s += arrow([[X, 512], [X, 532]]);
  s += step(532, ["emit new_message to the users who can", "currently read the channel"]);
  s += arrow([[X, 578], [X, 600]]);
  s += step(600, ["ACK(stored message) → client removes it", "from the outbox"], 46, { fill: C.client, stroke: C.clientS });
  s += arrow([[X + 125, 400], [560, 400]], { label: "yes", at: [500, 390], noBg: true });
  s += diamond(660, 400, 200, 62, ["Same content", "fingerprint?"]);
  s += arrow([[760, 400], [800, 400], [800, 330]], { label: "no", at: [806, 365], noBg: true, anchor: "start" });
  s += box(705, 286, 190, 44, ["409 DELIVERY_CONFLICT", "(rollback)"], { fill: C.warn, stroke: C.warnS, size: 12.5 });
  s += arrow([[660, 431], [660, 466]], { label: "yes", at: [668, 450], noBg: true, anchor: "start" });
  s += box(565, 466, 190, 62, ["Retry after lost ACK:", "return stored message,", "no broadcast"], { fill: "#fffbe6", stroke: "#c9a227", size: 12.5 });
  s += arrow([[660, 528], [660, 623], [X + 175, 623]]);
  figs["fig-4-2-send-message"] = svg(920, 665, s);
}

// ---------- Figure 4.3: presence heartbeat ----------
{
  let s = "";
  const X = 330;
  s += pill(X, 32, 300, 40, "Timer: every 15 s on each API process");
  const st = (y, l, h = 46) => box(X - 190, y, 380, h, l, { fill: C.server, stroke: C.serverS, size: 12.5 });
  s += arrow([[X, 52], [X, 74]]);
  s += st(74, ["Renew expires_at = now() + 45 s", "for the live sockets of this process"]);
  s += arrow([[X, 120], [X, 140]]);
  s += st(140, ["Renew this process's lease in api_instances"], 40);
  s += arrow([[X, 180], [X, 200]]);
  s += st(200, ["DELETE expired rows of socket_presence", "(sockets of crashed processes)"]);
  s += arrow([[X, 246], [X, 264]]);
  s += diamond(X, 296, 260, 62, ["Did a user lose", "their last socket?"]);
  s += arrow([[X + 130, 296], [600, 296]], { label: "yes", at: [560, 286], noBg: true });
  s += box(600, 270, 220, 52, ["emit user_presence = offline", "to that user's workspaces"], { fill: C.client, stroke: C.clientS, size: 12 });
  s += arrow([[710, 322], [710, 372], [X + 190, 372]]);
  s += arrow([[X, 327], [X, 352]], { label: "no", at: [X + 8, 340], noBg: true, anchor: "start" });
  s += st(352, ["Close meeting sessions owned by", "processes whose lease expired"]);
  s += arrow([[X, 398], [X, 418]]);
  s += st(418, ["Send online_users (presence rows with", "expires_at > now() ∩ shared workspaces)"]);
  s += arrow([[X - 190, 441], [80, 441], [80, 32], [X - 150, 32]], { label: "wait 15 s", at: [80, 240] });
  figs["fig-4-3-presence"] = svg(860, 480, s);
}

// ---------- Figure 4.4: ICE recovery ----------
{
  let s = "";
  const st = (x, y, w, l, o = {}) => box(x, y, w, 52, l, { r: 24, fill: o.fill ?? C.client, stroke: o.stroke ?? C.clientS, bold: true, subSize: 11.5, size: 13 });
  s += `<circle cx="150" cy="16" r="8" fill="${C.ink}"/>`;
  s += arrow([[150, 24], [150, 44]]);
  s += st(60, 44, 180, ["connected", "media flowing"], { fill: C.sfu, stroke: C.sfuS });
  s += st(420, 44, 190, ["disconnected", "wait 5 s"]);
  s += st(420, 200, 190, ["failed"], { fill: C.warn, stroke: C.warnS });
  s += st(60, 200, 190, ["restarting ICE", "attempt ≤ 2"], { fill: C.server, stroke: C.serverS });
  s += st(60, 350, 190, ["waiting for connection", "10 s after restart"], { fill: C.server, stroke: C.serverS });
  s += st(420, 350, 190, ["ask user to rejoin", "devices stopped"], { fill: C.warn, stroke: C.warnS });
  s += arrow([[240, 60], [420, 60]], { label: "state → disconnected", at: [330, 48], noBg: true });
  s += arrow([[420, 84], [240, 84]], { label: "recovers within 5 s", at: [330, 98], noBg: true });
  s += arrow([[515, 96], [515, 200]], { label: ["state →", "failed"], at: [548, 148], noBg: true });
  s += arrow([[450, 96], [450, 150], [200, 150], [200, 200]], { dash: "5 3", label: "still disconnected after 5 s", at: [325, 150] });
  s += arrow([[420, 226], [250, 226]], { label: "immediately", at: [335, 214], noBg: true });
  s += arrow([[100, 200], [100, 96]], { label: ["restartIce()", "succeeds"], at: [100, 150] });
  s += arrow([[155, 252], [155, 350]], { label: "restart sent", at: [155, 300] });
  s += arrow([[60, 376], [30, 376], [30, 70], [60, 70]], { label: "connected", at: [30, 300] });
  s += arrow([[250, 376], [420, 376]], { label: "not connected after 10 s", at: [335, 364], noBg: true });
  s += arrow([[250, 240], [345, 240], [345, 320], [470, 320], [470, 350]], { label: ["attempts ≥ 2", "or restart error"], at: [400, 300], noBg: true });
  figs["fig-4-4-ice-recovery"] = svg(650, 415, s);
}

// ---------- Figure 4.5: dynamic grid ----------
{
  let s = "";
  const b = (x, y, l, o = {}) => box(x, y, 175, 78, l, { fill: C.client, stroke: C.clientS, size: 12, bold: true, subSize: 11.5, ...o });
  s += b(15, 30, ["1. Measure", "tiles n, container", "W × H (ResizeObserver)"]);
  s += b(215, 30, ["2. bestGridLayout", "try c = 1…n, keep the", "largest 16:9 tile"]);
  s += b(415, 30, ["3. paginate", "4 / 6 / 9 tiles per page;", "off-page tiles not rendered"]);
  s += b(615, 30, ["4. layerForTile", "smallest layer covering", "tile width × DPR (or null)"]);
  s += b(815, 30, ["5. Diff demand", "compare with the demand", "already applied"]);
  for (const x of [190, 390, 590, 790]) s += arrow([[x, 69], [x + 25, 69]]);
  s += arrow([[902, 108], [902, 150], [160, 150], [160, 190]], {});
  s += arrow([[902, 150], [500, 150], [500, 190]], { none: true });
  s += arrow([[902, 150], [840, 150], [840, 190]], {});
  s += arrow([[500, 150], [500, 190]], {});
  s += box(40, 190, 240, 68, ["visible → hidden", "pause_consumer"], { fill: C.server, stroke: C.serverS, bold: true, mono: false, size: 12.5 });
  s += box(380, 190, 240, 68, ["hidden → visible", "resume_consumer + consumer_layer"], { fill: C.server, stroke: C.serverS, bold: true, size: 12.5 });
  s += box(720, 190, 240, 68, ["tile size changed", "consumer_layer(spatialLayer)"], { fill: C.server, stroke: C.serverS, bold: true, size: 12.5 });
  s += box(40, 300, 920, 56, ["SFU (mediasoup): consumer.pause() / resume() / setPreferredLayers() — forwards only the needed layer of visible tiles"], { fill: C.sfu, stroke: C.sfuS, size: 12.5 });
  for (const x of [160, 500, 840]) s += arrow([[x, 258], [x, 300]], { label: "socket", at: [x + 28, 280], noBg: true });
  figs["fig-4-5-grid"] = svg(1005, 375, s);
}

// ---------- Figure 4.11: deployment ----------
{
  let s = "";
  s += box(20, 150, 150, 70, ["Users'", "browsers"], { fill: C.client, stroke: C.clientS, bold: true });
  s += group(230, 20, 520, 400, "Docker Compose host (public IP)", { dash: "6 4" });
  s += box(260, 60, 220, 90, ["web (Nginx)", "serves the SPA · TLS", "proxy /api, /socket.io"], { fill: C.client, stroke: C.clientS, bold: true, subSize: 11.5 });
  s += box(260, 210, 220, 100, ["api (Node.js 22)", "REST · Socket.IO · signalling", "mediasoup workers", "/ready health check"], { fill: C.server, stroke: C.serverS, bold: true, subSize: 11.5 });
  s += cylinder(540, 220, 180, 85, ["postgres", "17"]);
  s += box(790, 210, 180, 90, ["coturn", "STUN / TURN", "use-auth-secret"], { fill: C.net, stroke: C.netS, bold: true, subSize: 11.5 });
  s += arrow([[170, 170], [260, 105]], { both: true, label: "HTTPS / WSS 443", at: [205, 125] });
  s += arrow([[370, 150], [370, 210]], { both: true, label: "HTTP", at: [395, 180], noBg: true });
  s += arrow([[480, 262], [540, 262]], { both: true, label: "SQL", at: [510, 252], noBg: true });
  s += arrow([[170, 205], [215, 205], [215, 290], [260, 290]], { both: true, color: C.sfuS, sw: 2, label: ["UDP/TCP", "40000–40099"], at: [215, 250], labelColor: C.sfuS });
  s += arrow([[170, 215], [190, 440], [880, 440], [880, 300]], { both: true, dash: "6 4", label: "TURN relay (3478, TLS 5349)", at: [520, 440] });
  s += text(500, 380, "shared secret (TURN_SHARED_SECRET) → time-limited credentials", { size: 11.5, italic: true, color: C.muted });
  figs["fig-4-11-deploy"] = svg(1000, 465, s);
}

// ---------- Figure 5.1: test bed ----------
{
  let s = "";
  s += group(15, 15, 970, 360, "One machine: AMD Ryzen 7 6800HS · 16 threads · 23 GiB RAM · Windows 11", { stroke: C.ink });
  s += box(40, 55, 280, 120, ["Harness (Node.js 22)", "starts N browsers, collects", "getStats() every 2 s and CPU", "via Chrome DevTools Protocol"], { fill: "#f6f8fa", bold: true, subSize: 11.5 });
  s += box(40, 200, 280, 150, ["SFU mode", "real API + mediasoup worker", "in the harness process", "", "Mesh mode", "minimal signalling relay,", "one RTCPeerConnection per pair"], { fill: C.server, stroke: C.serverS, bold: true, subSize: 11.5 });
  for (let i = 0; i < 4; i++)
    s += box(400 + i * 135, 70, 120, 90, i < 3 ? [`Chrome #${i + 1}`, "headless", "fake camera", "960×540 VP8"] : ["…", "up to", "N = 10"], { fill: C.client, stroke: C.clientS, bold: true, subSize: 11 });
  s += cylinder(400, 250, 200, 90, ["PostgreSQL 17", "(Docker)"]);
  s += box(650, 250, 310, 90, ["Network: all traffic on the LAN address", "of the same host (UDP), no real loss,", "delay or bandwidth limit"], { fill: "#fffbe6", stroke: "#c9a227", size: 12 });
  s += arrow([[320, 115], [400, 115]], { both: true, label: "CDP", at: [360, 105], noBg: true });
  s += arrow([[320, 275], [400, 295]], { both: true, label: "SQL", at: [360, 275], noBg: true });
  s += arrow([[180, 175], [180, 200]], { both: true });
  s += arrow([[600, 160], [600, 200], [320, 230]], { both: true, color: C.sfuS, sw: 2, label: "signalling + RTP/RTCP", at: [480, 205], labelColor: C.sfuS });
  figs["fig-5-1-testbed"] = svg(1000, 390, s);
}

for (const [name, content] of Object.entries(figs)) await writeFile(join(out, `${name}.svg`), content);
console.log(`wrote ${Object.keys(figs).length} diagrams to ${out}`);
