import { readFile, writeFile } from "node:fs/promises";
const report = JSON.parse(await readFile("docs/evidence/chat-load-2026-10-01.json", "utf8"));
const percentile = (values, p) =>
  values.sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] ?? null;
const tiers = report.load.tiers.map((count) => {
  const runs = report.runs.filter((run) => run.count === count),
    samples = runs.flatMap((run) => run.samples),
    receipts = runs.flatMap((run) => run.receipts);
  const rss = runs.flatMap((run) =>
    run.resources.flatMap((point) => point.api.map((api) => api.memory.rss)),
  );
  const cpu = runs.flatMap((run) =>
    run.resources.slice(1).flatMap((point, index) =>
      point.api.map((api, node) => {
        const previous = run.resources[index],
          old = previous.api[node].cpu;
        return (
          (100 * (api.cpu.user + api.cpu.system - (old.user + old.system))) /
          ((Date.parse(point.timestamp) - Date.parse(previous.timestamp)) * 1000)
        );
      }),
    ),
  );
  return {
    count,
    runs: runs.length,
    messages: samples.length,
    receipts: receipts.length,
    ackMs: Object.fromEntries(
      [0.5, 0.95, 0.99].map((p) => [
        `p${p * 100}`,
        percentile(
          samples.map((s) => s.ackMs),
          p,
        ),
      ]),
    ),
    receiptMs: Object.fromEntries(
      [0.5, 0.95, 0.99].map((p) => [
        `p${p * 100}`,
        percentile(
          receipts.map((s) => s.latencyMs),
          p,
        ),
      ]),
    ),
    lostAckRetries: samples.filter((s) => s.lostAckRetry).length,
    errors: runs.reduce((n, r) => n + r.errors.length, 0),
    duplicates: runs.reduce((n, r) => n + r.duplicates, 0),
    reconnectMs: runs.flatMap((r) => r.reconnect.map((s) => s.reconnectAndBackfillMs)),
    maxApiRssMiB: Math.max(...rss) / 1024 / 1024,
    maxApiOneCoreCpuPercent: Math.max(...cpu),
    maxPoolWaiting: Math.max(
      ...runs.flatMap((r) => r.resources.flatMap((s) => s.api.map((a) => a.db.waiting))),
    ),
    databaseContainer: runs.map((r) => r.databaseContainer),
  };
});
const summary = {
  timestamp: new Date().toISOString(),
  source: "chat-load-2026-10-01.json",
  cpuDefinition:
    "Delta process CPU microseconds / delta wall microseconds * 100; 100% is one core, sampled at 5s intervals. Connect/setup is excluded from CPU intervals.",
  tiers,
};
await writeFile(
  "docs/evidence/chat-load-summary-2026-10-01.json",
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary));
