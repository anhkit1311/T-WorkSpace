import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { HealthResponse } from "@doan/shared";
import { config, getJwtSecret } from "./config/config.js";
import { HttpError } from "./shared/http/http-error.js";
import { initSocketServer } from "./infrastructure/realtime/socket.js";
import { getAuthUserId, sendError, sendJson, setCorsHeaders, webOrigin } from "./shared/http/utils.js";
import { taskRoutes } from "./modules/tasks/routes.js";
import { conversationRoutes } from "./modules/chat/routes.js";
import { workspaceRoutes } from "./modules/workspaces/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { profileRoutes } from "./modules/profiles/routes.js";
import { meetingRoutes } from "./modules/meetings/routes.js";
import { fileRoutes } from "./modules/files/routes.js";
import { academicRoutes } from "./modules/academic/routes.js";
import { callCenterMetrics, callcenterRoutes, pbxConnected, startCallCenter } from "./modules/callcenter/index.js";
import { elearningRoutes, startElearning } from "./modules/elearning/index.js";
import { startJobWorker } from "./infrastructure/jobs/queue.js";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pool, query } from "./infrastructure/database/db.js";
import { roomManager } from "./modules/meetings/media/room-manager.js";
import { recoverRecordings, stopAllRecordings } from "./modules/meetings/recording/recordings.js";
import { publishOutcomeChange } from "./modules/meetings/outcome-events.js";
import { startMaintenance } from "./infrastructure/operations/maintenance.js";
import { openapi } from "./shared/http/openapi.js";
import { renderMetrics, type Metric } from "./infrastructure/operations/prometheus.js";
const port = Number(process.env.API_PORT ?? 3001);
const metrics = { requests: 0, errors: 0, totalDurationMs: 0 };
// /ready waits for the newest migration shipped with this build (dist/migrations or the source tree).
const latestMigration = (() => {
  for (const relative of ["../migrations", "../../services/api/migrations"])
    try {
      return readdirSync(fileURLToPath(new URL(relative, import.meta.url))).filter((file) => file.endsWith(".sql")).sort().at(-1);
    } catch {
      // try the next layout
    }
  return undefined;
})();
const ioForShutdown = new WeakMap<Server, ReturnType<typeof initSocketServer>>();

export function createApiServer(): Server {
  let io: ReturnType<typeof initSocketServer>;
  const server = createServer(async (request, response) => {
    const requestId = randomUUID(),
      started = performance.now();
    response.setHeader("X-Request-ID", requestId);
    response.once("finish", () => {
      const durationMs = performance.now() - started;
      metrics.requests++;
      metrics.totalDurationMs += durationMs;
      if (response.statusCode >= 500) metrics.errors++;
      if (process.env.REQUEST_LOGS === "true")
        console.log(
          JSON.stringify({
            level: "info",
            event: "http_request",
            requestId,
            method: request.method,
            path: (request.url ?? "/").split("?")[0],
            status: response.statusCode,
            durationMs: Math.round(durationMs),
          }),
        );
    });
    setCorsHeaders(response);
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    try {
      await handleRequest(request, response, io);
    } catch (error) {
      if (error instanceof HttpError) {
        sendError(response, error.statusCode, error.code, error.message);
        return;
      }
      console.error(
        JSON.stringify({
          level: "error",
          event: "request_error",
          requestId,
          message: error instanceof Error ? error.message : "Unknown error",
        }),
      );
      sendError(response, 500, "INTERNAL_ERROR", "Đã xảy ra lỗi máy chủ.");
    }
  });

  io = initSocketServer(server, webOrigin);
  ioForShutdown.set(server, io);
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;

  return server;
}
export async function closeApiServer(server: Server) {
  const io = ioForShutdown.get(server);
  if (io) await new Promise<void>((resolve) => io.close(() => resolve()));
  else await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  io: ReturnType<typeof initSocketServer>,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname,
    params = url.searchParams;
  if (request.method === "GET" && pathname === "/api/openapi.json") {
    sendJson(response, 200, openapi);
    return;
  }
  if (request.method === "GET" && pathname === "/ready") {
    const version = await query(
      `SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1`,
    ).catch(() => {
      throw new HttpError(503, "NOT_READY", "Máy chủ chưa sẵn sàng.");
    });
    if (!latestMigration || version.rows[0]?.name !== latestMigration)
      throw new HttpError(503, "NOT_READY", "Cần chạy migration trước khi phục vụ.");
    sendJson(response, 200, { status: "ready" });
    return;
  }
  if (request.method === "GET" && pathname === "/metrics") {
    // Q5: Prometheus scrape (same bearer token as the JSON metrics below).
    if (!process.env.OPERATIONS_TOKEN || request.headers.authorization !== `Bearer ${process.env.OPERATIONS_TOKEN}`)
      throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền truy cập.");
    const media = roomManager.metrics();
    const qos = roomManager.qosMetrics();
    const spread = (stats: { avg: number; max: number } | null) =>
      stats ? [{ labels: { stat: "avg" }, value: Math.round(stats.avg * 100) / 100 }, { labels: { stat: "max" }, value: stats.max }] : [];
    const jobs = await query<{ status: string; count: number }>(
      `SELECT status,count(*)::int AS count FROM media_jobs WHERE status IN ('queued','running','failed') GROUP BY status`,
    );
    const acd = callCenterMetrics();
    const gauge = (name: string, help: string, samples: Metric["samples"]): Metric => ({ name, help, type: "gauge", samples });
    const one = (value: number) => [{ value }];
    const body = renderMetrics([
      { name: "nexo_http_requests_total", help: "HTTP requests served.", type: "counter", samples: one(metrics.requests) },
      { name: "nexo_http_errors_total", help: "HTTP responses with status 5xx.", type: "counter", samples: one(metrics.errors) },
      { name: "nexo_http_request_duration_ms_total", help: "Sum of request durations in ms.", type: "counter", samples: one(metrics.totalDurationMs) },
      gauge("nexo_db_pool_connections", "PostgreSQL pool connections.", [
        { labels: { state: "total" }, value: pool.totalCount },
        { labels: { state: "idle" }, value: pool.idleCount },
        { labels: { state: "waiting" }, value: pool.waitingCount },
      ]),
      gauge("nexo_socket_clients", "Connected Socket.IO clients.", one(io.engine.clientsCount)),
      gauge("nexo_media_workers", "mediasoup workers.", one(media.workers)),
      gauge("nexo_media_rooms", "Meeting rooms with a router.", one(media.rooms)),
      gauge("nexo_media_peers", "Peers in meeting rooms (phone callers included).", one(media.peers)),
      gauge("nexo_media_qos_reporting_peers", "Meeting peers with a QoS report in the last 30 s.", one(qos.peers)),
      gauge("nexo_media_qos_rtt_ms", "Client-measured round-trip time.", spread(qos.rtt)),
      gauge("nexo_media_qos_jitter_ms", "Client-measured inbound jitter.", spread(qos.jitter)),
      gauge("nexo_media_qos_packet_loss_percent", "Client-measured inbound packet loss.", spread(qos.packetLoss)),
      gauge("nexo_media_jobs", "Media jobs in the PostgreSQL queue.", ["queued", "running", "failed"].map((status) => ({
        labels: { status },
        value: jobs.rows.find((row) => row.status === status)?.count ?? 0,
      }))),
      gauge("nexo_acd_leader", "1 on the instance running the ACD.", one(acd ? 1 : 0)),
      ...(acd
        ? [
            gauge("nexo_callcenter_active_calls", "Calls the ACD is handling.", one(acd.activeCalls)),
            gauge("nexo_callcenter_waiting_calls", "Calls waiting in a department queue.", acd.queues.map((queue) => ({ labels: { department: queue.departmentId }, value: queue.waiting }))),
            gauge("nexo_callcenter_longest_wait_seconds", "Longest current wait per department.", acd.queues.map((queue) => ({ labels: { department: queue.departmentId }, value: Math.round(queue.longestMs / 1000) }))),
            gauge("nexo_callcenter_agents", "Agents by state.", Object.entries(acd.agents).map(([state, value]) => ({ labels: { state }, value }))),
          ]
        : []),
      gauge("process_resident_memory_bytes", "Resident memory.", one(process.memoryUsage().rss)),
      gauge("process_uptime_seconds", "Process uptime.", one(Math.round(process.uptime()))),
    ]);
    response.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" });
    response.end(body);
    return;
  }
  if (request.method === "GET" && pathname === "/api/operations/metrics") {
    if (
      !process.env.OPERATIONS_TOKEN ||
      request.headers.authorization !== `Bearer ${process.env.OPERATIONS_TOKEN}`
    )
      throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền truy cập.");
    sendJson(response, 200, {
      ...metrics,
      db: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
      media: roomManager.metrics(),
      workerResources: await roomManager.resourceUsage(),
      sockets: io.engine.clientsCount,
    });
    return;
  }
  if (request.method === "GET" && pathname === "/api/operations/health") {
    // System-health page for system administrators (same numbers Prometheus scrapes, plus probes).
    const userId = await getAuthUserId(request);
    const admin = await query(`SELECT 1 FROM academic_role_grants WHERE user_id=$1 AND role='system_admin'`, [userId]);
    if (!admin.rowCount) throw new HttpError(403, "FORBIDDEN", "Chỉ quản trị hệ thống xem được trang này.");
    const started = performance.now();
    await query(`SELECT 1`);
    const dbLatencyMs = Math.round((performance.now() - started) * 10) / 10;
    const [jobs, calls] = await Promise.all([
      query<{ status: string; count: number }>(
        `SELECT status,count(*)::int AS count FROM media_jobs WHERE status IN ('queued','running','failed') GROUP BY status`,
      ),
      query<{ total: number; answered: number; wait: number | null }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE answered_at IS NOT NULL)::int AS answered,
                avg(extract(epoch FROM answered_at - coalesce(queued_at, started_at)))::float AS wait
         FROM cc_calls WHERE started_at > now() - interval '24 hours'`,
      ),
    ]);
    const acd = callCenterMetrics();
    sendJson(response, 200, {
      checkedAt: new Date().toISOString(),
      api: {
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        requests: metrics.requests,
        errors: metrics.errors,
        avgResponseMs: metrics.requests ? Math.round(metrics.totalDurationMs / metrics.requests) : 0,
        sockets: io.engine.clientsCount,
      },
      db: { latencyMs: dbLatencyMs, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount },
      media: { ...roomManager.metrics(), qos: roomManager.qosMetrics() },
      jobs: Object.fromEntries(["queued", "running", "failed"].map((status) => [status, jobs.rows.find((row) => row.status === status)?.count ?? 0])),
      callCenter: {
        asterisk: pbxConnected(),
        acdLeader: Boolean(acd),
        activeCalls: acd?.activeCalls ?? 0,
        waiting: acd?.queues.reduce((sum, queue) => sum + queue.waiting, 0) ?? 0,
        agents: acd?.agents ?? {},
        last24h: { total: calls.rows[0].total, answered: calls.rows[0].answered, avgWaitSeconds: Math.round(calls.rows[0].wait ?? 0) },
      },
    });
    return;
  }
  if (request.method === "GET" && pathname === "/health") {
    const payload: HealthResponse = {
      service: "api",
      status: "ok",
      timestamp: new Date().toISOString(),
    };
    sendJson(response, 200, payload);
    return;
  }

  const context = { request, response, io, pathname, params };
  for (const route of [
    taskRoutes,
    conversationRoutes,
    workspaceRoutes,
    authRoutes,
    profileRoutes,
    meetingRoutes,
    fileRoutes,
    academicRoutes,
    callcenterRoutes,
    elearningRoutes,
  ]) {
    await route(context);
    if (response.writableEnded) return;
  }
  sendError(response, 404, "NOT_FOUND", "Không tìm thấy tài nguyên.");
}

if (process.argv[1]?.endsWith("server.ts") || process.argv[1]?.endsWith("server.js")) {
  getJwtSecret();
  if (config.isProduction) {
    if (!config.resendApiKey && !config.smtpHost) {
      throw new Error("Production email requires RESEND_API_KEY or SMTP_HOST");
    }
    if (
      !process.env.MEDIASOUP_ANNOUNCED_IP ||
      ["127.0.0.1", "localhost", "0.0.0.0"].includes(process.env.MEDIASOUP_ANNOUNCED_IP)
    ) {
      throw new Error("Set MEDIASOUP_ANNOUNCED_IP to the public host IP");
    }
  }
  const server = createApiServer();
  const stopMaintenance = startMaintenance();
  const stopCallCenter = startCallCenter(ioForShutdown.get(server)!);
  const stopElearning = startElearning();
  // Q3: media jobs (handlers registered by the modules above) from the PostgreSQL queue.
  const stopJobs = startJobWorker((event, details = {}) =>
    console.log(JSON.stringify({ level: event.endsWith("failed") ? "warn" : "info", event, ...details })),
  );
  void recoverRecordings((roomId, sessionId) =>
    publishOutcomeChange(ioForShutdown.get(server)!, { roomId, sessionId, part: "recording" }),
  ).catch((error) => console.error(JSON.stringify({ level: "error", event: "recording_recovery_failed", message: String(error) })));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    stopMaintenance();
    stopCallCenter();
    stopElearning();
    stopJobs();
    console.log(JSON.stringify({ level: "info", event: "shutdown_started" }));
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    server.close(async () => {
      await stopAllRecordings().catch(() => {});
      roomManager.close();
      void pool.end().finally(() => {
        clearTimeout(deadline);
        process.exit(0);
      });
    });
    server.closeAllConnections();
    // Upgraded connections are closed by Socket.IO, which invokes the HTTP close hook.
    ioForShutdown.get(server)?.close();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  server.listen(port, () => console.log(`API listening on http://localhost:${port}`));
}
