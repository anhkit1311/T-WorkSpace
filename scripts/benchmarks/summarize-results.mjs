// Builds the SIPp and chat-latency tables and SVG charts in docs/benchmarks/ from the raw outputs
// (docs/benchmarks/raw/sipp/*, docs/evidence/chat-load-summary-*.json). Prints the tables as Markdown.
//   node scripts/benchmarks/summarize-results.mjs
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null;
};
const round = (value) => (value === null ? "–" : Math.round(value));

// Line chart: categorical x (tiers), linear y from 0, legend above, direct label at each line end.
const COLORS = ["#2a78d6", "#eb6834", "#1baf7a"];
function lineChart({ title, xLabel, yLabel, xs, series }) {
  const W = 640, H = 360, L = 64, R = 120, T = 56, B = 52;
  const max = Math.max(...series.flatMap((s) => s.values.filter((v) => v !== null)));
  const step = 10 ** Math.floor(Math.log10(max)) * (max / 10 ** Math.floor(Math.log10(max)) > 5 ? 2 : 1);
  const top = Math.ceil(max / step) * step;
  const x = (i) => L + (i * (W - L - R)) / Math.max(1, xs.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const text = (tx, ty, content, extra = "") => `<text x="${tx}" y="${ty}" ${extra}>${content}</text>`;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif" font-size="12">`,
    `<rect width="${W}" height="${H}" fill="#fcfcfb"/>`,
    text(L, 22, title, 'font-size="15" font-weight="600" fill="#0b0b0b"'),
    ...series.map((s, i) => `<rect x="${L + i * 150}" y="32" width="12" height="3" rx="1.5" fill="${COLORS[i]}"/>` + text(L + 18 + i * 150, 37, s.name, 'fill="#52514e"')),
    ...ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e4e3df"/>` + text(L - 8, y(v) + 4, v, 'text-anchor="end" fill="#52514e"')),
    ...xs.map((label, i) => text(x(i), H - B + 18, label, 'text-anchor="middle" fill="#52514e"')),
    text((L + W - R) / 2, H - 10, xLabel, 'text-anchor="middle" fill="#52514e"'),
    text(16, (T + H - B) / 2, yLabel, `text-anchor="middle" fill="#52514e" transform="rotate(-90 16 ${(T + H - B) / 2})"`),
  ];
  let lastLabelY = Infinity; // end labels are placed bottom-up, at least 14px apart
  series.map((s, i) => [s, i]).sort(([a], [b]) => a.values.at(-1) - b.values.at(-1)).forEach(([s, i]) => {
    const points = s.values.map((v, j) => (v === null ? null : [x(j), y(v)])).filter(Boolean);
    parts.push(`<polyline fill="none" stroke="${COLORS[i]}" stroke-width="2" points="${points.map((p) => p.join(",")).join(" ")}"/>`);
    parts.push(...points.map(([px, py]) => `<circle cx="${px}" cy="${py}" r="4" fill="${COLORS[i]}" stroke="#fcfcfb" stroke-width="2"/>`));
    const [lx, end] = points.at(-1);
    const ly = (lastLabelY = Math.min(end, lastLabelY - 14));
    parts.push(text(lx + 8, ly + 4, `${s.name} ${Math.round(s.values.filter((v) => v !== null).at(-1))}`, 'fill="#0b0b0b"'));
  });
  return [...parts, "</svg>"].join("\n");
}

await mkdir("docs/benchmarks/figures", { recursive: true });

// ---- SIPp: INVITE → 200 OK (ACD answers after writing the call row), success/failure, container CPU.
const sippDir = "docs/benchmarks/raw/sipp";
const levels = (await readdir(sippDir)).filter((d) => d.startsWith("level-")).map((d) => Number(d.slice(6))).sort((a, b) => a - b);
const sipp = [];
for (const level of levels) {
  const dir = `${sippDir}/level-${level}`;
  const files = await readdir(dir);
  const rtt = (await readFile(`${dir}/${files.find((f) => f.endsWith("_rtt.csv"))}`, "utf8"))
    .trim().split("\n").slice(1).map((line) => Number(line.split(";")[1]));
  const screen = await readFile(`${dir}/${files.find((f) => f.endsWith("_screen.log"))}`, "utf8");
  const count = (name) => Number([...screen.matchAll(new RegExp(`${name}\\s+\\|\\s+\\d+\\s+\\|\\s+(\\d+)`, "g"))].at(-1)?.[1] ?? 0);
  const { result, samples } = JSON.parse(await readFile(`${dir}/samples.json`, "utf8"));
  const mem = Math.max(...samples.flatMap((s) => s.containers.filter((c) => c.name === "infra-asterisk-1").map((c) => parseFloat(c.mem))));
  sipp.push({ level, attempted: result.totalCalls, ok: count("Successful call"), failed: count("Failed call"), p50: percentile(rtt, 50), p95: percentile(rtt, 95), max: percentile(rtt, 100), cpu: result.peakCpuPercent, mem });
}
console.log("| Concurrent (-l) | Calls (-m) | Successful | Failed | INVITE→200 p50 (ms) | p95 | max | Asterisk CPU peak | Asterisk RAM peak (MiB) | PostgreSQL CPU peak |");
console.log("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const r of sipp)
  console.log(`| ${r.level} | ${r.attempted} | ${r.ok} | ${r.failed} | ${round(r.p50)} | ${round(r.p95)} | ${round(r.max)} | ${r.cpu.asterisk}% | ${round(r.mem)} | ${r.cpu.postgres}% |`);

// ---- Chat over Socket.IO: ack and receipt latency percentiles per socket count.
const chatFile = (await readdir("docs/evidence")).find((f) => f.startsWith("chat-load-summary"));
const chat = JSON.parse(await readFile(`docs/evidence/${chatFile}`, "utf8")).tiers;
console.log("\n| Sockets | Messages | Receipts | Ack p50 / p95 / p99 (ms) | Receipt p50 / p95 / p99 (ms) | Errors | Max API CPU (1 core) | Max API RSS (MiB) |");
console.log("| ---: | ---: | ---: | --- | --- | ---: | ---: | ---: |");
for (const t of chat)
  console.log(`| ${t.count} | ${t.messages} | ${t.receipts} | ${round(t.ackMs.p50)} / ${round(t.ackMs.p95)} / ${round(t.ackMs.p99)} | ${round(t.receiptMs.p50)} / ${round(t.receiptMs.p95)} / ${round(t.receiptMs.p99)} | ${t.errors} | ${t.maxApiOneCoreCpuPercent.toFixed(1)}% | ${round(t.maxApiRssMiB)} |`);
await writeFile("docs/benchmarks/figures/chat-receipt-latency.svg", lineChart({
  title: "Chat message delivery latency across two API instances",
  xLabel: "Connected sockets", yLabel: "ms (send → other sockets receive)", xs: chat.map((t) => t.count),
  series: ["p50", "p95", "p99"].map((p) => ({ name: p, values: chat.map((t) => t.receiptMs[p]) })),
}));
