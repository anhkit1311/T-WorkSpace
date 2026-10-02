import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaOperation } from "../src/features/meetings/webrtc/operation.ts";
test("Pending native media operation times out and cleans late acquired resources", async () => {
  let resolve,
    cleaned = 0;
  const pending = new Promise((done) => {
    resolve = done;
  });
  await assert.rejects(
    mediaOperation(pending, new AbortController().signal, 5, () => cleaned++),
    /quá thời gian/,
  );
  resolve({ track: "late" });
  await Promise.resolve();
  assert.equal(cleaned, 1);
});
test("Cancel settles a pending media operation immediately and never returns its late value", async () => {
  const controller = new AbortController();
  let resolve,
    cleaned = 0;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const operation = mediaOperation(pending, controller.signal, 10000, () => cleaned++);
  controller.abort();
  await assert.rejects(operation, /bị hủy/);
  resolve("late");
  await Promise.resolve();
  assert.equal(cleaned, 1);
  assert.equal(
    await mediaOperation(Promise.resolve("ready"), new AbortController().signal),
    "ready",
  );
});
