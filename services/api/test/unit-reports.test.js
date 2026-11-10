import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import {
  createWorkspace,
  getWorkspaceChannels,
} from "../../../dist/api/modules/workspaces/service.js";
import { unitReport } from "../../../dist/api/modules/academic/reports.js";

test(
  "Unit report (2.5): a unit head sees only their unit; meetings, courses and access are counted",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 30000 },
  async () => {
    const [head, learner, outsider, officer] = Array.from({ length: 4 }, () => randomUUID());
    const [unitId, otherUnit, courseId] = Array.from({ length: 3 }, () => randomUUID());
    let workspaceId = null;
    try {
      for (const id of [head, learner, outsider, officer])
        await pool.query(
          `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only','Report QA',true)`,
          [id, `test-${id}@example.test`],
        );
      const suffix = Date.now() % 100000;
      await pool.query(
        `INSERT INTO academic_units(id,code,name) VALUES($1,$2,'QA Khoa báo cáo'),($3,$4,'QA Khoa khác')`,
        [unitId, `RP${suffix}`, otherUnit, `RQ${suffix}`],
      );
      await pool.query(
        `INSERT INTO academic_staff(user_id,unit_id,staff_code,academic_rank) VALUES($1,$2,'QARP1','ts')`,
        [head, unitId],
      );
      await pool.query(
        `INSERT INTO academic_role_grants(id,user_id,role,unit_id) VALUES($1,$2,'unit_head',$3)`,
        [randomUUID(), head, unitId],
      );
      // An office account belongs to the unit through users.unit_id only (no lecturer record).
      await pool.query(`UPDATE users SET unit_id=$1 WHERE id=$2`, [unitId, officer]);
      // A 90-minute meeting hosted by the head, an hour ago.
      const group = await createWorkspace(head, "Report test");
      workspaceId = group.id;
      const room = (await getWorkspaceChannels(head, group.id)).find(
        (channel) => channel.type === "video",
      );
      await pool.query(
        `INSERT INTO meeting_sessions(id,channel_id,host_id,started_at,ended_at) VALUES($1,$2,$3,now()-interval '150 minutes',now()-interval '60 minutes')`,
        [randomUUID(), room.id, head],
      );
      await pool.query(
        `INSERT INTO meeting_sessions(id,channel_id,host_id,started_at,ended_at) VALUES($1,$2,$3,now()-interval '50 minutes',now()-interval '20 minutes')`,
        [randomUUID(), room.id, officer],
      );
      await pool.query(
        `INSERT INTO courses(id,unit_id,owner_id,code,title,status) VALUES($1,$2,$3,$4,'Báo cáo QA','published')`,
        [courseId, unitId, head, `RPC${suffix}`],
      );
      await pool.query(
        `INSERT INTO course_enrollments(course_id,user_id,source,completed_at) VALUES($1,$2,'self',now())`,
        [courseId, learner],
      );

      const report = await unitReport(head, new URLSearchParams());
      assert.deepEqual(
        report.units.map((unit) => unit.unitId),
        [unitId],
        "only the head's own unit",
      );
      const [row] = report.units;
      assert.deepEqual(row.meetings, { sessions: 2, hours: 2 });
      assert.deepEqual(row.courses, { published: 1, enrolled: 1, completed: 1 });
      assert.deepEqual(row.calls, {
        offered: 0,
        answered: 0,
        abandoned: 0,
        callbacks: 0,
        answerRate: null,
      });

      // A day range before today has none of it; bad ranges and outsiders are refused.
      const old = await unitReport(
        head,
        new URLSearchParams({ from: "2026-01-01", to: "2026-01-31" }),
      );
      assert.deepEqual(old.units[0].meetings, { sessions: 0, hours: 0 });
      await assert.rejects(
        unitReport(head, new URLSearchParams({ from: "2026-02-01", to: "2026-01-01" })),
        (error) => error.code === "INVALID_INPUT",
      );
      await assert.rejects(
        unitReport(head, new URLSearchParams({ from: "01/02/2026" })),
        (error) => error.code === "INVALID_INPUT",
      );
      await assert.rejects(
        unitReport(outsider, new URLSearchParams()),
        (error) => error.code === "FORBIDDEN",
      );
    } finally {
      await pool.query(`DELETE FROM course_enrollments WHERE course_id=$1`, [courseId]);
      await pool.query(`DELETE FROM courses WHERE id=$1`, [courseId]);
      if (workspaceId) await pool.query(`DELETE FROM workspaces WHERE id=$1`, [workspaceId]);
      await pool.query(`DELETE FROM academic_staff WHERE unit_id=$1`, [unitId]);
      await pool.query(`DELETE FROM academic_units WHERE id=ANY($1::uuid[])`, [
        [unitId, otherUnit],
      ]);
      await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [
        [head, learner, outsider, officer],
      ]);
      await pool.end();
    }
  },
);
