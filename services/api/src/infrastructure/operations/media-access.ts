import { randomUUID } from "node:crypto";
import { query } from "../database/db.js";

/** One row per listen/view; written only after the access check passed. */
export async function logMediaAccess(
  userId: string,
  kind: "call" | "voicemail" | "meeting",
  refId: string,
) {
  await query(`INSERT INTO media_access_log(id,user_id,kind,ref_id) VALUES($1,$2,$3,$4)`, [
    randomUUID(),
    userId,
    kind,
    refId,
  ]);
}
