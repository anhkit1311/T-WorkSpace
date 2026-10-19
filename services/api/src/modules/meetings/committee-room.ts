import { query } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";
import { requireChannelAccess, validateId } from "../workspaces/service.js";
import { committeeRoom } from "../academic/evaluation.js";

// MT-3: a session started from a schedule that names a defense committee is a committee room.
// Members get the academic score sheets there; everyone else (students, guests) just meets.
export async function sessionCommittee(userId: string, sessionId: unknown) {
  validateId(sessionId);
  const session = (
    await query<{ channel_id: string; committee_id: string | null }>(
      `SELECT s.channel_id,sc.committee_id FROM meeting_sessions s LEFT JOIN meeting_schedules sc ON sc.id=s.schedule_id WHERE s.id=$1`,
      [sessionId],
    )
  ).rows[0];
  if (!session) throw new HttpError(404, "SESSION_NOT_FOUND", "Phiên họp không tồn tại.");
  await requireChannelAccess(userId, session.channel_id);
  if (!session.committee_id) return null;
  return committeeRoom(userId, session.committee_id).catch((error) => {
    if (error instanceof HttpError && error.statusCode === 403) return null;
    throw error;
  });
}
