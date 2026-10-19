import { randomInt } from "node:crypto";
import { config } from "../../config/config.js";
import { query } from "../../infrastructure/database/db.js";
import { requireChannelAccess } from "../workspaces/service.js";

/** M1: the room's dial-in code, created the first time a member asks for it. */
export async function dialInInfo(userId: string, channelId: string) {
  await requireChannelAccess(userId, channelId, true);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const result = await query<{ code: string }>(
      `WITH added AS (
         INSERT INTO meeting_dial_codes (channel_id,code,created_by) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING RETURNING code)
       SELECT code FROM added UNION ALL SELECT code FROM meeting_dial_codes WHERE channel_id=$1`,
      [channelId, code, userId],
    );
    // Empty only when the random code already belongs to another room: draw again.
    if (result.rowCount) return { number: config.meetingDialInNumber, code: result.rows[0].code };
  }
  throw new Error("No free dial-in code");
}

/** The media channel a code opens; text channels and archived rooms never match. */
export async function roomByDialCode(code: string) {
  const result = await query<{ id: string; name: string }>(
    `SELECT c.id,c.name FROM meeting_dial_codes d
       JOIN channels c ON c.id=d.channel_id JOIN workspaces w ON w.id=c.workspace_id
      WHERE d.code=$1 AND c.type<>'text' AND c.archived_at IS NULL AND w.archived_at IS NULL`,
    [code],
  );
  return result.rows[0] ? { roomId: result.rows[0].id, name: result.rows[0].name } : null;
}
