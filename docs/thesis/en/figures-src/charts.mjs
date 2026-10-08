// Aggregates docs/evidence/media-lab/*.json (top level = Chrome runs) and the chat-load summary,
// writes build/data/summary.json and the Chapter 5 chart SVGs into build/svg.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { C, SUFFIX, nf, svg, text, tr } from "./kit.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const evidence = join(repo, "docs/evidence/media-lab");
const outSvg = resolve(here, `../build/svg${SUFFIX}`);
const outData = resolve(here, "../build/data");
await mkdir(outSvg, { recursive: true });
await mkdir(outData, { recursive: true });

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v) => (v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean(v)) ** 2, 0) / (v.length - 1)) : null);
const stat = (vals) => {
  const v = vals.filter((x) => typeof x === "number" && Number.isFinite(x));
  return v.length ? { mean: mean(v), sd: sd(v), n: v.length, min: Math.min(...v), max: Math.max(...v) } : null;
};

const METRICS = {
  upKbps: (s) => s.upKbps?.mean,
  upP95: (s) => s.upKbps?.p95,
  downKbps: (s) => s.downKbps?.mean,
  cpu: (s) => s.clientCpuPct?.mean,
  encoders: (s) => s.activeEncoders,
  rtt: (s) => s.rttMs,
  audioJitter: (s) => s.audioJitterMs,
  videoJitter: (s) => s.videoJitterMs,
  loss: (s) => s.lossPct,
  fps: (s) => s.recvFps,
  jitterBuffer: (s) => s.jitterBufferMs,
  nackPerMin: (s) => s.nackPerMin,
  firstFrame: (s) => s.firstFrameMs,
  limited: (s) => s.qualityLimitedShare,
  workerCpu: (s) => s.serverWorkerCpuPct,
  nodeCpu: (s) => s.serverNodeCpuPct,
  rss: (s) => s.serverRssMiB,
};

const runs = {};
for (const f of (await readdir(evidence)).filter((f) => f.endsWith(".json")).sort()) {
  const d = JSON.parse(await readFile(join(evidence, f), "utf8"));
  (runs[d.label] ??= []).push({ file: f, env: d.environment, results: d.results });
}
const summary = { environment: null, labels: {} };
for (const [label, list] of Object.entries(runs)) {
  summary.environment ??= list[0].env;
  const byN = {};
  for (const run of list)
    for (const r of run.results) {
      const s = r.summary;
      const row = (byN[s.clients] ??= { ok: [], failed: [], freeze: [] });
      if (s.failed) row.failed.push(s.failed);
      else {
        row.ok.push(s);
        // freezes inside the 60 s measurement window (the counter is cumulative since joining)
        const fr = (r.perClient ?? []).map((c) => (c.samples.at(-1)?.freezeCount ?? 0) - (c.samples[0]?.freezeCount ?? 0));
        if (fr.length) row.freeze.push(mean(fr));
      }
    }
  summary.labels[label] = {
    files: list.map((r) => r.file),
    rows: Object.entries(byN)
      .map(([n, row]) => ({
        clients: Number(n),
        runs: row.ok.length,
        failed: row.failed.length,
        failures: row.failed,
        ...Object.fromEntries(Object.entries(METRICS).map(([k, f]) => [k, stat(row.ok.map(f))])),
        freezePerClient: stat(row.freeze),
      }))
      .sort((a, b) => a.clients - b.clients),
  };
}
summary.chat = JSON.parse(await readFile(join(repo, "docs/evidence/chat-load-summary-2026-10-01.json"), "utf8"));
await writeFile(join(outData, "summary.json"), JSON.stringify(summary, null, 2));

// ------------------------------------------------------------------ charts
const SERIES = [
  { label: "mesh-norender", name: "Mesh P2P (baseline)", color: "#2a6fb8", marker: "circle" },
  { label: "sfu-norender", name: "SFU + simulcast (nexo)", color: "#d1611b", marker: "square" },
  { label: "sfu-nosimulcast-norender", name: "SFU, single encoding", color: "#2e8b57", marker: "triangle", dash: "6 4" },
];
const nice = (max) => {
  const raw = max / 5;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw);
  return { step, top: Math.ceil(max / step) * step };
};
const fmt = (v) => (v >= 1000 ? nf(v) : nf(v, Number.isInteger(+v.toFixed(2)) ? 0 : (+v.toFixed(2) * 10) % 1 === 0 ? 1 : 2));
function marker(kind, x, y, color) {
  if (kind === "square") return `<rect x="${x - 4.5}" y="${y - 4.5}" width="9" height="9" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
  if (kind === "triangle") return `<path d="M${x},${y - 6} L${x + 5.5},${y + 4} L${x - 5.5},${y + 4} z" fill="${color}" stroke="#fff" stroke-width="1.2"/>`;
  return `<circle cx="${x}" cy="${y}" r="5" fill="${color}" stroke="#fff" stroke-width="1.5"/>`;
}

function lineChart({ file, title, yLabel, metric, log = false, series = SERIES, ns = [2, 4, 6, 8, 10], yMax, note }) {
  const W = 760, H = 420, L = 78, R = 210, T = 46, B = 62;
  const pw = W - L - R, ph = H - T - B;
  const pts = [];
  for (const s of series) {
    const rows = summary.labels[s.label]?.rows ?? [];
    for (const row of rows) if (row[metric] && ns.includes(row.clients)) pts.push(row[metric].mean + (row[metric].sd ?? 0));
  }
  let body = "";
  let yOf;
  if (log) {
    const lo = -1, hi = Math.ceil(Math.log10(Math.max(...pts)));
    yOf = (v) => T + ph - ((Math.log10(Math.max(v, 0.1)) - lo) / (hi - lo)) * ph;
    for (let e = lo; e <= hi; e++) {
      const y = yOf(10 ** e);
      body += `<line x1="${L}" x2="${L + pw}" y1="${y}" y2="${y}" stroke="#e3e6ea"/>` + text(L - 8, y, fmt(10 ** e), { anchor: "end", size: 12, color: C.muted });
    }
  } else {
    const { step, top } = nice(yMax ?? Math.max(...pts) * 1.05);
    yOf = (v) => T + ph - (v / top) * ph;
    for (let v = 0; v <= top + 1e-9; v += step) {
      const y = yOf(v);
      body += `<line x1="${L}" x2="${L + pw}" y1="${y}" y2="${y}" stroke="#e3e6ea"/>` + text(L - 8, y, fmt(v), { anchor: "end", size: 12, color: C.muted });
    }
  }
  const xOf = (n) => L + (ns.indexOf(n) / (ns.length - 1)) * pw;
  for (const n of ns) body += text(xOf(n), T + ph + 18, String(n), { size: 12.5, color: C.muted });
  body += `<line x1="${L}" x2="${L + pw}" y1="${T + ph}" y2="${T + ph}" stroke="${C.line}"/><line x1="${L}" x2="${L}" y1="${T}" y2="${T + ph}" stroke="${C.line}"/>`;
  body += text(L + pw / 2, H - 16, "Number of participants N", { size: 13 });
  body += `<text x="20" y="${T + ph / 2}" font-size="13" text-anchor="middle" transform="rotate(-90 20 ${T + ph / 2})" fill="${C.ink}">${tr(yLabel)}</text>`;
  body += text(L, 22, title, { anchor: "start", bold: true, size: 15 });
  let ly = T + 6;
  for (const s of series) {
    const rows = (summary.labels[s.label]?.rows ?? []).filter((r) => ns.includes(r.clients) && r[metric]);
    if (!rows.length) continue;
    const path = rows.map((r, i) => `${i ? "L" : "M"}${xOf(r.clients)},${yOf(r[metric].mean)}`).join(" ");
    body += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.4"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/>`;
    for (const r of rows) {
      const x = xOf(r.clients), m = r[metric].mean, e = r[metric].sd;
      if (e) {
        const y1 = yOf(log ? Math.max(m - e, 0.1) : Math.max(0, m - e)), y2 = yOf(m + e);
        body += `<path d="M${x},${y1} V${y2} M${x - 5},${y1} H${x + 5} M${x - 5},${y2} H${x + 5}" stroke="${s.color}" stroke-width="1.3"/>`;
      }
      body += marker(s.marker, x, yOf(m), s.color);
    }
    const failed = (summary.labels[s.label]?.rows ?? []).filter((r) => r.failed && ns.includes(r.clients));
    for (const r of failed) body += text(xOf(r.clients), T + ph - 10, "✕", { color: s.color, size: 14, bold: true });
    body += `<line x1="${L + pw + 18}" x2="${L + pw + 44}" y1="${ly}" y2="${ly}" stroke="${s.color}" stroke-width="2.4"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""}/>` + marker(s.marker, L + pw + 31, ly, s.color);
    body += text(L + pw + 52, ly, s.name, { anchor: "start", size: 12 });
    ly += 24;
  }
  body += text(L + pw + 18, ly + 8, "error bars: ± 1 SD", { anchor: "start", size: 11, color: C.muted });
  body += text(L + pw + 18, ly + 24, "across runs", { anchor: "start", size: 11, color: C.muted });
  if (series.some((s) => (summary.labels[s.label]?.rows ?? []).some((r) => r.failed && ns.includes(r.clients)))) {
    body += text(L + pw + 18, ly + 46, "✕ a run that could not", { anchor: "start", size: 11, color: C.muted });
    body += text(L + pw + 18, ly + 62, "be completed (overload)", { anchor: "start", size: 11, color: C.muted });
    ly += 40;
  }
  if (note) body += text(L + pw + 18, ly + 48, note, { anchor: "start", size: 11, color: C.muted, lh: 15 });
  return writeFile(join(outSvg, `${file}.svg`), svg(W, H, body));
}

await lineChart({ file: "fig-5-3-uplink", title: "Uplink per client", yLabel: "kbps (mean of clients)", metric: "upKbps" });
await lineChart({ file: "fig-5-4-downlink", title: "Downlink per client", yLabel: "kbps (mean of clients)", metric: "downKbps" });
await lineChart({ file: "fig-5-5-cpu", title: "Browser CPU per client", yLabel: "% of one core", metric: "cpu" });
await lineChart({ file: "fig-5-6-rtt", title: "Round-trip time (log scale)", yLabel: "ms", metric: "rtt", log: true, series: SERIES.slice(0, 2) });
await lineChart({ file: "fig-5-7-fps", title: "Received frame rate", yLabel: "frames per second (source: 20 fps)", metric: "fps", yMax: 22, series: SERIES.slice(0, 2) });

// Chat latency: grouped bars p50/p95/p99 of receipt latency
{
  const tiers = summary.chat.tiers;
  const W = 760, H = 400, L = 70, R = 170, T = 46, B = 60;
  const pw = W - L - R, ph = H - T - B;
  const keys = [["p50", "#9ec5ea"], ["p95", "#2a6fb8"], ["p99", "#173f6b"]];
  const max = Math.max(...tiers.flatMap((t) => [t.receiptMs.p99, t.ackMs.p99]));
  const { step, top } = nice(max * 1.05);
  const yOf = (v) => T + ph - (v / top) * ph;
  let body = text(L, 22, "Message latency under load (receipt)", { anchor: "start", bold: true, size: 15 });
  for (let v = 0; v <= top + 1e-9; v += step)
    body += `<line x1="${L}" x2="${L + pw}" y1="${yOf(v)}" y2="${yOf(v)}" stroke="#e3e6ea"/>` + text(L - 8, yOf(v), fmt(v), { anchor: "end", size: 12, color: C.muted });
  body += `<line x1="${L}" x2="${L + pw}" y1="${yOf(100)}" y2="${yOf(100)}" stroke="#b42318" stroke-dasharray="6 4" stroke-width="1.4"/>` + text(L + pw - 4, yOf(100) - 8, "requirement: p95 < 100 ms", { anchor: "end", size: 11.5, color: "#b42318" });
  const gw = pw / tiers.length, bw = 30;
  tiers.forEach((t, i) => {
    const cx = L + gw * (i + 0.5);
    keys.forEach(([k, color], j) => {
      const v = t.receiptMs[k], x = cx + (j - 1) * (bw + 6) - bw / 2;
      body += `<rect x="${x}" y="${yOf(v)}" width="${bw}" height="${T + ph - yOf(v)}" fill="${color}"/>` + text(x + bw / 2, yOf(v) - 8, nf(v, 1), { size: 11 });
    });
    body += text(cx, T + ph + 18, `${t.count} sockets`, { size: 12.5, color: C.muted });
  });
  body += `<line x1="${L}" x2="${L + pw}" y1="${T + ph}" y2="${T + ph}" stroke="${C.line}"/>`;
  body += `<text x="20" y="${T + ph / 2}" font-size="13" text-anchor="middle" transform="rotate(-90 20 ${T + ph / 2})">${tr("milliseconds")}</text>`;
  keys.forEach(([k, color], j) => {
    body += `<rect x="${L + pw + 22}" y="${T + 4 + j * 24}" width="16" height="12" fill="${color}"/>` + text(L + pw + 46, T + 10 + j * 24, `${k} receipt`, { anchor: "start", size: 12 });
  });
  body += text(L + pw + 22, T + 92, ["2 API processes,", "4 messages/s, 30 s × 2 runs", "per level, loopback"], { anchor: "start", size: 11, color: C.muted, lh: 15 });
  await writeFile(join(outSvg, "fig-5-2-chat.svg"), svg(W, H, body));
}

// Layer comparison at N = 6 and N = 10: default policy vs forced layer 0 vs single encoding
{
  const groups = [6, 10];
  const series = [
    ["sfu-norender", "SFU, default layer policy", "#d1611b"],
    ["sfu-layer0-norender", "SFU, all consumers on layer 0", "#7a4fb0"],
    ["sfu-nosimulcast-norender", "SFU, single encoding", "#2e8b57"],
  ];
  const val = (label, n) => summary.labels[label]?.rows.find((r) => r.clients === n)?.downKbps;
  const all = groups.flatMap((n) => series.map(([l]) => val(l, n)?.mean ?? 0));
  const W = 760, H = 380, L = 70, R = 230, T = 46, B = 56;
  const pw = W - L - R, ph = H - T - B;
  const { step, top } = nice(Math.max(...all) * 1.1);
  const yOf = (v) => T + ph - (v / top) * ph;
  let body = text(L, 22, "Downlink per client by layer policy", { anchor: "start", bold: true, size: 15 });
  for (let v = 0; v <= top + 1e-9; v += step)
    body += `<line x1="${L}" x2="${L + pw}" y1="${yOf(v)}" y2="${yOf(v)}" stroke="#e3e6ea"/>` + text(L - 8, yOf(v), fmt(v), { anchor: "end", size: 12, color: C.muted });
  const gw = pw / groups.length, bw = 44;
  groups.forEach((n, i) => {
    const cx = L + gw * (i + 0.5);
    series.forEach(([label, , color], j) => {
      const v = val(label, n);
      const x = cx + (j - 1) * (bw + 8) - bw / 2;
      if (!v) {
        body += text(x + bw / 2, T + ph - 10, "n/a", { size: 11, color: C.muted });
        return;
      }
      body += `<rect x="${x}" y="${yOf(v.mean)}" width="${bw}" height="${T + ph - yOf(v.mean)}" fill="${color}"/>` + text(x + bw / 2, yOf(v.mean) - 8, nf(Math.round(v.mean)), { size: 11 });
    });
    body += text(cx, T + ph + 18, `N = ${n}`, { size: 12.5, color: C.muted });
  });
  body += `<line x1="${L}" x2="${L + pw}" y1="${T + ph}" y2="${T + ph}" stroke="${C.line}"/>`;
  body += `<text x="20" y="${T + ph / 2}" font-size="13" text-anchor="middle" transform="rotate(-90 20 ${T + ph / 2})">${tr("kbps (mean of clients)")}</text>`;
  series.forEach(([, name, color], j) => {
    body += `<rect x="${L + pw + 22}" y="${T + 4 + j * 24}" width="16" height="12" fill="${color}"/>` + text(L + pw + 46, T + 10 + j * 24, name, { anchor: "start", size: 12 });
  });
  await writeFile(join(outSvg, "fig-5-8-layers.svg"), svg(W, H, body));
}

// Console table for writing Chapter 5
for (const [label, { rows, files }] of Object.entries(summary.labels)) {
  console.log(`\n== ${label} (${files.length} files)`);
  for (const r of rows) {
    const f = (s, d = 0) => (s ? `${s.mean.toFixed(d)}${s.sd != null ? "±" + s.sd.toFixed(d) : ""}` : "-");
    console.log(
      `N=${r.clients} runs=${r.runs} failed=${r.failed} up=${f(r.upKbps)} down=${f(r.downKbps)} cpu=${f(r.cpu, 1)} enc=${f(r.encoders, 1)} rtt=${f(r.rtt, 2)} aJit=${f(r.audioJitter, 2)} vJit=${f(r.videoJitter, 2)} loss=${f(r.loss, 3)} fps=${f(r.fps, 1)} jb=${f(r.jitterBuffer, 1)} nack=${f(r.nackPerMin, 1)} ff=${f(r.firstFrame)} lim=${f(r.limited, 2)} wCpu=${f(r.workerCpu, 1)} nCpu=${f(r.nodeCpu, 2)} rss=${f(r.rss, 1)} freeze=${f(r.freezePerClient, 1)}`,
    );
  }
}
