import { randomUUID } from "node:crypto";
import type { DirectConversationItem, DirectFileItem, DirectUserItem } from "@doan/shared";
import { query, withTransaction } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";
import { validateId } from "../workspaces/service.js";

// Same shape as a workspace channel row, so the chat page can list and open it like any channel.
const conversationProjection = `SELECT c.id, c.workspace_id AS "workspaceId", peer.display_name AS name, c.type, 0 AS position,
    c.archived_at AS "archivedAt", 'direct' AS kind,
    json_build_object('userId', peer.id, 'displayName', peer.display_name, 'email', peer.email) AS peer,
    COALESCE(cp.pinned, false) AS pinned, COALESCE(cp.muted, false) AS muted,
    (SELECT count(*)::integer FROM messages unread
      WHERE unread.channel_id = c.id AND unread.deleted_at IS NULL AND unread.author_id <> $1
        AND unread.created_at > COALESCE(cp.last_read_at, 'epoch'::timestamptz)) AS "unreadCount",
    CASE WHEN latest.id IS NULL THEN NULL ELSE json_build_object(
      'id', latest.id, 'channelId', c.id, 'authorId', latest.author_id,
      'authorName', author.display_name, 'content', latest.content, 'createdAt', latest.created_at
    ) END AS "lastMessage"
  FROM direct_conversations d
  JOIN channels c ON c.id = d.channel_id
  JOIN users peer ON peer.id = CASE WHEN d.user_low = $1 THEN d.user_high ELSE d.user_low END
  LEFT JOIN channel_preferences cp ON cp.channel_id = c.id AND cp.user_id = $1
  LEFT JOIN LATERAL (
    SELECT m.id, m.author_id, m.content, m.created_at FROM messages m
    WHERE m.channel_id = c.id AND m.deleted_at IS NULL AND m.thread_root_id IS NULL
    ORDER BY m.created_at DESC, m.id DESC LIMIT 1
  ) latest ON true
  LEFT JOIN users author ON author.id = latest.author_id
  WHERE $1 IN (d.user_low, d.user_high)`;

export async function listDirectConversations(userId: string) {
  const result = await query<DirectConversationItem>(
    `${conversationProjection} ORDER BY COALESCE(latest.created_at, d.created_at) DESC, c.id LIMIT 100`,
    [userId],
  );
  return result.rows;
}

export async function openDirectConversation(userId: string, otherUserId: unknown) {
  validateId(otherUserId);
  if (otherUserId === userId)
    throw new HttpError(400, "INVALID_PEER", "Không thể nhắn tin trực tiếp với chính mình.");
  if (!(await query(`SELECT 1 FROM users WHERE id=$1`, [otherUserId])).rowCount)
    throw new HttpError(404, "USER_NOT_FOUND", "Không tìm thấy người dùng.");
  const [low, high] = userId < otherUserId ? [userId, otherUserId] : [otherUserId, userId];
  const channelId = await withTransaction(async (client) => {
    // Serialise concurrent opens of the same pair; the unique pair is the final guard.
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`direct:${low}:${high}`]);
    const existing = await client.query<{ channel_id: string }>(
      `SELECT channel_id FROM direct_conversations WHERE user_low=$1 AND user_high=$2`,
      [low, high],
    );
    if (existing.rowCount) return existing.rows[0].channel_id;
    const id = randomUUID();
    await client.query(
      `INSERT INTO channels(id,workspace_id,created_by,name,type,position,kind) VALUES($1,NULL,$2,'direct','text',0,'direct')`,
      [id, userId],
    );
    await client.query(
      `INSERT INTO direct_conversations(channel_id,user_low,user_high) VALUES($1,$2,$3)`,
      [id, low, high],
    );
    return id;
  });
  const result = await query<DirectConversationItem>(`${conversationProjection} AND c.id=$2`, [
    userId,
    channelId,
  ]);
  return result.rows[0];
}

export async function searchDirectUsers(userId: string, value: string) {
  const term = value.trim();
  if (term.length < 2 || term.length > 100)
    throw new HttpError(400, "INVALID_SEARCH", "Từ khóa cần 2–100 ký tự.");
  const result = await query<DirectUserItem>(
    `SELECT id AS "userId", display_name AS "displayName", email FROM users
     WHERE id <> $1 AND (display_name ILIKE '%'||$2||'%' ESCAPE '\\' OR email ILIKE '%'||$2||'%' ESCAPE '\\')
     ORDER BY display_name, id LIMIT 10`,
    [userId, term.replace(/[\\%_]/g, "\\$&")],
  );
  return result.rows;
}

/** Files in one of the user's direct conversations; anyone else gets an empty list. */
export async function listDirectFiles(userId: string, channelId: string, limit = 20) {
  validateId(channelId);
  const safeLimit = Math.max(1, Math.min(Number.isInteger(limit) ? limit : 20, 50));
  const result = await query<DirectFileItem>(
    `SELECT a.id, a.file_name AS "fileName", a.mime_type AS "mimeType", a.file_size AS "fileSize",
       a.created_at AS "createdAt", m.id AS "messageId", u.display_name AS "uploaderName"
     FROM direct_conversations d
     JOIN message_attachments a ON a.channel_id = d.channel_id
     JOIN messages m ON m.id = a.message_id AND m.deleted_at IS NULL
     JOIN users u ON u.id = a.uploader_id
     WHERE d.channel_id = $2 AND $1 IN (d.user_low, d.user_high)
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $3`,
    [userId, channelId, safeLimit],
  );
  return result.rows;
}
