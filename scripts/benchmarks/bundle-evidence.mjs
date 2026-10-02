import { readFile, writeFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
const html = await readFile("dist/web/index.html", "utf8"),
  entry = html.match(/src="\/assets\/([^"]+\.js)"/)?.[1];
if (!entry) throw new Error("Missing built entry");
const visited = new Set(),
  files = [];
async function visit(name) {
  if (visited.has(name)) return;
  visited.add(name);
  const code = await readFile(`dist/web/assets/${name}`, "utf8");
  files.push({
    name,
    bytes: (await stat(`dist/web/assets/${name}`)).size,
    gzipBytes: gzipSync(code).length,
  });
  for (const match of code.matchAll(/\bfrom["']\.\/([^"']+\.js)["']/g)) await visit(match[1]);
}
await visit(entry);
const stage = process.argv[2];
if (!["before", "after"].includes(stage)) throw new Error("Choose before or after");
const evidence = {
  timestamp: new Date().toISOString(),
  stage,
  method:
    "Static ESM dependency graph of production entry; excludes route/dynamic imports. Bytes are build/gzip, not network or CPU measurements.",
  entry,
  files,
  totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
};
await writeFile(`docs/evidence/bundle-${stage}-2026-10-01.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
