import { test } from "node:test";
import assert from "node:assert/strict";
import { callQuality, eModel } from "./voice-quality.mjs";

test("E-model: no impairment gives R 93.2 / MOS 4.41; delay and loss lower it", () => {
  assert.deepEqual(eModel({ delayMs: 0, lossPct: 0 }), { r: 93.2, mos: 4.41 });
  // Id = 0.024·200 + 0.11·22.7 = 7.30; Ie,eff = 95·1/(1+25.1) = 3.64
  assert.equal(eModel({ delayMs: 200, lossPct: 1 }).r, 82.3);
  assert.ok(eModel({ delayMs: 40, lossPct: 1, bpl: 4.3 }).mos < eModel({ delayMs: 40, lossPct: 1 }).mos);
});

test("echoed packets give round trip, loss and jitter per PBX port", () => {
  const row = (time, src, dst, seq) => ({
    "frame.time_epoch": String(time),
    "udp.srcport": String(src),
    "udp.dstport": String(dst),
    "rtp.ssrc": "0x1",
    "rtp.seq": String(seq),
    "rtp.timestamp": String(seq * 160),
  });
  const rows = [];
  for (let seq = 0; seq < 4; seq++) {
    rows.push(row(seq * 0.02, 10010, 6000, seq));
    // packet 3 never comes back; the rest return 10 ms later
    if (seq !== 3) rows.push(row(seq * 0.02 + 0.01, 6000, 10010, seq));
  }
  const [call] = callQuality(rows);
  assert.equal(call.pbxPort, 10010);
  assert.equal(call.packetsSent, 4);
  assert.equal(call.packetsEchoed, 3);
  assert.equal(call.lossPct, 25);
  assert.equal(call.rttMeanMs, 10);
  assert.equal(call.jitterMeanMs, 0);
});
