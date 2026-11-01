import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
process.env.JWT_SECRET = "meeting-council-secret-at-least-32-characters";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import { createWorkspace, addWorkspaceMember, getWorkspaceChannels } from "../../../dist/api/modules/workspaces/service.js";
import { createMeetingSchedule } from "../../../dist/api/modules/meetings/schedules.js";
import {
  exportCouncil,
  finalizePresenter,
  getCouncil,
  saveCouncil,
  setMemberAbsent,
  sheetTotal,
  startPresenter,
  submitSheet,
} from "../../../dist/api/modules/meetings/council.js";

test("Council: a sheet's weighted total is on the 10-point scale", () => {
  const criteria = [
    { id: "a", weight: 60 },
    { id: "b", weight: 40 },
  ];
  assert.equal(sheetTotal({ a: 8, b: 7 }, criteria), 7.6);
  assert.equal(sheetTotal({ a: 10, b: 10 }, criteria), 10);
  assert.equal(sheetTotal({ a: 8.25, b: 6.5 }, criteria), 7.55);
});

test(
  "Council (NV-MT3, BR-12): setup, private sheets, chair finalizes only with every present member's sheet",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 30000 },
  async () => {
    const [owner, chair, member, student, student2, outsider] = Array.from({ length: 6 }, () => randomUUID());
    const everyone = [owner, chair, member, student, student2, outsider];
    let workspace;
    try {
      for (const id of everyone)
        await pool.query(
          `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only',$3,true)`,
          [id, `test-${id}@example.test`, `Council QA ${id.slice(0, 4)}`],
        );
      workspace = await createWorkspace(owner, "Council test");
      for (const id of [chair, member, student, student2]) await addWorkspaceMember(workspace.id, id);
      const room = (await getWorkspaceChannels(owner, workspace.id)).find((c) => c.type === "video");
      const schedule = await createMeetingSchedule(owner, {
        roomId: room.id,
        title: "Hội đồng QA",
        startsAt: new Date(Date.now() + 120000).toISOString(),
        endsAt: new Date(Date.now() + 3600000).toISOString(),
      });
      const setup = {
        chairId: chair,
        memberIds: [member],
        presenters: [
          { userId: student, topic: "Tổng đài VoIP" },
          { userId: student2, topic: "Phòng họp WebRTC" },
        ],
        criteria: [
          { label: "Nội dung", weight: 60 },
          { label: "Trình bày", weight: 40 },
        ],
      };

      assert.equal(await getCouncil(owner, schedule.id), null, "No council until set up");
      await assert.rejects(saveCouncil(member, schedule.id, setup), { statusCode: 403 });
      await assert.rejects(
        saveCouncil(owner, schedule.id, { ...setup, criteria: [{ label: "Nội dung", weight: 90 }] }),
        { code: "INVALID_COUNCIL" },
      );
      await assert.rejects(
        saveCouncil(owner, schedule.id, { ...setup, presenters: [{ userId: outsider, topic: "x" }] }),
        { code: "INVALID_COUNCIL" },
        "Presenters must belong to the room's group",
      );
      await assert.rejects(
        saveCouncil(owner, schedule.id, { ...setup, presenters: [{ userId: member, topic: "x" }] }),
        { code: "INVALID_COUNCIL" },
      );
      await saveCouncil(owner, schedule.id, setup);
      await assert.rejects(getCouncil(outsider, schedule.id), { statusCode: 404 });

      let view = await getCouncil(chair, schedule.id);
      assert.equal(view.myRole, "chair");
      assert.equal(view.members.length, 2);
      const [first, second] = view.presenters;
      const [content, delivery] = view.criteria.map((c) => c.id);

      await assert.rejects(startPresenter(member, first.id), { code: "CHAIR_ONLY" });
      await startPresenter(chair, first.id);
      await assert.rejects(saveCouncil(owner, schedule.id, setup), { code: "COUNCIL_LOCKED" });

      await assert.rejects(submitSheet(student, first.id, { scores: { [content]: 8, [delivery]: 7 } }), {
        code: "COUNCIL_ONLY",
      });
      await assert.rejects(submitSheet(member, first.id, { scores: { [content]: 11, [delivery]: 7 } }), {
        code: "INVALID_COUNCIL",
      });
      await assert.rejects(submitSheet(member, first.id, { scores: { [content]: 8 } }), { code: "INVALID_COUNCIL" });
      await submitSheet(member, first.id, { scores: { [content]: 8, [delivery]: 7 }, comment: "Tốt" });

      view = await getCouncil(member, schedule.id);
      assert.equal(view.presenters[0].sheets, null, "A member does not see others' sheets before finalizing");
      assert.deepEqual(view.presenters[0].mySheet.scores, { [content]: 8, [delivery]: 7 });
      assert.deepEqual(view.presenters[0].submittedBy, [member]);
      view = await getCouncil(chair, schedule.id);
      assert.equal(view.presenters[0].sheets.length, 1, "The chair sees every sheet");
      assert.equal(view.presenters[0].sheets[0].total, 7.6);

      await assert.rejects(finalizePresenter(member, first.id, {}), { code: "CHAIR_ONLY" });
      await assert.rejects(finalizePresenter(chair, first.id, {}), { code: "SHEETS_MISSING" });
      await submitSheet(chair, first.id, { scores: { [content]: 9, [delivery]: 8 } });
      await finalizePresenter(chair, first.id, { conclusion: "Đạt" });
      await assert.rejects(submitSheet(member, first.id, { scores: { [content]: 1, [delivery]: 1 } }), {
        code: "COUNCIL_FINALIZED",
      });

      view = await getCouncil(student, schedule.id);
      assert.equal(view.presenters[0].finalScore, 8.1, "(7.6 + 8.6) / 2");
      assert.equal(view.presenters[0].conclusion, "Đạt");
      assert.equal(view.presenters[0].sheets, null);
      assert.equal(view.presenters[1].finalScore, null);
      view = await getCouncil(student2, schedule.id);
      assert.equal(view.presenters[0].finalScore, null, "Others' results stay private");
      view = await getCouncil(member, schedule.id);
      assert.equal(view.presenters[0].sheets.length, 2, "Members see the sheets once final");

      // An absent member is not waited for.
      await assert.rejects(setMemberAbsent(member, schedule.id, member, true), { code: "CHAIR_ONLY" });
      await assert.rejects(setMemberAbsent(chair, schedule.id, chair, true), { statusCode: 404 });
      await setMemberAbsent(chair, schedule.id, member, true);
      await assert.rejects(submitSheet(member, second.id, { scores: { [content]: 5, [delivery]: 5 } }), {
        code: "MEMBER_ABSENT",
      });
      await submitSheet(chair, second.id, { scores: { [content]: 7, [delivery]: 6 } });
      await finalizePresenter(chair, second.id, {});
      view = await getCouncil(owner, schedule.id);
      assert.equal(view.presenters[1].finalScore, 6.6);
      assert.equal(view.presenters[1].status, "done");

      await assert.rejects(exportCouncil(student, schedule.id), { statusCode: 403 });
      const file = await exportCouncil(owner, schedule.id);
      const text = file.rows.map((row) => row.join(",")).join("\n");
      assert.match(text, /Tổng đài VoIP,8\.10,Đạt/);
      assert.match(text, /Phòng họp WebRTC,6\.60,/);
    } finally {
      if (workspace) await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspace.id]);
      await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [everyone]);
      await pool.end();
    }
  },
);
