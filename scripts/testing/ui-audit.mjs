// UI audit with headless Chrome over the DevTools protocol.
//   node scripts/testing/ui-audit.mjs zoom  -> reflow at 100% / 200% / 400% zoom on the main pages
//   node scripts/testing/ui-audit.mjs perf  -> page load under CPU throttling (low-end device)
// Needs the API (default http://localhost:3001) and the web app (default http://localhost:5176).
// A temporary account and workspace are created for the run and removed at the end; the generated
// password never leaves this process.
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool } from "../../dist/api/infrastructure/database/db.js";
import { hashPassword } from "../../dist/api/modules/auth/password.js";
import { createWorkspace, getWorkspaceChannels, saveMessage } from "../../dist/api/modules/workspaces/service.js";

const mode = process.argv[2];
if (!["zoom", "perf", "probe"].includes(mode)) throw new Error("Usage: ui-audit.mjs zoom|perf|probe");
const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;
const web = arg("web", "http://localhost:5176");
const api = arg("api", "http://localhost:3001");
const chrome = arg("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
const stamp = new Date().toISOString().slice(0, 10);
const outDir = join("docs/evidence", `ui-${mode}-${stamp}`);
await mkdir(outDir, { recursive: true });

// ---------- temporary fixtures ----------
const userId = randomUUID();
const email = `qa-audit-${userId}@example.test`;
const password = randomBytes(12).toString("base64url");
await pool.query(
  `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,$3,'QA kiểm tra giao diện',true)`,
  [userId, email, await hashPassword(password)],
);
const workspace = await createWorkspace(userId, "QA kiểm tra hiển thị");
const channels = await getWorkspaceChannels(userId, workspace.id);
const text = channels.find((c) => c.type === "text");
const video = channels.find((c) => c.type === "video");
const samples = [
  "Chào cả nhóm, đây là tin nhắn kiểm tra khả năng xuống dòng của giao diện khi phóng to 200% và 400%.",
  "Liên kết dài không có khoảng trắng: https://example.test/tai-lieu/bao-cao-tien-do-do-an-tot-nghiep-phien-ban-cuoi-cung-da-duoc-gop-y.pdf",
  "Tên-tệp-rất-dài-không-có-khoảng-trắng-để-kiểm-tra-việc-cắt-chữ-trong-bong-bóng-tin-nhắn.docx",
  "Tin ngắn.",
];
for (const content of samples) await saveMessage(userId, text.id, content, { clientMessageId: randomUUID() });

const routes = [
  ["overview", "/app/overview"],
  ["workspace", `/app/workspace?workspace=${workspace.id}`],
  ["chat", `/app/chat?workspace=${workspace.id}&channel=${text.id}`],
  ["meetings", `/app/meetings?workspace=${workspace.id}&channel=${video?.id ?? text.id}`],
  ["tasks", `/app/tasks?workspace=${workspace.id}`],
  ["notifications", "/app/notifications"],
  ["profile", "/app/profile"],
  ["admin", `/app/admin?workspace=${workspace.id}`],
];

// ---------- Chrome + CDP ----------
const profile = join(tmpdir(), `ui-audit-${process.pid}`);
const browser = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  browser.stderr.on("data", (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  setTimeout(() => reject(new Error("Chrome did not start")), 20000);
});
const port = new URL(wsUrl).port;
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
const listeners = new Set();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else for (const l of listeners) l(msg);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const navigate = async (url) => {
  const loaded = new Promise((resolve) => {
    const l = (m) => m.method === "Page.loadEventFired" && (listeners.delete(l), resolve());
    listeners.add(l);
  });
  await send("Page.navigate", { url });
  await Promise.race([loaded, sleep(30000)]);
};
await send("Page.enable");
await send("Runtime.enable");

// Sign in once: the refresh cookie lives on the API origin and is reused by every page load.
await navigate(`${web}/`);
const signIn = await evaluate(`fetch(${JSON.stringify(api + "/auth/login")}, {method:"POST",credentials:"include",
  headers:{"Content-Type":"application/json"},body:JSON.stringify(${JSON.stringify({ email, password })})}).then(r=>r.status)`);
if (signIn !== 200) throw new Error(`login failed with HTTP ${signIn}`);

const results = [];
try {
  if (mode === "probe") {
    // Debug helper: --route=chat --size=640x400x2 --expr="<js returning JSON-serialisable value>"
    const [w, h, dpr] = arg("size", "640x400x2").split("x").map(Number);
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
    await navigate(web + routes.find(([n]) => n === arg("route", "chat"))[1]);
    await sleep(2500);
    console.log(JSON.stringify(await evaluate(arg("expr", "document.title")), null, 1));
  } else if (mode === "zoom") {
    // Browser zoom Z on a W×H window shows a CSS viewport of (W/Z)×(H/Z) at device scale Z.
    const cases = [
      { zoom: "100%", width: 1280, height: 800, scale: 1 },
      { zoom: "200%", width: 640, height: 400, scale: 2 },
      { zoom: "400%", width: 320, height: 256, scale: 4 },
    ];
    const probe = `(() => {
      const vw = document.documentElement.clientWidth;
      const docOverflow = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - vw;
      const name = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") +
        (el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : "");
      const offenders = new Map();
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || r.right <= 0 || r.left >= vw) continue; // empty or fully off-canvas
        if (el.closest("[inert],[aria-hidden=true]")) continue;
        if (!(r.right > vw + 1 || r.left < -1)) continue;
        let a = el.parentElement, contained = false;
        while (a && a !== document.body) {
          const s = getComputedStyle(a);
          if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) {
            const ar = a.getBoundingClientRect();
            if (ar.right <= vw + 1 && ar.left >= -1) { contained = true; break; }
          }
          a = a.parentElement;
        }
        if (!contained) offenders.set(name(el), Math.round(Math.max(r.right - vw, -r.left)));
      }
      // Controls in the main content whose centre is covered by another element (e.g. a fixed bar).
      const covered = [];
      for (const el of document.querySelectorAll("main input, main textarea, main button, main [contenteditable=true], .editorial-main-content :is(input, textarea, button)")) {
        if (el.closest("[inert],[aria-hidden=true],.sr-only")) continue;
        // visible part = element box ∩ every clipping ancestor (scrolled-out content is not "covered")
        let r = el.getBoundingClientRect(), box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const s = getComputedStyle(a);
          if (s.overflowX !== "visible" || s.overflowY !== "visible") {
            const ar = a.getBoundingClientRect();
            box = { l: Math.max(box.l, ar.left), t: Math.max(box.t, ar.top), r: Math.min(box.r, ar.right), b: Math.min(box.b, ar.bottom) };
          }
        }
        if (box.r - box.l < 4 || box.b - box.t < 4) continue;
        const cx = (box.l + box.r) / 2, cy = (box.t + box.b) / 2;
        if (cx < 0 || cx > vw || cy < 0 || cy > innerHeight) continue;
        const top = document.elementFromPoint(cx, cy);
        if (top && !el.contains(top) && !top.contains(el)) covered.push(name(el) + " ← " + name(top));
      }
      return { viewport: vw, docOverflow, offenders: [...offenders].slice(0, 8), covered: [...new Set(covered)].slice(0, 8) };
    })()`;
    for (const c of cases) {
      await send("Emulation.setDeviceMetricsOverride", { width: c.width, height: c.height, deviceScaleFactor: c.scale, mobile: false });
      for (const [name, path] of routes) {
        await navigate(web + path);
        await sleep(2500);
        const m = await evaluate(probe);
        const shot = await send("Page.captureScreenshot", { format: "png" });
        await writeFile(join(outDir, `${name}-${c.zoom.replace("%", "")}.png`), Buffer.from(shot.data, "base64"));
        results.push({ page: name, zoom: c.zoom, ...m });
        console.log(`${c.zoom.padEnd(5)} ${name.padEnd(14)} overflow=${m.docOverflow}px offenders=${m.offenders.length} covered=${m.covered.length} ${m.covered.join("; ")}`);
      }
    }
  } else {
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await send("Network.enable");
    await send("Performance.enable");
    const reduced = arg("reducedMotion", "0") === "1";
    if (reduced) await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const measure = `new Promise((resolve) => {
      const out = { lcp: null, tbt: 0, longTasks: 0 };
      new PerformanceObserver((l) => { for (const e of l.getEntries()) out.lcp = e.startTime; })
        .observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((l) => { for (const e of l.getEntries()) { out.longTasks++; out.tbt += Math.max(0, e.duration - 50); } })
        .observe({ type: "longtask", buffered: true });
      setTimeout(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        out.domContentLoaded = nav.domContentLoadedEventEnd;
        out.load = nav.loadEventEnd;
        out.transferKB = performance.getEntriesByType("resource").reduce((s, r) => s + (r.transferSize || 0), nav.transferSize || 0) / 1024;
        resolve(out);
      }, 6000);
    })`;
    const readySelector = { overview: "main h1, main h2", chat: "textarea, [contenteditable=true]" };
    for (const rate of [1, 4, 6]) {
      await send("Emulation.setCPUThrottlingRate", { rate });
      for (const [name, path] of routes.filter(([n]) => n in readySelector)) {
        for (let run = 1; run <= 3; run++) {
          await send("Network.setCacheDisabled", { cacheDisabled: true });
          const t0 = Date.now();
          await navigate(web + path);
          const ready = await evaluate(`new Promise((resolve) => { const t = performance.now();
            const tick = () => document.querySelector(${JSON.stringify(readySelector[name])}) ? resolve(performance.now()) :
              (performance.now() - t > 30000 ? resolve(null) : requestAnimationFrame(tick)); tick(); })`);
          const m = await evaluate(measure);
          const heap = (await send("Performance.getMetrics")).metrics.find((x) => x.name === "JSHeapUsedSize").value / 1048576;
          results.push({ page: name, cpuSlowdown: rate, reducedMotion: reduced, run, appReadyMs: ready, ...m, heapMiB: heap, wallMs: Date.now() - t0 });
          console.log(`x${rate} ${name.padEnd(9)} run${run} ready=${Math.round(ready)}ms lcp=${Math.round(m.lcp)}ms tbt=${Math.round(m.tbt)}ms heap=${heap.toFixed(1)}MiB`);
        }
      }
    }
  }
  const suffix = arg("reducedMotion", "0") === "1" ? "-reduced-motion" : "";
  if (mode !== "probe") await writeFile(join(outDir, `${mode}${suffix}-results.json`),
    JSON.stringify({ date: new Date().toISOString(), web, chrome, results }, null, 2));
  console.log(`results: ${join(outDir, `${mode}${suffix}-results.json`)}`);
} finally {
  ws.close();
  browser.kill();
  await pool.query(`DELETE FROM workspaces WHERE id=$1 AND owner_id=$2`, [workspace.id, userId]);
  await pool.query(`DELETE FROM users WHERE id=$1 AND email=$2`, [userId, email]);
  await pool.end();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
