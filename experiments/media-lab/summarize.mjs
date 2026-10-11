// Build the Chapter 5 tables and SVG figures from docs/evidence/media-lab/*.json.
//   node experiments/media-lab/summarize.mjs
// Aggregates every run per label and N as mean ± sample SD; failed tiers stay visible.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = join(root, "docs/evidence/media-lab");
const figureDir = join(root, "docs/thesis/figures");

const SERIES = [
  { label: "mesh-norender", name: "Mesh P2P", color: "#2a78d6", marker: "circle" },
  { label: "sfu-norender", name: "SFU + simulcast", color: "#eb6834", marker: "square" },
  { label: "sfu-nosimulcast-norender", name: "SFU, 1 encoding", color: "#1baf7a", marker: "triangle" },
];
const EXTRA = [{ label: "sfu-layer0-norender", name: "SFU, mọi ô lớp 0" }];
// Stream-selection experiment (scripted talkers, --selection=..., --speak=5).
const POLICIES = [
  { label: "speaker-visible", name: "Theo ô hiển thị", color: "#2a78d6", marker: "circle" },
  { label: "speaker-speaker", name: "Theo người nói", color: "#eb6834", marker: "square" },
  { label: "speaker-combined", name: "Kết hợp", color: "#1baf7a", marker: "triangle" },
];

// Every run of a label is aggregated per N (mean ± sample SD across runs).
const files = (await readdir(evidenceDir)).filter((f) => f.endsWith(".json")).sort();
const runsByLabel = new Map();
for (const file of files) {
  const data = JSON.parse(await readFile(join(evidenceDir, file), "utf8"));
  if (!runsByLabel.has(data.label)) runsByLabel.set(data.label, []);
  runsByLabel.get(data.label).push({ file, data });
}
const METRICS = {
  upKbps: (r) => r.upKbps?.mean,
  downKbps: (r) => r.downKbps?.mean,
  clientCpuPct: (r) => r.clientCpuPct?.mean,
  activeEncoders: (r) => r.activeEncoders,
  rttMs: (r) => r.rttMs,
  videoJitterMs: (r) => r.videoJitterMs,
  lossPct: (r) => r.lossPct,
  recvFps: (r) => r.recvFps,
  jitterBufferMs: (r) => r.jitterBufferMs,
  serverWorkerCpuPct: (r) => r.serverWorkerCpuPct,
  downVideoKbps: (r) => r.downVideoKbps?.mean,
  detectionMs: (r) => r.speaker?.detectionMs?.mean,
  detectionP95Ms: (r) => r.speaker?.detectionMs?.p95,
  missedShare: (r) => r.speaker?.missedShare,
  wrongEventsPerSlot: (r) => r.speaker?.wrongEventsPerSlot,
  layerRequests: (r) => r.speaker?.layerRequestsPerClient,
};
const stats = (values) => {
  const v = values.filter((x) => typeof x === "number" && Number.isFinite(x));
  if (!v.length) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)) : null;
  return { mean, sd };
};
function rowsOf(label) {
  const byN = new Map();
  for (const { data } of runsByLabel.get(label) ?? [])
    for (const { summary } of data.results) {
      if (!byN.has(summary.clients)) byN.set(summary.clients, []);
      byN.get(summary.clients).push(summary);
    }
  return [...byN.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([clients, summaries]) => {
      const ok = summaries.filter((r) => !r.failed);
      return {
        clients,
        runs: ok.length,
        failed: summaries.length - ok.length,
        failure: summaries.find((r) => r.failed)?.failed,
        m: Object.fromEntries(Object.entries(METRICS).map(([k, f]) => [k, stats(ok.map(f))])),
      };
    });
}

const fmt = (v, digits = 0) =>
  v === null || v === undefined ? "–" : Number(v).toLocaleString("vi-VN", { maximumFractionDigits: digits });
const cell = (st, digits = 0) =>
  !st ? "–" : st.sd === null ? fmt(st.mean, digits) : `${fmt(st.mean, digits)} ± ${fmt(st.sd, digits)}`;

// ---------- tables ----------
const header =
  "| N | Lượt | Uplink (kbps) | Downlink (kbps) | CPU client (%) | Encoder | RTT (ms) | Jitter video (ms) | Mất gói (%) | FPS nhận | Jitter buffer (ms) | CPU worker SFU (%) |\n| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |";
function table(label) {
  return [
    header,
    ...rowsOf(label).map((r) =>
      !r.runs
        ? `| ${r.clients} | 0/${r.failed} | không hoàn thành: ${String(r.failure).split("\n")[0].slice(0, 60)} |  |  |  |  |  |  |  |  |  |`
        : `| ${r.clients} | ${r.runs}${r.failed ? `/${r.runs + r.failed}` : ""} | ${cell(r.m.upKbps)} | ${cell(r.m.downKbps)} | ${cell(r.m.clientCpuPct, 1)} | ${cell(r.m.activeEncoders, 1)} | ${cell(r.m.rttMs, 1)} | ${cell(r.m.videoJitterMs, 1)} | ${cell(r.m.lossPct, 2)} | ${cell(r.m.recvFps, 1)} | ${cell(r.m.jitterBufferMs)} | ${cell(r.m.serverWorkerCpuPct, 1)} |`,
    ),
  ].join("\n");
}

// ---------- SVG line chart (one axis, direct labels, shaped markers) ----------
function chart({ title, unit, metric, log = false, file, lines = SERIES }) {
  const W = 640, H = 360, L = 64, R = 140, T = 44, B = 48;
  const series = lines.map((s) => ({
    ...s,
    points: rowsOf(s.label)
      .filter((r) => r.runs && r.m[metric])
      .map((r) => ({ x: r.clients, y: r.m[metric].mean, sd: r.m[metric].sd ?? 0 })),
  })).filter((s) => s.points.length);
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  const ys = series.flatMap((s) => s.points.map((p) => p.y + p.sd));
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMinRaw = log ? Math.max(0.1, Math.min(...ys.filter((y) => y > 0))) : 0;
  const yMaxRaw = Math.max(...ys);
  const niceMax = (v) => {
    const p = 10 ** Math.floor(Math.log10(v || 1));
    return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v;
  };
  const step = niceMax(yMaxRaw / 4);
  const yMax = log ? 10 ** Math.ceil(Math.log10(yMaxRaw)) : step * Math.ceil(yMaxRaw / step);
  const yMin = log ? 10 ** Math.floor(Math.log10(yMinRaw)) : 0;
  const sx = (x) => L + ((x - xMin) / Math.max(1, xMax - xMin)) * (W - L - R);
  const sy = (y) =>
    log
      ? T + (1 - (Math.log10(Math.max(y, yMin)) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin))) * (H - T - B)
      : T + (1 - y / yMax) * (H - T - B);
  const ticks = log
    ? Array.from({ length: Math.log10(yMax) - Math.log10(yMin) + 1 }, (_, i) => yMin * 10 ** i)
    : Array.from({ length: Math.round(yMax / step) + 1 }, (_, i) => step * i);
  const marker = (s, x, y) =>
    s.marker === "circle"
      ? `<circle cx="${x}" cy="${y}" r="4.5" fill="${s.color}" stroke="#fcfcfb" stroke-width="2"/>`
      : s.marker === "square"
        ? `<rect x="${x - 4.5}" y="${y - 4.5}" width="9" height="9" rx="1.5" fill="${s.color}" stroke="#fcfcfb" stroke-width="2"/>`
        : `<path d="M${x} ${y - 5.5} L${x + 5.5} ${y + 4.5} L${x - 5.5} ${y + 4.5} Z" fill="${s.color}" stroke="#fcfcfb" stroke-width="2"/>`;
  // Direct labels at line ends, nudged apart to avoid collisions.
  const ends = series
    .map((s) => ({ s, y: sy(s.points.at(-1).y), x: sx(s.points.at(-1).x) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;
  const xTicks = [...new Set(xs)].sort((a, b) => a - b);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, Segoe UI, Arial, sans-serif" role="img" aria-label="${title}">
<rect width="${W}" height="${H}" fill="#fcfcfb"/>
<text x="${L}" y="22" font-size="14" font-weight="600" fill="#0b0b0b">${title}</text>
<text x="${L}" y="38" font-size="11" fill="#52514e">${unit}${log ? " · thang logarit" : ""}</text>
${ticks
  .map(
    (t) =>
      `<line x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}" stroke="#e6e5e0" stroke-width="1"/><text x="${L - 8}" y="${sy(t) + 4}" font-size="11" text-anchor="end" fill="#52514e">${fmt(t, t < 1 ? 1 : 0)}</text>`,
  )
  .join("\n")}
${xTicks.map((x) => `<text x="${sx(x)}" y="${H - B + 18}" font-size="11" text-anchor="middle" fill="#52514e">${x}</text>`).join("\n")}
<text x="${(L + W - R) / 2}" y="${H - 10}" font-size="11" text-anchor="middle" fill="#52514e">Số người trong phòng (N)</text>
${series
  .map(
    (s) =>
      s.points
        .filter((p) => p.sd > 0)
        .map(
          (p) =>
            `<line x1="${sx(p.x)}" x2="${sx(p.x)}" y1="${sy(Math.max(p.y - p.sd, log ? 1e-9 : 0))}" y2="${sy(p.y + p.sd)}" stroke="${s.color}" stroke-width="1.5" opacity="0.7"/>`,
        )
        .join("") +
      `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" points="${s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}"/>` +
      s.points.map((p) => marker(s, sx(p.x), sy(p.y))).join(""),
  )
  .join("\n")}
${ends.map(({ s, x, y }) => `<text x="${x + 10}" y="${y + 4}" font-size="11" fill="#0b0b0b">${s.name}</text>`).join("\n")}
</svg>`;
  return writeFile(join(figureDir, file), svg).then(() => file);
}

await mkdir(figureDir, { recursive: true });
const figures = [
  await chart({ title: "Uplink mỗi client theo số người", unit: "kbps (trung bình các client)", metric: "upKbps", file: "fig-5-uplink.svg" }),
  await chart({ title: "Downlink mỗi client theo số người", unit: "kbps (trung bình các client)", metric: "downKbps", file: "fig-5-downlink.svg" }),
  await chart({ title: "CPU mỗi client theo số người", unit: "% của một lõi (100% = 1 lõi)", metric: "clientCpuPct", file: "fig-5-cpu.svg" }),
  await chart({ title: "RTT theo số người", unit: "ms", metric: "rttMs", log: true, file: "fig-5-rtt.svg" }),
  await chart({ title: "Tốc độ khung hình nhận theo số người", unit: "khung/giây (nguồn phát 20 fps)", metric: "recvFps", file: "fig-5-fps.svg" }),
];
const policyRuns = POLICIES.filter((s) => runsByLabel.has(s.label));
if (policyRuns.length)
  figures.push(
    await chart({
      title: "Downlink video theo chính sách chọn luồng",
      unit: "kbps mỗi client (trung bình)",
      metric: "downVideoKbps",
      file: "fig-5-selection-downlink.svg",
      lines: policyRuns,
    }),
  );

// One table for the selection experiment: rows N x policy.
const policyTable = () => {
  const rows = [];
  for (const s of policyRuns)
    for (const r of rowsOf(s.label))
      rows.push(
        !r.runs
          ? `| ${r.clients} | ${s.name} | không hoàn thành |  |  |  |  |  |  |`
          : `| ${r.clients} | ${s.name} | ${cell(r.m.downVideoKbps)} | ${cell(r.m.clientCpuPct, 1)} | ${cell(r.m.detectionMs)} | ${cell(r.m.detectionP95Ms)} | ${cell(r.m.missedShare, 3)} | ${cell(r.m.wrongEventsPerSlot, 3)} | ${cell(r.m.layerRequests, 1)} |`,
      );
  rows.sort((a, b) => Number(a.split("|")[1]) - Number(b.split("|")[1]));
  return [
    "| N | Chính sách | Downlink video (kbps) | CPU client (%) | Phát hiện người nói TB (ms) | p95 (ms) | Tỉ lệ lỡ slot | Sự kiện sai / slot | Lệnh đổi lớp / client |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows,
  ].join("\n");
};

const env = [...runsByLabel.values()][0]?.[0]?.data.environment ?? {};
const sections = [...SERIES, ...EXTRA]
  .filter((s) => runsByLabel.has(s.label))
  .map(
    (s) =>
      `### ${s.name} (\`${s.label}\`)\n\nNguồn: ${runsByLabel
        .get(s.label)
        .map(({ file }) => `[${file}](../evidence/media-lab/${file})`)
        .join(", ")}\n\n${table(s.label)}`,
  );
const md = `# Kết quả phòng thí nghiệm media — Mesh và SFU

Sinh tự động bởi \`node experiments/media-lab/summarize.mjs\` từ số liệu gốc trong \`docs/evidence/media-lab/\`.

**Môi trường:** ${env.cpu ?? "?"}, ${env.logicalCores ?? "?"} luồng, ${env.memoryGiB ?? "?"} GiB RAM, ${env.platform ?? ""}, Node ${env.node ?? ""}.
Trình duyệt: ${env.browser ?? ""}. ${env.network ?? ""}. Thu: ${env.capture ?? ""}. Hiển thị video nhận: ${env.remoteRendering ?? ""}.
Ô có dạng "trung bình ± độ lệch chuẩn" khi có từ 2 lượt; cột "Lượt" là số lượt thành công (/tổng nếu có lượt lỗi). Mỗi lượt, mỗi mức N: khởi động ${env.warmupSeconds ?? "?"} s, đo ${env.measureSeconds ?? "?"} s, lấy mẫu \`getStats()\` mỗi 2 s, CPU mỗi trình duyệt qua CDP \`SystemInfo.getProcessInfo\`.

${sections.join("\n\n")}
## Hình

${figures.map((f) => `![${f}](../thesis/figures/${f})`).join("\n\n")}
`;
await writeFile(join(root, "docs/benchmarks/media-lab-summary.md"), md);
if (policyRuns.length)
  await writeFile(
    join(root, "docs/benchmarks/media-lab-selection.md"),
    `# Chính sách chọn luồng với người nói theo kịch bản

Sinh tự động bởi \`node experiments/media-lab/summarize.mjs\`. Mỗi client phát một giọng tổng hợp và lần lượt nói 5 s theo vòng tròn; chính sách chạy trên lưới ảo 1280×720 với tối đa 9 ô; mỗi lượt khởi động ${env.warmupSeconds ?? "?"} s, đo ${env.measureSeconds ?? "?"} s; mọi client và SFU trên một máy.

Nguồn: ${policyRuns
      .flatMap((s) => runsByLabel.get(s.label).map(({ file }) => `[${file}](../evidence/media-lab/${file})`))
      .join(", ")}

${policyTable()}

![Downlink video theo chính sách](../thesis/figures/fig-5-selection-downlink.svg)
`,
  );
console.log(`wrote docs/benchmarks/media-lab-summary.md and ${figures.length} figures`);
