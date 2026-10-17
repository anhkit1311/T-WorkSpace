import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { HealthResponse } from "@doan/shared";
import { config, getJwtSecret } from "./config/config.js";
import { HttpError } from "./shared/http/http-error.js";
import { initSocketServer } from "./infrastructure/realtime/socket.js";
import { sendError, sendJson, setCorsHeaders, webOrigin } from "./shared/http/utils.js";
import { taskRoutes } from "./modules/tasks/routes.js";
import { conversationRoutes } from "./modules/chat/routes.js";
import { workspaceRoutes } from "./modules/workspaces/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { profileRoutes } from "./modules/profiles/routes.js";
import { meetingRoutes } from "./modules/meetings/routes.js";
import { fileRoutes } from "./modules/files/routes.js";
import { academicRoutes } from "./modules/academic/routes.js";
import { randomUUID } from "node:crypto";
import { pool, query } from "./infrastructure/database/db.js";
import { roomManager } from "./modules/meetings/media/room-manager.js";
import { startMaintenance } from "./infrastructure/operations/maintenance.js";
import { openapi } from "./shared/http/openapi.js";
const port = Number(process.env.API_PORT ?? 3001);
const metrics = { requests: 0, errors: 0, totalDurationMs: 0 };
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
    if (version.rows[0]?.name !== "026_direct_messages.sql")
      throw new HttpError(503, "NOT_READY", "Cần chạy migration trước khi phục vụ.");
    sendJson(response, 200, { status: "ready" });
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
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    stopMaintenance();
    console.log(JSON.stringify({ level: "info", event: "shutdown_started" }));
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    server.close(() => {
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
