import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
process.env.JWT_SECRET = "activity-log-secret-at-least-32-characters";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import { logMediaAccess } from "../../../dist/api/infrastructure/operations/media-access.js";
import { listActivity } from "../../../dist/api/modules/academic/activity.js";

test(
  "Activity log: recording listens are recorded and only a system admin reads the log",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 30000 },
  async () => {
    const [admin, agent] = [randomUUID(), randomUUID()];
    const recordingId = randomUUID();
    try {
      for (const id of [admin, agent])
        await pool.query(
          `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only',$3,true)`,
          [id, `test-${id}@example.test`, `Activity QA ${id.slice(0, 4)}`],
        );
      await pool.query(`INSERT INTO academic_role_grants(id,user_id,role) VALUES($1,$2,'system_admin')`, [randomUUID(), admin]);

      await logMediaAccess(agent, "call", recordingId);
      await assert.rejects(listActivity(agent, new URLSearchParams()), (error) => error.code === "FORBIDDEN");
      const { items } = await listActivity(admin, new URLSearchParams({ source: "media" }));
      const mine = items.find((item) => item.target === recordingId.slice(0, 8));
      assert.ok(mine, "the listen is in the log");
      assert.deepEqual([mine.action, mine.actorName], ["media.call", `Activity QA ${agent.slice(0, 4)}`]);
      assert.ok(items.every((item) => item.source === "media"));
      const older = await listActivity(admin, new URLSearchParams({ source: "media", before: mine.at }));
      assert.ok(!older.items.some((item) => item.target === recordingId.slice(0, 8)), "the cursor pages past it");
      await assert.rejects(listActivity(admin, new URLSearchParams({ source: "x" })), (error) => error.code === "INVALID_INPUT");
    } finally {
      await pool.query(`DELETE FROM media_access_log WHERE ref_id=$1`, [recordingId]);
      await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[admin, agent]]);
      await pool.end();
    }
  },
);
