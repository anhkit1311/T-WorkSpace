import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { MeetingState } from "@doan/shared";
import { query, withTransaction } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";
import { requireChannelAccess, validateId } from "../workspaces/service.js";
import { config } from "../../config/config.js";

async function lock(client: PoolClient, userId: string, channelId: string) {
  validateId(channelId);
  await client.query(
    `SELECT w.id FROM workspaces w JOIN channels c ON c.workspace_id=w.id WHERE c.id=$1 FOR SHARE OF w`,
    [channelId],
  );
  await client.query(`SELECT id FROM channels WHERE id=$1 FOR UPDATE`, [channelId]);
  const access = await client.query(
    `SELECT can_write,type FROM channel_access WHERE user_id=$1 AND channel_id=$2`,
    [userId, channelId],
  );
  if (!access.rowCount) throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền tham gia phòng.");
  if (!access.rows[0].can_write)
    throw new HttpError(409, "ARCHIVED", "Phòng hoặc nhóm đã lưu trữ.");
  if (!["voice", "video"].includes(access.rows[0].type))
    throw new HttpError(400, "INVALID_ROOM", "Kênh này không phải phòng họp.");
}
export async function enterSession(
  userId: string,
  channelId: string,
  socketId: string,
  instanceId: string,
  scheduleId?: string,
  affinity = false,
) {
  return withTransaction(async (client) => {
    if (affinity)
      await client.query(
        `INSERT INTO api_instances(id,media_url,expires_at) VALUES($1,$2,now()+interval '45 seconds') ON CONFLICT(id) DO UPDATE SET expires_at=EXCLUDED.expires_at,media_url=EXCLUDED.media_url`,
        [instanceId, process.env.SFU_PUBLIC_URL || null],
      );
    await lock(client, userId, channelId);
    let session = (
      await client.query(
        `SELECT * FROM meeting_sessions WHERE channel_id=$1 AND ended_at IS NULL FOR UPDATE`,
        [channelId],
      )
    ).rows[0];
    if (affinity && session?.media_instance_id && session.media_instance_id !== instanceId) {
      const owner = (
        await client.query(`SELECT media_url FROM api_instances WHERE id=$1 AND expires_at>now()`, [
          session.media_instance_id,
        ])
      ).rows[0];
      if (owner)
        throw new HttpError(
          409,
          "MEDIA_ROUTING_REQUIRED",
          `Phòng đang chạy trên máy chủ media khác${owner.media_url ? `: ${owner.media_url}` : ". Kiểm tra cấu hình định tuyến SFU."}`,
        );
      await client.query(`UPDATE meeting_sessions SET ended_at=now() WHERE id=$1`, [session.id]);
      await client.query(`DELETE FROM meeting_connections WHERE session_id=$1`, [session.id]);
      session = null;
    }
    if (scheduleId) {
      validateId(scheduleId);
      if (
        !(
          await client.query(
            `SELECT 1 FROM meeting_schedules WHERE id=$1 AND channel_id=$2 AND canceled_at IS NULL`,
            [scheduleId, channelId],
          )
        ).rowCount
      )
        throw new HttpError(400, "INVALID_SCHEDULE", "Lịch họp không thuộc phòng hoặc đã hủy.");
    }
    if (!session) {
      const id = randomUUID();
      session = (
        await client.query(
          `INSERT INTO meeting_sessions(id,channel_id,host_id,schedule_id,media_instance_id) VALUES($1,$2,$3,$4,$5) RETURNING *`,
          [id, channelId, userId, scheduleId ?? null, affinity ? instanceId : null],
        )
      ).rows[0];
    }
    if (affinity && !session.media_instance_id)
      await client.query(`UPDATE meeting_sessions SET media_instance_id=$2 WHERE id=$1`, [
        session.id,
        instanceId,
      ]);
    if (scheduleId && session.schedule_id && session.schedule_id !== scheduleId)
      throw new HttpError(409, "OTHER_SESSION", "Phòng đang có phiên họp của lịch khác.");
    const attendee = (
      await client.query(`SELECT * FROM meeting_attendees WHERE session_id=$1 AND user_id=$2`, [
        session.id,
        userId,
      ])
    ).rows[0];
    if (attendee?.state === "kicked")
      throw new HttpError(403, "MEETING_KICKED", "Bạn đã bị loại khỏi phiên họp này.");
    if (session.locked && !attendee) throw new HttpError(403, "MEETING_LOCKED", "Phòng đã khóa.");
    const connections = await client.query(
      `SELECT user_id,count(*)::integer AS tabs FROM meeting_connections WHERE session_id=$1 GROUP BY user_id`,
      [session.id],
    );
    if (
      !connections.rows.some((row) => row.user_id === userId) &&
      connections.rows.length >= config.meetingMaxUsers
    )
      throw new HttpError(409, "MEETING_FULL", "Phòng đã đủ số người tham gia.");
    if (
      (connections.rows.find((row) => row.user_id === userId)?.tabs ?? 0) >=
        config.meetingMaxTabs &&
      !(
        await client.query(
          `SELECT 1 FROM meeting_connections WHERE socket_id=$1 AND session_id=$2`,
          [socketId, session.id],
        )
      ).rowCount
    )
      throw new HttpError(409, "TAB_LIMIT", "Bạn đã mở quá nhiều tab trong phòng.");
    const state =
      attendee?.state ??
      (session.host_id === userId || !session.waiting_enabled ? "admitted" : "waiting");
    await client.query(
      `INSERT INTO meeting_attendees(session_id,user_id,role,state) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [session.id, userId, session.host_id === userId ? "host" : "member", state],
    );
    await client.query(
      `INSERT INTO meeting_connections(socket_id,session_id,user_id,instance_id) VALUES($1,$2,$3,$4) ON CONFLICT(socket_id) DO UPDATE SET session_id=$2,user_id=$3,instance_id=$4`,
      [socketId, session.id, userId, instanceId],
    );
    return { sessionId: session.id as string, state: state as "admitted" | "waiting" };
  });
}
export async function getMeetingState(
  userId: string,
  channelId: string,
): Promise<MeetingState | null> {
  await requireChannelAccess(userId, channelId, true);
  const session = await query(
    `SELECT id,channel_id AS "channelId",schedule_id AS "scheduleId",host_id AS "hostId",waiting_enabled AS "waitingEnabled",locked,started_at AS "startedAt" FROM meeting_sessions WHERE channel_id=$1 AND ended_at IS NULL`,
    [channelId],
  );
  if (!session.rowCount) return null;
  const participants = await query(
    `SELECT a.user_id AS "userId",u.display_name AS "displayName",a.role,a.state,a.raised_hand AS "raisedHand",count(c.socket_id)::integer AS connections FROM meeting_attendees a JOIN users u ON u.id=a.user_id JOIN channel_access access ON access.channel_id=$2 AND access.user_id=a.user_id LEFT JOIN meeting_connections c ON c.session_id=a.session_id AND c.user_id=a.user_id WHERE a.session_id=$1 GROUP BY a.user_id,u.display_name,a.role,a.state,a.raised_hand,a.joined_at HAVING count(c.socket_id)>0 ORDER BY a.joined_at,a.user_id`,
    [session.rows[0].id, channelId],
  );
  return {
    ...session.rows[0],
    participants: participants.rows,
    maxUsers: config.meetingMaxUsers,
  } as MeetingState;
}
export async function requireAdmitted(userId: string, channelId: string, socketId: string) {
  await requireChannelAccess(userId, channelId, true);
  if (
    !(
      await query(
        `SELECT 1 FROM meeting_connections c JOIN meeting_sessions s ON s.id=c.session_id AND s.ended_at IS NULL JOIN meeting_attendees a ON a.session_id=c.session_id AND a.user_id=c.user_id AND a.state='admitted' WHERE c.socket_id=$1 AND c.user_id=$2 AND s.channel_id=$3`,
        [socketId, userId, channelId],
      )
    ).rowCount
  )
    throw new HttpError(403, "NOT_ADMITTED", "Bạn chưa được duyệt hoặc phiên họp đã kết thúc.");
}
export async function meetingAction(
  userId: string,
  channelId: string,
  socketId: string,
  body: { action: string; targetUserId?: string; enabled?: boolean },
) {
  return withTransaction(async (client) => {
    await lock(client, userId, channelId);
    const session = (
      await client.query(
        `SELECT * FROM meeting_sessions WHERE channel_id=$1 AND ended_at IS NULL FOR UPDATE`,
        [channelId],
      )
    ).rows[0];
    if (!session) throw new HttpError(404, "NO_MEETING", "Phiên họp đã kết thúc.");
    const actor = (
      await client.query(
        `SELECT a.* FROM meeting_attendees a JOIN meeting_connections c ON c.session_id=a.session_id AND c.user_id=a.user_id WHERE a.session_id=$1 AND a.user_id=$2 AND c.socket_id=$3`,
        [session.id, userId, socketId],
      )
    ).rows[0];
    if (actor?.state !== "admitted")
      throw new HttpError(403, "FORBIDDEN", "Bạn chưa được vào phòng.");
    if (body.action === "hand") {
      if (typeof body.enabled !== "boolean")
        throw new HttpError(400, "INVALID_ACTION", "Trạng thái giơ tay không hợp lệ.");
      await client.query(
        `UPDATE meeting_attendees SET raised_hand=$3 WHERE session_id=$1 AND user_id=$2`,
        [session.id, userId, body.enabled],
      );
      return { sessionId: session.id as string };
    }
    if (!["host", "cohost"].includes(actor.role))
      throw new HttpError(403, "FORBIDDEN", "Chỉ host/co-host được điều hành.");
    if (["lock", "waiting"].includes(body.action)) {
      if (typeof body.enabled !== "boolean")
        throw new HttpError(400, "INVALID_ACTION", "Trạng thái không hợp lệ.");
      await client.query(
        `UPDATE meeting_sessions SET ${body.action === "lock" ? "locked" : "waiting_enabled"}=$2 WHERE id=$1`,
        [session.id, body.enabled],
      );
    } else if (body.action === "end") {
      if (actor.role !== "host")
        throw new HttpError(403, "FORBIDDEN", "Chỉ host kết thúc cuộc họp.");
      await client.query(`UPDATE meeting_sessions SET ended_at=now() WHERE id=$1`, [session.id]);
      await client.query(`DELETE FROM meeting_connections WHERE session_id=$1`, [session.id]);
    } else if (["admit", "kick", "cohost", "mute", "transfer"].includes(body.action)) {
      validateId(body.targetUserId);
      const target = (
        await client.query(
          `SELECT a.* FROM meeting_attendees a JOIN channel_access access ON access.channel_id=$3 AND access.user_id=a.user_id WHERE a.session_id=$1 AND a.user_id=$2 AND EXISTS(SELECT 1 FROM meeting_connections c WHERE c.session_id=a.session_id AND c.user_id=a.user_id)`,
          [session.id, body.targetUserId, channelId],
        )
      ).rows[0];
      if (!target || target.state === "kicked")
        throw new HttpError(404, "PARTICIPANT_NOT_FOUND", "Người tham gia không còn trong phiên.");
      if (body.targetUserId === session.host_id && body.action !== "transfer")
        throw new HttpError(403, "HOST_PROTECTED", "Không thể điều khiển host bằng thao tác này.");
      if (body.action === "admit") {
        if (target.state !== "waiting")
          throw new HttpError(409, "NOT_WAITING", "Người này không còn trong phòng chờ.");
        await client.query(
          `UPDATE meeting_attendees SET state='admitted' WHERE session_id=$1 AND user_id=$2`,
          [session.id, body.targetUserId],
        );
      }
      if (body.action === "kick") {
        await client.query(
          `UPDATE meeting_attendees SET state='kicked' WHERE session_id=$1 AND user_id=$2`,
          [session.id, body.targetUserId],
        );
        await client.query(`DELETE FROM meeting_connections WHERE session_id=$1 AND user_id=$2`, [
          session.id,
          body.targetUserId,
        ]);
      }
      if (body.action === "cohost") {
        if (
          actor.role !== "host" ||
          target.state !== "admitted" ||
          typeof body.enabled !== "boolean"
        )
          throw new HttpError(403, "FORBIDDEN", "Chỉ host bổ nhiệm co-host đã vào phòng.");
        await client.query(
          `UPDATE meeting_attendees SET role=$3 WHERE session_id=$1 AND user_id=$2`,
          [session.id, body.targetUserId, body.enabled ? "cohost" : "member"],
        );
      }
      if (body.action === "transfer") {
        if (actor.role !== "host" || target.state !== "admitted")
          throw new HttpError(403, "FORBIDDEN", "Chỉ host chuyển quyền cho người đã vào phòng.");
        await client.query(
          `UPDATE meeting_attendees SET role=CASE WHEN user_id=$2 THEN 'host' WHEN user_id=$3 THEN 'member' ELSE role END WHERE session_id=$1`,
          [session.id, body.targetUserId, userId],
        );
        await client.query(`UPDATE meeting_sessions SET host_id=$2 WHERE id=$1`, [
          session.id,
          body.targetUserId,
        ]);
      }
    } else throw new HttpError(400, "INVALID_ACTION", "Thao tác điều hành không hợp lệ.");
    return { sessionId: session.id as string };
  });
}
// A host's last connection leaving transfers to a present co-host, then earliest member.
// Waiting clients cannot inherit host; if no admitted peer remains the session ends.
export async function leaveSession(socketId: string) {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE meeting_participations SET left_at=now() WHERE socket_id=$1 AND left_at IS NULL`,
      [socketId],
    );
    const initial = (
      await client.query(
        `SELECT s.* FROM meeting_connections c JOIN meeting_sessions s ON s.id=c.session_id WHERE c.socket_id=$1`,
        [socketId],
      )
    ).rows[0];
    if (!initial) return null;
    await client.query(`SELECT id FROM channels WHERE id=$1 FOR UPDATE`, [initial.channel_id]);
    const session = (
      await client.query(`SELECT * FROM meeting_sessions WHERE id=$1 FOR UPDATE`, [initial.id])
    ).rows[0];
    await client.query(`DELETE FROM meeting_connections WHERE socket_id=$1`, [socketId]);
    const hostPresent = await client.query(
      `SELECT 1 FROM meeting_connections WHERE session_id=$1 AND user_id=$2`,
      [session.id, session.host_id],
    );
    let ended = false;
    if (!hostPresent.rowCount && !session.ended_at) {
      const next = (
        await client.query(
          `SELECT a.user_id FROM meeting_attendees a JOIN channel_access access ON access.channel_id=$2 AND access.user_id=a.user_id WHERE a.session_id=$1 AND a.state='admitted' AND EXISTS(SELECT 1 FROM meeting_connections c WHERE c.session_id=a.session_id AND c.user_id=a.user_id) ORDER BY (a.role='cohost') DESC,a.joined_at,a.user_id LIMIT 1`,
          [session.id, session.channel_id],
        )
      ).rows[0];
      if (next) {
        await client.query(
          `UPDATE meeting_attendees SET role=CASE WHEN user_id=$2 THEN 'host' WHEN role='host' THEN 'member' ELSE role END WHERE session_id=$1`,
          [session.id, next.user_id],
        );
        await client.query(`UPDATE meeting_sessions SET host_id=$2 WHERE id=$1`, [
          session.id,
          next.user_id,
        ]);
      } else {
        ended = true;
        await client.query(
          `UPDATE meeting_sessions SET ended_at=COALESCE(ended_at,now()) WHERE id=$1`,
          [session.id],
        );
        await client.query(`DELETE FROM meeting_connections WHERE session_id=$1`, [session.id]);
      }
    }
    return { channelId: session.channel_id as string, sessionId: session.id as string, ended };
  });
}
