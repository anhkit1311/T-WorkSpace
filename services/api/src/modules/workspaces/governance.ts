import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { query, withTransaction } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";
import { membershipEvents, validateId } from "./service.js";
import {config} from '../../config/config.js';

export async function audit(
  client: PoolClient,
  workspaceId: string,
  actorId: string,
  action: string,
  targetId: string,
  details: object = {},
) {
  await client.query(
    `INSERT INTO audit_events(id,workspace_id,actor_id,action,target_id,details) VALUES($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), workspaceId, actorId, action, targetId, JSON.stringify(details)],
  );
}

async function workspaceRole(
  client: PoolClient,
  actor: string,
  workspaceId: string,
  admin = true,
  allowArchived = false,
) {
  validateId(workspaceId);
  // All governance operations serialize on the workspace row, including owner transfer.
  const w = await client.query<{ owner_id: string; archived_at: string | null }>(
    `SELECT owner_id,archived_at FROM workspaces WHERE id=$1 FOR UPDATE`,
    [workspaceId],
  );
  const m = await client.query<{ role: string }>(
    `SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2`,
    [workspaceId, actor],
  );
  if (!w.rowCount || !m.rowCount || (admin && !["owner", "admin"].includes(m.rows[0].role)))
    throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền quản lý nhóm này.");
  if (!allowArchived && w.rows[0].archived_at)
    throw new HttpError(
      409,
      "WORKSPACE_ARCHIVED",
      "Nhóm đã lưu trữ. Khôi phục nhóm trước khi thay đổi.",
    );
  return { ...w.rows[0], role: m.rows[0].role };
}

function text(value: unknown, label: string, max: number, min = 0): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max)
    throw new HttpError(400, "INVALID_INPUT", `${label} phải có ${min}–${max} ký tự.`);
  return value.trim();
}

async function refreshWorkspace(workspaceId: string) {
  const members = await query<{ user_id: string }>(
    `SELECT user_id FROM memberships WHERE workspace_id=$1`,
    [workspaceId],
  );
  members.rows.forEach((row) => membershipEvents.emit("removed", row.user_id));
}

export async function updateWorkspace(
  actor: string,
  workspaceId: string,
  input: Record<string, unknown>,
) {
  await withTransaction(async (client) => {
    const w = await workspaceRole(client, actor, workspaceId, true, true);
    if (
      w.archived_at &&
      input.archived !== false &&
      (input.name !== undefined || input.description !== undefined)
    )
      throw new HttpError(409, "WORKSPACE_ARCHIVED", "Khôi phục nhóm trước khi sửa thông tin.");
    if (input.archived !== undefined && (typeof input.archived !== "boolean" || w.role !== "owner"))
      throw new HttpError(403, "FORBIDDEN", "Chỉ chủ nhóm có thể lưu trữ hoặc khôi phục nhóm.");
    const name = input.name === undefined ? null : text(input.name, "Tên nhóm", 80, 1);
    const description =
      input.description === undefined ? null : text(input.description, "Mô tả", 1000);
    await client.query(
      `UPDATE workspaces SET name=COALESCE($2,name),description=COALESCE($3,description),archived_at=CASE WHEN $4::boolean IS NULL THEN archived_at WHEN $4 THEN COALESCE(archived_at,now()) ELSE NULL END,updated_at=now() WHERE id=$1`,
      [workspaceId, name, description, input.archived ?? null],
    );
    await audit(
      client,
      workspaceId,
      actor,
      input.archived === undefined
        ? "workspace.updated"
        : input.archived
          ? "workspace.archived"
          : "workspace.restored",
      workspaceId,
    );
  });
  await refreshWorkspace(workspaceId);
}

export async function changeMember(
  actor: string,
  workspaceId: string,
  target: string,
  action: "remove" | "leave" | "transfer" | "role" | "add",
  role?: unknown,
) {
  validateId(target);
  await withTransaction(async (client) => {
    const w = await workspaceRole(
      client,
      actor,
      workspaceId,
      action !== "leave",
      action === "leave",
    );
    const member = await client.query<{ role: string }>(
      `SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2`,
      [workspaceId, target],
    );
    if (action === "transfer") {
      if (w.owner_id !== actor || target === actor || !member.rowCount)
        throw new HttpError(
          403,
          "OWNER_TRANSFER_INVALID",
          "Chủ nhóm chỉ được chuyển quyền cho thành viên khác trong nhóm.",
        );
      await client.query(
        `UPDATE memberships SET role='admin' WHERE workspace_id=$1 AND user_id=$2`,
        [workspaceId, actor],
      );
      await client.query(
        `UPDATE memberships SET role='owner' WHERE workspace_id=$1 AND user_id=$2`,
        [workspaceId, target],
      );
      await client.query(`UPDATE workspaces SET owner_id=$2,updated_at=now() WHERE id=$1`, [
        workspaceId,
        target,
      ]);
    } else if (action === "role") {
      if (
        w.owner_id !== actor ||
        target === w.owner_id ||
        !member.rowCount ||
        !["admin", "member"].includes(String(role))
      )
        throw new HttpError(
          403,
          "ROLE_CHANGE_INVALID",
          "Chỉ chủ nhóm được đổi vai trò admin/member; không được hạ quyền chủ nhóm.",
        );
      await client.query(`UPDATE memberships SET role=$3 WHERE workspace_id=$1 AND user_id=$2`, [
        workspaceId,
        target,
        role,
      ]);
    } else if (action === "add") {
      const user = await client.query(`SELECT 1 FROM users WHERE id=$1`, [target]);
      if (!user.rowCount) throw new HttpError(404, "USER_NOT_FOUND", "Không tìm thấy người dùng.");
      await client.query(
        `INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING`,
        [workspaceId, target],
      );
    } else {
      if (
        target === w.owner_id ||
        (action === "leave" && target !== actor) ||
        (action === "remove" && member.rows[0]?.role === "admin" && w.role !== "owner")
      )
        throw new HttpError(
          403,
          "OWNER_PROTECTED",
          "Bạn không được loại chủ nhóm hoặc quản trị viên này. Chuyển chủ sở hữu trước khi rời nhóm.",
        );
      await client.query(
        `DELETE FROM channel_memberships WHERE user_id=$2 AND channel_id IN (SELECT id FROM channels WHERE workspace_id=$1)`,
        [workspaceId, target],
      );
      await client.query(`DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2`, [
        workspaceId,
        target,
      ]);
    }
    await audit(
      client,
      workspaceId,
      actor,
      `member.${action}`,
      target,
      action === "role" ? { role } : {},
    );
  });
  membershipEvents.emit("removed", target);
  if (action === "transfer") membershipEvents.emit("removed", actor);
}

export async function saveChannel(
  actor: string,
  workspaceId: string,
  channelId: string | undefined,
  input: Record<string, unknown>,
) {
  if (channelId) validateId(channelId);
  const id = channelId ?? randomUUID();
  await withTransaction(async (client) => {
    await workspaceRole(client, actor, workspaceId);
    const previous = channelId
      ? await client.query<{ is_private: boolean }>(
          `SELECT is_private FROM channels WHERE id=$1 AND workspace_id=$2 FOR UPDATE`,
          [id, workspaceId],
        )
      : null;
    if (channelId && !previous?.rowCount)
      throw new HttpError(404, "CHANNEL_NOT_FOUND", "Không tìm thấy kênh.");
    if (input.isPrivate !== undefined && typeof input.isPrivate !== "boolean")
      throw new HttpError(400, "INVALID_INPUT", "Loại riêng tư không hợp lệ.");
    if (input.archived !== undefined && typeof input.archived !== "boolean")
      throw new HttpError(400, "INVALID_INPUT", "Trạng thái lưu trữ không hợp lệ.");
    const name =
      input.name === undefined && channelId
        ? null
        : text(input.name, "Tên kênh", 80, 1).normalize("NFC");
    if (
      name &&
      Array.from(name).some(
        (character) =>
          character.charCodeAt(0) < 32 ||
          character.charCodeAt(0) === 127 ||
          "/#?".includes(character),
      )
    )
      throw new HttpError(
        400,
        "INVALID_NAME",
        "Tên kênh không được chứa ký tự điều khiển, /, # hoặc ?.",
      );
    if (
      name &&
      (
        await client.query(
          `SELECT 1 FROM channels WHERE workspace_id=$1 AND lower(name)=lower($2) AND id<>$3`,
          [workspaceId, name, id],
        )
      ).rowCount
    )
      throw new HttpError(409, "CHANNEL_NAME_EXISTS", "Tên kênh đã có trong nhóm.");
    const description =
      input.description === undefined ? null : text(input.description, "Mô tả kênh", 500);
    if (!channelId) {
      if (!["text", "voice", "video"].includes(String(input.type)))
        throw new HttpError(400, "INVALID_TYPE", "Loại kênh không hợp lệ.");
      await client.query(
        `INSERT INTO channels(id,workspace_id,created_by,name,type,position,description,is_private) VALUES($1,$2,$3,$4,$5,(SELECT COALESCE(max(position),0)+1 FROM channels WHERE workspace_id=$2),$6,$7)`,
        [id, workspaceId, actor, name, input.type, description ?? "", input.isPrivate ?? false],
      );
    } else
      await client.query(
        `UPDATE channels SET name=COALESCE($3,name),description=COALESCE($4,description),is_private=COALESCE($5,is_private),archived_at=CASE WHEN $6::boolean IS NULL THEN archived_at WHEN $6 THEN COALESCE(archived_at,now()) ELSE NULL END,updated_at=now() WHERE id=$1 AND workspace_id=$2`,
        [id, workspaceId, name, description, input.isPrivate ?? null, input.archived ?? null],
      );
    if (input.isPrivate === true && !previous?.rows[0]?.is_private)
      await client.query(
        `INSERT INTO channel_memberships(channel_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [id, actor],
      );
    await audit(client, workspaceId, actor, channelId ? "channel.updated" : "channel.created", id, {
      private: input.isPrivate,
      archived: input.archived,
    });
  });
  await refreshWorkspace(workspaceId);
  return { id };
}

export async function setChannelMember(
  actor: string,
  workspaceId: string,
  channelId: string,
  target: string,
  allowed: boolean,
) {
  validateId(channelId);
  validateId(target);
  await withTransaction(async (client) => {
    await workspaceRole(client, actor, workspaceId);
    const c = await client.query(
      `SELECT 1 FROM channels WHERE id=$1 AND workspace_id=$2 AND is_private FOR UPDATE`,
      [channelId, workspaceId],
    );
    const m = await client.query(`SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2`, [
      workspaceId,
      target,
    ]);
    if (!c.rowCount || !m.rowCount)
      throw new HttpError(
        400,
        "INVALID_CHANNEL_MEMBER",
        "Chọn thành viên hiện tại và kênh riêng tư trong nhóm.",
      );
    if (allowed)
      await client.query(
        `INSERT INTO channel_memberships(channel_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [channelId, target],
      );
    else
      await client.query(`DELETE FROM channel_memberships WHERE channel_id=$1 AND user_id=$2`, [
        channelId,
        target,
      ]);
    await audit(
      client,
      workspaceId,
      actor,
      allowed ? "channel.member_added" : "channel.member_removed",
      channelId,
      { userId: target },
    );
  });
  membershipEvents.emit("removed", target);
}

export async function reorderChannels(actor: string, workspaceId: string, ids: unknown) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 200)
    throw new HttpError(400, "INVALID_ORDER", "Danh sách thứ tự không hợp lệ.");
  ids.forEach(validateId);
  await withTransaction(async (client) => {
    await workspaceRole(client, actor, workspaceId);
    const channels = await client.query<{ id: string }>(
      `SELECT id FROM channels WHERE workspace_id=$1`,
      [workspaceId],
    );
    if (
      new Set(ids).size !== ids.length ||
      channels.rowCount !== ids.length ||
      channels.rows.some((row) => !ids.includes(row.id))
    )
      throw new HttpError(400, "INVALID_ORDER", "Thứ tự phải chứa mỗi kênh của nhóm đúng một lần.");
    for (let i = 0; i < ids.length; i++)
      await client.query(`UPDATE channels SET position=$2,updated_at=now() WHERE id=$1`, [
        ids[i],
        i + 1,
      ]);
    await audit(client, workspaceId, actor, "channel.reordered", workspaceId);
  });
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export async function createInvitation(
  actor: string,
  workspaceId: string,
  emailValue?: unknown,
  resendId?: string,
) {
  let email =
    emailValue === undefined || emailValue === ""
      ? null
      : text(emailValue, "Email", 320, 3).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpError(400, "INVALID_EMAIL", "Email không hợp lệ.");
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await withTransaction(async (client) => {
    await workspaceRole(client, actor, workspaceId);
    if (resendId) {
      validateId(resendId);
      const old = await client.query<{ email: string | null }>(
        `UPDATE workspace_invitations SET revoked_at=now() WHERE id=$1 AND workspace_id=$2 AND accepted_at IS NULL RETURNING email`,
        [resendId, workspaceId],
      );
      if (!old.rowCount)
        throw new HttpError(
          409,
          "INVITATION_UNAVAILABLE",
          "Lời mời đã được nhận hoặc không tồn tại.",
        );
      email = old.rows[0].email;
    }
    await client.query(
      `INSERT INTO workspace_invitations(id,workspace_id,created_by,email,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days')`,
      [id, workspaceId, actor, email, hashToken(token)],
    );
    await audit(client, workspaceId, actor, "invitation.created", id, {
      emailBound: Boolean(email),
    });
  });
  return { id, token, email };
}

export async function revokeInvitation(actor: string, workspaceId: string, id: string) {
  validateId(id);
  await withTransaction(async (client) => {
    await workspaceRole(client, actor, workspaceId);
    const updated = await client.query(
      `UPDATE workspace_invitations SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 AND workspace_id=$2 AND accepted_at IS NULL RETURNING id`,
      [id, workspaceId],
    );
    if (!updated.rowCount)
      throw new HttpError(
        409,
        "INVITATION_UNAVAILABLE",
        "Lời mời đã được nhận hoặc không tồn tại.",
      );
    await audit(client, workspaceId, actor, "invitation.revoked", id);
  });
}

export async function acceptInvitation(actor: string, value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value))
    throw new HttpError(400, "INVALID_INVITATION", "Liên kết lời mời không hợp lệ.");
  const result = await withTransaction(async (client) => {
    const scope = await client.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM workspace_invitations WHERE token_hash=$1`,
      [hashToken(value)],
    );
    if (!scope.rowCount) throw new HttpError(410, "INVITATION_EXPIRED", "Lời mời không tồn tại.");
    await client.query(`SELECT id FROM workspaces WHERE id=$1 FOR UPDATE`, [
      scope.rows[0].workspace_id,
    ]);
    const invite = await client.query<{
      id: string;
      workspace_id: string;
      email: string | null;
      accepted_by: string | null;
      accepted_at: string | null;
      revoked_at: string | null;
      expired: boolean;
    }>(
      `SELECT *,expires_at<=now() AS expired FROM workspace_invitations WHERE token_hash=$1 FOR UPDATE`,
      [hashToken(value)],
    );
    const i = invite.rows[0];
    if (!i || i.revoked_at || i.expired)
      throw new HttpError(
        410,
        "INVITATION_EXPIRED",
        "Lời mời đã hết hạn, bị thu hồi hoặc không tồn tại.",
      );
    const user = await client.query<{ email: string; email_verified: boolean }>(
      `SELECT email,email_verified FROM users WHERE id=$1`,
      [actor],
    );
    if (!user.rows[0]?.email_verified || (i.email && user.rows[0]?.email !== i.email))
      throw new HttpError(
        403,
        "INVITATION_EMAIL_MISMATCH",
        "Đăng nhập bằng email đã xác thực được ghi trên lời mời.",
      );
    if (i.accepted_at) {
      if (i.accepted_by !== actor)
        throw new HttpError(409, "INVITATION_USED", "Lời mời đã được người khác nhận.");
      const active = await client.query(
        `SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2`,
        [i.workspace_id, actor],
      );
      if (!active.rowCount)
        throw new HttpError(410, "INVITATION_USED", "Lời mời đã dùng và bạn không còn trong nhóm.");
      return { workspaceId: i.workspace_id };
    }
    const w = await client.query(
      `SELECT 1 FROM workspaces WHERE id=$1 AND archived_at IS NULL FOR UPDATE`,
      [i.workspace_id],
    );
    if (!w.rowCount) throw new HttpError(409, "WORKSPACE_ARCHIVED", "Nhóm đã lưu trữ.");
    await client.query(
      `INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING`,
      [i.workspace_id, actor],
    );
    await client.query(
      `UPDATE workspace_invitations SET accepted_at=now(),accepted_by=$2 WHERE id=$1`,
      [i.id, actor],
    );
    await audit(client, i.workspace_id, actor, "invitation.accepted", i.id);
    return { workspaceId: i.workspace_id };
  });
  membershipEvents.emit("removed", actor);
  return result;
}

export async function getAdministration(actor: string, workspaceId: string) {
  return withTransaction(async (client) => {
    await workspaceRole(client, actor, workspaceId, true, true);
    const workspace = await client.query(
      `SELECT id,name,description,archived_at AS "archivedAt",owner_id AS "ownerId" FROM workspaces WHERE id=$1`,
      [workspaceId],
    );
    const channels = await client.query(
      `SELECT id,name,type,position,description,is_private AS "isPrivate",archived_at AS "archivedAt",COALESCE((SELECT json_agg(user_id) FROM channel_memberships WHERE channel_id=c.id),'[]'::json) AS "memberIds" FROM channels c WHERE workspace_id=$1 ORDER BY position,id`,
      [workspaceId],
    );
    const invitations = await client.query(
      `SELECT id,email,expires_at AS "expiresAt",CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN accepted_at IS NOT NULL THEN 'accepted' WHEN expires_at<=now() THEN 'expired' ELSE 'pending' END AS status FROM workspace_invitations WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [workspaceId],
    );
    const events = await client.query(
      `SELECT a.id,a.action,a.target_id AS "targetId",a.details,a.created_at AS "createdAt",u.display_name AS "actorName" FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE workspace_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 100`,
      [workspaceId],
    );
    const usage = await client.query(
      `SELECT COALESCE(sum(file_size),0)::bigint AS bytes,count(*)::integer AS files FROM message_attachments WHERE channel_id IN (SELECT id FROM channels WHERE workspace_id=$1)`,
      [workspaceId],
    );
    return {
      workspace: workspace.rows[0],
      channels: channels.rows,
      invitations: invitations.rows,
      audit: events.rows,
      usage: {
        ...usage.rows[0],
        quotaBytes: config.fileQuotaBytes,
      },
    };
  });
}
