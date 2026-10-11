import test from "node:test";
import assert from "node:assert/strict";
import { levelFromRms } from "../src/features/meetings/mic-level.ts";
import { micConstraints, mediaConstraints } from "../src/features/meetings/webrtc/local-media.ts";

test("mic level maps -60..0 dBFS to 0..1 and clamps silence and clipping", () => {
  assert.equal(levelFromRms(0), 0);
  assert.equal(levelFromRms(Number.NaN), 0);
  assert.equal(levelFromRms(0.001), 0);
  assert.equal(levelFromRms(1), 1);
  assert.equal(levelFromRms(2), 1);
  assert.ok(Math.abs(levelFromRms(0.0316) - 0.5) < 0.01);
});

test("mic capture requests the browser speech pipeline on every path", () => {
  for (const constraints of [micConstraints(), micConstraints("dev-1"), mediaConstraints({}).audio]) {
    assert.equal(constraints.echoCancellation, true);
    assert.equal(constraints.noiseSuppression, true);
    assert.equal(constraints.autoGainControl, true);
  }
  assert.deepEqual(micConstraints("dev-1").deviceId, { ideal: "dev-1" });
  assert.equal("deviceId" in micConstraints(), false);
});
