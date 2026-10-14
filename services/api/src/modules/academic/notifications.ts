import { query } from "../../infrastructure/database/db.js";
import { invalid } from "./access.js";
import { validateId } from "../workspaces/service.js";

export async function listNotifications(userId: string, params: URLSearchParams) {
  const before = params.get("before");
  if (before && !Number.isFinite(Date.parse(before))) throw invalid("Mốc phân trang không hợp lệ.");
  const rows = await query(
    `SELECT id,kind,entity,entity_id AS "entityId",title,read_at AS "readAt",created_at AS "createdAt" FROM academic_notifications
     WHERE user_id=$1 AND ($2::timestamptz IS NULL OR created_at<$2) AND ($3::boolean IS NOT TRUE OR read_at IS NULL)
     ORDER BY created_at DESC,id DESC LIMIT 50`,
    [userId, before, params.get("unread") === "true"],
  );
  const unread = await query<{ n: number }>(`SELECT count(*)::int AS n FROM academic_notifications WHERE user_id=$1 AND read_at IS NULL`, [userId]);
  return { notifications: rows.rows, unread: unread.rows[0].n };
}

export async function markNotificationsRead(userId: string, body: Record<string, unknown>) {
  if (body.all === true) {
    await query(`UPDATE academic_notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL`, [userId]);
    return { ok: true };
  }
  if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 100) throw invalid("Cần 1–100 mã thông báo.");
  for (const value of body.ids) validateId(value);
  await query(`UPDATE academic_notifications SET read_at=now() WHERE user_id=$1 AND id=ANY($2::uuid[]) AND read_at IS NULL`, [userId, body.ids]);
  return { ok: true };
}
