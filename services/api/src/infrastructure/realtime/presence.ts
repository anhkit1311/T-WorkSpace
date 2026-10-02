import { query } from "../database/db.js";
import type { initSocketServer } from "./socket.js";
import { leaveSession } from "../../modules/meetings/sessions.js";
export async function addPresence(socketId: string, userId: string, instanceId: string) {
  await query(
    `INSERT INTO socket_presence(socket_id,user_id,instance_id,expires_at) VALUES($1,$2,$3,now()+interval '45 seconds') ON CONFLICT(socket_id) DO UPDATE SET expires_at=EXCLUDED.expires_at`,
    [socketId, userId, instanceId],
  );
}
export async function onlinePeers(userIds: string[]) {
  const rows = await query<{ actor: string; peer: string }>(
    `SELECT DISTINCT actor.user_id AS actor,target.user_id AS peer FROM memberships actor JOIN memberships target ON target.workspace_id=actor.workspace_id JOIN socket_presence p ON p.user_id=target.user_id AND p.expires_at>now() JOIN users u ON u.id=target.user_id AND u.show_activity WHERE actor.user_id=ANY($1::uuid[])`,
    [userIds],
  );
  const result = new Map<string, string[]>();
  for (const row of rows.rows) {
    const list = result.get(row.actor) ?? [];
    list.push(row.peer);
    result.set(row.actor, list);
  }
  return result;
}
export async function sweepStaleMeetings(io: ReturnType<typeof initSocketServer>) {
  const stale = await query<{ socket_id: string }>(
    `SELECT c.socket_id FROM meeting_connections c JOIN meeting_sessions s ON s.id=c.session_id WHERE (s.media_instance_id IS NOT NULL OR c.joined_at<now()-interval '45 seconds') AND NOT EXISTS(SELECT 1 FROM api_instances i WHERE i.id=c.instance_id AND i.expires_at>now()) LIMIT 100`,
  );
  for (const row of stale.rows) {
    const result = await leaveSession(row.socket_id);
    if (result) {
      io.to(`meeting:${result.channelId}`).emit("meeting_state_changed", {
        roomId: result.channelId,
      });
      if (result.ended)
        io.to(`meeting:${result.channelId}`).emit("meeting_closed", {
          roomId: result.channelId,
          reason: "Máy chủ media đã ngắt. Hãy tham gia phiên mới.",
        });
    }
  }
  await query(
    `UPDATE meeting_participations p SET left_at=now() WHERE left_at IS NULL AND joined_at<now()-interval '45 seconds' AND NOT EXISTS(SELECT 1 FROM meeting_connections c WHERE c.socket_id=p.socket_id)`,
  );
}
export function startPresence(io: ReturnType<typeof initSocketServer>, instanceId: string) {
  const heartbeat = async () => {
    await query(
      `INSERT INTO api_instances(id,media_url,expires_at) VALUES($1,$2,now()+interval '45 seconds') ON CONFLICT(id) DO UPDATE SET expires_at=EXCLUDED.expires_at,media_url=EXCLUDED.media_url`,
      [instanceId, process.env.SFU_PUBLIC_URL ?? null],
    );
    const sockets = [...io.sockets.sockets.values()];
    const ids = sockets.map((socket) => socket.id);
    await query(
      `UPDATE socket_presence SET expires_at=now()+interval '45 seconds' WHERE instance_id=$1 AND socket_id=ANY($2::text[])`,
      [instanceId, ids],
    );
    await query(`DELETE FROM socket_presence WHERE expires_at<now()`);
    await sweepStaleMeetings(io);
    const peers = await onlinePeers([...new Set(sockets.map((socket) => socket.data.user.id))]);
    for (const socket of sockets) socket.emit("online_users", peers.get(socket.data.user.id) ?? []);
  };
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void heartbeat()
      .catch((error) =>
        console.error(
          JSON.stringify({
            level: "error",
            event: "presence_heartbeat_error",
            message: error.message,
          }),
        ),
      )
      .finally(() => {
        running = false;
      });
  }, 15000);
  timer.unref();
  void heartbeat().catch(() => {});
  return () => {
    clearInterval(timer);
    void query(`DELETE FROM socket_presence WHERE instance_id=$1`, [instanceId]).catch(() => {});
    void query(`DELETE FROM api_instances WHERE id=$1`, [instanceId]).catch(() => {});
  };
}
