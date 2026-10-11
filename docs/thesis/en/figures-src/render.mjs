// Renders build/svg/*.svg and the UI screenshot composites to build/png/*.png with headless Chrome.
import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const build = resolve(here, "../build");
const SUFFIX = process.env.THESIS_LANG === "vi" ? "-vi" : "";
const svgDir = join(build, `svg${SUFFIX}`);
const pngDir = join(build, `png${SUFFIX}`);
const htmlDir = join(build, `html${SUFFIX}`);
const repo = resolve(here, "../../../..");
const chrome = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
await mkdir(pngDir, { recursive: true });
await mkdir(htmlDir, { recursive: true });

function shoot(htmlFile, png, w, h, scale = 2) {
  const profile = join(tmpdir(), `thesis-render-${process.pid}`);
  const r = spawnSync(
    chrome,
    [
      "--headless=new",
      `--user-data-dir=${profile}`,
      "--hide-scrollbars",
      "--disable-gpu",
      `--force-device-scale-factor=${scale}`,
      `--window-size=${w},${h}`,
      `--screenshot=${png}`,
      "--default-background-color=FFFFFFFF",
      pathToFileURL(htmlFile).href,
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  if (r.status !== 0) throw new Error(`chrome failed for ${png}: ${r.stderr}`);
}

const page = (w, h, inner) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff;width:${w}px;height:${h}px;overflow:hidden}</style></head><body>${inner}</body></html>`;

const only = process.argv.slice(2);
for (const file of (await readdir(svgDir)).filter((f) => f.endsWith(".svg"))) {
  const name = file.replace(/\.svg$/, "");
  if (only.length && !only.includes(name)) continue;
  const svg = await readFile(join(svgDir, file), "utf8");
  const w = Number(svg.match(/width="(\d+)"/)[1]);
  const h = Number(svg.match(/height="(\d+)"/)[1]);
  const html = join(htmlDir, `${name}.html`);
  await writeFile(html, page(w, h, svg));
  shoot(html, join(pngDir, `${name}.png`), w, h);
  console.log("rendered", name);
}

if (!only.length || only.includes("ui")) {
  const ui = join(repo, "docs/ui-review-2026-10-04");
  for (const [src, dst] of [
    ["locked-home-after-1440.png", "ui-home.png"],
    ["locked-chat-after-1440.png", "ui-chat.png"],
    ["locked-meeting-call-after-1440.png", "ui-meeting.png"],
    ["locked-admin-after-1440.png", "ui-admin.png"],
  ])
    await copyFile(join(ui, src), join(pngDir, dst));
  // Phone composite: chat and meeting at 375 px, side by side with a thin frame.
  const img = (f) => pathToFileURL(join(ui, f)).href;
  const html = join(htmlDir, "ui-mobile.html");
  await writeFile(
    html,
    page(
      820,
      840,
      `<div style="display:flex;gap:40px;padding:20px 15px;justify-content:center;align-items:flex-start">
        <img src="${img("locked-chat-after-375.png")}" style="width:375px;height:800px;object-fit:cover;object-position:top;border:1px solid #c9ced6;border-radius:14px">
        <img src="${img("locked-meeting-call-after-375.png")}" style="width:375px;height:800px;object-fit:cover;object-position:top;border:1px solid #c9ced6;border-radius:14px">
      </div>`,
    ),
  );
  shoot(html, join(pngDir, "ui-mobile.png"), 820, 840, 1.5);
  console.log("rendered ui-*");
}
await rm(join(tmpdir(), `thesis-render-${process.pid}`), { recursive: true, force: true });
