import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ChatMessageItem, GlobalMessageSearchItem } from "@doan/shared";
import { query, withTransaction } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";
import { requireChannelAccess, validateId } from "../workspaces/service.js";

export interface ConversationOptions {
  threadRootId?: string;
  mentionedUserIds?: string[];
}

export async function prepareConversation(
  client: PoolClient,
  userId: string,
  channelId: string,
  options: ConversationOptions,
) {
  if (options.threadRootId) {
    validateId(options.threadRootId);
    const root = await client.query(
      `SELECT 1 FROM messages WHERE id=$1 AND channel_id=$2 AND thread_root_id IS NULL AND deleted_at IS NULL FOR SHARE`,
      [options.threadRootId, channelId],
    );
    if (!root.rowCount)
      throw new HttpError(400, "INVALID_THREAD", "Chủ đề không tồn tại trong kênh.");
  }
  if (
    options.mentionedUserIds !== undefined &&
    (!Array.isArray(options.mentionedUserIds) || options.mentionedUserIds.length > 20)
  )
    throw new HttpError(400, "INVALID_MENTIONS", "Tối đa 20 người được nhắc tên trong một tin.");
  const mentions = [...new Set(options.mentionedUserIds ?? [])];
  mentions.forEach(validateId);
  if (mentions.length) {
    const allowed = await client.query(
      `SELECT user_id FROM channel_access WHERE channel_id=$1 AND user_id=ANY($2::uuid[])`,
      [channelId, mentions],
    );
    if (allowed.rowCount !== mentions.length)
      throw new HttpError(400, "INVALID_MENTIONS", "Chỉ nhắc người hiện có quyền đọc kênh.");
  }
  return mentions.filter((id) => id !== userId);
}

export async function createConversationNotifications(
  client: PoolClient,
  userId: string,
  channelId: string,
  messageId: string,
  options: ConversationOptions,
) {
  const mentions = [...new Set(options.mentionedUserIds ?? [])].filter((id) => id !== userId);
  for (const id of mentions)
    await client.query(
      `INSERT INTO message_mentions(message_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
      [messageId, id],
    );
  const watchers = options.threadRootId
    ? await client.query<{ author_id: string }>(
        `SELECT DISTINCT author_id FROM messages WHERE (id=$1 OR thread_root_id=$1) AND deleted_at IS NULL`,
        [options.threadRootId],
      )
    : { rows: [] };
  const recipients = [
    ...new Set([...mentions, ...watchers.rows.map((row) => row.author_id)]),
  ].filter((id) => id !== userId);
  for (const target of recipients) {
    await client.query(
      `INSERT INTO notifications(id,user_id,message_id,kind)
      SELECT $1,$2,$3,$4 FROM channel_access access JOIN users u ON u.id=access.user_id
      LEFT JOIN channel_preferences cp ON cp.channel_id=access.channel_id AND cp.user_id=u.id
      LEFT JOIN workspace_notification_preferences wp ON wp.workspace_id=access.workspace_id AND wp.user_id=u.id
      WHERE access.channel_id=$5 AND access.user_id=$2 AND u.notifications_enabled AND NOT COALESCE(cp.muted,false) AND NOT COALESCE(wp.muted,false) ON CONFLICT DO NOTHING`,
      [
        randomUUID(),
        target,
        messageId,
        mentions.includes(target) ? "mention" : "thread",
        channelId,
      ],
    );
  }
}

// All message views share the same projection and current permission check.
const messageProjection = `SELECT m.id,m.client_message_id AS "clientMessageId",m.channel_id AS "channelId",m.author_id AS "authorId",u.display_name AS "authorName",m.content,m.created_at AS "createdAt",m.edited_at AS "editedAt",m.reply_to_id AS "replyToId",reply.content AS "replyToContent",m.thread_root_id AS "threadRootId",
  (SELECT count(*)::integer FROM messages child WHERE child.thread_root_id=m.id AND child.deleted_at IS NULL) AS "replyCount",
  (SELECT count(*)::integer FROM messages child WHERE child.thread_root_id=m.id AND child.deleted_at IS NULL AND child.author_id<>$1 AND child.created_at>COALESCE((SELECT last_read_at FROM thread_reads WHERE root_id=m.id AND user_id=$1),'epoch'::timestamptz)) AS "threadUnreadCount",
  EXISTS(SELECT 1 FROM message_pins WHERE message_id=m.id) AS pinned,
  EXISTS(SELECT 1 FROM message_bookmarks WHERE message_id=m.id AND user_id=$1) AS bookmarked,
  (SELECT count(*)::integer FROM channel_preferences reader JOIN channel_access viewer ON viewer.channel_id=m.channel_id AND viewer.user_id=reader.user_id WHERE reader.channel_id=m.channel_id AND reader.user_id<>m.author_id AND reader.last_read_at>=m.created_at) AS "seenCount",
  COALESCE((SELECT json_agg(json_build_object('emoji',grouped.emoji,'count',grouped.total,'reacted',grouped.reacted)) FROM (SELECT emoji,count(*)::integer AS total,bool_or(user_id=$1) AS reacted FROM message_reactions WHERE message_id=m.id GROUP BY emoji) grouped),'[]'::json) AS reactions,
  COALESCE((SELECT json_agg(json_build_object('userId',mention.user_id,'displayName',mentioned.display_name)) FROM message_mentions mention JOIN users mentioned ON mentioned.id=mention.user_id WHERE mention.message_id=m.id),'[]'::json) AS mentions,
  CASE WHEN a.id IS NULL THEN NULL ELSE json_build_object('id',a.id,'fileName',a.file_name,'mimeType',a.mime_type,'fileSize',a.file_size) END AS attachment
  FROM messages m JOIN users u ON u.id=m.author_id JOIN channel_access access ON access.channel_id=m.channel_id AND access.user_id=$1 AND (m.thread_root_id IS NULL OR EXISTS(SELECT 1 FROM messages active_root WHERE active_root.id=m.thread_root_id AND active_root.deleted_at IS NULL)) LEFT JOIN messages reply ON reply.id=m.reply_to_id AND reply.deleted_at IS NULL LEFT JOIN message_attachments a ON a.id=m.attachment_id`;

export async function getMessageContext(userId: string, messageId: string) {
  validateId(messageId);
  const target = await query<ChatMessageItem>(
    `${messageProjection} WHERE m.id=$2 AND m.deleted_at IS NULL AND (m.thread_root_id IS NULL OR EXISTS(SELECT 1 FROM messages active_root WHERE active_root.id=m.thread_root_id AND active_root.deleted_at IS NULL))`,
    [userId, messageId],
  );
  if (!target.rowCount)
    throw new HttpError(404, "MESSAGE_NOT_FOUND", "Tin không tồn tại hoặc bạn không có quyền xem.");
  const channelId = target.rows[0].channelId;
  const older = await query<ChatMessageItem>(
    `${messageProjection} WHERE m.channel_id=$2 AND m.deleted_at IS NULL AND (m.thread_root_id IS NULL OR EXISTS(SELECT 1 FROM messages active_root WHERE active_root.id=m.thread_root_id AND active_root.deleted_at IS NULL)) AND m.thread_root_id IS NULL AND (m.created_at,m.id)<(SELECT created_at,id FROM messages WHERE id=$3) ORDER BY m.created_at DESC,m.id DESC LIMIT 25`,
    [userId, channelId, messageId],
  );
  const newer = await query<ChatMessageItem>(
    `${messageProjection} WHERE m.channel_id=$2 AND m.deleted_at IS NULL AND (m.thread_root_id IS NULL OR EXISTS(SELECT 1 FROM messages active_root WHERE active_root.id=m.thread_root_id AND active_root.deleted_at IS NULL)) AND m.thread_root_id IS NULL AND (m.created_at,m.id)>(SELECT created_at,id FROM messages WHERE id=$3) ORDER BY m.created_at,m.id LIMIT 25`,
    [userId, channelId, messageId],
  );
  return {
    target: target.rows[0],
    messages: [...older.rows.reverse(), target.rows[0], ...newer.rows],
  };
}

export async function getThread(userId: string, rootId: string, before?: string) {
  validateId(rootId);
  if (before) validateId(before);
  const root = await query<ChatMessageItem>(
    `${messageProjection} WHERE m.id=$2 AND m.thread_root_id IS NULL AND m.deleted_at IS NULL AND (m.thread_root_id IS NULL OR EXISTS(SELECT 1 FROM messages active_root WHERE active_root.id=m.thread_root_id AND active_root.deleted_at IS NULL))`,
    [userId, rootId],
  );
  if (!root.rowCount)
    throw new HttpError(
      404,
      "THREAD_NOT_FOUND",
      "Chủ đề không tồn tại hoặc bạn không có quyền xem.",
    );
  if (
    before &&
    !(await query(`SELECT 1 FROM messages WHERE id=$1 AND thread_root_id=$2`, [before, rootId]))
      .rowCount
  )
    throw new HttpError(400, "INVALID_CURSOR", "Mốc không thuộc chủ đề.");
  const messages = await query<ChatMessageItem>(
    `${messageProjection} WHERE m.thread_root_id=$2 AND m.deleted_at IS NULL AND (m.thread_root_id IS NULL OR EXISTS(SELECT 1 FROM messages active_root WHERE active_root.id=m.thread_root_id AND active_root.deleted_at IS NULL)) AND ($3::uuid IS NULL OR (m.created_at,m.id)<(SELECT created_at,id FROM messages WHERE id=$3)) ORDER BY m.created_at DESC,m.id DESC LIMIT 50`,
    [userId, rootId, before ?? null],
  );
  return {
    root: root.rows[0],
    messages: messages.rows.reverse(),
    hasMore: messages.rows.length === 50,
  };
}

export async function markThreadRead(userId: string, rootId: string) {
  const thread = await getThread(userId, rootId);
  await query(
    `INSERT INTO thread_reads(user_id,root_id,last_read_at) VALUES($1,$2,now()) ON CONFLICT(user_id,root_id) DO UPDATE SET last_read_at=now()`,
    [userId, rootId],
  );
  return { channelId: thread.root.channelId };
}

export async function toggleSavedMessage(userId: string, messageId: string, pin: boolean) {
  const target = (await getMessageContext(userId, messageId)).target;
  await requireChannelAccess(userId, target.channelId, false, pin);
  if (pin) {
    const role = await query(
      `SELECT 1 FROM channel_access WHERE channel_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
      [target.channelId, userId],
    );
    if (!role.rowCount) throw new HttpError(403, "FORBIDDEN", "Chỉ quản trị viên có thể ghim tin.");
  }
  await withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
      `${pin ? "pin" : "bookmark"}:${messageId}:${pin ? "" : userId}`,
    ]);
    await client.query(
      `SELECT w.id FROM workspaces w JOIN channels c ON c.workspace_id=w.id WHERE c.id=$1 FOR SHARE OF w`,
      [target.channelId],
    );
    const allowed = await client.query(
      `SELECT 1 FROM channel_access access JOIN messages m ON m.channel_id=access.channel_id WHERE access.user_id=$1 AND m.id=$2 AND m.deleted_at IS NULL AND (m.thread_root_id IS NULL OR EXISTS(SELECT 1 FROM messages active_root WHERE active_root.id=m.thread_root_id AND active_root.deleted_at IS NULL)) AND ($3::boolean=false OR (access.can_write AND access.role IN ('owner','admin')))`,
      [userId, messageId, pin],
    );
    if (!allowed.rowCount)
      throw new HttpError(403, "FORBIDDEN", "Quyền truy cập tin nhắn đã thay đổi.");
    if (pin) {
      const deleted = await client.query(
        `DELETE FROM message_pins WHERE message_id=$1 RETURNING message_id`,
        [messageId],
      );
      if (!deleted.rowCount)
        await client.query(`INSERT INTO message_pins(message_id,pinned_by) VALUES($1,$2)`, [
          messageId,
          userId,
        ]);
    } else {
      const deleted = await client.query(
        `DELETE FROM message_bookmarks WHERE message_id=$1 AND user_id=$2 RETURNING message_id`,
        [messageId, userId],
      );
      if (!deleted.rowCount)
        await client.query(`INSERT INTO message_bookmarks(message_id,user_id) VALUES($1,$2)`, [
          messageId,
          userId,
        ]);
    }
  });
  return { channelId: target.channelId };
}

export async function listSavedMessages(
  userId: string,
  channelId: string,
  kind: "pins" | "bookmarks",
) {
  await requireChannelAccess(userId, channelId);
  return (
    await query<ChatMessageItem>(
      `${messageProjection} WHERE m.channel_id=$2 AND m.deleted_at IS NULL AND (m.thread_root_id IS NULL OR EXISTS(SELECT 1 FROM messages active_root WHERE active_root.id=m.thread_root_id AND active_root.deleted_at IS NULL)) AND ${kind === "pins" ? "EXISTS(SELECT 1 FROM message_pins WHERE message_id=m.id)" : "EXISTS(SELECT 1 FROM message_bookmarks WHERE message_id=m.id AND user_id=$1)"} ORDER BY m.created_at DESC,m.id DESC LIMIT 100`,
      [userId, channelId],
    )
  ).rows;
}

export async function listNotifications(userId: string, before?: string, unread = false) {
  if (before) validateId(before);
  const items = await query(
    `SELECT n.id,n.kind,n.read_at AS "readAt",n.created_at AS "createdAt",m.id AS "messageId",m.content,m.thread_root_id AS "threadRootId",c.id AS "channelId",c.name AS "channelName",c.workspace_id AS "workspaceId",u.display_name AS "authorName" FROM notifications n JOIN messages m ON m.id=n.message_id AND m.deleted_at IS NULL AND (m.thread_root_id IS NULL OR EXISTS(SELECT 1 FROM messages active_root WHERE active_root.id=m.thread_root_id AND active_root.deleted_at IS NULL)) JOIN channels c ON c.id=m.channel_id JOIN channel_access access ON access.channel_id=c.id AND access.user_id=$1 JOIN users u ON u.id=m.author_id WHERE n.user_id=$1 AND ($3::boolean=false OR n.read_at IS NULL) AND ($2::uuid IS NULL OR (n.created_at,n.id)<(SELECT created_at,id FROM notifications WHERE id=$2 AND user_id=$1)) ORDER BY n.created_at DESC,n.id DESC LIMIT 30`,
    [userId, before ?? null, unread],
  );
  const count = await query<{ total: number }>(
    `SELECT count(*)::integer AS total FROM notifications n JOIN messages m ON m.id=n.message_id AND m.deleted_at IS NULL AND (m.thread_root_id IS NULL OR EXISTS(SELECT 1 FROM messages active_root WHERE active_root.id=m.thread_root_id AND active_root.deleted_at IS NULL)) JOIN channel_access access ON access.channel_id=m.channel_id AND access.user_id=$1 WHERE n.user_id=$1 AND n.read_at IS NULL`,
    [userId],
  );
  return { items: items.rows, unreadCount: count.rows[0].total, hasMore: items.rows.length === 30 };
}

export async function markNotificationsRead(userId: string, id?: string) {
  if (id) validateId(id);
  await query(
    `UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=$1 AND ($2::uuid IS NULL OR id=$2)`,
    [userId, id ?? null],
  );
}

export async function workspaceNotificationPreference(
  userId: string,
  workspaceId: string,
  muted?: unknown,
) {
  validateId(workspaceId);
  if (
    !(
      await query(`SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2`, [
        workspaceId,
        userId,
      ])
    ).rowCount
  )
    throw new HttpError(403, "FORBIDDEN", "Bạn không thuộc nhóm này.");
  if (muted !== undefined) {
    if (typeof muted !== "boolean")
      throw new HttpError(400, "INVALID_INPUT", "Mute phải là boolean.");
    await query(
      `INSERT INTO workspace_notification_preferences(workspace_id,user_id,muted) VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET muted=$3`,
      [workspaceId, userId, muted],
    );
  }
  const value = await query<{ muted: boolean }>(
    `SELECT muted FROM workspace_notification_preferences WHERE workspace_id=$1 AND user_id=$2`,
    [workspaceId, userId],
  );
  return { muted: value.rows[0]?.muted ?? false };
}

export async function filteredMessageSearch(userId: string, params: URLSearchParams) {
  const term = (params.get("q") ?? "").trim();
  if (term.length < 2 || term.length > 100)
    throw new HttpError(400, "INVALID_SEARCH", "Từ khóa cần 2–100 ký tự.");
  const workspaceId = params.get("workspace"),
    channelId = params.get("channel"),
    authorId = params.get("author"),
    cursor = params.get("before");
  for (const id of [workspaceId, channelId, authorId, cursor]) if (id) validateId(id);
  const from = params.get("from"),
    to = params.get("to");
  for (const time of [from, to])
    if (time && (!Number.isFinite(Date.parse(time)) || !/^\d{4}-\d{2}-\d{2}/.test(time)))
      throw new HttpError(400, "INVALID_DATE", "Ngày tìm kiếm không hợp lệ.");
  if (from && to && Date.parse(from) > Date.parse(to))
    throw new HttpError(400, "INVALID_DATE", "Ngày bắt đầu phải trước ngày kết thúc.");
  if (
    cursor &&
    !(
      await query(
        `SELECT 1 FROM messages m JOIN channel_access access ON access.channel_id=m.channel_id AND access.user_id=$1 WHERE m.id=$2`,
        [userId, cursor],
      )
    ).rowCount
  )
    throw new HttpError(400, "INVALID_CURSOR", "Mốc tìm kiếm không hợp lệ.");
  const file = params.get("file");
  if (file && !["image", "audio", "document", "any"].includes(file))
    throw new HttpError(400, "INVALID_FILE_FILTER", "Loại tệp không hợp lệ.");
  const messages = await query<GlobalMessageSearchItem>(
    `SELECT m.id,c.workspace_id AS "workspaceId",w.name AS "workspaceName",c.id AS "channelId",c.name AS "channelName",m.author_id AS "authorId",u.display_name AS "authorName",m.content,m.created_at AS "createdAt",m.thread_root_id AS "threadRootId" FROM messages m JOIN channels c ON c.id=m.channel_id JOIN workspaces w ON w.id=c.workspace_id JOIN users u ON u.id=m.author_id JOIN channel_access access ON access.channel_id=c.id AND access.user_id=$1 LEFT JOIN message_attachments a ON a.id=m.attachment_id WHERE m.deleted_at IS NULL AND (m.thread_root_id IS NULL OR EXISTS(SELECT 1 FROM messages active_root WHERE active_root.id=m.thread_root_id AND active_root.deleted_at IS NULL)) AND m.content ILIKE '%'||$2||'%' ESCAPE '\\' AND ($3::uuid IS NULL OR c.workspace_id=$3) AND ($4::uuid IS NULL OR c.id=$4) AND ($5::uuid IS NULL OR m.author_id=$5) AND ($6::timestamptz IS NULL OR m.created_at>=$6) AND ($7::timestamptz IS NULL OR m.created_at<=$7) AND ($8::uuid IS NULL OR (m.created_at,m.id)<(SELECT created_at,id FROM messages WHERE id=$8)) AND ($9::text IS NULL OR ($9='any' AND a.id IS NOT NULL) OR ($9='image' AND a.mime_type LIKE 'image/%') OR ($9='audio' AND a.mime_type LIKE 'audio/%') OR ($9='document' AND a.mime_type NOT LIKE 'image/%' AND a.mime_type NOT LIKE 'audio/%')) ORDER BY m.created_at DESC,m.id DESC LIMIT 30`,
    [
      userId,
      term.replace(/[\\%_]/g, "\\$&"),
      workspaceId,
      channelId,
      authorId,
      from,
      to,
      cursor,
      file,
    ],
  );
  return { messages: messages.rows, hasMore: messages.rows.length === 30 };
}
