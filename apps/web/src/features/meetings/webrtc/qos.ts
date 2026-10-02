import type { QosMetrics } from "@doan/shared";
export interface RtcSample {
  id: string;
  type: string;
  timestamp: number;
  [key: string]: unknown;
}
interface Counter {
  timestamp: number;
  bytes?: number;
  received?: number;
  lost?: number;
}
export class QosCollector {
  private counters = new Map<string, Counter>();
  reset() {
    this.counters.clear();
  }
  collect(reports: { direction: "send" | "receive"; samples: RtcSample[] }[]): QosMetrics {
    const next = new Map<string, Counter>();
    let sent = 0,
      received = 0,
      hasSend = false,
      hasReceive = false,
      deltaPackets = 0,
      deltaLost = 0,
      hasLoss = false;
    let rtt: number | null = null,
      jitter: number | null = null;
    const selected: string[] = [];
    for (const { direction, samples } of reports) {
      const byId = new Map(samples.map((sample) => [sample.id, sample]));
      for (const transport of samples.filter((sample) => sample.type === "transport")) {
        const pair = byId.get(String(transport.selectedCandidatePairId ?? ""));
        if (pair?.type === "candidate-pair" && pair.state === "succeeded") {
          selected.push(`${direction}:${pair.id}`);
          if (typeof pair.currentRoundTripTime === "number")
            rtt = Math.max(rtt ?? 0, pair.currentRoundTripTime * 1000);
        }
      }
      for (const sample of samples) {
        if (
          !["inbound-rtp", "outbound-rtp"].includes(sample.type) ||
          !Number.isFinite(sample.timestamp)
        )
          continue;
        const key = `${direction}:${sample.id}`,
          old = this.counters.get(key),
          counter: Counter = { timestamp: sample.timestamp };
        const bytes = sample.type === "outbound-rtp" ? sample.bytesSent : sample.bytesReceived;
        if (typeof bytes === "number" && bytes >= 0) {
          counter.bytes = bytes;
          const elapsed = old ? (sample.timestamp - old.timestamp) / 1000 : 0;
          if (old?.bytes !== undefined && elapsed > 0 && bytes >= old.bytes) {
            const rate = ((bytes - old.bytes) * 8) / elapsed / 1000;
            if (sample.type === "outbound-rtp") {
              sent += rate;
              hasSend = true;
            } else {
              received += rate;
              hasReceive = true;
            }
          }
        }
        if (sample.type === "inbound-rtp") {
          if (typeof sample.jitter === "number" && sample.jitter >= 0)
            jitter = Math.max(jitter ?? 0, sample.jitter * 1000);
          if (
            typeof sample.packetsReceived === "number" &&
            typeof sample.packetsLost === "number"
          ) {
            counter.received = sample.packetsReceived;
            counter.lost = sample.packetsLost;
            if (
              old?.received !== undefined &&
              old.lost !== undefined &&
              sample.timestamp > old.timestamp &&
              counter.received >= old.received &&
              counter.lost >= old.lost
            ) {
              deltaPackets += counter.received - old.received;
              deltaLost += Math.max(0, counter.lost - old.lost);
              hasLoss = true;
            }
          }
        }
        next.set(key, counter);
      }
    }
    this.counters = next;
    return {
      rtt: rtt === null ? null : Math.round(rtt),
      jitter: jitter === null ? null : Math.round(jitter),
      packetLoss:
        hasLoss && deltaPackets + deltaLost > 0
          ? (100 * deltaLost) / (deltaPackets + deltaLost)
          : null,
      bitrate: hasSend || hasReceive ? Math.round(sent + received) : null,
      sendBitrate: hasSend ? Math.round(sent) : null,
      receiveBitrate: hasReceive ? Math.round(received) : null,
      selectedCandidatePairs: selected,
    };
  }
}
