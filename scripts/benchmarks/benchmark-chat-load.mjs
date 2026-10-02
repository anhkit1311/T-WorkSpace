import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import { io } from "socket.io-client";
import { pool } from "../../dist/api/infrastructure/database/db.js";
import { createAccessToken } from "../../dist/api/modules/auth/tokens.js";
import { createWorkspace, getWorkspaceChannels } from "../../dist/api/modules/workspaces/service.js";
process.env.JWT_SECRET = "load-qa-only-secret-at-least-32-characters";
const tiers = (process.env.BENCH_TIERS ?? "50,100,200").split(",").map(Number),
  seconds = Number(process.env.BENCH_SECONDS ?? 30),
  repeats = Number(process.env.BENCH_REPEATS ?? 2);
if (
  tiers.some((n) => !Number.isInteger(n) || n < 8 || n > 200) ||
  seconds < 10 ||
  seconds > 300 ||
  repeats < 1 ||
  repeats > 5
)
  throw new Error("Invalid benchmark bounds");
const children = [],
  addresses = [],
  instanceIds = [randomUUID(), randomUUID()];
const report = {
  timestamp: new Date().toISOString(),
  environment: {
    node: process.version,
    os: os.platform(),
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    ramBytes: os.totalmem(),
    network: "Local loopback; two separate API processes, shared development PostgreSQL",
    postgres: (await pool.query("SHOW server_version")).rows[0].server_version,
  },
  load: {
    tiers,
    seconds,
    repeats,
    workspaces: 4,
    channelsPerWorkspace: 2,
    parallelWrites: 4,
    targetMessagesPerSecond: 4,
  },
  runs: [],
};
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
}
function resource(child) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      child.off("message", handler);
      reject(new Error("Resource timeout"));
    }, 5000);
    const handler = (data) => {
      if (data.id !== id) return;
      clearTimeout(timer);
      child.off("message", handler);
      resolve(data);
    };
    child.on("message", handler);
    child.send({ type: "metrics", id });
  });
}
function dockerStats() {
  return new Promise((resolve) => {
    const child = spawn(
      "docker",
      [
        "stats",
        "--no-stream",
        "--format",
        "{{json .}}",
        process.env.POSTGRES_CONTAINER ?? "infra-postgres-1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "",
      error = "";
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (error += data));
    child.on("error", (error) => resolve({ unavailable: error.message }));
    child.on("exit", (code) => {
      try {
        resolve(code === 0 ? JSON.parse(output.trim()) : { unavailable: error });
      } catch {
        resolve({ unavailable: "No container stats" });
      }
    });
  });
}
async function connect(socket) {
  if (socket.connected) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Connect timeout")), 10000);
    const connected = () => finish(),
      failed = (error) => finish(error);
    const finish = (error) => {
      clearTimeout(timer);
      socket.off("connect", connected);
      socket.off("connect_error", failed);
      error ? reject(error) : resolve();
    };
    socket.once("connect", connected);
    socket.once("connect_error", failed);
    socket.connect();
  });
}
try {
  for (let index = 0; index < 2; index++) {
    const child = fork(
      new URL("../../services/api/test/helpers/api-process.mjs", import.meta.url),
      [],
      {
        env: {
          ...process.env,
          API_INSTANCE_ID: instanceIds[index],
          SOCKET_ADAPTER: "postgres",
          SOCKET_CHANNEL_PREFIX: `load-${instanceIds[0]}`,
          DB_POOL_MAX: "8",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    children.push(child);
    child.stderr.on("data", (data) => process.stderr.write(data));
    const [ready] = await once(child, "message");
    addresses.push(`http://127.0.0.1:${ready.port}`);
  }
  for (const count of tiers)
    for (let repeat = 0; repeat < repeats; repeat++) {
      const users = Array.from({ length: count }, () => randomUUID()),
        workspaces = [],
        sockets = [],
        channels = [],
        tokens = [];
      const run = {
        count,
        repeat,
        startedAt: new Date().toISOString(),
        samples: [],
        receipts: [],
        resources: [],
        reconnect: [],
        duplicates: 0,
        errors: [],
      };
      report.runs.push(run);
      let sampleTimer,
        resourceBusy = false,
        dbContainerSample;
      try {
        await pool.query(
          `INSERT INTO users(id,email,password_hash,display_name,email_verified) SELECT id,'load-'||id||'@example.test','test-only','Load QA',true FROM unnest($1::uuid[]) AS id`,
          [users],
        );
        for (let group = 0; group < 4; group++) {
          const workspace = await createWorkspace(
            users[group],
            `Load QA ${count}/${repeat}/${group}`,
          );
          workspaces.push(workspace.id);
          const members = users.filter((_, index) => index % 4 === group && index !== group);
          await pool.query(
            `INSERT INTO memberships(workspace_id,user_id,role) SELECT $1,id,'member' FROM unnest($2::uuid[]) AS id`,
            [workspace.id, members],
          );
          channels.push(
            (await getWorkspaceChannels(users[group], workspace.id))
              .filter((c) => c.type === "text")
              .slice(0, 2),
          );
        }
        const starts = new Map(),
          seen = new Set(),
          lastMessage = new Map();
        for (let index = 0; index < count; index++) {
          tokens.push(await createAccessToken(users[index]));
          const socket = io(addresses[index % 2], {
            auth: { token: tokens[index] },
            transports: ["websocket"],
            autoConnect: false,
            reconnection: false,
          });
          sockets.push(socket);
          socket.on("new_message", (message) => {
            const start = starts.get(message.clientMessageId);
            if (start === undefined) return;
            const key = `${index}:${message.clientMessageId}`;
            if (seen.has(key)) run.duplicates++;
            else {
              seen.add(key);
              run.receipts.push({
                client: index,
                id: message.clientMessageId,
                latencyMs: performance.now() - start,
              });
            }
          });
        }
        const connectedAt = performance.now();
        await Promise.all(sockets.map(connect));
        run.connectAllMs = performance.now() - connectedAt;
        const sampleResources = async () => {
          if (resourceBusy) return;
          resourceBusy = true;
          try {
            run.resources.push({
              timestamp: new Date().toISOString(),
              api: await Promise.all(children.map(resource)),
              database: (
                await pool.query(
                  `SELECT numbackends,blks_read,blks_hit,tup_returned,tup_fetched FROM pg_stat_database WHERE datname=current_database()`,
                )
              ).rows[0],
            });
          } catch (error) {
            run.errors.push({ kind: "resource", message: error.message });
          } finally {
            resourceBusy = false;
          }
        };
        await sampleResources();
        sampleTimer = setInterval(() => void sampleResources(), 5000);
        const send = async (index, channelId, noAck = false) => {
          const payload = {
            channelId,
            content: `Benchmark QA ${run.startedAt}/${run.samples.length}/${randomUUID()}`,
            clientMessageId: randomUUID(),
          };
          const started = performance.now();
          starts.set(payload.clientMessageId, started);
          try {
            if (noAck) {
              await new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                  sockets[index].off("new_message", onMessage);
                  reject(new Error("Lost ACK broadcast timeout"));
                }, 10000);
                const onMessage = (message) => {
                  if (message.clientMessageId === payload.clientMessageId) {
                    clearTimeout(timer);
                    sockets[index].off("new_message", onMessage);
                    resolve();
                  }
                };
                sockets[index].on("new_message", onMessage);
                sockets[index].emit("send_message", payload);
              });
            }
            const ack = await sockets[index].timeout(10000).emitWithAck("send_message", payload);
            if (!ack.success) throw new Error(ack.error);
            lastMessage.set(channelId, ack.message.id);
            run.samples.push({
              id: payload.clientMessageId,
              sender: index,
              channelId,
              ackMs: performance.now() - started,
              lostAckRetry: noAck,
            });
          } catch (error) {
            run.errors.push({ kind: "send", message: error.message, id: payload.clientMessageId });
          }
        };
        const trafficStart = performance.now();
        console.log(`Load ${count} sockets, repeat ${repeat + 1}: ${seconds}s, 4 writes/s`);
        for (let second = 0; second < seconds; second++) {
          const target = trafficStart + second * 1000;
          if (performance.now() < target) await delay(target - performance.now());
          await Promise.all(
            Array.from({ length: 4 }, (_, group) => {
              const index = (second * 4 + group) % count;
              return send(
                index,
                channels[index % 4][second % 2].id,
                group === 0 && second % 5 === 0,
              );
            }),
          );
          if (second === Math.floor(seconds / 2)) {
            dbContainerSample = dockerStats();
            const channelId = channels[0][0].id,
              cursor = lastMessage.get(channelId);
            sockets[0].disconnect();
            await send(4, channelId);
            await send(4, channelId);
            const start = performance.now();
            await connect(sockets[0]);
            const response = await fetch(
              `${addresses[0]}/api/channels/${channelId}/messages?after=${cursor}`,
              { headers: { Authorization: `Bearer ${tokens[0]}` } },
            );
            assert.equal(response.status, 200);
            const backfill = await response.json();
            assert.ok(backfill.messages.length >= 2);
            run.reconnect.push({
              client: 0,
              reconnectAndBackfillMs: performance.now() - start,
              backfilled: backfill.messages.length,
            });
          }
        }
        await delay(Math.max(0, trafficStart + seconds * 1000 - performance.now()));
        clearInterval(sampleTimer);
        sampleTimer = null;
        await sampleResources();
        run.databaseContainer = await dbContainerSample;
        run.durationMs = performance.now() - trafficStart;
        run.databaseMessages = (
          await pool.query(
            `SELECT count(*)::integer AS count FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.workspace_id=ANY($1::uuid[])`,
            [workspaces],
          )
        ).rows[0].count;
        assert.equal(run.databaseMessages, run.samples.length);
        assert.equal(run.duplicates, 0);
        assert.equal(run.errors.filter((error) => error.kind === "send").length, 0);
        run.summary = {
          ack: {
            p50: percentile(
              run.samples.map((s) => s.ackMs),
              0.5,
            ),
            p95: percentile(
              run.samples.map((s) => s.ackMs),
              0.95,
            ),
            p99: percentile(
              run.samples.map((s) => s.ackMs),
              0.99,
            ),
          },
          receipt: {
            p50: percentile(
              run.receipts.map((s) => s.latencyMs),
              0.5,
            ),
            p95: percentile(
              run.receipts.map((s) => s.latencyMs),
              0.95,
            ),
            p99: percentile(
              run.receipts.map((s) => s.latencyMs),
              0.99,
            ),
          },
          samples: run.samples.length,
          receipts: run.receipts.length,
          lostAckRetries: run.samples.filter((s) => s.lostAckRetry).length,
        };
        console.log(
          JSON.stringify({
            count,
            repeat,
            ...run.summary,
            duplicates: run.duplicates,
            errors: run.errors.length,
          }),
        );
      } finally {
        if (sampleTimer) clearInterval(sampleTimer);
        for (const socket of sockets) socket.disconnect();
        if (workspaces.length)
          await pool.query(`DELETE FROM workspaces WHERE id=ANY($1::uuid[])`, [workspaces]);
        await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [users]);
        await writeFile("docs/evidence/chat-load-2026-10-01.json", JSON.stringify(report, null, 2));
      }
    }
} finally {
  for (const child of children)
    if (child.exitCode === null) {
      const stopped = once(child, "exit");
      child.send("stop");
      await Promise.race([
        stopped,
        delay(5000).then(() => {
          if (child.exitCode === null) child.kill();
        }),
      ]);
    }
  await pool.query(`DELETE FROM socket_presence WHERE instance_id=ANY($1::text[])`, [instanceIds]);
  await pool.query(`DELETE FROM api_instances WHERE id=ANY($1::text[])`, [instanceIds]);
  await pool.end();
}
