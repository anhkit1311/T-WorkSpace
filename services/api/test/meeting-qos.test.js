import assert from "node:assert/strict";
import { test } from "node:test";
import { QOS_STALE_MS, parseQosReport, summarizeQos } from "../../../dist/api/modules/meetings/media/qos.js";

test("QoS report: untrusted numbers are clamped, junk becomes null", () => {
  assert.deepEqual(parseQosReport({ rtt: 40, jitter: "5", packetLoss: 250 }, 1), { rtt: 40, jitter: null, packetLoss: 100, at: 1 });
  assert.deepEqual(parseQosReport({ rtt: -1, jitter: Number.NaN, packetLoss: Infinity }, 1), { rtt: null, jitter: null, packetLoss: null, at: 1 });
  assert.deepEqual(parseQosReport(null, 1), { rtt: null, jitter: null, packetLoss: null, at: 1 });
});

test("QoS summary: avg/max over fresh reports only, unmeasured metrics left out", () => {
  const now = 100_000;
  const summary = summarizeQos(
    [
      { rtt: 20, jitter: null, packetLoss: 0, at: now },
      { rtt: 60, jitter: null, packetLoss: 4, at: now - 1000 },
      { rtt: 900, jitter: 9, packetLoss: 50, at: now - QOS_STALE_MS - 1 },
    ],
    now,
  );
  assert.deepEqual(summary, { peers: 2, rtt: { avg: 40, max: 60 }, jitter: null, packetLoss: { avg: 2, max: 4 } });
  assert.deepEqual(summarizeQos([], now), { peers: 0, rtt: null, jitter: null, packetLoss: null });
});
