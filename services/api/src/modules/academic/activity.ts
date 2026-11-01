import { withTransaction } from "../../infrastructure/database/db.js";
import { forbidden, invalid, loadActor } from "./access.js";

export type ActivitySource = "media" | "workspace" | "academic";
export interface ActivityItem {
  id: string;
  at: string;
  source: ActivitySource;
  actorName: string | null;
  action: string;
  target: string | null;
}

const SOURCES = ["media", "workspace", "academic"] as const;

/**
 * "Xem nhật ký hoạt động" (system admin): recording listens/views, workspace governance and
 * organisation changes, newest first, 100 per page.
 */
export async function listActivity(userId: string, params: URLSearchParams) {
  const source = params.get("source") || null;
  if (source && !SOURCES.includes(source as ActivitySource)) throw invalid("Nguồn nhật ký không hợp lệ.");
  const beforeText = params.get("before");
  const before = beforeText ? new Date(beforeText) : null;
  if (before && Number.isNaN(before.getTime())) throw invalid("Mốc thời gian không hợp lệ.");
  return withTransaction(async (client) => {
    if (!(await loadActor(client, userId)).systemAdmin) throw forbidden("Chỉ quản trị hệ thống xem được nhật ký hoạt động.");
    const rows = await client.query<ActivityItem & { at: Date }>(
      `SELECT * FROM (
         SELECT l.id::text, l.accessed_at AS at, 'media' AS source, u.display_name AS "actorName",
           'media.' || l.kind AS action,
           COALESCE(call.caller_number, vm.caller_number, room.name, left(l.ref_id::text, 8)) AS target
         FROM media_access_log l LEFT JOIN users u ON u.id=l.user_id
         LEFT JOIN cc_calls call ON l.kind='call' AND call.id=l.ref_id
         LEFT JOIN cc_voicemails vm ON l.kind='voicemail' AND vm.id=l.ref_id
         LEFT JOIN meeting_recordings rec ON l.kind='meeting' AND rec.id=l.ref_id
         LEFT JOIN channels room ON room.id=rec.channel_id
         UNION ALL
         SELECT a.id::text, a.created_at, 'workspace', u.display_name, a.action, w.name
         FROM audit_events a JOIN workspaces w ON w.id=a.workspace_id LEFT JOIN users u ON u.id=a.actor_id
         UNION ALL
         SELECT a.id::text, a.created_at, 'academic', u.display_name, a.action, COALESCE(un.name, a.entity)
         FROM academic_audit_events a LEFT JOIN academic_units un ON un.id=a.unit_id LEFT JOIN users u ON u.id=a.actor_id
       ) x
       WHERE ($1::text IS NULL OR x.source=$1) AND ($2::timestamptz IS NULL OR x.at < $2)
       ORDER BY x.at DESC, x.id DESC LIMIT 100`,
      [source, before],
    );
    return { items: rows.rows.map((row) => ({ ...row, at: row.at.toISOString() })) };
  });
}
