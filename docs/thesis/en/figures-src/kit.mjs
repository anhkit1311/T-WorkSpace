// Tiny SVG toolkit for the thesis diagrams (rendered to PNG by render.mjs).
export const C = {
  ink: "#1f2328",
  muted: "#57606a",
  line: "#3d444d",
  client: "#e8f1fb",
  clientS: "#2a6fb8",
  server: "#fdf0e3",
  serverS: "#c56a17",
  sfu: "#e7f5ec",
  sfuS: "#2e8b57",
  data: "#eef0f3",
  dataS: "#57606a",
  net: "#f3ecfa",
  netS: "#7a4fb0",
  white: "#ffffff",
  warn: "#fdecea",
  warnS: "#b42318",
};
// THESIS_LANG=vi renders Vietnamese labels from vi.json; THESIS_LANG=collect records every label.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname as _dirname, join as _join } from "node:path";
import { fileURLToPath as _f } from "node:url";
export const LANG = process.env.THESIS_LANG ?? "en";
export const SUFFIX = LANG === "vi" ? "-vi" : "";
const _here = _dirname(_f(import.meta.url));
const DICT = LANG === "vi" ? JSON.parse(readFileSync(_join(_here, "vi.json"), "utf8")) : {};
const SEEN = new Set();
export const tr = (t) => {
  const key = String(t);
  if (LANG === "collect") SEEN.add(key);
  if (LANG === "vi" && key.trim() && !(key in DICT) && /[A-Za-z]{3}/.test(key)) MISSING.add(key);
  return DICT[key] ?? key;
};
const MISSING = new Set();
process.on("exit", () => {
  if (LANG === "collect") {
    const file = _join(_here, "labels.collected.json");
    let prev = [];
    try { prev = JSON.parse(readFileSync(file, "utf8")); } catch {}
    writeFileSync(file, JSON.stringify([...new Set([...prev, ...SEEN])].sort(), null, 1));
  }
  if (MISSING.size) console.warn(`untranslated labels (${MISSING.size}):\n${[...MISSING].join("\n")}`);
});
/** Locale-aware number: en 1,234.5 / vi 1.234,5 */
export function nf(v, digits = 0) {
  const en = Number(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return LANG === "vi" ? en.replace(/[,.]/g, (c) => (c === "," ? "." : ",")) : en;
}
const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Arial, Helvetica, sans-serif">
<defs>
<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${C.line}"/></marker>
<marker id="ao" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10" fill="none" stroke="${C.line}" stroke-width="1.5"/></marker>
</defs>
<rect width="${w}" height="${h}" fill="#fff"/>
${body}
</svg>`;
}

/** Multi-line text centred at (x, y). lines: string | string[]; first line may be bold. */
export function text(x, y, lines, o = {}) {
  const arr = Array.isArray(lines) ? lines : [lines];
  const size = o.size ?? 13;
  const lh = o.lh ?? size * 1.3;
  const anchor = o.anchor ?? "middle";
  const y0 = y - ((arr.length - 1) * lh) / 2 + size * 0.35;
  return arr
    .map((t0, i) => {
      const t = tr(t0);
      const bold = (o.bold && i === 0) || o.allBold;
      const mono = o.mono;
      return `<text x="${x}" y="${y0 + i * lh}" font-size="${i > 0 && o.subSize ? o.subSize : size}" text-anchor="${anchor}" fill="${o.color ?? C.ink}"${bold ? ' font-weight="bold"' : ""}${mono ? ' font-family="Consolas, monospace"' : ""}${o.italic ? ' font-style="italic"' : ""}>${esc(t)}</text>`;
    })
    .join("");
}

export function box(x, y, w, h, lines, o = {}) {
  const r = o.r ?? 6;
  const rect = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${o.fill ?? C.white}" stroke="${o.stroke ?? C.line}" stroke-width="${o.sw ?? 1.4}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ""}/>`;
  if (lines == null) return rect;
  if (o.title) {
    return (
      rect +
      text(x + w / 2, y + 16, o.title, { bold: true, size: o.titleSize ?? 14, color: o.stroke ?? C.ink }) +
      (lines.length ? text(x + w / 2, y + 16 + (h - 16) / 2, lines, { size: o.size ?? 12, ...o.textOpts }) : "")
    );
  }
  return rect + text(x + w / 2, y + h / 2, lines, { size: o.size ?? 13, bold: o.bold, subSize: o.subSize, mono: o.mono });
}

export function group(x, y, w, h, title, o = {}) {
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${o.fill ?? "none"}" stroke="${o.stroke ?? C.line}" stroke-width="${o.sw ?? 1.6}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ""}/>` +
    text(o.tx ?? x + 12, y + 18, title, { anchor: o.tx ? "middle" : "start", bold: true, size: o.size ?? 14, color: o.stroke ?? C.ink })
  );
}

/** Polyline arrow through points [[x,y],...]. */
export function arrow(pts, o = {}) {
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ");
  const start = o.both ? ' marker-start="url(#ah)"' : "";
  const end = o.none ? "" : ` marker-end="url(#${o.open ? "ao" : "ah"})"`;
  let s = `<path d="${d}" fill="none" stroke="${o.color ?? C.line}" stroke-width="${o.sw ?? 1.5}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ""}${start}${end}/>`;
  if (o.label) {
    const [lx, ly] = o.at ?? mid(pts);
    const lines = Array.isArray(o.label) ? o.label : [o.label];
    const w = Math.max(...lines.map((l) => l.length)) * (o.size ?? 11.5) * 0.56 + 10;
    const h = lines.length * (o.size ?? 11.5) * 1.3 + 4;
    if (!o.noBg) s += `<rect x="${lx - w / 2}" y="${ly - h / 2}" width="${w}" height="${h}" fill="#fff" opacity="0.92"/>`;
    s += text(lx, ly, lines, { size: o.size ?? 11.5, color: o.labelColor ?? C.muted, italic: o.italicLabel, anchor: o.anchor });
  }
  return s;
}
const mid = (pts) => {
  if (pts.length === 2) return [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
  const i = Math.floor((pts.length - 1) / 2);
  return [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
};

export function diamond(cx, cy, w, h, lines, o = {}) {
  return (
    `<path d="M${cx},${cy - h / 2} L${cx + w / 2},${cy} L${cx},${cy + h / 2} L${cx - w / 2},${cy} z" fill="${o.fill ?? "#fff8e6"}" stroke="${o.stroke ?? C.line}" stroke-width="1.4"/>` +
    text(cx, cy, lines, { size: o.size ?? 12 })
  );
}
export function pill(cx, cy, w, h, lines, o = {}) {
  return box(cx - w / 2, cy - h / 2, w, h, lines, { r: h / 2, fill: o.fill ?? "#f1f3f5", size: o.size ?? 13, bold: true, ...o });
}
export function ellipse(cx, cy, rx, ry, lines, o = {}) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${o.fill ?? C.white}" stroke="${o.stroke ?? C.line}" stroke-width="1.4"/>` + text(cx, cy, lines, { size: o.size ?? 12.5 });
}
export function actor(cx, cy, label) {
  return `<g stroke="${C.ink}" stroke-width="1.6" fill="none"><circle cx="${cx}" cy="${cy - 26}" r="9"/><line x1="${cx}" y1="${cy - 17}" x2="${cx}" y2="${cy + 8}"/><line x1="${cx - 14}" y1="${cy - 8}" x2="${cx + 14}" y2="${cy - 8}"/><line x1="${cx}" y1="${cy + 8}" x2="${cx - 11}" y2="${cy + 26}"/><line x1="${cx}" y1="${cy + 8}" x2="${cx + 11}" y2="${cy + 26}"/></g>` + text(cx, cy + 42, label, { size: 12.5, bold: true });
}
export function cylinder(x, y, w, h, lines, o = {}) {
  const ry = 9;
  return `<path d="M${x},${y + ry} A${w / 2},${ry} 0 0 1 ${x + w},${y + ry} L${x + w},${y + h - ry} A${w / 2},${ry} 0 0 1 ${x},${y + h - ry} z" fill="${o.fill ?? C.data}" stroke="${o.stroke ?? C.dataS}" stroke-width="1.4"/><path d="M${x},${y + ry} A${w / 2},${ry} 0 0 0 ${x + w},${y + ry}" fill="none" stroke="${o.stroke ?? C.dataS}" stroke-width="1.4"/>` + text(x + w / 2, y + h / 2 + 5, lines, { size: o.size ?? 12.5, bold: o.bold ?? true });
}

/**
 * Sequence diagram. parts: [{id,label,fill,stroke}], steps: list of
 *  {from,to,text,dash} | {note,over:[a,b]} | {alt:[label...], at} handled by caller via frames
 */
export function sequence(width, parts, steps, o = {}) {
  const top = 20, headH = 46, gapY = o.gapY ?? 34;
  const n = parts.length;
  const margin = o.margin ?? 90;
  const xs = parts.map((_, i) => margin + (i * (width - 2 * margin)) / (n - 1));
  const pos = Object.fromEntries(parts.map((p, i) => [p.id, xs[i]]));
  let y = top + headH + 28;
  let body = "";
  const frames = [];
  for (const s of steps) {
    if (s.frameStart) {
      frames.push({ y: y - 14, label: s.frameStart, x1: pos[s.span[0]] - 70, x2: pos[s.span[1]] + 70, divs: [] });
      y += 12;
      continue;
    }
    if (s.frameElse) {
      const f = frames[frames.length - 1];
      f.divs.push({ y: y - 10, label: s.frameElse });
      y += 34;
      continue;
    }
    if (s.frameEnd) {
      const f = frames.pop();
      body += `<rect x="${f.x1}" y="${f.y}" width="${f.x2 - f.x1}" height="${y - f.y - 6}" fill="none" stroke="${C.muted}" stroke-width="1.2"/>`;
      body += `<path d="M${f.x1},${f.y} h76 v14 l-8,8 h-68 z" fill="#f1f3f5" stroke="${C.muted}" stroke-width="1"/>`;
      body += text(f.x1 + 6, f.y + 11, f.label, { anchor: "start", size: 11, bold: true });
      for (const d of f.divs) {
        body += `<line x1="${f.x1}" y1="${d.y}" x2="${f.x2}" y2="${d.y}" stroke="${C.muted}" stroke-dasharray="5 4"/>`;
        body += text(f.x1 + 8, d.y + 11, d.label, { anchor: "start", size: 11, italic: true, color: C.muted });
      }
      y += 8;
      continue;
    }
    if (s.note) {
      const [a, b] = s.over;
      const x1 = Math.min(pos[a], pos[b]) - 60, x2 = Math.max(pos[a], pos[b]) + 60;
      const lines = Array.isArray(s.note) ? s.note : [s.note];
      const h = lines.length * 15 + 10;
      body += `<rect x="${x1}" y="${y - 12}" width="${x2 - x1}" height="${h}" fill="#fffbe6" stroke="#c9a227" stroke-width="1"/>`;
      body += text((x1 + x2) / 2, y - 12 + h / 2, lines, { size: 11.5 });
      y += h + 12;
      continue;
    }
    const xa = pos[s.from], xb = pos[s.to];
    if (s.from === s.to) {
      body += `<path d="M${xa},${y - 6} h34 v16 h-32" fill="none" stroke="${C.line}" stroke-width="1.4" marker-end="url(#ah)"/>`;
      body += text(xa + 40, y + 2, s.text, { anchor: "start", size: 11.5 });
      y += gapY;
      continue;
    }
    body += `<line x1="${xa}" y1="${y}" x2="${xb + (xb > xa ? -2 : 2)}" y2="${y}" stroke="${C.line}" stroke-width="1.4"${s.dash ? ' stroke-dasharray="6 4"' : ""} marker-end="url(#${s.dash ? "ao" : "ah"})"/>`;
    const lx = (xa + xb) / 2;
    body += text(lx, y - 9, s.text, { size: 11.5, mono: s.mono });
    y += gapY;
  }
  const h = y + 10;
  let heads = "";
  for (const p of parts) {
    const x = pos[p.id];
    heads += `<line x1="${x}" y1="${top + headH}" x2="${x}" y2="${h - 8}" stroke="${C.muted}" stroke-width="1.1" stroke-dasharray="4 4"/>`;
    heads += box(x - (p.w ?? 120) / 2, top, p.w ?? 120, headH, p.label, { fill: p.fill ?? C.white, stroke: p.stroke ?? C.line, size: 12.5, bold: true });
  }
  return { svg: svg(width, h, heads + body), height: h };
}
