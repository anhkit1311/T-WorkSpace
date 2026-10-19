import assert from "node:assert/strict";
import { test } from "node:test";
import { canAgentChoose, canTransition } from "../../../dist/api/modules/callcenter/domain/agent-state.js";
import { isOpen } from "../../../dist/api/modules/callcenter/domain/business-hours.js";
import { strategies } from "../../../dist/api/modules/callcenter/domain/distribution.js";
import { CallCenterAccess } from "../../../dist/api/modules/callcenter/domain/access.js";
import { inRange, nextExtensionNumber, normalizePhone } from "../../../dist/api/modules/callcenter/domain/extension.js";
import { kpiSummary, periodBounds } from "../../../dist/api/modules/callcenter/domain/kpi.js";
import { AcdService } from "../../../dist/api/modules/callcenter/service/acd-service.js";

test("Call center domain rules", () => {
  assert.equal(canTransition("ready", "ringing"), true);
  assert.equal(canTransition("on_call", "ready"), false);
  assert.equal(canAgentChoose("on_call", "ready"), false);
  assert.equal(canAgentChoose("wrap_up", "ready"), true);

  const agents = [
    { userId: "b", readySince: 10, lastOfferedAt: 5 },
    { userId: "a", readySince: 20, lastOfferedAt: 1 },
  ];
  assert.equal(strategies.longest_idle.pick(agents).userId, "b");
  assert.equal(strategies.round_robin.pick(agents).userId, "a");
  assert.equal(strategies.longest_idle.pick([]), null);

  assert.equal(nextExtensionNumber({ from: 2100, to: 2102 }, ["2100", "2101"]), "2102");
  assert.equal(nextExtensionNumber({ from: 2100, to: 2101 }, ["2100", "2101"]), null);
  assert.equal(inRange("2100", { from: 2100, to: 2199 }), true);
  assert.equal(inRange("21a0", { from: 2100, to: 2199 }), false);
  assert.equal(normalizePhone("+84 912 345 678"), "0912345678");

  // 2026-10-19 is a Monday; 02:00 UTC is 09:00 in Ho Chi Minh City.
  const weekday = [{ weekday: 1, opens: "07:30", closes: "17:00" }];
  assert.equal(isOpen(weekday, new Date("2026-10-19T02:00:00Z")), true);
  assert.equal(isOpen(weekday, new Date("2026-10-19T12:00:00Z")), false);
  assert.equal(isOpen([], new Date()), true);

  const supervisor = new CallCenterAccess("u1", false, new Map([["d1", new Set(["supervisor"])]]));
  assert.deepEqual(supervisor.supervisedDepartments(), ["d1"]);
  assert.equal(supervisor.canReviewCall({ department_id: "d2", agent_user_id: "u2" }), false);
  assert.equal(supervisor.canReviewCall({ department_id: "d2", agent_user_id: "u1" }), true);
  assert.equal(new CallCenterAccess("u3", true, new Map()).supervisedDepartments(), null);
});

function harness({ webSessions = {}, online = () => true } = {}) {
  let now = Date.parse("2026-10-19T02:00:00Z");
  let timers = [];
  const clock = {
    now: () => now,
    setTimeout: (callback, ms) => {
      const timer = { at: now + ms, callback };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => (timers = timers.filter((item) => item !== timer)),
  };
  const pbxCalls = [];
  let sequence = 0;
  const pbx = new Proxy(
    {
      play: async (channelId, media) => (pbxCalls.push(["play", channelId, media]), `pb-${++sequence}`),
      callExtension: async (input) => (pbxCalls.push(["callExtension", input.extension]), `agent-leg-${++sequence}`),
      bridge: async (ids) => (pbxCalls.push(["bridge", ...ids]), ids[0] === "snoop-1" ? "monitor-bridge" : "bridge-1"),
      isExtensionOnline: async (extension) => online(extension),
      linkedId: async (channelId) => `linked-${channelId}`,
      snoop: async () => "snoop-1",
    },
    { get: (target, name) => target[name] ?? (async (...args) => void pbxCalls.push([name, ...args])) },
  );
  const calls = new Map();
  const states = [];
  const voicemails = [];
  const missed = [];
  const department = (id, wrapUpSeconds) => ({
    id,
    name: id,
    strategy: "longest_idle",
    ringSeconds: 20,
    maxWaitSeconds: 60,
    wrapUpSeconds,
    active: true,
    hours: [],
  });
  const store = {
    hotline: async () => ({
      id: "h1",
      number: "19001234",
      fallbackDepartmentId: "sales",
      options: [
        { digit: "1", departmentId: "sales" },
        { digit: "2", departmentId: "support" },
      ],
    }),
    department: async (id) => department(id, 10),
    caller: async (number) => ({ number, userId: null, displayName: null, email: null, recentCalls: 0 }),
    createCall: async (input) => void calls.set(input.id, { ...input }),
    updateCall: async (id, patch) => void Object.assign(calls.get(id), patch),
    saveVoicemail: async (input) => void voicemails.push(input),
    missedCall: async (input) => void missed.push(input),
    agentRoster: async () => [
      { userId: "alice", displayName: "Alice", departments: ["sales"], extension: "2101", state: "offline", reason: "", since: null },
      { userId: "bob", displayName: "Bob", departments: ["sales"], extension: "2102", state: "offline", reason: "", since: null },
    ],
    recordAgentState: async (userId, state, reason) => void states.push([userId, state, reason]),
    closeDanglingCalls: async () => 0,
  };
  const notified = [];
  const notifier = { agent: (userId, data) => notified.push([userId, data.state]), live: () => {} };
  const acd = new AcdService(pbx, store, notifier, clock, () => {}, async (endpoint) => webSessions[endpoint] ?? null);
  const flush = () => acd.handle({ type: "dtmf", channelId: "none", digit: "0" });
  const advance = async (ms) => {
    now += ms;
    const due = timers.filter((timer) => timer.at <= now);
    timers = timers.filter((timer) => timer.at > now);
    for (const timer of due) timer.callback();
    await flush();
  };
  const call = () => [...calls.values()][0];
  const agentState = (userId) => acd.agentView(userId).state;
  return { acd, pbxCalls, calls, call, voicemails, missed, agentState, advance, flush };
}

const inbound = { type: "call_started", channelId: "caller", args: ["inbound", "19001234"], callerNumber: "+84912345678", callerName: "", exten: "19001234" };

test("ACD: IVR → queue → longest idle agent → answered → wrap-up → ready", async () => {
  const { acd, pbxCalls, call, agentState, advance } = harness();
  await acd.handle({ type: "connected" });
  await acd.requestState("alice", "ready");
  await advance(1000);
  await acd.requestState("bob", "ready");

  await acd.handle(inbound);
  assert.equal(call().callerNumber, "0912345678");
  assert.ok(pbxCalls.some(([name, , media]) => name === "play" && media.includes("sound:digits/2")), "menu played");

  await acd.handle({ type: "dtmf", channelId: "caller", digit: "1" });
  assert.equal(call().departmentId, "sales");
  assert.deepEqual(pbxCalls.find(([name]) => name === "callExtension"), ["callExtension", "2101"], "longest idle first");
  assert.equal(agentState("alice"), "ringing");
  assert.equal(acd.agentView("alice").offer.caller.number, "0912345678");

  const leg = `agent-leg-3`;
  await acd.handle({ type: "channel_up", channelId: leg });
  assert.equal(agentState("alice"), "on_call");
  assert.equal(call().agentUserId, "alice");
  assert.ok(call().recordingKey.startsWith("call-"), "CC-7 recording started");

  await acd.handle({ type: "channel_ended", channelId: "caller" });
  assert.equal(call().outcome, "answered");
  assert.equal(agentState("alice"), "wrap_up");
  await advance(10_000);
  assert.equal(agentState("alice"), "ready");
});

test("ACD: unanswered offer requeues to the next agent; max wait sends the caller to voicemail", async () => {
  const { acd, pbxCalls, call, voicemails, agentState, advance, flush } = harness();
  await acd.handle({ type: "connected" });
  await acd.requestState("alice", "ready");
  await acd.handle(inbound);
  await acd.handle({ type: "dtmf", channelId: "caller", digit: "1" });
  const firstLeg = pbxCalls.length;
  await acd.handle({ type: "channel_ended", channelId: "agent-leg-3" }); // Alice let it ring out
  assert.equal(agentState("alice"), "not_ready");
  assert.equal(acd.snapshot("sales").waiting.length, 1, "call back in queue");

  await acd.requestState("bob", "ready");
  assert.deepEqual(pbxCalls.slice(firstLeg).find(([name]) => name === "callExtension"), ["callExtension", "2102"]);
  await acd.handle({ type: "channel_ended", channelId: "agent-leg-4" });

  await advance(60_000);
  const intro = pbxCalls.filter(([name]) => name === "play").at(-1);
  assert.deepEqual(intro[2], ["sound:vm-intro"]);
  await acd.handle({ type: "playback_finished", playbackId: "pb-5" });
  const recording = pbxCalls.find(([name]) => name === "recordVoicemail");
  assert.ok(recording, "voicemail recording started");
  await acd.handle({ type: "recording_finished", name: recording[2], durationSeconds: 12 });
  await flush();
  assert.equal(call().outcome, "voicemail");
  assert.equal(voicemails[0].departmentId, "sales");
});

test("ACD: agents cannot pick a state mid-call and need an extension", async () => {
  const { acd } = harness();
  await acd.handle({ type: "connected" });
  await assert.rejects(acd.requestState("stranger", "ready"), (error) => error.code === "NOT_AGENT");
  await acd.requestState("alice", "ready");
  await acd.handle(inbound);
  await acd.handle({ type: "dtmf", channelId: "caller", digit: "1" });
  await assert.rejects(acd.requestState("alice", "not_ready"), (error) => error.code === "INVALID_AGENT_STATE");
});

test("ACD: a caller who hangs up in the queue opens a missed-call ticket; one who quits in the IVR does not", async () => {
  const { acd, call, missed } = harness();
  await acd.handle({ type: "connected" });
  await acd.handle(inbound);
  await acd.handle({ type: "channel_ended", channelId: "caller" }); // left during the menu
  assert.equal(call().outcome, "abandoned");
  assert.equal(missed.length, 0);

  const second = harness();
  await second.acd.handle({ type: "connected" });
  await second.acd.handle(inbound);
  await second.acd.handle({ type: "dtmf", channelId: "caller", digit: "2" });
  await second.acd.handle({ type: "channel_ended", channelId: "caller" });
  assert.deepEqual(second.missed, [{ callId: second.call().id, departmentId: "support", callerNumber: "0912345678", callerUserId: null }]);
});

test("CC-9 KPI: ASA, AHT, abandon rate and service level", () => {
  const at = (seconds) => new Date(Date.parse("2026-10-19T02:00:00Z") + seconds * 1000);
  const calls = [
    // answered after 10 s, talked 60 s
    { agentUserId: "a", agentName: "An", startedAt: at(0), queuedAt: at(5), answeredAt: at(15), endedAt: at(75), outcome: "answered" },
    // answered after 30 s (outside a 20 s service level), talked 120 s
    { agentUserId: "a", agentName: "An", startedAt: at(0), queuedAt: at(0), answeredAt: at(30), endedAt: at(150), outcome: "answered" },
    { agentUserId: null, agentName: null, startedAt: at(0), queuedAt: at(0), answeredAt: null, endedAt: at(40), outcome: "abandoned" },
    { agentUserId: null, agentName: null, startedAt: at(0), queuedAt: at(0), answeredAt: null, endedAt: at(300), outcome: "voicemail" },
    // never reached the queue (hung up in the IVR): not offered
    { agentUserId: null, agentName: null, startedAt: at(0), queuedAt: null, answeredAt: null, endedAt: at(3), outcome: "abandoned" },
  ];
  const report = kpiSummary(calls, [10, 20], 20);
  assert.equal(report.offered, 4);
  assert.equal(report.answered, 2);
  assert.equal(report.abandoned, 1);
  assert.equal(report.voicemail, 1);
  assert.equal(report.asa, 20); // (10 + 30) / 2
  assert.equal(report.aht, 105); // (60 + 120) / 2 + (10 + 20) / 2
  assert.equal(report.abandonRate, 0.25);
  assert.equal(report.serviceLevel, 0.3333); // 1 fast answer / (2 answered + 1 abandoned)
  assert.deepEqual(report.agents, [{ userId: "a", displayName: "An", answered: 2, talkSeconds: 180, averageTalk: 90 }]);
  assert.deepEqual(report.hourly, [{ hour: 9, offered: 4, answered: 2 }]);
  assert.equal(kpiSummary([], [], 20).serviceLevel, null);

  const { start, end } = periodBounds("2026-10-19", "2026-10-20");
  assert.equal(start.toISOString(), "2026-10-18T17:00:00.000Z");
  assert.equal(end.toISOString(), "2026-10-20T17:00:00.000Z");
});

test("CC-10: attended transfer hands the caller to the receiver and splits the CDR", async () => {
  const { acd, pbxCalls, calls, agentState } = harness();
  await acd.handle({ type: "connected" });
  await acd.requestState("alice", "ready");
  await acd.handle(inbound);
  await acd.handle({ type: "dtmf", channelId: "caller", digit: "1" });
  await acd.handle({ type: "channel_up", channelId: "agent-leg-3" });
  await acd.requestState("bob", "ready");

  await acd.transfer("alice", { extension: "2102" }, true);
  assert.ok(pbxCalls.some(([name, , channel]) => name === "removeFromBridge" && channel === "caller"), "caller on hold");
  assert.equal(agentState("bob"), "ringing");
  await acd.handle({ type: "channel_up", channelId: "agent-leg-4" });
  assert.equal(agentState("bob"), "on_call");
  assert.deepEqual(acd.agentView("alice").offer.transfer, { target: "2102", attended: true, answered: true });

  await acd.completeTransfer("alice");
  assert.equal(agentState("alice"), "wrap_up");
  const [first, second] = [...calls.values()];
  assert.equal(first.outcome, "transferred");
  assert.equal(second.transferredFrom, first.id);
  assert.equal(second.agentUserId, "bob");
  assert.ok(second.answeredAt);
  assert.equal(second.recordingKey, first.recordingKey, "the bridge recording carries on");

  await acd.handle({ type: "channel_ended", channelId: "caller" });
  assert.equal(second.outcome, "answered");
  assert.equal(agentState("bob"), "wrap_up");
});

test("CC-10: blind transfer to a department requeues; an unanswered blind transfer returns to the queue head", async () => {
  const { acd, calls, agentState } = harness();
  await acd.handle({ type: "connected" });
  await acd.requestState("alice", "ready");
  await acd.handle(inbound);
  await acd.handle({ type: "dtmf", channelId: "caller", digit: "1" });
  await acd.handle({ type: "channel_up", channelId: "agent-leg-3" });
  await assert.rejects(acd.transfer("alice", { departmentId: "support" }, true), (error) => error.code === "INVALID_INPUT");
  await acd.transfer("alice", { departmentId: "support" }, false);
  assert.equal(agentState("alice"), "wrap_up");
  assert.equal(acd.snapshot("support").waiting.length, 1);
  const second = [...calls.values()][1];
  assert.equal(second.departmentId, "support");
  assert.ok(second.queuedAt, "offered again in the receiving department");

  const other = harness();
  await other.acd.handle({ type: "connected" });
  await other.acd.requestState("alice", "ready");
  await other.acd.handle(inbound);
  await other.acd.handle({ type: "dtmf", channelId: "caller", digit: "1" });
  await other.acd.handle({ type: "channel_up", channelId: "agent-leg-3" });
  await other.acd.requestState("bob", "ready");
  await other.acd.transfer("alice", { extension: "2102" }, false);
  assert.equal(other.agentState("alice"), "wrap_up", "blind: the agent leaves at once");
  await other.acd.handle({ type: "channel_ended", channelId: "agent-leg-4" }); // Bob let it ring out
  assert.equal(other.agentState("bob"), "not_ready");
  assert.equal(other.acd.snapshot("sales").waiting.length, 1, "back in the queue");
});

test("CC-11: a supervisor listens through a snoop channel and leaves when the call ends", async () => {
  const { acd, pbxCalls } = harness();
  await acd.handle({ type: "connected" });
  await acd.requestState("alice", "ready");
  await acd.handle(inbound);
  await acd.handle({ type: "dtmf", channelId: "caller", digit: "1" });
  await acd.handle({ type: "channel_up", channelId: "agent-leg-3" });
  const key = acd.snapshot("sales").agents.find((agent) => agent.userId === "alice").callId;
  assert.equal(acd.departmentOfCall(key), "sales");
  await acd.monitor("boss", "2199", key, "whisper");
  await acd.handle({ type: "channel_up", channelId: "agent-leg-4" });
  assert.ok(pbxCalls.some(([name, a, b]) => name === "bridge" && a === "snoop-1" && b === "agent-leg-4"), "snoop bridged to the supervisor");
  await assert.rejects(acd.monitor("boss", "2199", key, "listen"), (error) => error.code === "ALREADY_MONITORING");
  await acd.handle({ type: "channel_ended", channelId: "caller" });
  assert.ok(pbxCalls.some(([name, channel]) => name === "hangup" && channel === "agent-leg-4"), "supervisor leg hung up");
  assert.ok(pbxCalls.some(([name, channel]) => name === "hangup" && channel === "snoop-1"));
});

test("ACD: hold takes the caller out of the bridge with music, resume brings them back", async () => {
  const { acd, pbxCalls, advance } = harness();
  await acd.handle({ type: "connected" });
  await assert.rejects(acd.hold("alice", true), (error) => error.code === "NO_ACTIVE_CALL");
  await acd.requestState("alice", "ready");
  await advance(1000);
  await acd.handle(inbound);
  await acd.handle({ type: "dtmf", channelId: "caller", digit: "1" });
  await acd.handle({ type: "channel_up", channelId: "agent-leg-3" });

  const before = pbxCalls.length;
  await acd.hold("alice", true);
  assert.deepEqual(pbxCalls.slice(before).map(([name, ...args]) => [name, ...args]), [
    ["removeFromBridge", "bridge-1", "caller"],
    ["startMusicOnHold", "caller"],
  ]);
  assert.equal(acd.agentView("alice").offer.held, true);
  await acd.hold("alice", true); // already held: nothing more
  assert.equal(pbxCalls.length, before + 2);

  await acd.hold("alice", false);
  assert.deepEqual(pbxCalls.slice(before + 2), [
    ["stopMusicOnHold", "caller"],
    ["addToBridge", "bridge-1", ["caller"]],
  ]);
  assert.equal(acd.agentView("alice").offer.held, false);
});

test("ACD: a pause keeps its reason (NV-CC2); ready clears it", async () => {
  const { acd } = harness();
  await acd.handle({ type: "connected" });
  await acd.requestState("alice", "not_ready", "Ăn trưa");
  assert.equal(acd.agentView("alice").reason, "Ăn trưa");
  await acd.requestState("alice", "ready", "Ăn trưa");
  assert.equal(acd.agentView("alice").reason, "");
});

test("ACD: a browser call skips the IVR, reaches its department and carries the caller's context", async () => {
  const session = { userId: "student-1", departmentId: "sales", context: "CC-101 · Bài 2 · phiếu TK-000009", displayName: "Sinh viên A", phone: null };
  const { acd, pbxCalls, call } = harness({ webSessions: { web0123456789ab: session } });
  await acd.handle({ type: "connected" });
  await acd.requestState("alice", "ready");

  // An endpoint without a live session (expired, or forged) is hung up and leaves no record.
  await acd.handle({ type: "call_started", channelId: "stale", args: ["web", "webffffffffffff"], callerNumber: "", callerName: "", exten: "hotline" });
  assert.deepEqual(pbxCalls.at(-1), ["hangup", "stale"]);
  assert.equal(call(), undefined);

  await acd.handle({ type: "call_started", channelId: "browser", args: ["web", "web0123456789ab"], callerNumber: "web0123456789ab", callerName: "", exten: "hotline" });
  assert.equal(call().direction, "inbound");
  assert.equal(call().calleeNumber, "web");
  assert.equal(call().callerUserId, "student-1");
  assert.equal(call().departmentId, "sales");
  assert.ok(!pbxCalls.some(([name, , media]) => name === "play" && media.some((item) => item.startsWith("sound:digits/"))), "no IVR menu");
  assert.deepEqual(pbxCalls.find(([name]) => name === "callExtension"), ["callExtension", "2101"]);
  const offer = acd.agentView("alice").offer;
  assert.equal(offer.caller.displayName, "Sinh viên A");
  assert.equal(offer.context, session.context);
});

test("ACD: an idle agent whose softphone stays unregistered 30 s goes offline (BR-09)", async () => {
  const registered = new Set(["2101", "2102"]);
  const { acd, agentState, advance } = harness({ online: (extension) => registered.has(extension) });
  await acd.handle({ type: "connected" });
  await acd.requestState("alice", "ready");
  await acd.requestState("bob", "not_ready", "Họp");
  registered.clear();

  await acd.checkConnections();
  await advance(20_000);
  await acd.checkConnections();
  assert.equal(agentState("alice"), "ready", "a short network blip is tolerated");

  registered.add("2102"); // bob's phone came back: his timer restarts
  await acd.checkConnections();
  registered.clear();
  await advance(10_000);
  await acd.checkConnections();
  assert.equal(agentState("alice"), "offline");
  assert.equal(acd.agentView("alice").reason, "Mất kết nối quá 30 giây");
  assert.equal(agentState("bob"), "not_ready");
});

test("ACD: the caller hears the recording notice exactly once before reaching an agent (BR-06)", async () => {
  const { acd, pbxCalls } = harness();
  await acd.handle({ type: "connected" });
  await acd.handle(inbound);
  await acd.handle({ type: "dtmf", channelId: "caller", digit: "1" });
  const plays = pbxCalls.filter(([name]) => name === "play").map(([, , media]) => media);
  assert.equal(plays.flat().filter((item) => item === "sound:conf-now-recording").length, 1);
  assert.equal(plays[0][0], "sound:conf-now-recording");
});
