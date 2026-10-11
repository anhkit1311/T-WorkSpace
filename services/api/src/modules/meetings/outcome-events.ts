import type { ServerToClientEvents } from "@doan/shared";
import { query } from "../../infrastructure/database/db.js";
import { getMessageItem } from "../chat/conversations.js";

type OutcomeChange = Parameters<ServerToClientEvents["meeting_outcomes_changed"]>[0];
// Structural type keeps this module free of a runtime import cycle with the socket server.
interface Emitter {
  to(rooms: string | string[]): {
    emit<E extends keyof ServerToClientEvents>(
      event: E,
      ...args: Parameters<ServerToClientEvents[E]>
    ): boolean;
  };
}

export function publishOutcomeChange(io: Emitter, change: OutcomeChange) {
  io.to(`meeting:${change.roomId}`).emit("meeting_outcomes_changed", change);
}

export async function publishMeetingSummary(
  io: Emitter,
  roomId: string,
  sessionId: string,
  messageId: string | null | undefined,
) {
  publishOutcomeChange(io, { roomId, sessionId, part: "summary" });
  if (!messageId) return;
  const message = (
    await query<{ author_id: string; channel_id: string }>(
      `SELECT author_id,channel_id FROM messages WHERE id=$1`,
      [messageId],
    )
  ).rows[0];
  if (!message) return;
  const item = await getMessageItem(message.author_id, messageId);
  if (!item) return;
  const recipients = await query<{ user_id: string }>(
    `SELECT user_id FROM channel_access WHERE channel_id=$1`,
    [message.channel_id],
  );
  io.to(recipients.rows.map((row) => `user:${row.user_id}`)).emit("new_message", item);
}
