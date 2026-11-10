import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InternalCallLog,
  internalOutcome,
} from "../../../dist/api/modules/callcenter/service/internal-call-service.js";

function harness() {
  const saved = [];
  let clock = 0;
  const log = new InternalCallLog(
    { saveInternalCall: async (record) => void saved.push(record) },
    () => new Date(Date.UTC(2026, 9, 24, 8, 0, clock++)),
  );
  return { log, saved };
}

const dialplan = (channelId, exten, app, appData, extra = {}) => ({
  type: "dialplan",
  channelId,
  linkedId: "L1",
  context: "from-internal",
  exten,
  app,
  appData,
  callerNumber: "10101",
  ...extra,
});

test("Internal calls: answered call is saved once, with answer and end times", async () => {
  const { log, saved } = harness();
  log.handle(dialplan("a", "10102", "NoOp", "Internal 10101 -> 10102"));
  log.handle(dialplan("a", "10102", "Dial", "PJSIP/10102,25"));
  log.handle({ type: "dial", callerChannelId: "a", status: "ANSWER" });
  await log.handle({ type: "channel_ended", channelId: "a" });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].callerNumber, "10101");
  assert.equal(saved[0].calleeNumber, "10102");
  assert.equal(saved[0].outcome, "answered");
  assert.equal(saved[0].linkedId, "L1");
  assert.ok(saved[0].answeredAt > saved[0].startedAt && saved[0].endedAt > saved[0].answeredAt);
  assert.equal(
    log.handle({ type: "channel_ended", channelId: "a" }),
    null,
    "a second end is ignored",
  );
});

test("Internal calls: a unit group number is logged once, answered by whoever picked up", async () => {
  const { log, saved } = harness();
  log.handle(dialplan("a", "10100", "Dial", "PJSIP/10102&PJSIP/10103,30"));
  log.handle({ type: "dial", callerChannelId: "a", status: "ANSWER" });
  log.handle({ type: "dial", callerChannelId: "a", status: "CANCEL" }); // the other phone stops ringing
  await log.handle({ type: "channel_ended", channelId: "a" });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].calleeNumber, "10100");
  assert.equal(saved[0].outcome, "answered");
});

test("Internal calls: offline callee gets its status from the voicemail hand-off", async () => {
  const { log, saved } = harness();
  log.handle(dialplan("a", "10102", "Dial", "PJSIP/10102,25"));
  log.handle(dialplan("a", "10102", "Stasis", "tworkspace,voicemail,10102,CHANUNAVAIL"));
  await log.handle({ type: "channel_ended", channelId: "a" });
  assert.equal(saved[0].outcome, "missed");
  assert.equal(saved[0].answeredAt, null);
});

test("Internal calls: a blind transfer ends the first leg and links the next one", async () => {
  const { log, saved } = harness();
  log.handle(dialplan("a", "10102", "Dial", "PJSIP/10102,25"));
  log.handle({ type: "dial", callerChannelId: "a", status: "ANSWER" });
  await log.handle(dialplan("a", "10103", "Dial", "PJSIP/10103,25"));
  log.handle({ type: "dial", callerChannelId: "a", status: "BUSY" });
  await log.handle({ type: "channel_ended", channelId: "a" });
  assert.deepEqual(
    saved.map((call) => [call.calleeNumber, call.outcome, call.linkedId]),
    [
      ["10102", "transferred", "L1"],
      ["10103", "busy", "L1#1"],
    ],
  );
  assert.equal(saved[1].transferredFrom, saved[0].id);
});

test("Internal calls: hotline, echo test and other contexts are not logged", () => {
  const { log } = harness();
  assert.equal(log.handle(dialplan("a", "8000", "Echo", "")), null);
  assert.equal(
    log.handle(dialplan("b", "hotline", "Stasis", "tworkspace,web,x", { context: "from-web" })),
    null,
  );
  assert.equal(log.handle({ type: "channel_ended", channelId: "a" }), null);
  assert.equal(log.handle({ type: "dial", callerChannelId: "z", status: "ANSWER" }), null);
});

test("Internal calls: dial status to outcome", () => {
  assert.equal(internalOutcome(true, "ANSWER"), "answered");
  assert.equal(internalOutcome(false, "BUSY"), "busy");
  assert.equal(internalOutcome(false, "CANCEL"), "abandoned");
  assert.equal(internalOutcome(false, "NOANSWER"), "missed");
  assert.equal(internalOutcome(false, ""), "missed");
});
