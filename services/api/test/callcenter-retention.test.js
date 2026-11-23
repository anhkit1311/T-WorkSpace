import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import { CallCenterRepository } from "../../../dist/api/modules/callcenter/repository/callcenter-repository.js";
import { VoipRepository } from "../../../dist/api/modules/callcenter/repository/voip-repository.js";
import { CallCenterAdminService } from "../../../dist/api/modules/callcenter/service/admin-service.js";

// BR-08 and BR-17 against PostgreSQL: the housekeeping jobs that runHousekeeping() calls every 10 minutes.
// Both jobs act on the whole table, like in production, so the test only asserts on its own rows.
test(
  "Call center housekeeping: quiet resolved tickets close (BR-08), old recordings expire (BR-17)",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 20000 },
  async () => {
    const adminId = randomUUID();
    const tag = randomUUID().slice(0, 6).toUpperCase();
    const voip = new VoipRepository();
    const admin = new CallCenterAdminService(
      new CallCenterRepository(),
      () => null,
      async () => {},
      () => {},
    );
    const daysAgo = (days) => new Date(Date.now() - days * 86_400_000);
    let departmentId;
    try {
      await pool.query(
        `INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,'x','Admin')`,
        [adminId, `${adminId}@cc.test`],
      );
      await pool.query(
        `INSERT INTO academic_role_grants(id,user_id,role) VALUES($1,$2,'system_admin')`,
        [randomUUID(), adminId],
      );
      const from = 700000 + Math.floor(Math.random() * 9000) * 10;
      departmentId = (
        await admin.createDepartment(adminId, {
          code: `RT${tag}`,
          name: `Phòng ${tag}`,
          extensionFrom: from,
          extensionTo: from + 9,
        })
      ).id;

      const ticket = async (status, updatedDaysAgo, voicemailId = null) => {
        const id = randomUUID();
        const at = daysAgo(updatedDaysAgo);
        await pool.query(
          `INSERT INTO cc_tickets(id,department_id,source,voicemail_id,subject,status,created_at,updated_at,resolved_at)
           VALUES($1,$2,$3,$4,'Hỏi học phí',$5,$6,$6,$7)`,
          [
            id,
            departmentId,
            voicemailId ? "voicemail" : "manual",
            voicemailId,
            status,
            at,
            ["resolved", "closed"].includes(status) ? at : null,
          ],
        );
        return id;
      };
      const statusOf = async (id) =>
        (await pool.query(`SELECT status FROM cc_tickets WHERE id=$1`, [id])).rows[0].status;
      const closeEvents = async (id) =>
        (
          await pool.query(
            `SELECT actor_id,from_status,to_status FROM cc_ticket_events WHERE ticket_id=$1 AND kind='status'`,
            [id],
          )
        ).rows;

      // ---- BR-08: resolved for 3 days with no reply → closed ------------------------------------
      const quiet = await ticket("resolved", 4);
      const recent = await ticket("resolved", 1);
      const stillOpen = await ticket("open", 10);

      assert.ok((await voip.closeQuietTickets(3)) >= 1);
      assert.equal(await statusOf(quiet), "closed", "resolved 4 days ago closes");
      assert.equal(await statusOf(recent), "resolved", "resolved yesterday stays resolved");
      assert.equal(await statusOf(stillOpen), "open", "only resolved tickets close, however old");
      assert.deepEqual(
        await closeEvents(quiet),
        [{ actor_id: null, from_status: "resolved", to_status: "closed" }],
        "the history shows the system closed it",
      );
      await voip.closeQuietTickets(3);
      assert.equal((await closeEvents(quiet)).length, 1, "running again adds nothing");
      assert.deepEqual(await closeEvents(recent), []);

      // ---- BR-17: recordings and voicemails older than 90 days go -------------------------------
      const call = async (startedDaysAgo, recordingKey) => {
        const id = randomUUID();
        await pool.query(
          `INSERT INTO cc_calls(id,linkedid,direction,department_id,caller_number,callee_number,started_at,answered_at,ended_at,outcome,recording_key)
           VALUES($1,$2,'inbound',$3,'0912000111','9000',$4,$4,$4,'answered',$5)`,
          [id, `rt-${id}`, departmentId, daysAgo(startedDaysAgo), recordingKey],
        );
        return id;
      };
      const voicemail = async (receivedDaysAgo, recordingKey) => {
        const id = randomUUID();
        await pool.query(
          `INSERT INTO cc_voicemails(id,department_id,caller_number,duration_seconds,recording_key,received_at)
           VALUES($1,$2,'0912000111',12,$3,$4)`,
          [id, departmentId, recordingKey, daysAgo(receivedDaysAgo)],
        );
        return id;
      };
      const k = (name) => `${name}-${tag}`;
      const oldCall = await call(100, k("call-old"));
      const newCall = await call(10, k("call-new"));
      const oldVoicemail = await voicemail(100, k("vm-old"));
      const linkedVoicemail = await voicemail(100, k("vm-linked"));
      const newVoicemail = await voicemail(10, k("vm-new"));
      const linkedTicket = await ticket("open", 100, linkedVoicemail);

      // Calls go 500 per run (the job runs every 10 minutes); loop like the schedule would.
      const expired = [];
      for (let run = 0; run < 20; run++) {
        const keys = await voip.expireRecordings(90);
        expired.push(...keys);
        if (!keys.length) break;
      }
      const ours = expired.filter((key) => key.endsWith(tag)).sort();
      assert.deepEqual(
        ours,
        [k("call-old"), k("vm-linked"), k("vm-old")],
        "old keys are handed back so the files can be deleted",
      );

      const callKey = async (id) =>
        (await pool.query(`SELECT recording_key FROM cc_calls WHERE id=$1`, [id])).rows[0]
          .recording_key;
      assert.equal(await callKey(oldCall), null, "the call row stays, only the recording goes");
      assert.equal(await callKey(newCall), k("call-new"));

      const vm = async (id) =>
        (await pool.query(`SELECT recording_key FROM cc_voicemails WHERE id=$1`, [id])).rows[0];
      assert.equal(await vm(oldVoicemail), undefined, "an unlinked old voicemail is deleted");
      assert.equal(
        (await vm(linkedVoicemail)).recording_key,
        "",
        "a ticket's voicemail keeps its row",
      );
      assert.equal(await statusOf(linkedTicket), "open", "the ticket is untouched");
      assert.equal((await vm(newVoicemail)).recording_key, k("vm-new"));

      const again = (await voip.expireRecordings(90)).filter((key) => key.endsWith(tag));
      assert.deepEqual(again, [], "nothing is handed back twice");
    } finally {
      if (departmentId) {
        await pool.query(`DELETE FROM cc_tickets WHERE department_id=$1`, [departmentId]);
        await pool.query(`DELETE FROM cc_voicemails WHERE department_id=$1`, [departmentId]);
        await pool.query(`DELETE FROM cc_calls WHERE department_id=$1`, [departmentId]);
        await pool.query(`DELETE FROM cc_departments WHERE unit_id=$1`, [departmentId]);
        await pool.query(`DELETE FROM academic_units WHERE id=$1`, [departmentId]);
      }
      await pool.query(`DELETE FROM users WHERE id=$1`, [adminId]);
      await pool.end();
    }
  },
);
