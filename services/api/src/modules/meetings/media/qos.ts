// 2.2: client-measured network quality (getStats), reported every ~10 s and exported to Prometheus.

export interface QosReport {
  rtt: number | null;
  jitter: number | null;
  packetLoss: number | null;
  at: number;
}

/** A report older than this belongs to a peer that stopped measuring; it no longer counts. */
export const QOS_STALE_MS = 30_000;

const metric = (value: unknown, max: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : null;

/** Untrusted socket payload -> report; out-of-range numbers are clamped, junk becomes null. */
export function parseQosReport(data: Record<string, unknown> | null | undefined, now = Date.now()): QosReport {
  return {
    rtt: metric(data?.rtt, 60_000),
    jitter: metric(data?.jitter, 60_000),
    packetLoss: metric(data?.packetLoss, 100),
    at: now,
  };
}

export type QosKey = "rtt" | "jitter" | "packetLoss";

/** avg/max per metric over fresh reports; a metric nobody measured is left out. */
export function summarizeQos(reports: Iterable<QosReport>, now = Date.now()) {
  const fresh = [...reports].filter((report) => now - report.at <= QOS_STALE_MS);
  const stats = (key: QosKey) => {
    const values = fresh.map((report) => report[key]).filter((value): value is number => value !== null);
    if (!values.length) return null;
    return { avg: values.reduce((sum, value) => sum + value, 0) / values.length, max: Math.max(...values) };
  };
  return { peers: fresh.length, rtt: stats("rtt"), jitter: stats("jitter"), packetLoss: stats("packetLoss") };
}
