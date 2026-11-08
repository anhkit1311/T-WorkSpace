// Q1: runs uac-hotline.xml in Docker (image built from Debian's sip-tester package, see Dockerfile) at
// several concurrency levels, samples Asterisk/PostgreSQL container CPU+RAM while each level runs,
// and writes everything to docs/benchmarks/raw/sipp/. A throwaway UDP extension (default 1290) is
// pushed to Asterisk over ARI for the run and removed afterwards; its cc_calls rows are deleted too.
// Usage: docker build -t nexo-sipp scripts/benchmarks/sipp && node scripts/benchmarks/sipp/run-sipp.mjs --levels 10,25,50,75,100
// Options: --rate 10 (calls/s), --hold 20 (s), --ext 1290, --network infra_default, --host asterisk:5060,
//   --out docs/benchmarks/raw/sipp, --netem "delay 50ms 10ms loss 1%" (tc netem on SIPp's egress, i.e. the
//   caller→PBX leg), --pcap (tcpdump RTP in Asterisk's network namespace → capture.pcap + capture.csv
//   for experiments/packet-capture/voice-quality.mjs).
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import "../../../dist/api/config/env.js";
import { FIELDS } from "../../../experiments/packet-capture/analyze.mjs";
import { pool } from "../../../dist/api/infrastructure/database/db.js";

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : fallback;
};
const levels = arg("levels", "10,25,50").split(",").map(Number);
const rate = Number(arg("rate", 10));
const holdMs = Number(arg("hold", 20)) * 1000;
const ext = arg("ext", "1290");
const network = arg("network", "infra_default");
const target = arg("host", "asterisk:5060");
const outRoot = resolve(arg("out", "docs/benchmarks/raw/sipp"));
const netem = arg("netem", "");
const pcap = process.argv.includes("--pcap");
const holder = "nexo-sipp-net";
const capturer = "nexo-sipp-cap";
if (!process.env.ASTERISK_ARI_PASSWORD) throw new Error("ASTERISK_ARI_PASSWORD is required");

const base = `${(process.env.ASTERISK_ARI_URL ?? "http://localhost:8088").replace(/\/$/, "")}/ari`;
const auth = `Basic ${Buffer.from(`${process.env.ASTERISK_ARI_USER ?? "nexo"}:${process.env.ASTERISK_ARI_PASSWORD}`).toString("base64")}`;
const ari = async (method, path, body) => {
  const response = await fetch(base + path, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  });
  if (!response.ok && !(method === "DELETE" && response.status === 404)) throw new Error(`${method} ${path} → ${response.status}`);
};
const fields = (values) => ({ fields: Object.entries(values).map(([attribute, value]) => ({ attribute, value })) });
const dynamic = "/asterisk/config/dynamic/res_pjsip";
const secret = randomBytes(12).toString("hex");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Same fields as AriPbx.pushExtension for a UDP softphone.
await ari("PUT", `${dynamic}/auth/${ext}`, fields({ auth_type: "userpass", username: ext, password: secret }));
await ari("PUT", `${dynamic}/aor/${ext}`, fields({ max_contacts: "1", remove_existing: "yes" }));
await ari("PUT", `${dynamic}/endpoint/${ext}`, fields({
  transport: "transport-udp", rtp_symmetric: "yes", force_rport: "yes", rewrite_contact: "yes", acl: "internal-only",
  context: "from-internal", disallow: "all", allow: "ulaw,alaw", direct_media: "no", aors: ext, auth: ext, callerid: `"SIPp" <${ext}>`,
}));

const sampleContainers = () => {
  const lines = execFileSync("docker", ["stats", "--no-stream", "--format", "{{.Name}},{{.CPUPerc}},{{.MemUsage}}", "infra-asterisk-1", "infra-postgres-1"], { encoding: "utf8" });
  return lines.trim().split("\n").map((line) => {
    const [name, cpu, mem] = line.split(",");
    return { name, cpuPercent: parseFloat(cpu), mem: mem.split(" / ")[0] };
  });
};

const summary = [];
try {
  for (const level of levels) {
    const out = `${outRoot}/level-${level}`;
    await mkdir(out, { recursive: true });
    const startedAt = new Date();
    const total = level * 2;
    const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" });
    if (netem) {
      // SIPp joins this container's network namespace, so the netem qdisc shapes everything SIPp sends.
      docker("run", "-d", "--name", holder, "--network", network, "--cap-add", "NET_ADMIN", "--entrypoint", "sleep", "nexo-sipp", "infinity");
      docker("exec", holder, "tc", "qdisc", "add", "dev", "eth0", "root", "netem", ...netem.split(" "));
    }
    if (pcap)
      docker("run", "-d", "--name", capturer, "--network", "container:infra-asterisk-1", "--cap-add", "NET_RAW", "--cap-add", "NET_ADMIN",
        "-v", `${out}:/out`, "--entrypoint", "tcpdump", "nexo-sipp", "-i", "eth0", "-U", "-w", "/out/capture.pcap", "udp portrange 10000-10499");
    const args = [
      "run", "--rm", "--network", netem ? `container:${holder}` : network, "-v", `${out}:/out`, "-v", `${resolve("scripts/benchmarks/sipp")}:/scen:ro`, "-w", "/out", "nexo-sipp",
      "-sf", "/scen/uac-hotline.xml", "-s", "9000", "-au", ext, "-ap", secret, "-key", "auth_user", ext,
      "-r", String(rate), "-l", String(level), "-m", String(total), "-d", String(holdMs), "-rtp_echo",
      "-recv_timeout", "30000", "-timeout", `${Math.ceil(total / rate + holdMs / 1000 + 90)}s`, "-nostdin",
      "-trace_stat", "-fd", "2", "-trace_rtt", "-rtt_freq", "1", "-trace_err", "-trace_screen", target,
    ];
    console.log(`level ${level}: ${total} calls, ${rate}/s, hold ${holdMs / 1000}s`);
    const sipp = spawn("docker", args, { stdio: "ignore" });
    const exited = new Promise((done) => sipp.on("exit", done));
    const samples = [];
    let finished = false;
    exited.then(() => (finished = true));
    while (!finished) {
      samples.push({ t: Date.now() - startedAt.getTime(), containers: sampleContainers() });
      await sleep(1000);
    }
    const exitCode = await exited;
    if (pcap) {
      docker("stop", capturer);
      docker("rm", capturer);
      const csv = docker("run", "--rm", "-v", `${out}:/out`, "--entrypoint", "tshark", "nexo-sipp", "-r", "/out/capture.pcap",
        "-d", "udp.port==10000-10499,rtp", "-Y", "rtp", "-T", "fields", "-E", "header=y", "-E", "separator=,", "-E", "occurrence=f",
        ...FIELDS.flatMap((field) => ["-e", field]));
      await writeFile(`${out}/capture.csv`, csv);
    }
    if (netem) docker("rm", "-f", holder);
    await sleep(3000); // the ACD finishes writing ended calls
    const rows = (await pool.query(
      `SELECT id,started_at,answered_at,queued_at,ended_at,outcome FROM cc_calls WHERE caller_number=$1 AND started_at >= $2`,
      [ext, startedAt],
    )).rows;
    await pool.query(`DELETE FROM cc_tickets WHERE call_id=ANY($1::uuid[])`, [rows.map((row) => row.id)]);
    await pool.query(`DELETE FROM cc_calls WHERE id=ANY($1::uuid[])`, [rows.map((row) => row.id)]);
    const peak = (name) => Math.max(...samples.flatMap((s) => s.containers.filter((c) => c.name === name).map((c) => c.cpuPercent)));
    const result = {
      level, rate, holdSeconds: holdMs / 1000, totalCalls: total, sippExitCode: exitCode, netem: netem || undefined,
      ccCallsRecorded: rows.length,
      outcomes: rows.reduce((all, row) => ({ ...all, [row.outcome ?? "open"]: (all[row.outcome ?? "open"] ?? 0) + 1 }), {}),
      peakCpuPercent: { asterisk: peak("infra-asterisk-1"), postgres: peak("infra-postgres-1") },
    };
    await writeFile(`${out}/samples.json`, JSON.stringify({ result, samples }, null, 2));
    summary.push(result);
    console.log(JSON.stringify(result));
    await sleep(10000);
  }
} finally {
  // Left over only when a level failed half-way; "No such container" otherwise.
  for (const name of [holder, capturer]) try { execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" }); } catch {}
  for (const type of ["endpoint", "aor", "auth"]) await ari("DELETE", `${dynamic}/${type}/${ext}`).catch(() => {});
  await pool.end();
}
await writeFile(`${outRoot}/summary.json`, JSON.stringify(summary, null, 2));
