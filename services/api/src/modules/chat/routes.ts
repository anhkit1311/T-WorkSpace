import type { RouteContext } from "../../shared/http/context.js";
import { getAuthUserId, readJson, sendJson } from "../../shared/http/utils.js";
import { HttpError } from "../../shared/http/http-error.js";
import { query } from "../../infrastructure/database/db.js";
import {
  getChannelMessages,
  requireChannelAccess,
  setChannelPreference,
  getChannelPreference,
  validateId,
} from "../workspaces/service.js";
import {
  filteredMessageSearch,
  getMessageContext,
  getThread,
  listNotifications,
  listSavedMessages,
  markNotificationsRead,
  markThreadRead,
  toggleSavedMessage,
  workspaceNotificationPreference,
} from "./conversations.js";
import {
  listDirectConversations,
  listDirectFiles,
  openDirectConversation,
  searchDirectUsers,
} from "./direct.js";
export async function conversationRoutes({
  request,
  response,
  io,
  pathname,
  params,
}: RouteContext): Promise<void> {
  if (pathname === "/api/notifications" && request.method === "GET") {
    const userId = await getAuthUserId(request);
    response.setHeader("Cache-Control", "no-store");
    sendJson(
      response,
      200,
      await listNotifications(
        userId,
        params.get("before") ?? undefined,
        params.get("unread") === "true",
      ),
    );
    return;
  }
  if (pathname === "/api/notifications/read" && request.method === "POST") {
    const userId = await getAuthUserId(request);
    const body = await readJson(request);
    if (body.id !== undefined) validateId(body.id);
    await markNotificationsRead(userId, body.id as string | undefined);
    io.to(`user:${userId}`).emit("notifications_changed");
    sendJson(response, 200, { success: true });
    return;
  }
  if (pathname === "/api/direct-conversations" && request.method === "GET") {
    const userId = await getAuthUserId(request);
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, { conversations: await listDirectConversations(userId) });
    return;
  }
  if (pathname === "/api/direct-conversations" && request.method === "POST") {
    const userId = await getAuthUserId(request);
    const body = await readJson(request);
    sendJson(response, 200, { conversation: await openDirectConversation(userId, body.userId) });
    return;
  }
  if (pathname === "/api/direct-conversations/users" && request.method === "GET") {
    const userId = await getAuthUserId(request);
    sendJson(response, 200, { users: await searchDirectUsers(userId, params.get("q") ?? "") });
    return;
  }
  const directFiles = pathname.match(/^\/api\/direct-conversations\/([^/]+)\/files$/);
  if (directFiles && request.method === "GET") {
    const userId = await getAuthUserId(request);
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, {
      files: await listDirectFiles(userId, directFiles[1], Number(params.get("limit")) || 20),
    });
    return;
  }
  const conversation = pathname.match(
    /^\/api\/(messages|threads)\/([^/]+)(?:\/(context|pin|bookmark|read))?$/,
  );
  if (conversation) {
    const userId = await getAuthUserId(request);
    const [, kind, id, action] = conversation;
    validateId(id);
    if (kind === "messages" && action === "context" && request.method === "GET") {
      sendJson(response, 200, await getMessageContext(userId, id));
      return;
    }
    if (kind === "threads" && !action && request.method === "GET") {
      sendJson(response, 200, await getThread(userId, id, params.get("before") ?? undefined));
      return;
    }
    if (kind === "threads" && action === "read" && request.method === "POST") {
      await markThreadRead(userId, id);
      const root = await query<{ channel_id: string }>(
        `SELECT channel_id FROM messages WHERE id=$1`,
        [id],
      );
      if (root.rows[0])
        io.to(`user:${userId}`).emit("message_changed", {
          channelId: root.rows[0].channel_id,
          messageId: id,
        });
      io.to(`user:${userId}`).emit("notifications_changed");
      sendJson(response, 200, { success: true });
      return;
    }
    if (kind === "messages" && ["pin", "bookmark"].includes(action) && request.method === "POST") {
      const result = await toggleSavedMessage(userId, id, action === "pin");
      const recipients = await query<{ user_id: string }>(
        `SELECT user_id FROM channel_access WHERE channel_id=$1`,
        [result.channelId],
      );
      io.to(
        action === "bookmark"
          ? [`user:${userId}`]
          : recipients.rows.map((row) => `user:${row.user_id}`),
      ).emit("message_changed", { channelId: result.channelId, messageId: id });
      sendJson(response, 200, { success: true });
      return;
    }
  }
  const channelExtras = pathname.match(/^\/api\/channels\/([^/]+)\/(pins|bookmarks|members)$/);
  if (channelExtras && request.method === "GET") {
    const userId = await getAuthUserId(request);
    const [, id, kind] = channelExtras;
    await requireChannelAccess(userId, id);
    if (kind === "members") {
      const members = await query(
        `SELECT u.id AS "userId",u.display_name AS "displayName",access.role FROM channel_access access JOIN users u ON u.id=access.user_id WHERE access.channel_id=$1 ORDER BY u.display_name,u.id`,
        [id],
      );
      sendJson(response, 200, { members: members.rows });
    } else
      sendJson(response, 200, {
        messages: await listSavedMessages(userId, id, kind as "pins" | "bookmarks"),
      });
    return;
  }
  const workspaceMute = pathname.match(/^\/api\/workspaces\/([^/]+)\/notifications$/);
  if (workspaceMute && ["GET", "POST"].includes(request.method ?? "")) {
    const userId = await getAuthUserId(request);
    const input = request.method === "POST" ? await readJson(request) : {};
    sendJson(
      response,
      200,
      await workspaceNotificationPreference(userId, workspaceMute[1], input.muted),
    );
    return;
  }

  if (request.method === "GET" && pathname === "/api/search/messages") {
    const userId = await getAuthUserId(request);
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, await filteredMessageSearch(userId, params));
    return;
  }

  const channelMessagesMatch = pathname.match(/^\/api\/channels\/([^/]+)\/messages$/);
  if (request.method === "GET" && channelMessagesMatch) {
    const userId = await getAuthUserId(request);
    const channelId = channelMessagesMatch[1];
    const url = new URL(request.url ?? "/", "http://localhost");
    const requestedLimit = url.searchParams.get("limit");
    const before = url.searchParams.get("before") ?? undefined;
    const after = url.searchParams.get("after") ?? undefined;
    const search = url.searchParams.get("search") ?? undefined;
    const limit = requestedLimit === null ? 50 : Number(requestedLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new HttpError(400, "INVALID_LIMIT", "Giới hạn tin nhắn phải từ 1 đến 100.");
    const messages = await getChannelMessages(userId, channelId, limit, before, search, after);
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, { messages });
    return;
  }

  const channelPrefsMatch = pathname.match(/^\/api\/channels\/([^/]+)\/preferences$/);
  if (request.method === "GET" && channelPrefsMatch) {
    const userId = await getAuthUserId(request);
    sendJson(response, 200, {
      preference: await getChannelPreference(userId, channelPrefsMatch[1]),
    });
    return;
  }
  if (request.method === "POST" && channelPrefsMatch) {
    const userId = await getAuthUserId(request);
    const body = await readJson(request);
    const preference = await setChannelPreference(userId, channelPrefsMatch[1], {
      pinned: body.pinned as boolean | undefined,
      muted: body.muted as boolean | undefined,
      markRead: body.markRead === true,
    });
    if (body.markRead === true) io.to(`user:${userId}`).emit("notifications_changed");
    sendJson(response, 200, { preference });
    return;
  }
}
