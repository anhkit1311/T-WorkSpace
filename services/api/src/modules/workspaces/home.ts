import { query } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";
import { listMeetingSchedules } from "../meetings/schedules.js";
import { listNotifications } from "../chat/conversations.js";
import { validateId } from "./service.js";
import type {
  HomeSummary,
  MeetingScheduleItem,
  WorkspaceFileItem,
  WorkspaceOverviewSummary,
} from "@doan/shared";

export async function homeSummary(userId: string): Promise<HomeSummary> {
  const [tasks, schedules, notifications, unreadChannels] = await Promise.all([
    query<HomeSummary["tasks"][number]>(
      `SELECT t.id,t.title,t.status,t.priority,t.due_at AS "dueAt",c.id AS "channelId",c.name AS "channelName",c.workspace_id AS "workspaceId" FROM tasks t JOIN channels c ON c.id=t.channel_id JOIN channel_access a ON a.channel_id=c.id AND a.user_id=$1 AND a.can_write WHERE t.assignee_id=$1 AND t.archived_at IS NULL AND t.status<>'done' ORDER BY (t.due_at<now()) DESC NULLS LAST,CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,t.due_at NULLS LAST,t.updated_at DESC LIMIT 6`,
      [userId],
    ),
    listMeetingSchedules(userId),
    listNotifications(userId, undefined, true),
    // Plain channel messages create no notification rows (only mentions and thread replies
    // do), so unread messages are reported separately, matching the channel list badge.
    query<HomeSummary["unreadChannels"][number]>(
      `SELECT c.id AS "channelId", c.name AS "channelName", w.id AS "workspaceId", w.name AS "workspaceName",
         count(*)::integer AS "unreadCount", max(m.created_at) AS "lastMessageAt"
       FROM messages m
       JOIN channels c ON c.id = m.channel_id AND c.type = 'text' AND c.archived_at IS NULL
       JOIN workspaces w ON w.id = c.workspace_id AND w.archived_at IS NULL
       JOIN channel_access access ON access.channel_id = c.id AND access.user_id = $1
       LEFT JOIN channel_preferences cp ON cp.channel_id = c.id AND cp.user_id = $1
       WHERE m.deleted_at IS NULL AND m.author_id <> $1
         AND m.created_at > COALESCE(cp.last_read_at, 'epoch'::timestamptz)
       GROUP BY c.id, w.id
       ORDER BY max(m.created_at) DESC`,
      [userId],
    ),
  ]);
  return {
    tasks: tasks.rows,
    meetings: schedules.slice(0, 4),
    unreadNotifications: notifications.unreadCount,
    unreadMessages: unreadChannels.rows.reduce((total, row) => total + row.unreadCount, 0),
    unreadChannels: unreadChannels.rows.slice(0, 5),
  };
}

async function requireWorkspaceMembership(userId: string, workspaceId: string): Promise<void> {
  validateId(workspaceId);
  const member = await query(
    `SELECT 1 FROM memberships WHERE workspace_id = $1 AND user_id = $2`,
    [workspaceId, userId],
  );
  if (!member.rowCount) {
    throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền truy cập workspace này.");
  }
}

export async function listWorkspaceFiles(
  userId: string,
  workspaceId: string | null,
  before?: string,
  limit = 30,
  prioritizePinned = false,
  search?: string,
): Promise<{ files: WorkspaceFileItem[]; hasMore: boolean }> {
  // null = every group ("Tài liệu" page); channel_access below already limits it to the user's channels.
  if (workspaceId !== null) await requireWorkspaceMembership(userId, workspaceId);
  if (before !== undefined) {
    validateId(before);
  }
  const safeLimit = Math.max(1, Math.min(Number.isInteger(limit) ? limit : 30, 100));
  const result = await query<WorkspaceFileItem>(
    `SELECT
       a.id,
       a.file_name AS "fileName",
       a.mime_type AS "mimeType",
       a.file_size AS "fileSize",
       a.channel_id AS "channelId",
       c.name AS "channelName",
       c.workspace_id AS "workspaceId",
       w.name AS "workspaceName",
       a.uploader_id AS "uploaderId",
       u.display_name AS "uploaderName",
       a.created_at AS "createdAt",
       CASE WHEN m.id IS NOT NULL AND m.deleted_at IS NULL THEN m.id ELSE NULL END AS "messageId",
       task_link.task_id AS "taskId",
       task_link.task_title AS "taskTitle",
       EXISTS(SELECT 1 FROM message_pins mp WHERE mp.message_id = a.message_id) AS "pinned"
     FROM message_attachments a
     JOIN channels c ON c.id = a.channel_id
     JOIN workspaces w ON w.id = c.workspace_id
     JOIN channel_access access ON access.channel_id = c.id AND access.user_id = $1
     JOIN users u ON u.id = a.uploader_id
     LEFT JOIN messages m ON m.id = a.message_id AND m.deleted_at IS NULL
     LEFT JOIN LATERAL (
       SELECT t.id AS task_id, t.title AS task_title
       FROM task_attachments ta
       JOIN tasks t ON t.id = ta.task_id
       WHERE ta.attachment_id = a.id AND t.channel_id = a.channel_id
       ORDER BY t.updated_at DESC
       LIMIT 1
     ) task_link ON true
     WHERE ($2::uuid IS NULL OR c.workspace_id = $2)
       AND ($5::text IS NULL OR a.file_name ILIKE '%' || $5 || '%' ESCAPE '\\')
       AND (
         (m.id IS NOT NULL AND (m.thread_root_id IS NULL OR EXISTS(SELECT 1 FROM messages root WHERE root.id = m.thread_root_id AND root.deleted_at IS NULL)))
         OR task_link.task_id IS NOT NULL
       )
       AND ($3::uuid IS NULL OR (a.created_at, a.id) < (SELECT created_at, id FROM message_attachments WHERE id = $3::uuid))
     ORDER BY ${prioritizePinned ? 'EXISTS(SELECT 1 FROM message_pins mp WHERE mp.message_id = a.message_id) DESC, ' : ''}a.created_at DESC, a.id DESC
     LIMIT $4`,
    [userId, workspaceId, before ?? null, safeLimit + 1, search?.trim() ? search.trim().replace(/[\\%_]/g, "\\$&") : null],
  );
  return {
    files: result.rows.slice(0, safeLimit),
    hasMore: result.rows.length > safeLimit,
  };
}

export async function workspaceOverview(
  userId: string,
  workspaceId: string,
): Promise<WorkspaceOverviewSummary> {
  await requireWorkspaceMembership(userId, workspaceId);

  const [tasks, recentMessages, meetings, rooms, fileResult] = await Promise.all([
    query<WorkspaceOverviewSummary["tasks"][number]>(
      `SELECT
         t.id,
         t.title,
         t.status,
         t.priority,
         t.due_at AS "dueAt",
         t.assignee_id AS "assigneeId",
         u.display_name AS "assigneeName",
         c.id AS "channelId",
         c.name AS "channelName",
         c.workspace_id AS "workspaceId",
         t.version
       FROM tasks t
       JOIN channels c ON c.id = t.channel_id
       JOIN channel_access a ON a.channel_id = c.id AND a.user_id = $1
       LEFT JOIN users u ON u.id = t.assignee_id
       WHERE c.workspace_id = $2
         AND t.archived_at IS NULL
         AND t.status <> 'done'
       ORDER BY
         (t.assignee_id = $1) DESC NULLS LAST,
         (t.due_at < now()) DESC NULLS LAST,
         CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
         t.due_at ASC NULLS LAST,
         t.updated_at DESC
       LIMIT 8`,
      [userId, workspaceId],
    ),
    query<WorkspaceOverviewSummary["recentMessages"][number]>(
      `SELECT
         m.id,
         m.channel_id AS "channelId",
         c.name AS "channelName",
         m.author_id AS "authorId",
         u.display_name AS "authorName",
         m.content,
         m.created_at AS "createdAt",
         att.file_name AS "attachmentName"
       FROM messages m
       JOIN channels c ON c.id = m.channel_id
       JOIN channel_access a ON a.channel_id = c.id AND a.user_id = $1
       JOIN users u ON u.id = m.author_id
       LEFT JOIN message_attachments att ON att.id = m.attachment_id
       WHERE c.workspace_id = $2
         AND c.type = 'text'
         AND m.deleted_at IS NULL
         AND m.thread_root_id IS NULL
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 6`,
      [userId, workspaceId],
    ),
    query<MeetingScheduleItem>(
      `SELECT
         s.id,
         s.channel_id AS "roomId",
         c.workspace_id AS "workspaceId",
         c.name AS "roomName",
         w.name AS "workspaceName",
         s.created_by AS "createdBy",
         u.display_name AS "organizerName",
         s.title,
         s.description,
         s.starts_at AS "startsAt",
         s.ends_at AS "endsAt",
         (s.created_by = $1 OR a.role IN ('owner', 'admin')) AS "canManage"
       FROM meeting_schedules s
       JOIN channels c ON c.id = s.channel_id
       JOIN workspaces w ON w.id = c.workspace_id
       JOIN channel_access a ON a.channel_id = c.id AND a.user_id = $1
       JOIN users u ON u.id = s.created_by
       WHERE c.workspace_id = $2
         AND s.canceled_at IS NULL
         AND s.ends_at > now()
       ORDER BY s.starts_at ASC
       LIMIT 5`,
      [userId, workspaceId],
    ),
    query<WorkspaceOverviewSummary["rooms"][number]>(
      `SELECT
         c.id,
         c.name,
         c.type,
         COALESCE(c.description, '') AS "description"
       FROM channels c
       JOIN channel_access a ON a.channel_id = c.id AND a.user_id = $1
       WHERE c.workspace_id = $2
         AND c.type IN ('voice', 'video')
         AND c.archived_at IS NULL
       ORDER BY c.position ASC, c.created_at ASC`,
      [userId, workspaceId],
    ),
    listWorkspaceFiles(userId, workspaceId, undefined, 8, true),
  ]);

  return {
    tasks: tasks.rows,
    recentMessages: recentMessages.rows,
    meetings: meetings.rows,
    rooms: rooms.rows,
    files: fileResult.files,
  };
}

