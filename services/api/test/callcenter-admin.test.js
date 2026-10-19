import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { URLSearchParams } from "node:url";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import { CallCenterRepository } from "../../../dist/api/modules/callcenter/repository/callcenter-repository.js";
import { CallCenterAdminService } from "../../../dist/api/modules/callcenter/service/admin-service.js";
import { CallCenterAgentService } from "../../../dist/api/modules/callcenter/service/agent-service.js";

// NT-2 / CC-2 against PostgreSQL: departments, members, extensions pushed to a fake PBX, permissions.
test(
  "Call center admin: departments, members, extensions and access rules",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 20000 },
  async () => {
    const [adminId, agentId, outsiderId] = [randomUUID(), randomUUID(), randomUUID()];
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const pushed = [];
    const removed = [];
    const pbx = {
      pushExtension: async (input) => void pushed.push(input),
      removeExtension: async (number) => void removed.push(number),
    };
    let rosterChanges = 0;
    const repo = new CallCenterRepository();
    const admin = new CallCenterAdminService(repo, () => pbx, async () => void rosterChanges++, () => {});
    const agents = new CallCenterAgentService(repo, admin, () => null, () => null, "wss://pbx.tdtu.local:8089/ws");
    let departmentId;
    try {
      for (const id of [adminId, agentId, outsiderId])
        await pool.query(`INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,'x',$3)`, [
          id,
          `${id}@cc.test`,
          id === agentId ? "Agent One" : "User",
        ]);
      await pool.query(`INSERT INTO academic_role_grants(id,user_id,role) VALUES($1,$2,'system_admin')`, [randomUUID(), adminId]);

      await assert.rejects(admin.createDepartment(outsiderId, {}), (error) => error.code === "FORBIDDEN");
      const from = 900000 + Math.floor(Math.random() * 9000) * 10;
      const department = await admin.createDepartment(adminId, {
        code: `CC${tag}`,
        name: `Phòng tuyển sinh ${tag}`,
        extensionFrom: from,
        extensionTo: from + 9,
        strategy: "round_robin",
      });
      departmentId = department.id;
      assert.equal(department.strategy, "round_robin");
      assert.equal(department.ringSeconds, 20);
      await assert.rejects(
        admin.createDepartment(adminId, { code: `CD${tag}`, name: "Overlap", extensionFrom: from + 5, extensionTo: from + 20 }),
        (error) => error.code === "RANGE_OVERLAP",
      );

      const withHours = await admin.setHours(adminId, departmentId, {
        hours: [{ weekday: 1, opens: "07:30", closes: "17:00" }],
      });
      assert.deepEqual(withHours.hours, [{ weekday: 1, opens: "07:30", closes: "17:00" }]);
      await assert.rejects(
        admin.setHours(adminId, departmentId, { hours: [{ weekday: 1, opens: "18:00", closes: "08:00" }] }),
        (error) => error.code === "INVALID_INPUT",
      );

      await admin.addMember(adminId, departmentId, { email: `${agentId}@cc.test`, role: "agent" });
      await assert.rejects(
        admin.createExtension(adminId, { departmentId, userId: outsiderId }),
        (error) => error.code === "INVALID_INPUT",
        "only members get an extension",
      );
      const { extension, secret } = await admin.createExtension(adminId, { departmentId, userId: agentId });
      assert.equal(extension.number, String(from), "first free number of the range");
      assert.ok(extension.syncedAt, "pushed to the PBX");
      assert.deepEqual(pushed.at(-1), { number: String(from), secret, transport: "webrtc", callerName: "Agent One" });
      assert.ok(!("secret" in (await admin.listExtensions(adminId))[0]), "secret never listed");
      assert.ok(rosterChanges >= 2);

      const sip = await agents.sipAccount(agentId);
      assert.deepEqual(sip, { number: String(from), secret, wsUrl: "wss://pbx.tdtu.local:8089/ws", domain: "pbx.tdtu.local" });
      const me = await agents.me(agentId);
      assert.deepEqual(me.departments, [{ id: departmentId, name: `Phòng tuyển sinh ${tag}`, role: "agent" }]);
      assert.deepEqual(me.extension, { number: String(from), transport: "webrtc" });
      await assert.rejects(agents.sipAccount(outsiderId), (error) => error.code === "NOT_FOUND");
      await assert.rejects(agents.setState(agentId, { state: "ready" }), (error) => error.code === "CALL_CENTER_OFFLINE");
      await assert.rejects(admin.listExtensions(agentId), (error) => error.code === "FORBIDDEN", "agents see no extension list");

      const reset = await admin.resetSecret(adminId, extension.id);
      assert.notEqual(reset.secret, secret);
      assert.equal((await agents.sipAccount(agentId)).secret, reset.secret);
      await admin.updateExtension(adminId, extension.id, { active: false });
      assert.deepEqual(removed, [String(from)]);

      const callId = randomUUID();
      await pool.query(
        `INSERT INTO cc_calls(id,linkedid,direction,department_id,caller_number,callee_number,agent_user_id)
         VALUES($1,$2,'inbound',$3,'0912345678','19001234',$4)`,
        [callId, `linked-${callId}`, departmentId, agentId],
      );
      assert.equal((await agents.calls(agentId, new URLSearchParams())).length, 1, "agent sees own calls");
      await assert.rejects(agents.calls(outsiderId, new URLSearchParams()), (error) => error.code === "FORBIDDEN");
      const { id: dispositionId } = await admin.createDisposition(adminId, { departmentId, code: "INFO", label: "Tư vấn" });
      await agents.wrapUp(agentId, callId, { dispositionId, notes: "Hỏi về học phí" });
      const [saved] = await agents.calls(agentId, new URLSearchParams());
      assert.equal(saved.dispositionId, dispositionId);
      assert.equal(saved.notes, "Hỏi về học phí");
      await assert.rejects(agents.recording(agentId, callId), (error) => error.code === "NOT_FOUND");
    } finally {
      if (departmentId) {
        await pool.query(`DELETE FROM cc_calls WHERE department_id=$1`, [departmentId]);
        await pool.query(`DELETE FROM cc_extensions WHERE department_id=$1`, [departmentId]);
        await pool.query(`DELETE FROM cc_departments WHERE unit_id=$1`, [departmentId]);
        await pool.query(`DELETE FROM academic_units WHERE id=$1`, [departmentId]);
      }
      await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[adminId, agentId, outsiderId]]);
      await pool.end();
    }
  },
);
