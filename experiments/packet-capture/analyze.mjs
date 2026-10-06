// Summarise a WebRTC capture exported by tshark (see README.md for the export command).
//   node experiments/packet-capture/analyze.mjs capture-fields.csv [--out=summary.json]
// Computes per-SSRC packet/bitrate/loss/RFC 3550 jitter from RTP headers (SRTP keeps the
// RTP header in clear text) and counts STUN, DTLS and RTCP packet types.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FIELDS = [
  "frame.time_epoch",
  "frame.len",
  "ip.src",
  "udp.srcport",
  "ip.dst",
  "udp.dstport",
  "stun.type",
  "dtls.record.content_type",
  "rtp.ssrc",
  "rtp.seq",
  "rtp.timestamp",
  "rtp.p_type",
  "rtcp.pt",
  "rtcp.rc",
];

// Payload type -> RTP clock rate, matching the mediasoup router codecs (Opus 111, VP8 96+).
export function clockRate(payloadType) {
  return payloadType === 111 || payloadType === 100 ? 48000 : 90000;
}

const RTCP_NAMES = { 200: "SR", 201: "RR", 202: "SDES", 203: "BYE", 204: "APP" };
// RTPFB (205) FMT 1 = Generic NACK, 15 = transport-cc; PSFB (206) FMT 1 = PLI, 4 = FIR, 15 = REMB.
export function rtcpName(pt, fmt) {
  if (pt === 205) return fmt === 1 ? "RTPFB/NACK" : fmt === 15 ? "RTPFB/TWCC" : `RTPFB/${fmt}`;
  if (pt === 206)
    return fmt === 1 ? "PSFB/PLI" : fmt === 4 ? "PSFB/FIR" : fmt === 15 ? "PSFB/REMB" : `PSFB/${fmt}`;
  return RTCP_NAMES[pt] ?? `RTCP/${pt}`;
}

function parseCsv(text) {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const names = header.split(",").map((name) => name.replace(/^"|"$/g, ""));
  return lines.map((line) => {
    const cells = line.split(",").map((cell) => cell.replace(/^"|"$/g, ""));
    return Object.fromEntries(names.map((name, i) => [name, cells[i] ?? ""]));
  });
}

const first = (value) => (value ?? "").split(/[;|]/)[0];

export function analyze(rows) {
  const streams = new Map();
  const rtcp = {};
  let stun = 0;
  let dtls = 0;
  let start = Infinity;
  let end = -Infinity;
  for (const row of rows) {
    const time = Number(row["frame.time_epoch"]);
    if (Number.isFinite(time)) {
      start = Math.min(start, time);
      end = Math.max(end, time);
    }
    if (row["stun.type"]) stun++;
    if (row["dtls.record.content_type"]) dtls++;
    if (row["rtcp.pt"]) {
      const pts = row["rtcp.pt"].split(/[;|]/).map(Number);
      const fmts = (row["rtcp.rc"] || "").split(/[;|]/).map(Number);
      pts.forEach((pt, i) => {
        const name = rtcpName(pt, fmts[i]);
        rtcp[name] = (rtcp[name] ?? 0) + 1;
      });
      continue;
    }
    const ssrcText = first(row["rtp.ssrc"]);
    if (!ssrcText) continue;
    const key = `${ssrcText} ${row["ip.src"]}:${row["udp.srcport"]}->${row["ip.dst"]}:${row["udp.dstport"]}`;
    const pt = Number(first(row["rtp.p_type"]));
    const seq = Number(first(row["rtp.seq"]));
    const timestamp = Number(first(row["rtp.timestamp"]));
    let stream = streams.get(key);
    if (!stream) {
      stream = {
        ssrc: ssrcText,
        flow: key.slice(ssrcText.length + 1),
        payloadType: pt,
        packets: 0,
        bytes: 0,
        firstTime: time,
        lastTime: time,
        maxSeq: null,
        firstSeq: seq,
        cycles: 0,
        jitter: 0,
        previous: null,
      };
      streams.set(key, stream);
    }
    stream.packets++;
    stream.bytes += Number(row["frame.len"]) || 0;
    stream.lastTime = time;
    // Extended highest sequence number (RFC 3550 A.1), tolerant of reordering.
    if (stream.maxSeq === null) stream.maxSeq = seq;
    else {
      const delta = (seq - stream.maxSeq + 65536) % 65536;
      if (delta > 0 && delta < 32768) {
        if (seq < stream.maxSeq) stream.cycles++;
        stream.maxSeq = seq;
      }
    }
    // Interarrival jitter (RFC 3550 6.4.1), in timestamp units then converted to ms.
    const rate = clockRate(pt);
    if (stream.previous && timestamp !== stream.previous.timestamp) {
      const arrival = (time - stream.previous.time) * rate;
      const transit = (timestamp - stream.previous.timestamp + 2 ** 32) % 2 ** 32;
      const d = Math.abs(arrival - (transit > 2 ** 31 ? transit - 2 ** 32 : transit));
      stream.jitter += (d - stream.jitter) / 16;
    }
    stream.previous = { time, timestamp };
  }
  const durationS = end > start ? end - start : 0;
  return {
    durationS: Math.round(durationS * 10) / 10,
    stunPackets: stun,
    dtlsRecords: dtls,
    rtcp,
    streams: [...streams.values()]
      .map((s) => {
        const expected = s.cycles * 65536 + s.maxSeq - s.firstSeq + 1;
        const seconds = Math.max(1e-6, s.lastTime - s.firstTime);
        return {
          ssrc: s.ssrc,
          flow: s.flow,
          payloadType: s.payloadType,
          kind: clockRate(s.payloadType) === 48000 ? "audio" : "video",
          packets: s.packets,
          kbps: Math.round(((s.bytes * 8) / seconds / 1000) * 10) / 10,
          lossPct: Math.round((Math.max(0, expected - s.packets) / Math.max(1, expected)) * 10000) / 100,
          jitterMs: Math.round((s.jitter / clockRate(s.payloadType)) * 1000 * 100) / 100,
        };
      })
      .sort((a, b) => b.packets - a.packets),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2];
  if (!input) {
    console.error("usage: node analyze.mjs <tshark-fields.csv> [--out=summary.json]");
    process.exit(1);
  }
  const summary = analyze(parseCsv(await readFile(input, "utf8")));
  const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6);
  if (out) await writeFile(out, JSON.stringify(summary, null, 2));
  console.log(`Duration ${summary.durationS}s · STUN ${summary.stunPackets} · DTLS ${summary.dtlsRecords}`);
  console.log("RTCP:", JSON.stringify(summary.rtcp));
  console.table(summary.streams.slice(0, 20));
}
