import assert from "node:assert/strict";
import { test } from "node:test";
import { PersonalVoicemailService, greeting } from "../../../dist/api/modules/callcenter/service/voicemail-service.js";

function harness(mailboxes) {
  const pbxCalls = [];
  let sequence = 0;
  const pbx = new Proxy(
    { play: async (channelId, media) => (pbxCalls.push(["play", channelId, media]), `pb-${++sequence}`) },
    { get: (target, name) => target[name] ?? (async (...args) => void pbxCalls.push([name, ...args])) },
  );
  const saved = [];
  const notices = [];
  const store = {
    mailbox: async (number) => mailboxes[number] ?? null,
    callerName: async (number) => (number === "1200" ? "Phòng Giáo vụ" : null),
    savePersonalVoicemail: async (input) => (saved.push(input), `vm-${saved.length}`),
  };
  const service = new PersonalVoicemailService(pbx, store, async (notice) => void notices.push(notice));
  return { service, pbxCalls, saved, notices };
}

const owner = { "1201": { id: "ext-1201", user_id: "u-ha", display_name: "Vũ Thu Hà", email: "ha@test" } };
const started = (channelId, exten, status) => ({ type: "call_started", channelId, args: ["voicemail", exten, status], callerNumber: "1200", callerName: "", exten });

test("Personal voicemail: greeting, recording after the tone, saved for the owner and announced", async () => {
  const { service, pbxCalls, saved, notices } = harness(owner);
  assert.equal(await service.handle({ type: "call_started", channelId: "x", args: ["inbound"], callerNumber: "", callerName: "", exten: "" }), false, "hotline calls are the ACD's");

  assert.equal(await service.handle(started("ch-1", "1201", "BUSY")), true);
  assert.deepEqual(pbxCalls.slice(0, 2), [["answer", "ch-1"], ["play", "ch-1", greeting("1201", "BUSY")]]);
  assert.ok(greeting("1201", "BUSY").includes("sound:vm-isonphone"));
  assert.ok(greeting("1201", "NOANSWER").includes("sound:vm-isunavail"));

  assert.equal(await service.handle({ type: "playback_finished", playbackId: "pb-1" }), true);
  const record = pbxCalls.find(([name]) => name === "recordVoicemail");
  assert.equal(record[1], "ch-1");
  assert.match(record[2], /^pvm-/);
  assert.equal(record[3], 120);

  // The caller hangs up after speaking: the message is still kept (RecordingFinished follows).
  assert.equal(await service.handle({ type: "channel_ended", channelId: "ch-1" }), true);
  assert.equal(await service.handle({ type: "recording_finished", name: record[2], durationSeconds: 9 }), true);
  assert.deepEqual(saved, [{ extensionId: "ext-1201", callerNumber: "1200", callerName: "Phòng Giáo vụ", durationSeconds: 9, recordingKey: record[2] }]);
  assert.equal(notices[0].ownerId, "u-ha");
  assert.equal(notices[0].voicemailId, "vm-1");
  assert.ok(!pbxCalls.some(([name, id]) => name === "hangup" && id === "ch-1"), "no hangup of a channel that is already gone");
});

test("Personal voicemail: nothing kept when the caller hangs up at the tone; unknown mailboxes hang up", async () => {
  const { service, pbxCalls, saved } = harness(owner);
  await service.handle(started("ch-2", "1201", "NOANSWER"));
  await service.handle({ type: "playback_finished", playbackId: "pb-1" });
  const name = pbxCalls.find(([call]) => call === "recordVoicemail")[2];
  await service.handle({ type: "recording_finished", name, durationSeconds: 0 });
  assert.equal(saved.length, 0);
  assert.deepEqual(pbxCalls.at(-1), ["hangup", "ch-2"]);

  await service.handle(started("ch-3", "1999", "CHANUNAVAIL"));
  assert.deepEqual(pbxCalls.at(-1), ["hangup", "ch-3"]);
  assert.equal(await service.handle({ type: "recording_finished", name: "call-other", durationSeconds: 5 }), false, "other recordings pass through");
});

test("ARI adapter: a media list goes out as one comma-separated value (repeated params keep only the last)", async () => {
  const { AriPbx } = await import("../../../dist/api/modules/callcenter/infrastructure/ari-pbx.js");
  const original = globalThis.fetch;
  let url = "";
  globalThis.fetch = async (input) => ((url = String(input)), new Response(JSON.stringify({ id: "pb-1" }), { status: 201 }));
  try {
    const pbx = new AriPbx({ url: "http://ari.test:8088/", user: "u", password: "p", app: "nexo" });
    assert.equal(await pbx.play("ch-1", ["sound:vm-theperson", "digits:1201", "sound:vm-intro"]), "pb-1");
    assert.equal(new URL(url).searchParams.getAll("media").join("|"), "sound:vm-theperson,digits:1201,sound:vm-intro");
  } finally {
    globalThis.fetch = original;
  }
});
