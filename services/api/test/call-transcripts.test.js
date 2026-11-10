import assert from "node:assert/strict";
import { test } from "node:test";
import { CallTranscriptService } from "../../../dist/api/modules/callcenter/service/call-transcript-service.js";

const CALL = "11111111-2222-4333-8444-555555555555";

function setup({
  enabled = true,
  transcribe = async () => [{ start: 0, end: 2, text: "Xin chào" }],
} = {}) {
  const writes = [];
  const fetched = [];
  const service = new CallTranscriptService(
    { setCallTranscript: async (...args) => void writes.push(args) },
    async (name) => (
      fetched.push(name),
      { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }
    ),
    () => {},
    () => enabled,
    transcribe,
  );
  return { service, writes, fetched };
}

test("a finished call recording is transcribed and stored", async () => {
  const { service, writes, fetched } = setup();
  await service.handle({ type: "recording_finished", name: `call-${CALL}`, durationSeconds: 12 });
  assert.deepEqual(fetched, [`call-${CALL}`]);
  assert.deepEqual(writes, [
    [CALL, "processing", null],
    [CALL, "ready", [{ start: 0, end: 2, text: "Xin chào" }]],
  ]);
});

test("voicemails, empty recordings, other events and STT off are ignored", () => {
  const { service } = setup();
  assert.equal(
    service.handle({ type: "recording_finished", name: `vm-${CALL}`, durationSeconds: 5 }),
    null,
  );
  assert.equal(
    service.handle({ type: "recording_finished", name: `call-${CALL}`, durationSeconds: 0 }),
    null,
  );
  assert.equal(service.handle({ type: "recording_failed", name: `call-${CALL}` }), null);
  assert.equal(
    setup({ enabled: false }).service.handle({
      type: "recording_finished",
      name: `call-${CALL}`,
      durationSeconds: 5,
    }),
    null,
  );
});

test("with a summarizer, the transcript gets a summary and a disposition from the call's own list", async () => {
  const writes = [];
  const seen = [];
  const store = {
    setCallTranscript: async () => {},
    callDispositions: async () => [{ id: "d1", label: "Hỏi học phí" }],
    setCallSummary: async (...args) => void writes.push(args),
  };
  const summarize = async (segments, dispositions) => (
    seen.push([segments.length, dispositions.length]),
    { summary: "Hỏi học phí HK1", dispositionId: "d1" }
  );
  const service = new CallTranscriptService(
    store,
    async () => ({ arrayBuffer: async () => new ArrayBuffer(1) }),
    () => {},
    () => true,
    async () => [{ start: 0, end: 1, text: "Học phí bao nhiêu?" }],
    () => summarize,
  );
  await service.handle({ type: "recording_finished", name: `call-${CALL}`, durationSeconds: 5 });
  assert.deepEqual(seen, [[1, 1]]);
  assert.deepEqual(writes, [[CALL, "Hỏi học phí HK1", "d1"]]);

  // A summarizer failure keeps the transcript and does not throw.
  const failing = new CallTranscriptService(
    store,
    async () => ({ arrayBuffer: async () => new ArrayBuffer(1) }),
    () => {},
    () => true,
    async () => [{ start: 0, end: 1, text: "a" }],
    () => async () => {
      throw new Error("down");
    },
  );
  await failing.handle({ type: "recording_finished", name: `call-${CALL}`, durationSeconds: 5 });
  assert.equal(writes.length, 1);
});

test("a speech service failure marks the call failed and does not throw", async () => {
  const { service, writes } = setup({
    transcribe: async () => {
      throw new Error("503");
    },
  });
  await service.handle({ type: "recording_finished", name: `call-${CALL}`, durationSeconds: 5 });
  assert.deepEqual(writes.at(-1), [CALL, "failed", null]);
});
