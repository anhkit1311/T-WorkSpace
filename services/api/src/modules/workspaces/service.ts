import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
export const membershipEvents = new EventEmitter();
import type {
  ChannelItem,
  ChatMessageItem,
  GlobalMessageSearchItem,
  GroupMemberItem,
  WorkspaceItem,
} from "@doan/shared";
import { query, withTransaction } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";

export function validateId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new HttpError(400, "INVALID_ID", "Mã tài nguyên không hợp lệ.");
  }
}

export async function requireChannelAccess(
  userId: string,
  channelId: unknown,
  media = false,
  write = false,
): Promise<void> {
  validateId(channelId);
  const result = await query<{ type: string; can_write: boolean }>(
    `SELECT type,can_write FROM channel_access WHERE channel_id=$1 AND user_id=$2`,
    [channelId, userId],
  );
  if (!result.rowCount || (media && result.rows[0].type === "text")) {
    throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền truy cập kênh này.");
  }
  if ((media || write) && !result.rows[0].can_write)
    throw new HttpError(
      409,
      "CHANNEL_ARCHIVED",
      "Nhóm hoặc kênh đã lưu trữ, chỉ có thể xem lịch sử.",
    );
}

export async function getUserWorkspaces(userId: string): Promise<WorkspaceItem[]> {
  const result = await query<WorkspaceItem>(
    `SELECT w.id, w.name, w.slug, w.description, w.archived_at AS "archivedAt", m.role,
       (SELECT count(*)::integer FROM memberships mc WHERE mc.workspace_id = w.id) AS "memberCount",
       (SELECT count(*)::integer FROM messages unread
         JOIN channels c ON c.id = unread.channel_id
         LEFT JOIN channel_preferences cp ON cp.channel_id = c.id AND cp.user_id = $1
         WHERE c.workspace_id = w.id
           AND c.type = 'text'
           AND unread.deleted_at IS NULL
           AND unread.author_id <> $1
           AND EXISTS (SELECT 1 FROM channel_access access WHERE access.channel_id = c.id AND access.user_id = $1)
           AND unread.created_at > COALESCE(cp.last_read_at, 'epoch'::timestamptz)
       ) AS "unreadCount"
     FROM workspaces w
     JOIN memberships m ON m.workspace_id = w.id
     WHERE m.user_id = $1
     ORDER BY w.created_at ASC`,
    [userId],
  );
  return result.rows;
}

export async function getWorkspaceChannels(
  userId: string,
  workspaceId: string,
): Promise<ChannelItem[]> {
  validateId(workspaceId);
  const membership = await query(
    `SELECT 1 FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId],
  );
  if (!membership.rowCount) {
    throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền truy cập workspace này.");
  }

  const result = await query<ChannelItem>(
    `SELECT c.id, c.workspace_id as "workspaceId", c.name, c.type, c.position,c.description,c.is_private AS "isPrivate",c.archived_at AS "archivedAt",
       COALESCE(cp.pinned, false) AS pinned, COALESCE(cp.muted, false) AS muted,
       (SELECT count(*)::integer FROM messages unread
         WHERE unread.channel_id = c.id AND unread.deleted_at IS NULL
           AND unread.author_id <> $2
           AND unread.created_at > COALESCE(cp.last_read_at, 'epoch'::timestamptz)) AS "unreadCount",
       CASE WHEN latest.id IS NULL THEN NULL ELSE json_build_object(
         'id', latest.id, 'channelId', c.id, 'authorId', latest.author_id,
         'authorName', author.display_name, 'content', latest.content,
         'createdAt', latest.created_at
       ) END AS "lastMessage"
     FROM channels c
     LEFT JOIN channel_preferences cp ON cp.channel_id = c.id AND cp.user_id = $2
     LEFT JOIN LATERAL (
       SELECT m.id, m.author_id, m.content, m.created_at
       FROM messages m
       WHERE m.channel_id = c.id AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC, m.id DESC LIMIT 1
     ) latest ON true
     LEFT JOIN users author ON author.id = latest.author_id
     WHERE c.workspace_id = $1 AND EXISTS (SELECT 1 FROM channel_access access WHERE access.channel_id=c.id AND access.user_id=$2)
     ORDER BY c.position ASC, c.created_at ASC`,
    [workspaceId, userId],
  );
  return result.rows;
}

export async function getChannelMessages(
  userId: string,
  channelId: string,
  limit = 50,
  before?: string,
  search?: string,
  after?: string,
): Promise<ChatMessageItem[]> {
  validateId(channelId);
  await requireChannelAccess(userId, channelId);
  if (before !== undefined) {
    validateId(before);
  }
  if (after !== undefined) validateId(after);
  if (before && after) throw new HttpError(400, "INVALID_CURSOR", "Chỉ dùng một hướng phân trang.");
  if (before || after) {
    const cursor = await query(`SELECT 1 FROM messages WHERE id=$1 AND channel_id=$2`, [
      before ?? after,
      channelId,
    ]);
    if (!cursor.rowCount)
      throw new HttpError(400, "INVALID_CURSOR", "Mốc lịch sử không thuộc kênh này.");
  }
  const channelCheck = await query(
    `SELECT c.id
     FROM channels c
     JOIN memberships m ON m.workspace_id = c.workspace_id
     WHERE c.id = $1 AND m.user_id = $2`,
    [channelId, userId],
  );
  if (!channelCheck.rowCount) {
    throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền xem tin nhắn trong kênh này.");
  }

  const result = await query<{
    id: string;
    channelId: string;
    authorId: string;
    authorName: string;
    content: string;
    createdAt: string;
    seenCount: number;
  }>(
    `SELECT
       m.id,
       m.client_message_id as "clientMessageId",
       m.thread_root_id AS "threadRootId",
       m.kind, m.meeting_session_id AS "meetingSessionId",
       (SELECT count(*)::integer FROM messages child WHERE child.thread_root_id=m.id AND child.deleted_at IS NULL) AS "replyCount",
       (SELECT count(*)::integer FROM messages child WHERE child.thread_root_id=m.id AND child.deleted_at IS NULL AND child.author_id<>$4 AND child.created_at>COALESCE((SELECT last_read_at FROM thread_reads WHERE root_id=m.id AND user_id=$4),'epoch'::timestamptz)) AS "threadUnreadCount",
       EXISTS(SELECT 1 FROM message_pins WHERE message_id=m.id) AS pinned,
       EXISTS(SELECT 1 FROM message_bookmarks WHERE message_id=m.id AND user_id=$4) AS bookmarked,
       COALESCE((SELECT json_agg(json_build_object('userId',mention.user_id,'displayName',mentioned.display_name)) FROM message_mentions mention JOIN users mentioned ON mentioned.id=mention.user_id WHERE mention.message_id=m.id),'[]'::json) AS mentions,
       m.channel_id as "channelId",
       m.author_id as "authorId",
       u.display_name as "authorName",
       m.content,
       m.created_at as "createdAt", m.edited_at as "editedAt",
       (SELECT count(*)::integer FROM channel_preferences reader
         JOIN memberships member ON member.user_id=reader.user_id AND member.workspace_id=channel.workspace_id
         WHERE reader.channel_id=m.channel_id AND reader.user_id<>m.author_id
           AND reader.last_read_at>=m.created_at) AS "seenCount",
       m.reply_to_id as "replyToId", reply.content as "replyToContent",
       CASE WHEN attachment.id IS NULL THEN NULL ELSE json_build_object(
         'id', attachment.id, 'fileName', attachment.file_name,
         'mimeType', attachment.mime_type, 'fileSize', attachment.file_size
       ) END AS attachment,
       COALESCE((SELECT json_agg(json_build_object('emoji', grouped.emoji,
         'count', grouped.total, 'reacted', grouped.reacted)) FROM (
           SELECT emoji, count(*)::integer AS total, bool_or(user_id = $4) AS reacted
           FROM message_reactions WHERE message_id = m.id GROUP BY emoji
         ) grouped), '[]'::json) AS reactions
     FROM messages m
     JOIN channels channel ON channel.id=m.channel_id
     JOIN users u ON u.id = m.author_id
     LEFT JOIN messages reply ON reply.id = m.reply_to_id AND reply.deleted_at IS NULL
     LEFT JOIN message_attachments attachment ON attachment.id = m.attachment_id
     WHERE m.channel_id = $1 AND m.deleted_at IS NULL
       AND m.thread_root_id IS NULL
       AND EXISTS (SELECT 1 FROM channel_access access WHERE access.channel_id=m.channel_id AND access.user_id=$4)
       AND ($5::text IS NULL OR m.content ILIKE '%' || $5 || '%' ESCAPE '\\')
       AND ($3::uuid IS NULL OR (m.created_at, m.id) < (SELECT created_at, id FROM messages WHERE id = $3::uuid))
       AND ($6::uuid IS NULL OR (m.created_at, m.id) > (SELECT created_at, id FROM messages WHERE id = $6::uuid))
     ORDER BY ${after ? "m.created_at ASC, m.id ASC" : "m.created_at DESC, m.id DESC"}
     LIMIT $2`,
    [
      channelId,
      Math.max(1, Math.min(Number.isInteger(limit) ? limit : 50, 100)),
      before ?? null,
      userId,
      search
        ?.trim()
        .slice(0, 100)
        .replace(/[\\%_]/g, "\\$&") || null,
      after ?? null,
    ],
  );
  return after ? result.rows : result.rows.reverse();
}

export async function searchMessages(
  userId: string,
  value: string,
): Promise<GlobalMessageSearchItem[]> {
  const term = value.trim();
  if (term.length < 2 || term.length > 100)
    throw new HttpError(400, "INVALID_SEARCH", "Từ khóa tìm kiếm phải có từ 2 đến 100 ký tự.");
  const escaped = term.replace(/[\\%_]/g, "\\$&");
  const result = await query<GlobalMessageSearchItem>(
    `SELECT m.id, w.id AS "workspaceId", w.name AS "workspaceName",
       c.id AS "channelId", c.name AS "channelName", u.display_name AS "authorName",
       m.content, m.created_at AS "createdAt"
     FROM messages m
     JOIN channels c ON c.id=m.channel_id
     JOIN workspaces w ON w.id=c.workspace_id
     JOIN memberships membership ON membership.workspace_id=w.id AND membership.user_id=$1
     JOIN users u ON u.id=m.author_id
     WHERE m.deleted_at IS NULL AND EXISTS (SELECT 1 FROM channel_access access WHERE access.channel_id=c.id AND access.user_id=$1) AND m.content ILIKE '%' || $2 || '%' ESCAPE '\\'
     ORDER BY m.created_at DESC, m.id DESC LIMIT 20`,
    [userId, escaped],
  );
  return result.rows;
}

export async function saveMessage(
  userId: string,
  channelId: string,
  content: string,
  options: {
    replyToId?: string;
    attachmentId?: string;
    clientMessageId?: string;
    threadRootId?: string;
    mentionedUserIds?: string[];
  } = {},
): Promise<ChatMessageItem & { deduplicated: boolean }> {
  validateId(channelId);
  await requireChannelAccess(userId, channelId, false, true);
  if (options.clientMessageId) validateId(options.clientMessageId);
  if (typeof content !== "string")
    throw new HttpError(400, "INVALID_MESSAGE", "Tin nhắn phải là văn bản.");
  const trimmed = content.trim();
  if ((!trimmed && !options.attachmentId) || trimmed.length > 4000) {
    throw new HttpError(
      400,
      "INVALID_MESSAGE",
      "Nội dung tin nhắn không được để trống và tối đa 4000 ký tự.",
    );
  }

  const channelCheck = await query<{ authorName: string }>(
    `SELECT u.display_name as "authorName"
     FROM channels c
     JOIN memberships m ON m.workspace_id = c.workspace_id
     JOIN users u ON u.id = $2
     WHERE c.id = $1 AND m.user_id = $2`,
    [channelId, userId],
  );
  if (!channelCheck.rowCount) {
    throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền gửi tin nhắn trong kênh này.");
  }

  let replyContent: string | null = null;
  if (options.replyToId) validateId(options.replyToId);
  if (options.attachmentId) validateId(options.attachmentId);

  const messageId = randomUUID();
  const authorName = channelCheck.rows[0].authorName;
  let deduplicated = false;
  const payloadHash = createHash("sha256")
    .update(
      JSON.stringify([
        trimmed,
        options.replyToId ?? null,
        options.attachmentId ?? null,
        ...(options.threadRootId || options.mentionedUserIds?.length
          ? [options.threadRootId ?? null, options.mentionedUserIds ?? []]
          : []),
      ]),
    )
    .digest("hex");

  const result = await withTransaction(async (client) => {
    await client.query(`SELECT w.id FROM workspaces w JOIN channels c ON c.workspace_id=w.id WHERE c.id=$1 FOR SHARE OF w`,[channelId]);
    await client.query(`SELECT id FROM channels WHERE id=$1 FOR SHARE`,[channelId]);
    // Hold current membership against concurrent removal until the insert commits.
    const access = await client.query(
      `SELECT m.user_id FROM memberships m JOIN channels c ON c.workspace_id=m.workspace_id JOIN workspaces w ON w.id=c.workspace_id WHERE c.id=$1 AND m.user_id=$2 AND EXISTS (SELECT 1 FROM channel_access access WHERE access.channel_id=c.id AND access.user_id=$2 AND access.can_write) FOR SHARE OF m`,
      [channelId, userId],
    );
    if (!access.rowCount)
      throw new HttpError(403, "FORBIDDEN", "Bạn không còn quyền gửi tin nhắn.");
    if (options.clientMessageId) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `${userId}:${channelId}:${options.clientMessageId}`,
      ]);
      const previous = await client.query<{
        id: string;
        channelId: string;
        authorId: string;
        content: string;
        createdAt: string;
        payloadHash: string;
        deletedAt: string | null;
      }>(
        `SELECT id, channel_id AS "channelId", author_id AS "authorId", content, created_at AS "createdAt", client_payload_hash AS "payloadHash", deleted_at AS "deletedAt" FROM messages WHERE channel_id=$1 AND author_id=$2 AND client_message_id=$3`,
        [channelId, userId, options.clientMessageId],
      );
      if (previous.rowCount) {
        if (previous.rows[0].payloadHash !== payloadHash || previous.rows[0].deletedAt)
          throw new HttpError(
            409,
            "DELIVERY_CONFLICT",
            "Mã gửi đã được dùng cho tin khác hoặc tin đã xóa.",
          );
        deduplicated = true;
        return previous;
      }
    }
    if (options.replyToId) {
      const reply = await client.query<{ content: string }>(
        `SELECT content FROM messages WHERE id=$1 AND channel_id=$2 AND deleted_at IS NULL`,
        [options.replyToId, channelId],
      );
      if (!reply.rowCount)
        throw new HttpError(400, "INVALID_REPLY", "Tin được trả lời không còn tồn tại.");
      replyContent = reply.rows[0].content;
    }
    const { prepareConversation, createConversationNotifications } =
      await import("../chat/conversations.js");
    await prepareConversation(client, userId, channelId, options);
    if (options.attachmentId) {
      const attachment = await client.query(
        `SELECT 1 FROM message_attachments WHERE id=$1 AND channel_id=$2 AND uploader_id=$3 AND message_id IS NULL FOR UPDATE`,
        [options.attachmentId, channelId, userId],
      );
      if (!attachment.rowCount)
        throw new HttpError(400, "INVALID_ATTACHMENT", "Tệp đính kèm không hợp lệ.");
    }
    const inserted = await client.query<{
      id: string;
      channelId: string;
      authorId: string;
      content: string;
      createdAt: string;
    }>(
      `INSERT INTO messages (id, channel_id, author_id, content, reply_to_id, attachment_id, client_message_id, client_payload_hash,thread_root_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8,$9)
     RETURNING id, channel_id as "channelId", author_id as "authorId", content, created_at as "createdAt"`,
      [
        messageId,
        channelId,
        userId,
        trimmed || " ",
        options.replyToId ?? null,
        options.attachmentId ?? null,
        options.clientMessageId ?? null,
        options.clientMessageId ? payloadHash : null,
        options.threadRootId ?? null,
      ],
    );
    if (options.attachmentId)
      await client.query(`UPDATE message_attachments SET message_id=$1 WHERE id=$2`, [
        messageId,
        options.attachmentId,
      ]);
    await createConversationNotifications(client, userId, channelId, messageId, options);
    return inserted;
  });

  const row = result.rows[0];
  return {
    id: row.id,
    clientMessageId: options.clientMessageId ?? null,
    threadRootId: options.threadRootId ?? null,
    mentions: options.mentionedUserIds?.length
      ? (
          await query<{ userId: string; displayName: string }>(
            `SELECT id AS "userId",display_name AS "displayName" FROM users WHERE id=ANY($1::uuid[])`,
            [options.mentionedUserIds],
          )
        ).rows
      : [],
    deduplicated,
    channelId: row.channelId,
    authorId: row.authorId,
    authorName,
    content: row.content,
    createdAt: row.createdAt,
    seenCount: 0,
    replyToId: options.replyToId ?? null,
    replyToContent: replyContent,
    attachment: options.attachmentId
      ? await getAttachmentMetadata(userId, options.attachmentId)
      : null,
    reactions: [],
  };
}

export async function setChannelPreference(
  userId: string,
  channelId: string,
  input: { pinned?: boolean; muted?: boolean; markRead?: boolean },
) {
  await requireChannelAccess(userId, channelId);
  if (input.pinned !== undefined && typeof input.pinned !== "boolean")
    throw new HttpError(400, "INVALID_PREFERENCE", "Giá trị ghim không hợp lệ.");
  if (input.muted !== undefined && typeof input.muted !== "boolean")
    throw new HttpError(400, "INVALID_PREFERENCE", "Giá trị tắt tiếng không hợp lệ.");
  const result = await query<{ pinned: boolean; muted: boolean }>(
    `INSERT INTO channel_preferences (user_id, channel_id, pinned, muted, last_read_at)
     VALUES ($1,$2,$3,$4,CASE WHEN $5::boolean THEN now() ELSE NULL END)
     ON CONFLICT (user_id, channel_id) DO UPDATE SET
       pinned=COALESCE($6::boolean,channel_preferences.pinned),
       muted=COALESCE($7::boolean,channel_preferences.muted),
       last_read_at=CASE WHEN $5::boolean THEN now() ELSE channel_preferences.last_read_at END
     RETURNING pinned, muted`,
    [
      userId,
      channelId,
      input.pinned ?? false,
      input.muted ?? false,
      input.markRead === true,
      input.pinned ?? null,
      input.muted ?? null,
    ],
  );
  return result.rows[0];
}

export async function getChannelPreference(
  userId: string,
  channelId: string,
): Promise<{ pinned: boolean; muted: boolean; workspaceId: string }> {
  await requireChannelAccess(userId, channelId);
  // workspaceId lets a new-message toast navigate straight to the channel's workspace.
  const result = await query<{ pinned: boolean; muted: boolean; workspaceId: string }>(
    `SELECT COALESCE(cp.pinned,false) AS pinned, COALESCE(cp.muted,false) AS muted,
            ca.workspace_id AS "workspaceId"
     FROM channel_access ca
     LEFT JOIN channel_preferences cp ON cp.channel_id=ca.channel_id AND cp.user_id=ca.user_id
     WHERE ca.user_id=$1 AND ca.channel_id=$2`,
    [userId, channelId],
  );
  return result.rows[0];
}

export async function editMessage(
  userId: string,
  messageId: string,
  content: string,
): Promise<void> {
  validateId(messageId);
  await getMessageChannel(userId, messageId);
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > 4000)
    throw new HttpError(400, "INVALID_MESSAGE", "Nội dung phải có từ 1 đến 4000 ký tự.");
  const result = await query(
    `UPDATE messages SET content=$1, edited_at=now() WHERE id=$2 AND author_id=$3 AND kind='user' AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM channel_access access WHERE access.channel_id=messages.channel_id AND access.user_id=$3 AND access.can_write) RETURNING id`,
    [trimmed, messageId, userId],
  );
  if (!result.rowCount)
    throw new HttpError(404, "MESSAGE_NOT_FOUND", "Bạn chỉ có thể sửa tin nhắn của mình.");
}

export async function deleteMessage(userId: string, messageId: string): Promise<void> {
  validateId(messageId);
  await getMessageChannel(userId, messageId);
  const result = await query(
    `UPDATE messages SET deleted_at=now() WHERE id=$1 AND author_id=$2 AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM channel_access access WHERE access.channel_id=messages.channel_id AND access.user_id=$2 AND access.can_write) RETURNING id`,
    [messageId, userId],
  );
  if (!result.rowCount)
    throw new HttpError(404, "MESSAGE_NOT_FOUND", "Bạn chỉ có thể xóa tin nhắn của mình.");
}

export async function toggleReaction(
  userId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  validateId(messageId);
  if (!["👍", "❤️", "😂", "🎉", "👀"].includes(emoji))
    throw new HttpError(400, "INVALID_REACTION", "Cảm xúc không hợp lệ.");
  const access = await query<{ channelId: string }>(
    `SELECT m.channel_id AS "channelId" FROM messages m JOIN channels c ON c.id=m.channel_id JOIN memberships member ON member.workspace_id=c.workspace_id AND member.user_id=$2 WHERE m.id=$1 AND m.deleted_at IS NULL`,
    [messageId, userId],
  );
  if (!access.rowCount) throw new HttpError(404, "MESSAGE_NOT_FOUND", "Không tìm thấy tin nhắn.");
  await requireChannelAccess(userId, access.rows[0].channelId, false, true);
  await withTransaction(async client=>{
  await client.query(`SELECT w.id FROM workspaces w JOIN channels c ON c.workspace_id=w.id WHERE c.id=$1 FOR SHARE OF w`,[access.rows[0].channelId]);
  await client.query(`SELECT id FROM channels WHERE id=$1 FOR SHARE`,[access.rows[0].channelId]);
  if(!(await client.query(`SELECT m.user_id FROM memberships m JOIN channel_access a ON a.workspace_id=m.workspace_id AND a.user_id=m.user_id AND a.can_write WHERE m.user_id=$1 AND a.channel_id=$2 FOR SHARE OF m`,[userId,access.rows[0].channelId])).rowCount)throw new HttpError(403,'FORBIDDEN','Bạn không còn quyền phản hồi.');
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,[`${userId}:${messageId}:${emoji}`]);
  if(!(await client.query(`SELECT id FROM messages WHERE id=$1 AND deleted_at IS NULL FOR SHARE`,[messageId])).rowCount)throw new HttpError(404,'MESSAGE_NOT_FOUND','Tin nhắn đã bị xóa.');
  const removed = await client.query(
    `DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3 RETURNING message_id`,
    [messageId, userId, emoji],
  );
  if (!removed.rowCount)
    await client.query(`INSERT INTO message_reactions(message_id,user_id,emoji) VALUES($1,$2,$3)`, [
      messageId,
      userId,
      emoji,
    ]);
  });
}

export async function getMessageChannel(userId: string, messageId: string): Promise<string> {
  validateId(messageId);
  const result = await query<{ channelId: string }>(
    `SELECT m.channel_id AS "channelId" FROM messages m JOIN channels c ON c.id=m.channel_id JOIN memberships member ON member.workspace_id=c.workspace_id AND member.user_id=$2 WHERE m.id=$1`,
    [messageId, userId],
  );
  if (!result.rowCount) throw new HttpError(404, "MESSAGE_NOT_FOUND", "Không tìm thấy tin nhắn.");
  await requireChannelAccess(userId, result.rows[0].channelId, false, true);
  return result.rows[0].channelId;
}

export async function getAttachmentMetadata(
  userId: string,
  attachmentId: string,
): Promise<NonNullable<ChatMessageItem["attachment"]>> {
  validateId(attachmentId);
  const result = await query<{ id: string; fileName: string; mimeType: string; fileSize: number }>(
    `SELECT a.id, a.file_name AS "fileName", a.mime_type AS "mimeType", a.file_size AS "fileSize" FROM message_attachments a JOIN channel_access access ON access.channel_id=a.channel_id AND access.user_id=$2 WHERE a.id=$1 AND (EXISTS(SELECT 1 FROM messages message WHERE message.id=a.message_id AND message.deleted_at IS NULL AND (message.thread_root_id IS NULL OR EXISTS(SELECT 1 FROM messages root WHERE root.id=message.thread_root_id AND root.deleted_at IS NULL))) OR EXISTS(SELECT 1 FROM task_attachments link JOIN tasks task ON task.id=link.task_id WHERE link.attachment_id=a.id AND task.channel_id=a.channel_id))`,
    [attachmentId, userId],
  );
  if (!result.rowCount) throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Không tìm thấy tệp.");
  return result.rows[0];
}

export async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: "member" | "admin" = "member",
): Promise<void> {
  await query(
    `INSERT INTO memberships (workspace_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, user_id) DO NOTHING`,
    [workspaceId, userId, role],
  );
}

export async function removeWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
  const owner = await query(`SELECT 1 FROM workspaces WHERE id = $1 AND owner_id = $2`, [
    workspaceId,
    userId,
  ]);
  if (owner.rowCount)
    throw new HttpError(403, "OWNER_PROTECTED", "Chủ nhóm không thể rời hoặc bị loại khỏi nhóm.");
  await query(`DELETE FROM memberships WHERE workspace_id = $1 AND user_id = $2`, [
    workspaceId,
    userId,
  ]);
  membershipEvents.emit("removed", userId);
}

export async function createWorkspace(userId: string, name: string): Promise<WorkspaceItem> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) {
    throw new HttpError(400, "INVALID_NAME", "Tên nhóm không được để trống và tối đa 80 ký tự.");
  }
  const workspaceId = randomUUID();
  const baseSlug = trimmed
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const slug = `${baseSlug.slice(0, 64) || "workspace"}-${workspaceId.slice(0, 8)}`;

  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO workspaces (id, name, slug, owner_id) VALUES ($1, $2, $3, $4)`,
      [workspaceId, trimmed, slug, userId],
    );

    await client.query(
      `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [workspaceId, userId],
    );

    const defaultChannels = [
      { name: "tong-quan", pos: 1 },
      { name: "thong-bao", pos: 2 },
      { name: "y-tuong", pos: 3 },
      { name: "tai-lieu", pos: 4 },
    ];
    for (const ch of defaultChannels) {
      await client.query(
        `INSERT INTO channels (id, workspace_id, created_by, name, type, position)
         VALUES ($1, $2, $3, $4, 'text', $5)`,
        [randomUUID(), workspaceId, userId, ch.name, ch.pos],
      );
    }
    await client.query(
      `INSERT INTO channels (id, workspace_id, created_by, name, type, position) VALUES ($1, $2, $3, 'phong-hop', 'video', 5)`,
      [randomUUID(), workspaceId, userId],
    );

    return {
      id: workspaceId,
      name: trimmed,
      slug,
      role: "owner",
      memberCount: 1,
      unreadCount: 0,
    };
  });
}

export async function getWorkspaceMembers(
  userId: string,
  workspaceId: string,
): Promise<GroupMemberItem[]> {
  validateId(workspaceId);
  const memberCheck = await query(
    `SELECT 1 FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId],
  );
  if (!memberCheck.rowCount) {
    throw new HttpError(403, "FORBIDDEN", "Bạn không thuộc nhóm này.");
  }

  const result = await query<{
    id: string;
    userId: string;
    displayName: string;
    email: string;
    role: "owner" | "admin" | "member";
    joinedAt: string;
  }>(
    `SELECT
       m.user_id as "id",
       m.user_id as "userId",
       u.display_name as "displayName",
       u.email,
       m.role,
       m.joined_at as "joinedAt"
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = $1
     ORDER BY m.joined_at ASC`,
    [workspaceId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    status: "active",
    joinedAt: row.joinedAt,
  }));
}

export async function approveWorkspaceMember(
  adminUserId: string,
  workspaceId: string,
  targetUserId: string,
): Promise<void> {
  validateId(workspaceId);
  validateId(targetUserId);
  const adminCheck = await query<{ role: string }>(
    `SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, adminUserId],
  );
  if (!adminCheck.rowCount || !["owner", "admin"].includes(adminCheck.rows[0].role)) {
    throw new HttpError(403, "FORBIDDEN", "Chỉ Quản trị viên mới có quyền duyệt thành viên.");
  }

  const { changeMember } = await import("./governance.js");
  await changeMember(adminUserId, workspaceId, targetUserId, "add");
}

export async function rejectWorkspaceMember(
  adminUserId: string,
  workspaceId: string,
  targetUserId: string,
): Promise<void> {
  validateId(workspaceId);
  validateId(targetUserId);
  const adminCheck = await query<{ role: string }>(
    `SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, adminUserId],
  );
  if (!adminCheck.rowCount || !["owner", "admin"].includes(adminCheck.rows[0].role)) {
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Chỉ Quản trị viên mới có quyền từ chối hoặc loại thành viên.",
    );
  }

  const target = await query<{ role: string }>(
    `SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, targetUserId],
  );
  if (
    target.rows[0]?.role === "owner" ||
    (target.rows[0]?.role === "admin" && adminCheck.rows[0].role !== "owner")
  ) {
    throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền loại quản trị viên này.");
  }
  const { changeMember } = await import("./governance.js");
  await changeMember(adminUserId, workspaceId, targetUserId, "remove");
}
