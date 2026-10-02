import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../../infrastructure/database/db.js";
import { config } from "../../config/config.js";
import { HttpError } from "../../shared/http/http-error.js";
import { requireChannelAccess, getAttachmentMetadata } from "../workspaces/service.js";
import { putObject, readObject, deleteObject } from "./storage.js";
import { validateFile } from "./validation.js";
export async function uploadFile(
  userId: string,
  channelId: string,
  fileName: string,
  mimeType: string,
  data: Buffer,
) {
  await requireChannelAccess(userId, channelId, false, true);
  if (!data.length || data.length > 8000000)
    throw new HttpError(413, "INVALID_SIZE", "Tệp cần có nội dung và không quá 8 MB.");
  validateFile(data, mimeType);
  const id = randomUUID(),
    provider = process.env.FILE_STORAGE_PROVIDER ?? "db";
  if (!["db", "s3"].includes(provider)) throw new Error("FILE_STORAGE_PROVIDER must be db or s3");
  let key: string | null = null;
  try {
    await withTransaction(async (client) => {
      const scope = (
        await client.query(`SELECT workspace_id FROM channels WHERE id=$1`, [channelId])
      ).rows[0];
      await client.query(`SELECT id FROM workspaces WHERE id=$1 FOR UPDATE`, [scope?.workspace_id]);
      if (
        !(
          await client.query(
            `SELECT 1 FROM channel_access WHERE channel_id=$1 AND user_id=$2 AND can_write`,
            [channelId, userId],
          )
        ).rowCount
      )
        throw new HttpError(403, "FORBIDDEN", "Bạn không còn quyền tải tệp lên.");
      const usage = (
        await client.query(
          `SELECT COALESCE(sum(a.file_size),0)::bigint AS workspace_bytes,COALESCE(sum(a.file_size) FILTER(WHERE a.uploader_id=$2),0)::bigint AS user_bytes FROM message_attachments a JOIN channels c ON c.id=a.channel_id WHERE c.workspace_id=$1`,
          [scope.workspace_id, userId],
        )
      ).rows[0];
      if (Number(usage.workspace_bytes) + data.length > config.fileQuotaBytes)
        throw new HttpError(413, "QUOTA_EXCEEDED", "Nhóm đã đạt giới hạn dung lượng tệp.");
      // Per-user budget is per workspace so one workspace cannot consume another's allowance.
      if (Number(usage.user_bytes) + data.length > config.userFileQuotaBytes)
        throw new HttpError(413, "USER_QUOTA_EXCEEDED", "Bạn đã đạt giới hạn tải tệp trong nhóm.");
      if (provider === "s3") {
        key = `workspaces/${scope.workspace_id}/${id}`;
        await putObject(key, data, mimeType);
      }
      await client.query(
        `INSERT INTO message_attachments(id,channel_id,uploader_id,file_name,mime_type,file_size,data,storage_provider,object_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          channelId,
          userId,
          fileName,
          mimeType,
          data.length,
          provider === "db" ? data : null,
          provider,
          key,
        ],
      );
    });
  } catch (error) {
    if (key) {
      const objectKey = key;
      await deleteObject(objectKey).catch(() =>
        query(
          `INSERT INTO storage_cleanup(id,object_key) VALUES($1,$2) ON CONFLICT(object_key) DO NOTHING`,
          [randomUUID(), objectKey],
        ),
      );
    }
    throw error;
  }
  return { id, fileName, mimeType, fileSize: data.length };
}
export async function downloadFile(userId: string, id: string) {
  const metadata = await getAttachmentMetadata(userId, id);
  const record = (
    await query<{ data: Buffer | null; storage_provider: string; object_key: string | null }>(
      `SELECT data,storage_provider,object_key FROM message_attachments WHERE id=$1`,
      [id],
    )
  ).rows[0];
  const data = record?.data ?? (record?.object_key ? await readObject(record.object_key) : null);
  if (!data || data.length !== metadata.fileSize)
    throw new HttpError(503, "STORAGE_UNAVAILABLE", "Tệp tạm thời không đọc được.");
  // Object reads can take seconds. Recheck permission before sending bytes.
  await getAttachmentMetadata(userId, id);
  return { metadata, data };
}
