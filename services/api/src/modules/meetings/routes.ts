import type { RouteContext } from "../../shared/http/context.js";
import { getAuthUserId, readJson, sendJson } from "../../shared/http/utils.js";
import { query } from "../../infrastructure/database/db.js";
import { requireChannelAccess } from "../workspaces/service.js";
import {
  listMeetingSchedules,
  createMeetingSchedule,
  updateMeetingSchedule,
  cancelMeetingSchedule,
} from "./schedules.js";
export async function meetingRoutes({ request, response, pathname }: RouteContext): Promise<void> {
  const location = pathname.match(/^\/api\/channels\/([^/]+)\/media-location$/);
  if (location && request.method === "GET") {
    await requireChannelAccess(await getAuthUserId(request), location[1], true, true);
    const result = await query(
      `SELECT i.media_url FROM meeting_sessions s JOIN api_instances i ON i.id=s.media_instance_id AND i.expires_at>now() WHERE s.channel_id=$1 AND s.ended_at IS NULL`,
      [location[1]],
    );
    sendJson(response, 200, { url: result.rows[0]?.media_url ?? null });
    return;
  }
  if (request.method === "GET" && pathname === "/api/meetings/history") {
    const userId = await getAuthUserId(request);
    const result = await query(
      `SELECT p.id, c.name, c.id AS "roomId", p.joined_at AS "joinedAt", p.left_at AS "leftAt"
      FROM meeting_participations p JOIN channels c ON c.id=p.channel_id
      JOIN channel_access m ON m.channel_id=c.id AND m.user_id=$1
      WHERE p.user_id=$1 ORDER BY p.joined_at DESC LIMIT 50`,
      [userId],
    );
    sendJson(response, 200, { meetings: result.rows });
    return;
  }

  if (pathname === "/api/meetings/schedules") {
    const userId = await getAuthUserId(request);
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET") {
      sendJson(response, 200, { schedules: await listMeetingSchedules(userId) });
      return;
    }
    if (request.method === "POST") {
      const schedule = await createMeetingSchedule(userId, await readJson(request));
      sendJson(response, 201, { schedule });
      return;
    }
  }

  const scheduleMatch = pathname.match(/^\/api\/meetings\/schedules\/([^/]+)$/);
  if (scheduleMatch && (request.method === "PATCH" || request.method === "DELETE")) {
    const userId = await getAuthUserId(request);
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "PATCH") {
      const schedule = await updateMeetingSchedule(
        userId,
        scheduleMatch[1],
        await readJson(request),
      );
      sendJson(response, 200, { schedule });
    } else {
      await cancelMeetingSchedule(userId, scheduleMatch[1]);
      sendJson(response, 200, { ok: true });
    }
    return;
  }
}
