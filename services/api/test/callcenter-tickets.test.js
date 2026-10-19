import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { URLSearchParams } from "node:url";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import { CallCenterRepository } from "../../../dist/api/modules/callcenter/repository/callcenter-repository.js";
import { CallCenterAdminService } from "../../../dist/api/modules/callcenter/service/admin-service.js";
import { CallCenterReportService } from "../../../dist/api/modules/callcenter/service/report-service.js";
import { CallCenterTicketService } from "../../../dist/api/modules/callcenter/service/ticket-service.js";

// CC-8 / CC-9 against PostgreSQL: automatic follow-up tickets, ticket workflow, KPI and CSV export.
test(
  "Call center tickets and KPI: follow-ups, workflow history, access and report",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 20000 },
  async () => {
    const [adminId, agentId, outsiderId] = [randomUUID(), randomUUID(), randomUUID()];
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const repo = new CallCenterRepository();
    const admin = new CallCenterAdminService(repo, () => null, async () => {}, () => {});
    const tickets = new CallCenterTicketService(repo, admin, () => null);
    const reports = new CallCenterReportService(repo, admin);
    const params = (values = {}) => new URLSearchParams(values);
    let departmentId;
    try {
      for (const id of [adminId, agentId, outsiderId])
        await pool.query(`INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,'x',$3)`, [
          id,
          `${id}@cc.test`,
          id === agentId ? "Agent Two" : "User",
        ]);
      await pool.query(`INSERT INTO academic_role_grants(id,user_id,role) VALUES($1,$2,'system_admin')`, [randomUUID(), adminId]);
      const from = 800000 + Math.floor(Math.random() * 9000) * 10;
      departmentId = (await admin.createDepartment(adminId, { code: `TK${tag}`, name: `Phòng ${tag}`, extensionFrom: from, extensionTo: from + 9 })).id;
      await admin.addMember(adminId, departmentId, { email: `${agentId}@cc.test`, role: "agent" });

      const call = async (fields) => {
        const id = randomUUID();
        await pool.query(
          `INSERT INTO cc_calls(id,linkedid,direction,department_id,caller_number,callee_number,agent_user_id,started_at,queued_at,answered_at,ended_at,outcome)
           VALUES($1,$2,'inbound',$3,$4,'19001234',$5,$6,$7,$8,$9,$10)`,
          [id, `l-${id}`, departmentId, fields.caller ?? "0912000111", fields.agent ?? null, fields.started, fields.queued, fields.answered ?? null, fields.ended, fields.outcome],
        );
        return id;
      };
      const t = (seconds) => new Date(Date.now() - 3_600_000 + seconds * 1000);

      // A missed call, then a voicemail from the same number: one ticket, two notes.
      const missedId = await call({ started: t(0), queued: t(2), ended: t(40), outcome: "abandoned" });
      await repo.missedCall({ callId: missedId, departmentId, callerNumber: "0912000111", callerUserId: null });
      const voicemailCall = await call({ started: t(100), queued: t(101), ended: t(200), outcome: "voicemail" });
      await repo.saveVoicemail({ callId: voicemailCall, departmentId, callerNumber: "0912000111", callerUserId: null, durationSeconds: 15, recordingKey: "vm-x" });
      let list = await tickets.list(agentId, params());
      assert.equal(list.length, 1, "repeat contact is appended, not duplicated");
      assert.equal(list[0].source, "missed_call");
      assert.match(list[0].code, /^TK-\d{6}$/);
      const detail = await tickets.get(agentId, list[0].id);
      assert.equal(detail.events.length, 1);
      assert.match(detail.events[0].body, /Thư thoại/);

      // Workflow: assign, call back, resolve; every step is in the history.
      await tickets.update(agentId, list[0].id, { assigneeId: agentId, status: "in_progress" });
      await tickets.addEvent(agentId, list[0].id, { kind: "callback", body: "Đã gọi lại, hẹn chiều mai." });
      const resolved = await tickets.update(agentId, list[0].id, { status: "resolved" });
      assert.equal(resolved.ticket.status, "resolved");
      assert.equal(resolved.ticket.assigneeName, "Agent Two");
      assert.deepEqual(resolved.events.map((event) => event.kind), ["comment", "status", "assign", "callback", "status"]);
      await assert.rejects(tickets.update(agentId, list[0].id, { assigneeId: outsiderId }), (error) => error.code === "INVALID_INPUT");
      await assert.rejects(tickets.get(outsiderId, list[0].id), (error) => error.code === "FORBIDDEN");
      await assert.rejects(
        pool.query(`UPDATE cc_ticket_events SET body='x' WHERE ticket_id=$1`, [list[0].id]),
        (error) => error.code === "55000",
        "history is append-only",
      );

      // After it is resolved, a new miss opens a fresh ticket.
      await repo.missedCall({ callId: missedId, departmentId, callerNumber: "0912000111", callerUserId: null });
      assert.equal((await tickets.list(agentId, params({ status: "open" }))).length, 1);

      // A ticket from an answered call carries the caller's number.
      const answered = await call({ started: t(300), queued: t(301), answered: t(311), ended: t(371), outcome: "answered", agent: agentId, caller: "0988777666" });
      const created = await tickets.create(agentId, { departmentId, callId: answered, subject: "Xin cấp lại bảng điểm", priority: "high" });
      assert.equal(created.ticket.callerNumber, "0988777666");
      assert.equal(created.ticket.source, "call");
      assert.equal((await tickets.list(agentId, params({ mine: "1" }))).length, 1, "only the resolved one is assigned to the agent");

      // CC-9 over the same calls: 3 offered, 1 answered in 10 s, 1 abandoned, 1 voicemail.
      await assert.rejects(reports.kpi(agentId, departmentId, params()), (error) => error.code === "FORBIDDEN", "agents see no KPI");
      // The calls are an hour old: name their day, or the test fails between 00:00 and 01:00.
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(t(0));
      const kpi = await reports.kpi(adminId, departmentId, params({ from: day }));
      assert.equal(kpi.offered, 3);
      assert.equal(kpi.answered, 1);
      assert.equal(kpi.asa, 10);
      assert.equal(kpi.aht, 60);
      assert.equal(kpi.serviceLevel, 0.5);
      const csv = await reports.exportCsv(adminId, departmentId, params({ from: day }));
      assert.equal(csv.content.split("\r\n").length, 4);
      assert.match(csv.content, /0988777666,Đã nghe,10,60,Agent Two/);
      await assert.rejects(reports.kpi(adminId, departmentId, params({ from: "2026-01-01", to: "2026-12-31" })), (error) => error.code === "INVALID_INPUT");
    } finally {
      if (departmentId) {
        await pool.query(`DELETE FROM cc_tickets WHERE department_id=$1`, [departmentId]);
        await pool.query(`DELETE FROM cc_voicemails WHERE department_id=$1`, [departmentId]);
        await pool.query(`DELETE FROM cc_calls WHERE department_id=$1`, [departmentId]);
        await pool.query(`DELETE FROM cc_departments WHERE unit_id=$1`, [departmentId]);
        await pool.query(`DELETE FROM academic_units WHERE id=$1`, [departmentId]);
      }
      await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[adminId, agentId, outsiderId]]);
      await pool.end();
    }
  },
);
