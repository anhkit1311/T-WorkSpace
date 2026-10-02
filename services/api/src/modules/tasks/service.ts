import { randomUUID, createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { TaskItem, TaskDetail } from "@doan/shared";
import { query, withTransaction } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";
import { requireChannelAccess, validateId } from "../workspaces/service.js";

const projection = `SELECT t.id,t.channel_id AS "channelId",t.title,t.description,t.status,t.priority,t.due_at AS "dueAt",t.assignee_id AS "assigneeId",u.display_name AS "assigneeName",t.source_message_id AS "sourceMessageId",t.position::float8 AS position,t.version,t.archived_at AS "archivedAt",t.updated_at AS "updatedAt",(SELECT count(*)::integer FROM task_checklist WHERE task_id=t.id) AS "checklistTotal",(SELECT count(*)::integer FROM task_checklist WHERE task_id=t.id AND done) AS "checklistDone" FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id JOIN channel_access access ON access.channel_id=t.channel_id AND access.user_id=$1`;
const statuses = ["todo", "doing", "done"],
  priorities = ["low", "normal", "high", "urgent"];
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

export async function listTasks(userId: string, channelId: string, params = new URLSearchParams()) {
  await requireChannelAccess(userId, channelId);
  const status = params.get("status"),
    priority = params.get("priority"),
    assigned = params.get("assignee"),
    deadline = params.get("deadline");
  if (status) choice(status, statuses);
  if (priority) choice(priority, priorities);
  if (assigned) validateId(assigned);
  if (deadline && !["overdue", "upcoming", "none"].includes(deadline))
    throw new HttpError(400, "INVALID_FILTER", "Bộ lọc hạn không hợp lệ.");
  const rows = await query<TaskItem>(
    `${projection} WHERE t.channel_id=$2 AND ($3::text IS NULL OR t.status=$3) AND ($4::text IS NULL OR t.priority=$4) AND ($5::uuid IS NULL OR t.assignee_id=$5) AND (($6::boolean AND t.archived_at IS NOT NULL) OR (NOT $6::boolean AND t.archived_at IS NULL)) AND ($7::text IS NULL OR ($7='overdue' AND t.due_at<now() AND t.status<>'done') OR ($7='upcoming' AND t.due_at>=now() AND t.due_at<now()+interval '7 days') OR ($7='none' AND t.due_at IS NULL)) ORDER BY t.status,t.position,t.id LIMIT 501`,
    [userId, channelId, status, priority, assigned, params.get("archived") === "true", deadline],
  );
  return { tasks: rows.rows.slice(0, 500), truncated: rows.rows.length > 500 };
}
export async function getTask(userId: string, taskId: string): Promise<TaskDetail> {
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
export async function createTask(userId: string, channelId: string, body: Record<string, unknown>) {
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
      `INSERT INTO tasks(id,channel_id,created_by,client_task_id,title,description,priority,due_at,assignee_id,source_message_id,position) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,(SELECT COALESCE(max(position),0)+1024 FROM tasks WHERE channel_id=$2 AND status='todo'))`,
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
      ],
    );
    await log(client, id, userId, "created", { createFingerprint: fingerprint });
    return id;
  });
  return getTask(userId, taskId);
}
export async function mutateTask(userId: string, taskId: string, body: Record<string, unknown>) {
  const target = await getTask(userId, taskId);
  if (!Number.isInteger(body.version) || Number(body.version) < 1)
    throw new HttpError(400, "INVALID_VERSION", "Cần phiên bản nhiệm vụ hiện tại.");
  await withTransaction(async (client) => {
    await boardLock(client, userId, target.channelId);
    const locked = await client.query(`SELECT * FROM tasks WHERE id=$1 FOR UPDATE`, [taskId]);
    const current = locked.rows[0];
    if (!current) throw new HttpError(404, "TASK_NOT_FOUND", "Nhiệm vụ đã bị xóa.");
    if (current.version !== body.version)
      throw new HttpError(
        409,
        "TASK_CONFLICT",
        "Nhiệm vụ đã được người khác cập nhật. Tải lại để xem phiên bản mới.",
      );
    if (current.archived_at && body.archived !== false)
      throw new HttpError(409, "ARCHIVED", "Khôi phục nhiệm vụ trước khi chỉnh sửa.");
    const action = body.action ?? "update";
    if (action === "comment")
      await client.query(
        `INSERT INTO task_comments(id,task_id,author_id,content) VALUES($1,$2,$3,$4)`,
        [randomUUID(), taskId, userId, text(body.content, 4000, true)],
      );
    else if (action === "checklist-add") {
      if (
        (await client.query(`SELECT 1 FROM task_checklist WHERE task_id=$1`, [taskId])).rowCount! >=
        100
      )
        throw new HttpError(400, "CHECKLIST_LIMIT", "Tối đa 100 mục.");
      await client.query(
        `INSERT INTO task_checklist(id,task_id,label,position) VALUES($1,$2,$3,(SELECT COALESCE(max(position),0)+1 FROM task_checklist WHERE task_id=$2))`,
        [randomUUID(), taskId, text(body.label, 200, true)],
      );
    } else if (action === "checklist-toggle" || action === "checklist-remove") {
      validateId(body.itemId);
      const result =
        action === "checklist-remove"
          ? await client.query(`DELETE FROM task_checklist WHERE id=$1 AND task_id=$2`, [
              body.itemId,
              taskId,
            ])
          : await client.query(
              `UPDATE task_checklist SET done=NOT done WHERE id=$1 AND task_id=$2`,
              [body.itemId, taskId],
            );
      if (!result.rowCount)
        throw new HttpError(404, "ITEM_NOT_FOUND", "Mục checklist không tồn tại.");
    } else if (action === "attachment-add" || action === "attachment-remove") {
      validateId(body.attachmentId);
      if (action === "attachment-add") {
        const file = await client.query(
          `SELECT 1 FROM message_attachments WHERE id=$1 AND channel_id=$2 AND uploader_id=$3`,
          [body.attachmentId, target.channelId, userId],
        );
        if (!file.rowCount)
          throw new HttpError(400, "INVALID_ATTACHMENT", "Tệp phải được bạn tải trong cùng kênh.");
        await client.query(
          `INSERT INTO task_attachments(task_id,attachment_id,attached_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
          [taskId, body.attachmentId, userId],
        );
      } else
        await client.query(`DELETE FROM task_attachments WHERE task_id=$1 AND attachment_id=$2`, [
          taskId,
          body.attachmentId,
        ]);
    } else if (action === "update") {
      const title = body.title === undefined ? current.title : text(body.title, 160, true),
        description =
          body.description === undefined ? current.description : text(body.description, 8000),
        status = body.status === undefined ? current.status : choice(body.status, statuses),
        priority =
          body.priority === undefined ? current.priority : choice(body.priority, priorities),
        dueAt = body.dueAt === undefined ? current.due_at : due(body.dueAt),
        assigned =
          body.assigneeId === undefined
            ? current.assignee_id
            : await assignee(client, target.channelId, body.assigneeId);
      if (body.archived !== undefined && typeof body.archived !== "boolean")
        throw new HttpError(400, "INVALID_TASK", "Lưu trữ phải là boolean.");
      let position = current.position;
      if (status !== current.status || body.beforeTaskId !== undefined) {
        const rows = await client.query<{ id: string }>(
          `SELECT id FROM tasks WHERE channel_id=$1 AND status=$2 AND archived_at IS NULL AND id<>$3 ORDER BY position,id FOR UPDATE`,
          [target.channelId, status, taskId],
        );
        const ids = rows.rows.map((row) => row.id);
        let index = ids.length;
        if (body.beforeTaskId) {
          validateId(body.beforeTaskId);
          index = ids.indexOf(body.beforeTaskId as string);
          if (index < 0) throw new HttpError(400, "INVALID_ORDER", "Mốc sắp xếp không thuộc cột.");
        }
        ids.splice(index, 0, taskId);
        for (let i = 0; i < ids.length; i++) {
          if (ids[i] === taskId) position = (i + 1) * 1024;
          else
            await client.query(`UPDATE tasks SET position=$2 WHERE id=$1`, [
              ids[i],
              (i + 1) * 1024,
            ]);
        }
      }
      await client.query(
        `UPDATE tasks SET title=$2,description=$3,status=$4,priority=$5,due_at=$6,assignee_id=$7,position=$8,archived_at=CASE WHEN $9::boolean=true THEN COALESCE(archived_at,now()) WHEN $9::boolean=false THEN NULL ELSE archived_at END WHERE id=$1`,
        [
          taskId,
          title,
          description,
          status,
          priority,
          dueAt,
          assigned,
          position,
          body.archived ?? null,
        ],
      );
    } else throw new HttpError(400, "INVALID_ACTION", "Thao tác nhiệm vụ không hợp lệ.");
    await client.query(`UPDATE tasks SET version=version+1,updated_at=now() WHERE id=$1`, [taskId]);
    await log(client, taskId, userId, String(action), {
      fields: Object.keys(body).filter(
        (key) => !["version", "content", "description", "title"].includes(key),
      ),
      previousStatus: current.status,
      status: body.status ?? current.status,
    });
  });
  return getTask(userId, taskId);
}
