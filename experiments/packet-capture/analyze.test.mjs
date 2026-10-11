import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, rtcpName } from "./analyze.mjs";

const row = (fields) => ({
  "frame.time_epoch": "",
  "frame.len": "0",
  "ip.src": "192.168.1.10",
  "udp.srcport": "50000",
  "ip.dst": "192.168.1.60",
  "udp.dstport": "40000",
  "stun.type": "",
  "dtls.record.content_type": "",
  "rtp.ssrc": "",
  "rtp.seq": "",
  "rtp.timestamp": "",
  "rtp.p_type": "",
  "rtcp.pt": "",
  "rtcp.rc": "",
  ...fields,
});

test("RTCP feedback types are named by PT and FMT", () => {
  assert.equal(rtcpName(200), "SR");
  assert.equal(rtcpName(205, 1), "RTPFB/NACK");
  assert.equal(rtcpName(205, 15), "RTPFB/TWCC");
  assert.equal(rtcpName(206, 1), "PSFB/PLI");
  assert.equal(rtcpName(206, 15), "PSFB/REMB");
});

test("per-SSRC loss counts sequence gaps across wrap-around; jitter is zero for paced packets", () => {
  const rows = [row({ "stun.type": "0x0001", "frame.time_epoch": "0" }), row({ "dtls.record.content_type": "22" })];
  // 20 ms audio frames, 960 ticks each, seq 65533..65535,0..2 with seq 1 missing.
  const seqs = [65533, 65534, 65535, 0, 2];
  seqs.forEach((seq, i) => {
    const index = seq >= 65533 ? seq - 65533 : seq + 3;
    rows.push(
      row({
        "frame.time_epoch": String(1 + index * 0.02),
        "frame.len": "100",
        "rtp.ssrc": "0x1234",
        "rtp.seq": String(seq),
        "rtp.timestamp": String(1000 + index * 960),
        "rtp.p_type": "111",
      }),
    );
  });
  rows.push(row({ "rtcp.pt": "200;202", "rtcp.rc": "1;1" }));
  rows.push(row({ "rtcp.pt": "205", "rtcp.rc": "1" }));
  const summary = analyze(rows);
  assert.equal(summary.stunPackets, 1);
  assert.equal(summary.dtlsRecords, 1);
  assert.deepEqual(summary.rtcp, { SR: 1, SDES: 1, "RTPFB/NACK": 1 });
  const [stream] = summary.streams;
  assert.equal(stream.kind, "audio");
  assert.equal(stream.packets, 5);
  assert.equal(stream.lossPct, Math.round((1 / 6) * 10000) / 100);
  assert.equal(stream.jitterMs, 0);
});
