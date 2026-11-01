import { query } from "../database/db.js";

type Emitter = { to(rooms: string[]): { emit(event: "notifications_changed"): boolean } };
let emitter: Emitter | null = null;

/** The socket server, set once at startup so any module can ring the bell. */
export function setNoticeEmitter(io: Emitter) {
  emitter = io;
}

/** A bell entry that is not a chat message; `link` is the web route to open. */
export async function addNotices(
  userIds: string[],
  notice: { kind: "meeting" | "course"; title: string; body: string; link: Record<string, string> },
) {
  if (!userIds.length) return;
  await query(
    `INSERT INTO notifications(id,user_id,kind,title,body,link) SELECT gen_random_uuid(),u,$2,$3,$4,$5 FROM unnest($1::uuid[]) u`,
    [userIds, notice.kind, notice.title.slice(0, 200), notice.body.slice(0, 500), notice.link],
  );
  emitter?.to(userIds.map((id) => `user:${id}`)).emit("notifications_changed");
}
