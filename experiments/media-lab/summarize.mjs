// Build the Chapter 5 tables and SVG figures from docs/evidence/media-lab/*.json.
//   node experiments/media-lab/summarize.mjs
// Uses the newest file per label; failed tiers stay visible as "không hoàn thành".
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

const files = (await readdir(evidenceDir)).filter((f) => f.endsWith(".json")).sort();
const latest = new Map();
for (const file of files) {
  const data = JSON.parse(await readFile(join(evidenceDir, file), "utf8"));
  latest.set(data.label, { file, data });
}
const rowsOf = (label) => latest.get(label)?.data.results.map((r) => r.summary) ?? [];

const fmt = (v, digits = 0) =>
  v === null || v === undefined ? "–" : Number(v).toLocaleString("vi-VN", { maximumFractionDigits: digits });

// ---------- tables ----------
const header =
  "| N | Uplink TB (kbps) | Downlink TB (kbps) | CPU client TB (%) | Encoder hoạt động | RTT (ms) | Jitter video (ms) | Mất gói (%) | FPS nhận | Jitter buffer (ms) | CPU worker SFU (%) |\n| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |";
function table(label) {
  return [
    header,
    ...rowsOf(label).map((s) =>
      s.failed
        ? `| ${s.clients} | không hoàn thành: ${s.failed.split("\n")[0].slice(0, 60)} |  |  |  |  |  |  |  |  |  |`
        : `| ${s.clients} | ${fmt(s.upKbps.mean)} | ${fmt(s.downKbps.mean)} | ${fmt(s.clientCpuPct.mean)} | ${fmt(s.activeEncoders, 1)} | ${fmt(s.rttMs, 1)} | ${fmt(s.videoJitterMs, 1)} | ${fmt(s.lossPct, 2)} | ${fmt(s.recvFps, 1)} | ${fmt(s.jitterBufferMs)} | ${fmt(s.serverWorkerCpuPct, 1)} |`,
    ),
  ].join("\n");
}

// ---------- SVG line chart (one axis, direct labels, shaped markers) ----------
function chart({ title, unit, pick, log = false, file }) {
  const W = 640, H = 360, L = 64, R = 140, T = 44, B = 48;
  const series = SERIES.map((s) => ({
    ...s,
    points: rowsOf(s.label)
      .filter((r) => !r.failed && typeof pick(r) === "number")
      .map((r) => ({ x: r.clients, y: pick(r) })),
  })).filter((s) => s.points.length);
  const xs = series.flatMap((s) => s.points.map((p) => p.x));
  const ys = series.flatMap((s) => s.points.map((p) => p.y));
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
  await chart({ title: "Uplink mỗi client theo số người", unit: "kbps (trung bình các client)", pick: (r) => r.upKbps.mean, file: "fig-5-uplink.svg" }),
  await chart({ title: "Downlink mỗi client theo số người", unit: "kbps (trung bình các client)", pick: (r) => r.downKbps.mean, file: "fig-5-downlink.svg" }),
  await chart({ title: "CPU mỗi client theo số người", unit: "% của một lõi (100% = 1 lõi)", pick: (r) => r.clientCpuPct.mean, file: "fig-5-cpu.svg" }),
  await chart({ title: "RTT theo số người", unit: "ms", pick: (r) => r.rttMs, log: true, file: "fig-5-rtt.svg" }),
  await chart({ title: "Tốc độ khung hình nhận theo số người", unit: "khung/giây (nguồn phát 20 fps)", pick: (r) => r.recvFps, file: "fig-5-fps.svg" }),
];

const env = [...latest.values()][0]?.data.environment ?? {};
const sections = [...SERIES, ...EXTRA]
  .filter((s) => latest.has(s.label))
  .map((s) => `### ${s.name} (\`${s.label}\`)\n\nNguồn: [${latest.get(s.label).file}](../evidence/media-lab/${latest.get(s.label).file})\n\n${table(s.label)}`);
const md = `# Kết quả phòng thí nghiệm media — Mesh và SFU

Sinh tự động bởi \`node experiments/media-lab/summarize.mjs\` từ số liệu gốc trong \`docs/evidence/media-lab/\`.

**Môi trường:** ${env.cpu ?? "?"}, ${env.logicalCores ?? "?"} luồng, ${env.memoryGiB ?? "?"} GiB RAM, ${env.platform ?? ""}, Node ${env.node ?? ""}.
Trình duyệt: ${env.browser ?? ""}. ${env.network ?? ""}. Thu: ${env.capture ?? ""}. Hiển thị video nhận: ${env.remoteRendering ?? ""}.
Mỗi mức N: khởi động ${env.warmupSeconds ?? "?"} s, đo ${env.measureSeconds ?? "?"} s, lấy mẫu \`getStats()\` mỗi 2 s, CPU mỗi trình duyệt qua CDP \`SystemInfo.getProcessInfo\`.

${sections.join("\n\n")}

## Hình

${figures.map((f) => `![${f}](../thesis/figures/${f})`).join("\n\n")}
`;
await writeFile(join(root, "docs/benchmarks/media-lab-summary.md"), md);
console.log(`wrote docs/benchmarks/media-lab-summary.md and ${figures.length} figures`);
