import type { CreateAnnouncementInput, UpdateAnnouncementInput } from "@doan/shared";
import type { RouteContext } from "../../shared/http/context.js";
import { getAuthUserId, readJson, sendJson } from "../../shared/http/utils.js";
import { HttpError } from "../../shared/http/http-error.js";
import {
  createAnnouncement,
  deleteAnnouncement,
  grantPublisher,
  listAnnouncements,
  listPublishers,
  revokePublisher,
  updateAnnouncement,
} from "./service.js";

export async function announcementRoutes({
  request,
  response,
  pathname,
  params,
  io,
}: RouteContext): Promise<void> {
  if (!pathname.startsWith("/api/announcements")) return;

  const userId = await getAuthUserId(request);
  response.setHeader("Cache-Control", "no-store");

  // GET /api/announcements
  if (pathname === "/api/announcements" && request.method === "GET") {
    const category = params.get("category") || undefined;
    const data = await listAnnouncements(userId, category);
    sendJson(response, 200, data);
    return;
  }

  // POST /api/announcements
  if (pathname === "/api/announcements" && request.method === "POST") {
    const body = await readJson(request);
    const item = await createAnnouncement(userId, body as unknown as CreateAnnouncementInput);
    io?.emit("announcements_changed");
    io?.emit("notifications_changed");
    sendJson(response, 201, { item });
    return;
  }

  // GET /api/announcements/publishers
  if (pathname === "/api/announcements/publishers" && request.method === "GET") {
    const data = await listPublishers(userId);
    sendJson(response, 200, data);
    return;
  }

  // POST /api/announcements/publishers
  if (pathname === "/api/announcements/publishers" && request.method === "POST") {
    const body = await readJson(request);
    const email = typeof body.email === "string" ? body.email : "";
    if (!email) {
      throw new HttpError(400, "INVALID_INPUT", "Vui lòng cung cấp email của người dùng.");
    }
    const res = await grantPublisher(userId, email);
    io?.emit("announcements_changed");
    sendJson(response, 200, res);
    return;
  }

  // DELETE /api/announcements/publishers/:userId
  const publisherMatch = pathname.match(/^\/api\/announcements\/publishers\/([0-9a-fA-F-]{36})$/);
  if (publisherMatch && request.method === "DELETE") {
    const targetUserId = publisherMatch[1];
    const res = await revokePublisher(userId, targetUserId);
    io?.emit("announcements_changed");
    sendJson(response, 200, res);
    return;
  }

  // PATCH /api/announcements/:id
  const itemMatch = pathname.match(/^\/api\/announcements\/([0-9a-fA-F-]{36})$/);
  if (itemMatch && request.method === "PATCH") {
    const announcementId = itemMatch[1];
    const body = await readJson(request);
    const item = await updateAnnouncement(userId, announcementId, body as unknown as UpdateAnnouncementInput);
    io?.emit("announcements_changed");
    sendJson(response, 200, { item });
    return;
  }

  // DELETE /api/announcements/:id
  if (itemMatch && request.method === "DELETE") {
    const announcementId = itemMatch[1];
    await deleteAnnouncement(userId, announcementId);
    io?.emit("announcements_changed");
    sendJson(response, 200, { ok: true });
    return;
  }
}
