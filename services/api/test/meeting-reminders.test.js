import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
process.env.JWT_SECRET = "meeting-reminder-secret-at-least-32-characters";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import { createWorkspace, addWorkspaceMember, getWorkspaceChannels } from "../../../dist/api/modules/workspaces/service.js";
import { createMeetingSchedule, updateMeetingSchedule } from "../../../dist/api/modules/meetings/schedules.js";
import { noticeSchedule, sendDueReminders } from "../../../dist/api/modules/meetings/reminders.js";
import { listNotifications } from "../../../dist/api/modules/chat/conversations.js";

test(
  "Meeting reminders (NV-MT1): invitees are told once, 15 minutes ahead; moving the start re-arms it",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 30000 },
  async () => {
    const [owner, member] = [randomUUID(), randomUUID()];
    const sent = [];
    const io = { to: (room) => ({ emit: (event, data) => sent.push({ room, event, data }) }) };
    let workspace;
    try {
      for (const id of [owner, member])
        // notifications_enabled=false keeps the test from e-mailing anyone.
        await pool.query(
          `INSERT INTO users(id,email,password_hash,display_name,email_verified,notifications_enabled) VALUES($1,$2,'test-only','Reminder QA',true,false)`,
          [id, `test-${id}@example.test`],
        );
      workspace = await createWorkspace(owner, "Reminder test");
      await addWorkspaceMember(workspace.id, member);
      const room = (await getWorkspaceChannels(owner, workspace.id)).find((c) => c.type === "video");
      const later = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();
      const schedule = await createMeetingSchedule(owner, { roomId: room.id, title: "Họp nhắc giờ", startsAt: later(10), endsAt: later(60) });

      await noticeSchedule(io, schedule.id, "created", owner);
      assert.deepEqual(sent.map((item) => [item.room, item.data.kind]), [[`user:${member}`, "created"]]);
      const bell = await listNotifications(member);
      assert.deepEqual([bell.unreadCount, bell.items[0].kind, bell.items[0].title, bell.items[0].link.channelId], [1, "meeting", "Lời mời họp", room.id]);
      assert.equal((await listNotifications(owner)).unreadCount, 0, "the organizer is not told about their own change");

      sent.length = 0;
      await sendDueReminders(io);
      const mine = () => sent.filter((item) => item.data.scheduleId === schedule.id);
      assert.deepEqual(mine().map((item) => item.room).sort(), [`user:${member}`, `user:${owner}`].sort());
      assert.ok(mine().every((item) => item.data.kind === "reminder"));
      sent.length = 0;
      await sendDueReminders(io);
      assert.equal(mine().length, 0, "a schedule is reminded only once");

      await updateMeetingSchedule(owner, schedule.id, { roomId: room.id, title: "Họp nhắc giờ", startsAt: later(12), endsAt: later(60) });
      await sendDueReminders(io);
      assert.equal(mine().length, 2, "a new start time re-arms the reminder");
    } finally {
      if (workspace) await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspace.id]);
      await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[owner, member]]);
      await pool.end();
    }
  },
);
