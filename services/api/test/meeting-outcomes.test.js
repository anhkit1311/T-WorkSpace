import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
process.env.JWT_SECRET = "meeting-outcomes-secret-at-least-32-characters";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import {
  createWorkspace,
  addWorkspaceMember,
  getWorkspaceChannels,
  getChannelMessages,
  editMessage,
} from "../../../dist/api/modules/workspaces/service.js";
import { createMeetingSchedule } from "../../../dist/api/modules/meetings/schedules.js";
import {
  enterSession,
  meetingAction,
  leaveSession,
} from "../../../dist/api/modules/meetings/sessions.js";
import {
  addAgendaItem,
  createMeetingSummary,
  createMeetingTask,
  deleteAgendaItem,
  getMeetingOutcomes,
  saveMeetingNotes,
  setOutcomeChannel,
  updateAgendaItem,
} from "../../../dist/api/modules/meetings/outcomes.js";
import { withTransaction } from "../../../dist/api/infrastructure/database/db.js";

test(
  "Meeting outcomes: agenda, notes conflicts, meeting tasks and one summary per session",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 30000 },
  async () => {
    const owner = randomUUID(),
      member = randomUUID(),
      outsider = randomUUID();
    let workspace;
    try {
      for (const id of [owner, member, outsider])
        await pool.query(
          `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only',$3,true)`,
          [id, `test-${id}@example.test`, `Outcome QA ${id.slice(0, 4)}`],
        );
      workspace = await createWorkspace(owner, "Meeting outcomes test");
      for (const id of [member, outsider]) await addWorkspaceMember(workspace.id, id);
      const channels = await getWorkspaceChannels(owner, workspace.id);
      const room = channels.find((c) => c.type === "video");
      const board = channels
        .filter((c) => c.type === "text")
        .sort((a, b) => a.position - b.position)[0];
      const schedule = await createMeetingSchedule(owner, {
        roomId: room.id,
        title: "QA outcomes",
        description: "",
        startsAt: new Date(Date.now() + 120000).toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
        agenda: ["Báo cáo tiến độ", "Phân công"],
      });
      assert.deepEqual(schedule.agenda, ["Báo cáo tiến độ", "Phân công"]);

      const { sessionId } = await enterSession(owner, room.id, "qa-o-host", "qa-o", schedule.id);
      await enterSession(member, room.id, "qa-o-member", "qa-o");
      let outcomes = await getMeetingOutcomes(member, sessionId);
      assert.equal(outcomes.outcomeChannelId, board.id, "Defaults to the first public text channel");
      assert.equal(outcomes.title, "QA outcomes");
      assert.equal(outcomes.agenda.length, 2);
      assert.ok(outcomes.agenda.every((item) => item.fromSchedule && !item.done));
      assert.equal(outcomes.canEdit, true);
      assert.equal(outcomes.canManage, false);
      assert.equal((await getMeetingOutcomes(outsider, sessionId)).canEdit, false);

      const first = await saveMeetingNotes(member, sessionId, {
        content: "Chốt demo thứ Sáu",
        baseVersion: 0,
      });
      assert.equal(first.notes.version, 1);
      await assert.rejects(
        saveMeetingNotes(owner, sessionId, { content: "Ghi đè", baseVersion: 0 }),
        { statusCode: 409, code: "NOTES_CONFLICT" },
      );
      await saveMeetingNotes(owner, sessionId, {
        content: "Chốt demo thứ Sáu\nCần thêm số liệu",
        baseVersion: 1,
      });
      await assert.rejects(
        saveMeetingNotes(outsider, sessionId, { content: "x", baseVersion: 2 }),
        { statusCode: 403 },
      );

      await addAgendaItem(member, sessionId, { label: "Việc phát sinh" });
      outcomes = await getMeetingOutcomes(owner, sessionId);
      const [planned, , adhoc] = outcomes.agenda;
      assert.equal(adhoc.fromSchedule, false);
      await updateAgendaItem(member, sessionId, planned.id, { done: true });
      await assert.rejects(deleteAgendaItem(owner, sessionId, planned.id), { statusCode: 409 });
      await deleteAgendaItem(owner, sessionId, adhoc.id);
      outcomes = await getMeetingOutcomes(owner, sessionId);
      assert.equal(outcomes.agenda.length, 2);
      assert.equal(outcomes.agenda[0].done, true);

      await assert.rejects(setOutcomeChannel(member, sessionId, { channelId: board.id }), {
        statusCode: 403,
      });
      await assert.rejects(setOutcomeChannel(owner, sessionId, { channelId: room.id }), {
        statusCode: 400,
      });
      await setOutcomeChannel(owner, sessionId, { channelId: board.id });

      const clientTaskId = randomUUID();
      const created = await createMeetingTask(member, sessionId, {
        clientTaskId,
        title: "Chuẩn bị slide demo",
        assigneeId: member,
      });
      assert.equal(created.task.channelId, board.id);
      assert.equal(created.task.meetingSessionId, sessionId);
      const retried = await createMeetingTask(member, sessionId, {
        clientTaskId,
        title: "Chuẩn bị slide demo",
        assigneeId: member,
      });
      assert.equal(retried.task.id, created.task.id, "Retry with the same client id is idempotent");
      assert.equal((await getMeetingOutcomes(owner, sessionId)).tasks.length, 1);

      // End from the host and drop the last member at the same moment.
      const [ended] = await Promise.all([
        meetingAction(owner, room.id, "qa-o-host", { action: "end" }),
        leaveSession("qa-o-member"),
      ]);
      await withTransaction((client) => createMeetingSummary(client, sessionId));
      const summaries = await pool.query(
        `SELECT id,channel_id,author_id,content FROM messages WHERE meeting_session_id=$1 AND kind='meeting_summary'`,
        [sessionId],
      );
      assert.equal(summaries.rowCount, 1, "Exactly one summary per session");
      const summary = summaries.rows[0];
      assert.equal(ended.summaryMessageId, summary.id);
      assert.equal(summary.channel_id, board.id);
      assert.equal(summary.author_id, owner);
      assert.match(summary.content, /Tổng kết cuộc họp: QA outcomes/);
      assert.match(summary.content, /Agenda: 1\/2/);
      assert.match(summary.content, /Chuẩn bị slide demo/);
      assert.match(summary.content, /Cần thêm số liệu/);

      const listed = (await getChannelMessages(member, board.id, 20)).find(
        (message) => message.id === summary.id,
      );
      assert.equal(listed.kind, "meeting_summary");
      assert.equal(listed.meetingSessionId, sessionId);
      await assert.rejects(editMessage(owner, summary.id, "Sửa tổng kết"), { statusCode: 404 });
      await assert.rejects(
        saveMeetingNotes(owner, sessionId, { content: "Muộn", baseVersion: 2 }),
        { statusCode: 409, code: "MEETING_ENDED" },
      );
      outcomes = await getMeetingOutcomes(member, sessionId);
      assert.equal(outcomes.summaryMessageId, summary.id);
      assert.equal(outcomes.canEdit, false);

      // A host alone with nothing recorded does not post into the channel.
      const solo = await enterSession(owner, room.id, "qa-o-solo", "qa-o");
      const soloEnd = await leaveSession("qa-o-solo");
      assert.equal(soloEnd.ended, true);
      assert.equal(soloEnd.summaryMessageId, null);
      assert.equal(
        (await pool.query(`SELECT 1 FROM messages WHERE meeting_session_id=$1`, [solo.sessionId]))
          .rowCount,
        0,
      );
    } finally {
      if (workspace) await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspace.id]);
      await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[owner, member, outsider]]);
      await pool.end();
    }
  },
);
