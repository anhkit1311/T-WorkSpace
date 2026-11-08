// §5.3: one simulated duty shift on the hotline, in real time (the database stamps calls with now()).
// The real ACD (AcdService) and the real PostgreSQL repository run in this process; only Asterisk is
// emulated: callers dial the hotline, pick "1" in the IVR, wait, and may press * (callback) or hang up;
// agents pick up after a few seconds of ringing (one lets it ring out), talk, then file a disposition.
// The KPI and the CDR export come from the same report service the "Tổng đài → KPI" page uses and are
// written to docs/benchmarks/raw/callcenter-shift/.
// Usage: npm run build --workspace @doan/api && node scripts/callcenter/simulate-shift.mjs [--peak] giaovu@demo.tworkspace.test gv.ha@demo.tworkspace.test gv.lan@demo.tworkspace.test
// Default: a normal shift; --peak: two bursts of long calls that keep every agent busy, and one agent
// who lets a call ring out. Results go to callcenter-shift/ or callcenter-shift-peak/. Takes about 30 minutes. The agents must be members of the hotline's "1" department (seed-demo.mjs does it)
// and should not be signed in to the web softphone meanwhile: this ACD keeps its own view of their state.
import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import "../../dist/api/config/env.js";
import { pool } from "../../dist/api/infrastructure/database/db.js";
import { kpiSummary } from "../../dist/api/modules/callcenter/domain/kpi.js";
import { systemClock } from "../../dist/api/modules/callcenter/domain/ports.js";
import { CallCenterRepository } from "../../dist/api/modules/callcenter/repository/callcenter-repository.js";
import { AcdService } from "../../dist/api/modules/callcenter/service/acd-service.js";
import { CallCenterAdminService } from "../../dist/api/modules/callcenter/service/admin-service.js";
import { CallCenterReportService } from "../../dist/api/modules/callcenter/service/report-service.js";
import { toCsv } from "../../dist/api/shared/http/csv.js";
import { toXlsx } from "../../dist/api/shared/http/xlsx.js";

const peak = process.argv.includes("--peak");
const out = resolve(`docs/benchmarks/raw/callcenter-shift${peak ? "-peak" : ""}`);
await mkdir(out, { recursive: true });
const logFile = `${out}/events.log`;
await writeFile(logFile, "");
const startedAt = Date.now();
const log = (event, details = {}) =>
  void appendFile(logFile, `${((Date.now() - startedAt) / 1000).toFixed(1).padStart(7)}s ${event} ${JSON.stringify(details)}\n`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Deterministic "random" so a rerun plays the same shift.
let seed = peak ? 20261103 : 20261104;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const between = (min, max) => Math.round(min + random() * (max - min));

const repo = new CallCenterRepository();
const emails = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!emails.length) throw new Error("usage: node scripts/callcenter/simulate-shift.mjs agent@x.y [...]");
const agents = [];
for (const email of emails) {
  const user = await repo.userByEmail(email);
  if (!user) throw new Error(`Không tìm thấy ${email}`);
  agents.push(user.id);
}
const hotline = (await repo.hotlines())[0];
if (!hotline) throw new Error("Chưa có hotline: chạy scripts/callcenter/seed-demo.mjs trước.");
const departmentId = hotline.options.find((option) => option.digit === "1").departmentId;
const dispositions = await repo.dispositions([departmentId]);
const supervisor = (await pool.query(`SELECT user_id FROM cc_members WHERE department_id=$1 AND role='supervisor' LIMIT 1`, [departmentId])).rows[0]?.user_id;
if (!supervisor) throw new Error("Phòng ban cần một giám sát viên để xem KPI.");

// ---- the shift --------------------------------------------------------------------------------
// `star`/`hangUp`: seconds of queue wait after which the caller presses * or gives up if still unanswered.
// Peak: 18 calls over ~27 minutes plus two bursts of long calls. Normal: 19 calls over ~25 minutes plus
// three short bursts of 3, whose last caller finds both other agents busy (2 callbacks, 1 hang-up).
const TOPICS = [
  ["TU_VAN", "Hỏi lịch thi cuối kỳ"],
  ["TU_VAN", "Hỏi học phí học kỳ 2"],
  ["TU_VAN", "Xin giấy xác nhận sinh viên"],
  ["TU_VAN", "Hỏi thủ tục bảo lưu"],
  ["TU_VAN", "Hỏi điều kiện xét tốt nghiệp"],
  ["CHUYEN_PB", "Hỏi về ký túc xá, hướng dẫn gọi phòng Công tác sinh viên"],
  ["KHIEU_NAI", "Phản ánh điểm quá trình chưa cập nhật"],
  ["TU_VAN", "Hỏi đăng ký học phần bổ sung"],
];
const callers = [];
const add = (at, extra = {}) =>
  callers.push({ at, number: `09${between(10_000_000, 99_999_999)}`, talk: between(45, 150), pickup: between(3, 9), ...extra });
if (peak) {
  for (let i = 0; i < 18; i++) add(i * 90 + between(0, 30), i === 5 ? { ringOut: true } : {});
  for (const [offset, extra] of [[0, { talk: 200 }], [4, { talk: 190 }], [8, { talk: 180 }], [12, { star: 15 }], [16, { star: 25 }], [20, { hangUp: 40 }]])
    add(600 + offset, extra);
  for (const [offset, extra] of [[0, { talk: 170 }], [5, { talk: 160 }], [10, { talk: 150 }], [15, { star: 20 }]]) add(1290 + offset, extra);
} else {
  for (let i = 0; i < 19; i++) add(i * 80 + between(0, 15), { talk: between(40, 110) });
  for (const [at, last] of [[420, { star: 12 }], [900, { star: 15 }], [1340, { hangUp: 15 }]])
    for (const [offset, extra] of [[0, { talk: between(60, 100) }], [3, { talk: between(60, 100) }], [6, last]]) add(at + offset, extra);
}
callers.sort((a, b) => a.at - b.at).forEach((caller, index) => (caller.channel = `caller-${index}`));

// ---- emulated PBX -----------------------------------------------------------------------------
let acd;
let chain = Promise.resolve();
const emit = (event) => (chain = chain.then(() => acd.handle(event)).catch((error) => log("acd_error", { message: error.message })));
const later = (seconds, event) => setTimeout(() => emit(event), seconds * 1000);
let sequence = 0;
const ended = new Set();
const legs = new Map(); // agent leg → caller
const byExtension = new Map();
const pbx = new Proxy(
  {
    play: async (_channel, media) => {
      const id = `pb-${++sequence}`;
      later(Math.min(8, 1.2 * media.length), { type: "playback_finished", playbackId: id });
      return id;
    },
    callExtension: async (input) => {
      const leg = `leg-${++sequence}`;
      const caller = callers.find((item) => input.callerId.includes(item.number));
      log("ring", { caller: caller?.channel, extension: input.extension });
      if (caller?.ringOut && !caller.rungOut) {
        caller.rungOut = true; // the agent lets it ring out: back to the queue, agent paused (BR-04)
        later(20, { type: "channel_ended", channelId: leg });
        const agent = byExtension.get(input.extension);
        setTimeout(() => acd.requestState(agent, "ready").catch(() => undefined), 80_000);
        return leg;
      }
      legs.set(leg, caller);
      setTimeout(() => {
        if (!caller || caller.gone) return;
        caller.answered = true;
        emit({ type: "channel_up", channelId: leg });
        setTimeout(() => hangUp(caller), caller.talk * 1000);
      }, caller?.pickup * 1000);
      return leg;
    },
    hangup: async (channelId) => {
      if (!ended.has(channelId)) later(0.05, { type: "channel_ended", channelId });
      ended.add(channelId);
    },
    bridge: async () => `bridge-${++sequence}`,
    linkedId: async (channelId) => `sim-${startedAt}-${channelId}`,
    isExtensionOnline: async () => true,
    extensionStates: async () => new Map(),
    releaseOrphans: async () => 0,
  },
  { get: (target, name) => target[name] ?? (async () => undefined) },
);
function hangUp(caller) {
  if (caller.gone) return;
  caller.gone = true;
  ended.add(caller.channel);
  emit({ type: "channel_ended", channelId: caller.channel });
}

// Only this shift's agents, and calls already open elsewhere stay as they are.
const store = new Proxy(repo, {
  get: (target, name) => {
    if (name === "agentRoster") return async () => (await target.agentRoster()).filter((agent) => agents.includes(agent.userId));
    if (name === "closeDanglingCalls") return async () => 0;
    if (name === "createCall")
      return async (input) => {
        const caller = callers.find((item) => item.number === input.callerNumber);
        if (caller) caller.recordId = input.id;
        return target.createCall(input);
      };
    const value = target[name];
    return typeof value === "function" ? value.bind(target) : value;
  },
});
const notifier = new Proxy({}, { get: () => () => undefined });
acd = new AcdService(pbx, store, notifier, systemClock, log, async () => null);

await emit({ type: "connected" });
await chain;
for (const userId of agents) {
  const extension = (await repo.ownExtension(userId))?.number;
  byExtension.set(extension, userId);
  await acd.requestState(userId, "ready");
  await sleep(1000);
}
log("shift_started", { callers: callers.length, agents: agents.length });

for (const caller of callers) {
  setTimeout(async () => {
    emit({ type: "call_started", channelId: caller.channel, args: ["inbound", hotline.number], callerNumber: caller.number, callerName: "", exten: hotline.number });
    await sleep(4000); // listens to the menu, then presses 1
    emit({ type: "dtmf", channelId: caller.channel, digit: "1" });
    if (caller.star || caller.hangUp)
      setTimeout(() => {
        if (caller.answered || caller.gone) return;
        if (caller.star) {
          caller.gone = true;
          emit({ type: "dtmf", channelId: caller.channel, digit: "*" });
        } else hangUp(caller);
      }, (caller.star ?? caller.hangUp) * 1000);
  }, caller.at * 1000);
}

// Wait for the last call and its wrap-up, filing a disposition for each answered call as agents do.
const lastEnd = Math.max(...callers.map((caller) => caller.at + 30 + caller.talk + 60));
const filed = new Set();
while (Date.now() - startedAt < lastEnd * 1000) {
  await sleep(5000);
  for (const caller of callers.filter((item) => item.answered && item.gone && item.recordId && !filed.has(item))) {
    filed.add(caller);
    const [code, note] = TOPICS[between(0, TOPICS.length - 1)];
    await repo.saveWrapUp(caller.recordId, dispositions.find((item) => item.code === code)?.id ?? null, note);
  }
}
await chain;
for (const userId of agents) await acd.requestState(userId, "offline").catch(() => undefined);

// ---- report, through the same service as the web page -----------------------------------------
const ids = callers.map((caller) => caller.recordId).filter(Boolean);
// No recording exists behind the emulated PBX: keep the CDR from pointing at missing files.
await pool.query(`UPDATE cc_calls SET recording_key=NULL WHERE id=ANY($1::uuid[])`, [ids]);
const admin = new CallCenterAdminService(repo, () => null, async () => {}, log);
const reports = new CallCenterReportService(repo, admin);
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(startedAt));
const params = new URLSearchParams({ from: day, to: day, threshold: "20" });
// The page reports whole days; the shift's own window keeps a second shift on the same day out.
const shiftStart = new Date(startedAt);
const shiftEnd = new Date();
const kpi = {
  ...(await reports.kpi(supervisor, departmentId, params)),
  ...kpiSummary(await repo.kpiCalls(departmentId, shiftStart, shiftEnd), await repo.wrapUpSeconds(departmentId, shiftStart, shiftEnd), 20),
};
const table = await reports.exportCsv(supervisor, departmentId, params);
// Rows of this shift only: same start time (as the export formats it) and caller number.
const time = (date) => date.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
const own = new Set((await repo.kpiCalls(departmentId, shiftStart, shiftEnd)).map((call) => `${time(call.startedAt)}|${call.callerNumber}`));
const shiftRows = table.rows.filter((row, index) => index === 0 || own.has(`${row[0]}|${row[1]}`));
await writeFile(`${out}/kpi.json`, JSON.stringify({ shift: { startedAt: new Date(startedAt).toISOString(), callers: callers.length, callIds: ids }, kpi }, null, 2));
await writeFile(`${out}/cuoc-goi.csv`, `﻿${toCsv(shiftRows)}`);
await writeFile(`${out}/cuoc-goi.xlsx`, toXlsx(shiftRows, table.name));
console.log(JSON.stringify(kpi, null, 2));
await pool.end();
