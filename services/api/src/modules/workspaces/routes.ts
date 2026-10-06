import type { RouteContext } from "../../shared/http/context.js";
import { getAuthUserId, readJson, sendJson } from "../../shared/http/utils.js";
import { webOrigin } from "../../shared/http/utils.js";
import { HttpError } from "../../shared/http/http-error.js";
import { query } from "../../infrastructure/database/db.js";
import { limitRequest } from "../../shared/http/rate-limit.js";
import {
  approveWorkspaceMember,
  createWorkspace,
  getUserWorkspaces,
  getWorkspaceChannels,
  getWorkspaceMembers,
  rejectWorkspaceMember,
  validateId,
} from "./service.js";
import { sendWorkspaceInvitation } from "../../infrastructure/email/service.js";
import { homeSummary, listWorkspaceFiles, workspaceOverview } from "./home.js";
import {
  acceptInvitation,
  changeMember,
  createInvitation,
  getAdministration,
  reorderChannels,
  revokeInvitation,
  saveChannel,
  setChannelMember,
  updateWorkspace,
} from "./governance.js";
export async function workspaceRoutes({
  request,
  response,
  pathname,
  params,
}: RouteContext): Promise<void> {
  if (pathname === "/api/home" && request.method === "GET") {
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, await homeSummary(await getAuthUserId(request)));
    return;
  }
  const workspaceOverviewMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/overview$/);
  if (request.method === "GET" && workspaceOverviewMatch) {
    const userId = await getAuthUserId(request);
    const workspaceId = workspaceOverviewMatch[1];
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, await workspaceOverview(userId, workspaceId));
    return;
  }
  const workspaceFilesMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/files$/);
  if (request.method === "GET" && workspaceFilesMatch) {
    const userId = await getAuthUserId(request);
    const workspaceId = workspaceFilesMatch[1];
    const before = params.get("before") ?? undefined;
    const limit = Number(params.get("limit")) || 24;
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, await listWorkspaceFiles(userId, workspaceId, before, limit, false));
    return;
  }
  const governance = pathname.match(
    /^\/api\/workspaces\/([^/]+)\/(administration|settings|leave|transfer|roles|channels\/manage|channels\/order|channel-members|invitations)(?:\/([^/]+))?$/,
  );
  if (governance) {
    const userId = await getAuthUserId(request);
    const [, workspaceId, action, id] = governance;
    validateId(workspaceId);
    if (request.method === "GET" && action === "administration") {
      sendJson(response, 200, await getAdministration(userId, workspaceId));
      return;
    }
    if (["POST", "PATCH", "DELETE"].includes(request.method ?? "")) {
      const method =
        action === "settings"
          ? "PATCH"
          : action === "channels/manage"
            ? id
              ? "PATCH"
              : "POST"
            : action === "invitations"
              ? id && request.method === "DELETE"
                ? "DELETE"
                : "POST"
              : "POST";
      if (
        request.method !== method ||
        action === "administration" ||
        (id && !["invitations", "channels/manage"].includes(action))
      )
        throw new HttpError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
      await limitRequest(
        request,
        `governance:${userId}:${action}`,
        action === "invitations" ? 20 : 120,
        3600,
      );
      const body = request.method === "DELETE" ? {} : await readJson(request);
      let result: object = { success: true };
      if (action === "settings") await updateWorkspace(userId, workspaceId, body);
      else if (action === "leave") await changeMember(userId, workspaceId, userId, "leave");
      else if (action === "transfer") {
        validateId(body.userId);
        await changeMember(userId, workspaceId, body.userId, "transfer");
      } else if (action === "roles") {
        validateId(body.userId);
        await changeMember(userId, workspaceId, body.userId, "role", body.role);
      } else if (action === "channels/manage")
        result = await saveChannel(userId, workspaceId, id, body);
      else if (action === "channels/order") await reorderChannels(userId, workspaceId, body.ids);
      else if (action === "channel-members") {
        validateId(body.channelId);
        validateId(body.userId);
        if (typeof body.allowed !== "boolean")
          throw new HttpError(400, "INVALID_INPUT", "Quyền kênh phải là boolean.");
        await setChannelMember(userId, workspaceId, body.channelId, body.userId, body.allowed);
      } else if (action === "invitations" && request.method === "DELETE" && id)
        await revokeInvitation(userId, workspaceId, id);
      else if (action === "invitations" && request.method === "POST") {
        const invitation = await createInvitation(userId, workspaceId, body.email, id);
        const link = `${webOrigin}/app/invitation#token=${invitation.token}`;
        let delivery = "link";
        if (body.sendEmail === true && invitation.email) {
          try {
            await sendWorkspaceInvitation(invitation.email, link);
            delivery = "sent";
          } catch {
            delivery = "failed";
          }
        }
        result = { ...invitation, link, delivery };
      } else throw new HttpError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
      sendJson(response, 200, result);
      return;
    }
  }
  if (pathname === "/api/invitations/accept" && request.method === "POST") {
    const userId = await getAuthUserId(request);
    await limitRequest(request, `invitation-accept:${userId}`, 30, 3600);
    sendJson(response, 200, await acceptInvitation(userId, (await readJson(request)).token));
    return;
  }

  if (request.method === "GET" && pathname === "/api/workspaces") {
    const userId = await getAuthUserId(request);
    const workspaces = await getUserWorkspaces(userId);
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, { workspaces });
    return;
  }

  if (request.method === "POST" && pathname === "/api/workspaces") {
    const userId = await getAuthUserId(request);
    const body = await readJson(request);
    const name = typeof body.name === "string" ? body.name : "Nhóm mới";
    const workspace = await createWorkspace(userId, name);
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 201, { workspace });
    return;
  }

  const workspaceMembersMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/members$/);
  const addMemberMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/members\/add$/);
  if (request.method === "POST" && addMemberMatch) {
    const userId = await getAuthUserId(request);
    const body = await readJson(request);
    const members = await getWorkspaceMembers(userId, addMemberMatch[1]);
    if (!members.some((m) => m.userId === userId && m.role !== "member"))
      throw new HttpError(403, "FORBIDDEN", "Chỉ quản trị viên được thêm thành viên.");
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const target = await query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
    if (!target.rowCount) throw new HttpError(404, "USER_NOT_FOUND", "Tài khoản này chưa đăng ký.");
    await approveWorkspaceMember(userId, addMemberMatch[1], target.rows[0].id);
    sendJson(response, 200, { ok: true });
    return;
  }
  if (request.method === "GET" && workspaceMembersMatch) {
    const userId = await getAuthUserId(request);
    const workspaceId = workspaceMembersMatch[1];
    const members = await getWorkspaceMembers(userId, workspaceId);
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, { members });
    return;
  }

  const workspaceApproveMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/members\/approve$/);
  if (request.method === "POST" && workspaceApproveMatch) {
    const userId = await getAuthUserId(request);
    const workspaceId = workspaceApproveMatch[1];
    const body = await readJson(request);
    const targetUserId = typeof body.userId === "string" ? body.userId : "";
    await approveWorkspaceMember(userId, workspaceId, targetUserId);
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, { ok: true });
    return;
  }

  const workspaceRejectMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/members\/reject$/);
  if (request.method === "POST" && workspaceRejectMatch) {
    const userId = await getAuthUserId(request);
    const workspaceId = workspaceRejectMatch[1];
    const body = await readJson(request);
    const targetUserId = typeof body.userId === "string" ? body.userId : "";
    await rejectWorkspaceMember(userId, workspaceId, targetUserId);
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, { ok: true });
    return;
  }

  const workspaceChannelsMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/channels$/);
  if (request.method === "GET" && workspaceChannelsMatch) {
    const userId = await getAuthUserId(request);
    const workspaceId = workspaceChannelsMatch[1];
    const channels = await getWorkspaceChannels(userId, workspaceId);
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, { channels });
    return;
  }
}
