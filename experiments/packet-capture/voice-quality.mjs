// Voice quality of G.711 calls captured on the PBX side (scripts/benchmarks/sipp/run-sipp.mjs --pcap).
// SIPp -rtp_echo sends every RTP packet from Asterisk straight back (same SSRC and sequence number),
// so for each call (one Asterisk RTP port) the capture gives: echo round trip per packet, packets lost
// on the round trip, and RFC 3550 jitter of the returning stream. Those feed the simplified E-model.
//   node experiments/packet-capture/voice-quality.mjs <label=capture.csv> ... [--out=summary.json]
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "./analyze.mjs";

/**
 * Simplified ITU-T G.107 E-model for G.711 (Ie = 0) with all other parameters at their defaults
 * (R0 − Is = 93.2). Id after Cole & Rosenbluth (2001); Ie,eff per G.107 with random loss (BurstR = 1).
 * Bpl 25.1 = G.711 with packet loss concealment (G.113 Appendix I; WebRTC's NetEQ conceals loss),
 * 4.3 = without.
 */
export function eModel({ delayMs, lossPct, bpl = 25.1 }) {
  const id = 0.024 * delayMs + (delayMs > 177.3 ? 0.11 * (delayMs - 177.3) : 0);
  const ieEff = (95 * lossPct) / (lossPct + bpl);
  const r = 93.2 - id - ieEff;
  const mos = r <= 0 ? 1 : r >= 100 ? 4.5 : 1 + 0.035 * r + 7e-6 * r * (r - 60) * (100 - r);
  return { r: Math.round(r * 10) / 10, mos: Math.round(mos * 100) / 100 };
}

const RTP_PORTS = [10000, 10499];
const isPbxPort = (port) => port >= RTP_PORTS[0] && port <= RTP_PORTS[1];
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};
const round = (value) => Math.round(value * 100) / 100;

export function callQuality(rows) {
  const calls = new Map();
  for (const row of rows) {
    const time = Number(row["frame.time_epoch"]) * 1000;
    const src = Number(row["udp.srcport"]);
    const dst = Number(row["udp.dstport"]);
    if (!row["rtp.ssrc"] || !Number.isFinite(time)) continue;
    const outbound = isPbxPort(src);
    const port = outbound ? src : dst;
    if (!isPbxPort(port)) continue;
    let call = calls.get(port);
    if (!call) calls.set(port, (call = { sent: new Map(), echo: [] }));
    const key = `${row["rtp.ssrc"]}:${row["rtp.seq"]}`;
    if (outbound) call.sent.set(key, time);
    else call.echo.push({ key, time, timestamp: Number(row["rtp.timestamp"]) });
  }
  return [...calls.entries()].map(([port, { sent, echo }]) => {
    const rtt = [];
    const jitters = [];
    let jitter = 0;
    let previous = null;
    for (const packet of echo) {
      const departed = sent.get(packet.key);
      if (departed !== undefined) rtt.push(packet.time - departed);
      // RFC 3550 6.4.1 in ms (G.711: 8 timestamp units per ms); a new SSRC/playback restarts the estimate.
      const gap = previous && packet.timestamp - previous.timestamp;
      if (gap > 0 && gap < 8000) {
        const d = Math.abs(packet.time - previous.time - gap / 8);
        jitter += (d - jitter) / 16;
        jitters.push(jitter);
      }
      previous = packet;
    }
    const lossPct = sent.size ? Math.max(0, (1 - rtt.length / sent.size) * 100) : 0;
    const rttMean = rtt.reduce((sum, value) => sum + value, 0) / Math.max(1, rtt.length);
    const jitterMean = jitters.reduce((sum, value) => sum + value, 0) / Math.max(1, jitters.length);
    // Mouth-to-ear: the whole echo round trip (conservative) + 20 ms G.711 frame + a jitter buffer of 2×jitter (≥ 20 ms).
    const delayMs = rttMean + 20 + Math.max(20, 2 * jitterMean);
    return {
      pbxPort: port,
      packetsSent: sent.size,
      packetsEchoed: rtt.length,
      lossPct: round(lossPct),
      rttMeanMs: round(rttMean),
      rttP95Ms: round(percentile(rtt, 95)),
      jitterMeanMs: round(jitterMean),
      jitterMaxMs: round(Math.max(0, ...jitters)),
      delayMs: round(delayMs),
      ...eModel({ delayMs, lossPct }),
      mosNoPlc: eModel({ delayMs, lossPct, bpl: 4.3 }).mos,
    };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (!inputs.length) {
    console.error("usage: node voice-quality.mjs <label=capture.csv> ... [--out=summary.json]");
    process.exit(1);
  }
  const results = [];
  for (const input of inputs) {
    const [label, file] = input.includes("=") ? input.split("=") : [input, input];
    for (const call of callQuality(parseCsv(await readFile(file, "utf8")))) results.push({ profile: label, ...call });
  }
  const out = process.argv.find((arg) => arg.startsWith("--out="))?.slice(6);
  if (out) await writeFile(out, JSON.stringify(results, null, 2));
  console.table(results);
}
