import type { RouteContext } from "../../shared/http/context.js";
import { getAuthUserId, readJson, sendJson } from "../../shared/http/utils.js";
import { HttpError } from "../../shared/http/http-error.js";
import { query } from "../../infrastructure/database/db.js";
import { limitRequest } from "../../shared/http/rate-limit.js";
import { createTask, getTask, listAllTasks, listTasks, mutateTask } from "./service.js";
export async function taskRoutes({
  request,
  response,
  io,
  pathname,
  params,
}: RouteContext): Promise<void> {
  if (pathname === "/api/tasks" && request.method === "GET") {
    const userId = await getAuthUserId(request);
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, await listAllTasks(userId, params));
    return;
  }
  const boardRoute = pathname.match(/^\/api\/channels\/([^/]+)\/tasks$/);
  const taskRoute = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (boardRoute || taskRoute) {
    const userId = await getAuthUserId(request);
    response.setHeader("Cache-Control", "no-store");
    if (boardRoute && request.method === "GET") {
      sendJson(response, 200, await listTasks(userId, boardRoute[1], params));
      return;
    }
    if (taskRoute && request.method === "GET") {
      sendJson(response, 200, await getTask(userId, taskRoute[1]));
      return;
    }
    if ((boardRoute && request.method === "POST") || (taskRoute && request.method === "PATCH")) {
      await limitRequest(request, `task:${userId}`, 120, 60);
      const body = await readJson(request);
      const task = boardRoute
        ? await createTask(userId, boardRoute[1], body)
        : await mutateTask(userId, taskRoute![1], body);
      const recipients = await query<{ user_id: string }>(
        `SELECT user_id FROM channel_access WHERE channel_id=$1`,
        [task.channelId],
      );
      io.to(recipients.rows.map((row) => `user:${row.user_id}`)).emit("task_changed", {
        channelId: task.channelId,
        taskId: task.id,
        version: task.version,
      });
      sendJson(response, boardRoute ? 201 : 200, { task });
      return;
    }
    throw new HttpError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
  }
}
