import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { TaskItem, TaskDetail } from "@doan/shared";
import { query, withTransaction } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";
import { validateId } from "../workspaces/service.js";

const projection = `SELECT t.id,t.channel_id AS "channelId",t.title,t.description,t.status,t.priority,t.due_at AS "dueAt",t.assignee_id AS "assigneeId",u.display_name AS "assigneeName",t.source_message_id AS "sourceMessageId",t.meeting_session_id AS "meetingSessionId",t.position::float8 AS position,t.version,t.archived_at AS "archivedAt",t.updated_at AS "updatedAt",(SELECT count(*)::integer FROM task_checklist WHERE task_id=t.id) AS "checklistTotal",(SELECT count(*)::integer FROM task_checklist WHERE task_id=t.id AND done) AS "checklistDone" FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id JOIN channel_access access ON access.channel_id=t.channel_id AND access.user_id=$1`;
const priorities = ["low", "normal", "high", "urgent"];
function text(value: unknown, max: number, required = false) {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim()))
    throw new HttpError(400, "INVALID_TASK", "Nội dung nhiệm vụ không hợp lệ.");
  return value.trim();
}
function choice(value: unknown, values: string[]) {
  if (typeof value !== "string" || !values.includes(value))
    throw new HttpError(400, "INVALID_TASK", "Trạng thái hoặc ưu tiên không hợp lệ.");
  return value;
}
function due(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new HttpError(400, "INVALID_TASK", "Hạn chót không hợp lệ.");
  return new Date(value).toISOString();
}
async function boardLock(client: PoolClient, userId: string, channelId: string) {
  await client.query(
    `SELECT w.id FROM workspaces w JOIN channels c ON c.workspace_id=w.id WHERE c.id=$1 FOR SHARE OF w`,
    [channelId],
  );
  await client.query(`SELECT id FROM channels WHERE id=$1 FOR UPDATE`, [channelId]);
  const allowed = await client.query(
    `SELECT can_write,type FROM channel_access WHERE user_id=$1 AND channel_id=$2`,
    [userId, channelId],
  );
  if (!allowed.rowCount) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền truy cập bảng.");
  if (!allowed.rows[0].can_write)
    throw new HttpError(409, "ARCHIVED", "Nhóm hoặc kênh đã lưu trữ.");
  if (allowed.rows[0].type !== "text")
    throw new HttpError(400, "INVALID_CHANNEL", "Bảng công việc thuộc kênh văn bản.");
}
async function assignee(client: PoolClient, channelId: string, value: unknown) {
  if (value === null || value === "") return null;
  validateId(value);
  if (
    !(
      await client.query(`SELECT 1 FROM channel_access WHERE channel_id=$1 AND user_id=$2`, [
        channelId,
        value,
      ])
    ).rowCount
  )
    throw new HttpError(400, "INVALID_ASSIGNEE", "Người phụ trách phải hiện có quyền đọc kênh.");
  return value as string;
}
async function log(
  client: PoolClient,
  taskId: string,
  userId: string,
  action: string,
  details: unknown = {},
) {
  await client.query(
    `INSERT INTO task_activity(id,task_id,actor_id,action,details) VALUES($1,$2,$3,$4,$5::jsonb)`,
    [randomUUID(), taskId, userId, action, JSON.stringify(details)],
  );
}

async function getTask(userId: string, taskId: string): Promise<TaskDetail> {
  validateId(taskId);
  const task = await query<TaskItem>(`${projection} WHERE t.id=$2`, [userId, taskId]);
  if (!task.rowCount)
    throw new HttpError(
      404,
      "TASK_NOT_FOUND",
      "Nhiệm vụ không tồn tại hoặc bạn không có quyền xem.",
    );
  const checklist = await query(
    `SELECT id,label,done FROM task_checklist WHERE task_id=$1 ORDER BY position,id`,
    [taskId],
  );
  const comments = await query(
    `SELECT c.id,c.author_id AS "authorId",u.display_name AS "authorName",c.content,c.created_at AS "createdAt" FROM task_comments c JOIN users u ON u.id=c.author_id WHERE task_id=$1 ORDER BY c.created_at DESC,c.id DESC LIMIT 100`,
    [taskId],
  );
  const attachments = await query(
    `SELECT a.id,a.file_name AS "fileName",a.mime_type AS "mimeType",a.file_size AS "fileSize" FROM task_attachments link JOIN message_attachments a ON a.id=link.attachment_id WHERE task_id=$1 ORDER BY a.created_at,a.id`,
    [taskId],
  );
  const activity = await query(
    `SELECT a.id,u.display_name AS "actorName",a.action,a.details,a.created_at AS "createdAt" FROM task_activity a JOIN users u ON u.id=a.actor_id WHERE task_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 100`,
    [taskId],
  );
  return {
    ...task.rows[0],
    checklist: checklist.rows,
    comments: comments.rows.reverse(),
    attachments: attachments.rows,
    activity: activity.rows,
  } as TaskDetail;
}
export async function createTask(
  userId: string,
  channelId: string,
  body: Record<string, unknown>,
  links: { meetingSessionId?: string } = {},
) {
  validateId(channelId);
  validateId(body.clientTaskId);
  const title = text(body.title, 160, true),
    description = text(body.description ?? "", 8000);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        channelId,
        title,
        description,
        choice(body.priority ?? "normal", priorities),
        due(body.dueAt ?? null),
        body.assigneeId ?? null,
        body.sourceMessageId ?? null,
        // Appended only when present so fingerprints of older tasks stay valid.
        ...(links.meetingSessionId ? [links.meetingSessionId] : []),
      ]),
    )
    .digest("hex");
  const taskId = await withTransaction(async (client) => {
    await boardLock(client, userId, channelId);
    const previous = await client.query(
      `SELECT t.id,t.channel_id,t.title,(SELECT details->>'createFingerprint' FROM task_activity WHERE task_id=t.id AND action='created' ORDER BY created_at LIMIT 1) AS fingerprint FROM tasks t WHERE created_by=$1 AND client_task_id=$2`,
      [userId, body.clientTaskId],
    );
    if (previous.rowCount) {
      if (
        previous.rows[0].channel_id !== channelId ||
        (previous.rows[0].fingerprint
          ? previous.rows[0].fingerprint !== fingerprint
          : previous.rows[0].title !== title)
      )
        throw new HttpError(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Mã tạo nhiệm vụ đã dùng cho nội dung khác.",
        );
      return previous.rows[0].id as string;
    }
    const assigned = await assignee(client, channelId, body.assigneeId ?? null);
    if (body.sourceMessageId) {
      validateId(body.sourceMessageId);
      if (
        !(
          await client.query(
            `SELECT 1 FROM messages WHERE id=$1 AND channel_id=$2 AND deleted_at IS NULL`,
            [body.sourceMessageId, channelId],
          )
        ).rowCount
      )
        throw new HttpError(400, "INVALID_SOURCE", "Tin nguồn không thuộc kênh hoặc đã xóa.");
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO tasks(id,channel_id,created_by,client_task_id,title,description,priority,due_at,assignee_id,source_message_id,meeting_session_id,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,(SELECT COALESCE(max(position),0)+1024 FROM tasks WHERE channel_id=$2 AND status='todo'))`,
      [
        id,
        channelId,
        userId,
        body.clientTaskId,
        title,
        description,
        choice(body.priority ?? "normal", priorities),
        due(body.dueAt ?? null),
        assigned,
        body.sourceMessageId ?? null,
        links.meetingSessionId ?? null,
      ],
    );
    await log(client, id, userId, "created", {
      createFingerprint: fingerprint,
      ...(links.meetingSessionId ? { meetingSessionId: links.meetingSessionId } : {}),
    });
    return id;
  });
  return getTask(userId, taskId);
}
