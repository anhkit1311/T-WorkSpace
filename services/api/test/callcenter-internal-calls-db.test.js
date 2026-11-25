import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import { CallCenterRepository } from "../../../dist/api/modules/callcenter/repository/callcenter-repository.js";
import { VoipRepository } from "../../../dist/api/modules/callcenter/repository/voip-repository.js";
import { CallCenterAdminService } from "../../../dist/api/modules/callcenter/service/admin-service.js";
import { CallCenterAgentService } from "../../../dist/api/modules/callcenter/service/agent-service.js";

// Extension-to-extension history against PostgreSQL: owners resolved by number, each side sees its own view.
test(
  "Internal calls: saved with both owners, listed per user, kept out of hotline lists",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 20000 },
  async () => {
    const [adminId, anId, binhId, guestId] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    const repo = new CallCenterRepository();
    const voip = new VoipRepository();
    const admin = new CallCenterAdminService(
      repo,
      () => null,
      async () => {},
      () => {},
    );
    let departmentId;
    try {
      for (const [id, name] of [
        [adminId, "Admin"],
        [anId, "Nguyễn An"],
        [binhId, "Trần Bình"],
        [guestId, "Khách"],
      ])
        await pool.query(
          `INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,'x',$3)`,
          [id, `${id}@cc.test`, name],
        );
      await pool.query(
        `INSERT INTO academic_role_grants(id,user_id,role) VALUES($1,$2,'system_admin')`,
        [randomUUID(), adminId],
      );
      const from = 900000 + Math.floor(Math.random() * 9000) * 10;
      const tag = randomUUID().slice(0, 6).toUpperCase();
      departmentId = (
        await admin.createDepartment(adminId, {
          code: `CI${tag}`,
          name: `Nội bộ ${tag}`,
          extensionFrom: from,
          extensionTo: from + 9,
        })
      ).id;
      const [an, binh] = [String(from), String(from + 1)];
      for (const [number, userId] of [
        [an, anId],
        [binh, binhId],
      ])
        await pool.query(
          `INSERT INTO cc_extensions(id,number,department_id,user_id,sip_secret) VALUES($1,$2,$3,$4,$5)`,
          [randomUUID(), number, departmentId, userId, "s".repeat(16)],
        );

      // A personal extension is enough to dial from the directory; no extension, no directory.
      const agents = new CallCenterAgentService(
        repo,
        admin,
        () => null,
        () => null,
        "",
      );
      const directory = await agents.directory(anId);
      assert.ok(directory.extensions.some((ext) => ext.number === binh));
      assert.ok(!directory.extensions.some((ext) => ext.number === an), "not yourself");
      await assert.rejects(agents.directory(guestId), { statusCode: 403 });

      const linkedId = `test-${randomUUID()}`;
      const first = randomUUID();
      const at = (second) => new Date(Date.UTC(2026, 9, 24, 8, 0, second));
      await voip.saveInternalCall({
        id: first,
        linkedId,
        callerNumber: an,
        calleeNumber: binh,
        startedAt: at(0),
        answeredAt: at(5),
        endedAt: at(65),
        outcome: "answered",
        transferredFrom: null,
      });
      await voip.saveInternalCall({
        id: randomUUID(),
        linkedId: `${linkedId}#1`,
        callerNumber: binh,
        calleeNumber: "9999",
        startedAt: at(70),
        answeredAt: null,
        endedAt: at(80),
        outcome: "missed",
        transferredFrom: first,
      });

      const mine = await voip.recentCalls(anId);
      assert.equal(mine.length, 1);
      assert.deepEqual(
        {
          way: mine[0].way,
          number: mine[0].number,
          name: mine[0].name,
          durationSeconds: mine[0].durationSeconds,
          outcome: mine[0].outcome,
        },
        { way: "out", number: binh, name: "Trần Bình", durationSeconds: 60, outcome: "answered" },
      );
      const theirs = await voip.recentCalls(binhId);
      assert.deepEqual(
        theirs.map((call) => [call.way, call.number, call.outcome]),
        [
          ["out", "9999", "missed"],
          ["in", an, "answered"],
        ],
      );
      const hotline = await repo.calls({ departmentIds: null, agentUserId: binhId, limit: 200 });
      assert.ok(!hotline.some((call) => call.id === first), "not hotline work");
    } finally {
      await pool.query(
        `DELETE FROM cc_calls WHERE caller_user_id=ANY($1::uuid[]) OR agent_user_id=ANY($1::uuid[])`,
        [[anId, binhId]],
      );
      if (departmentId) {
        await pool.query(`DELETE FROM cc_extensions WHERE department_id=$1`, [departmentId]);
        await pool.query(`DELETE FROM cc_departments WHERE unit_id=$1`, [departmentId]);
        await pool.query(`DELETE FROM academic_units WHERE id=$1`, [departmentId]);
      }
      await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [
        [adminId, anId, binhId, guestId],
      ]);
      await pool.end();
    }
  },
);
