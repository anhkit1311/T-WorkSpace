import assert from "node:assert/strict";
import { test } from "node:test";
import { isDialCode, pressKey } from "../../../dist/api/modules/callcenter/domain/dial-in.js";
import { MeetingDialInService } from "../../../dist/api/modules/callcenter/service/meeting-dialin-service.js";
import { mixFilter } from "../../../dist/api/modules/meetings/media/phone-bridge.js";

test("keypad collects a 6-digit code; * restarts, # ends early, other keys are ignored", () => {
  let buffer = "";
  let code = null;
  for (const key of "12A*2468") ({ buffer, code } = pressKey(buffer, key));
  assert.equal(buffer, "2468");
  assert.equal(code, null);
  ({ buffer, code } = pressKey(buffer, "1"));
  ({ buffer, code } = pressKey(buffer, "0"));
  assert.equal(code, "246810");
  assert.equal(buffer, "");
  assert.equal(pressKey("12", "#").code, "12");
  assert.equal(isDialCode("246810"), true);
  assert.equal(isDialCode("12"), false);
});

test("downlink mixes every other microphone; one input passes through", () => {
  assert.equal(mixFilter(1), "[0:a:0]aresample=async=1[a0];[a0]anull[a]");
  assert.match(mixFilter(3), /\[a0\]\[a1\]\[a2\]amix=inputs=3:duration=longest:normalize=0\[a\]$/);
});

function harness() {
  const calls = [];
  const timers = [];
  const pbx = new Proxy(
    {},
    {
      get: (_target, name) => async (...args) => {
        calls.push([name, ...args]);
        if (name === "play") return `pb-${calls.length}`;
        if (name === "externalMedia") return { channelId: "media-1", address: "10.0.0.2", port: 10010 };
        if (name === "bridge") return "bridge-1";
      },
    },
  );
  const announced = [];
  const leg = {
    listenPort: 30000,
    others: () => 1,
    connect: async (target) => (leg.target = target, { producerId: "p1", socketId: "phone:chan-1", userId: "", displayName: "x", kind: "audio", source: "mic" }),
    close: async () => ((leg.closed = true), ["p1"]),
  };
  const meetings = {
    room: async (code) => (code === "246810" ? { roomId: "room-1", name: "phong-hop" } : null),
    open: (input) => ((leg.input = input), leg),
    mediaHost: (port) => `ffmpeg:${port}`,
    announce: (roomId, event, data) => announced.push([roomId, event, data]),
  };
  const clock = { now: () => 0, setTimeout: (fn) => (timers.push(fn), timers.length), clearTimeout: () => {} };
  const service = new MeetingDialInService(pbx, meetings, clock, () => {});
  return { service, calls, announced, leg, timers };
}

const started = { type: "call_started", channelId: "chan-1", args: ["meeting"], callerNumber: "1101", callerName: "Cô Hà", exten: "7000" };
const dial = async (service, digits) => {
  for (const digit of digits) await service.handle({ type: "dtmf", channelId: "chan-1", digit });
};

test("a right code bridges the caller into the room and hangup leaves it", async () => {
  const { service, calls, announced, leg } = harness();
  assert.equal(await service.handle(started), true);
  assert.deepEqual(calls.slice(0, 2), [["answer", "chan-1"], ["play", "chan-1", ["sound:conf-getconfno"]]]);
  await dial(service, "246810");
  assert.ok(calls.some(([name, host]) => name === "externalMedia" && host === "ffmpeg:30000"));
  assert.ok(calls.some(([name, ids]) => name === "bridge" && ids.join() === "chan-1,media-1"));
  assert.deepEqual(leg.target, { channelId: "media-1", address: "10.0.0.2", port: 10010 });
  assert.equal(leg.input.displayName, "Cô Hà (điện thoại)");
  assert.deepEqual(announced.map(([, event]) => event), ["new_producer", "meeting_state_changed"]);

  // The media leg is ours too: the ACD must not see it.
  assert.equal(await service.handle({ type: "call_started", channelId: "media-1", args: ["phone-leg"] }), true);
  assert.equal(await service.handle({ type: "channel_ended", channelId: "chan-1" }), true);
  assert.equal(leg.closed, true);
  assert.ok(calls.some(([name, id]) => name === "destroyBridge" && id === "bridge-1"));
  assert.deepEqual(announced.slice(2).map(([, event]) => event), ["producer_closed", "peer_left", "meeting_state_changed"]);
  assert.equal(await service.handle({ type: "channel_ended", channelId: "chan-1" }), false);
});

test("three wrong codes play the error and hang up; other calls go to the ACD", async () => {
  const { service, calls, timers } = harness();
  assert.equal(await service.handle({ ...started, args: ["inbound"] }), false);
  await service.handle(started);
  await dial(service, "111111");
  await dial(service, "12#");
  assert.ok(calls.some(([name, , media]) => name === "play" && media?.join() === "sound:conf-invalid,sound:conf-getconfno"));
  await dial(service, "999999");
  assert.ok(calls.some(([name, , media]) => name === "play" && media?.join() === "sound:conf-invalid,sound:vm-goodbye"));
  assert.ok(!calls.some(([name]) => name === "externalMedia"));
  await timers.at(-1)();
  assert.ok(calls.some(([name, id]) => name === "hangup" && id === "chan-1"));
});
