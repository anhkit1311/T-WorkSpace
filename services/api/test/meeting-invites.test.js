import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
process.env.JWT_SECRET = "meeting-invites-secret-at-least-32-characters";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import { createWorkspace, addWorkspaceMember, getWorkspaceChannels } from "../../../dist/api/modules/workspaces/service.js";
import { createMeetingSchedule } from "../../../dist/api/modules/meetings/schedules.js";
import { enterSession } from "../../../dist/api/modules/meetings/sessions.js";
import { noticeSchedule } from "../../../dist/api/modules/meetings/reminders.js";

test(
  "Meeting invites (NV-MT1, BR-10): class and unit invites, room settings, invitees skip the waiting room",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 30000 },
  async () => {
    const [owner, invited, uninvited, classmate, colleague] = Array.from({ length: 5 }, () => randomUUID());
    const everyone = [owner, invited, uninvited, classmate, colleague];
    const unitId = randomUUID();
    const workspaces = [];
    try {
      for (const id of everyone)
        await pool.query(
          `INSERT INTO users(id,email,password_hash,display_name,email_verified,notifications_enabled) VALUES($1,$2,'test-only','Invite QA',true,false)`,
          [id, `test-${id}@example.test`],
        );
      await pool.query(`INSERT INTO academic_units(id,code,name) VALUES($1,$2,'QA Đơn vị mời họp')`, [unitId, `MI${Date.now() % 100000}`]);
      for (const [userId, code] of [[owner, "QAMI1"], [colleague, "QAMI2"]])
        await pool.query(`INSERT INTO academic_staff(user_id,unit_id,staff_code,academic_rank) VALUES($1,$2,$3,'ths')`, [userId, unitId, code]);
      const group = await createWorkspace(owner, "Invite test");
      const otherClass = await createWorkspace(owner, "Invite class");
      workspaces.push(group.id, otherClass.id);
      for (const id of [invited, uninvited]) await addWorkspaceMember(group.id, id);
      await addWorkspaceMember(otherClass.id, classmate);
      const room = (await getWorkspaceChannels(owner, group.id)).find((c) => c.type === "video");
      const later = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();
      const base = { roomId: room.id, title: "Họp có danh sách mời", startsAt: later(30), endsAt: later(90) };

      // A plain member may not pull people from outside the group in.
      await assert.rejects(
        createMeetingSchedule(uninvited, { ...base, invite: { workspaceIds: [group.id], unitIds: [unitId] } }),
        (error) => error.code === "FORBIDDEN",
      );
      const schedule = await createMeetingSchedule(owner, {
        ...base,
        waitingRoom: true,
        muteOnJoin: true,
        invite: { userIds: [invited], workspaceIds: [otherClass.id], unitIds: [unitId] },
      });
      assert.deepEqual([schedule.waitingRoom, schedule.autoRecord, schedule.muteOnJoin], [true, false, true]);
      assert.deepEqual([...schedule.inviteeIds].sort(), [owner, invited, classmate, colleague].sort());
      const joined = await pool.query(`SELECT user_id FROM memberships WHERE workspace_id=$1 AND user_id=ANY($2::uuid[])`, [group.id, [classmate, colleague]]);
      assert.equal(joined.rowCount, 2, "class and unit invitees join the room's group");

      const sent = [];
      await noticeSchedule({ to: (room) => ({ emit: () => sent.push(room) }) }, schedule.id, "created", owner);
      assert.ok(!sent.includes(`user:${uninvited}`), "only the invite list is notified");
      assert.ok(sent.includes(`user:${classmate}`));

      const host = await enterSession(owner, room.id, `s-${owner}`, "test", schedule.id);
      assert.deepEqual([host.state, host.muteOnJoin], ["admitted", false]);
      assert.equal((await pool.query(`SELECT waiting_enabled,mute_on_join FROM meeting_sessions WHERE id=$1`, [host.sessionId])).rows[0].waiting_enabled, true);
      const guest = await enterSession(invited, room.id, `s-${invited}`, "test", schedule.id);
      assert.deepEqual([guest.state, guest.muteOnJoin], ["admitted", true]);
      assert.equal((await enterSession(uninvited, room.id, `s-${uninvited}`, "test", schedule.id)).state, "waiting");
    } finally {
      for (const id of workspaces) await pool.query(`DELETE FROM workspaces WHERE id=$1`, [id]);
      await pool.query(`DELETE FROM academic_staff WHERE unit_id=$1`, [unitId]);
      await pool.query(`DELETE FROM academic_units WHERE id=$1`, [unitId]);
      await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [everyone]);
      await pool.end();
    }
  },
);
