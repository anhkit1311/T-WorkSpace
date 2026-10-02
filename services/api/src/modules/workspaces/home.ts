import { query } from "../../infrastructure/database/db.js";
import { listMeetingSchedules } from "../meetings/schedules.js";
import { listNotifications } from "../chat/conversations.js";
import type { HomeSummary } from "@doan/shared";
export async function homeSummary(userId: string): Promise<HomeSummary> {
  const [tasks, schedules, notifications] = await Promise.all([
    query<HomeSummary["tasks"][number]>(
      `SELECT t.id,t.title,t.status,t.priority,t.due_at AS "dueAt",c.id AS "channelId",c.name AS "channelName",c.workspace_id AS "workspaceId" FROM tasks t JOIN channels c ON c.id=t.channel_id JOIN channel_access a ON a.channel_id=c.id AND a.user_id=$1 AND a.can_write WHERE t.assignee_id=$1 AND t.archived_at IS NULL AND t.status<>'done' ORDER BY (t.due_at<now()) DESC NULLS LAST,CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,t.due_at NULLS LAST,t.updated_at DESC LIMIT 6`,
      [userId],
    ),
    listMeetingSchedules(userId),
    listNotifications(userId, undefined, true),
  ]);
  return {
    tasks: tasks.rows,
    meetings: schedules.slice(0, 4),
    unreadNotifications: notifications.unreadCount,
  };
}
