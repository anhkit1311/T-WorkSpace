import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { pool } from "../../../dist/api/infrastructure/database/db.js";

// Schema guarantees of 025_call_center and 026_direct_messages, checked inside one rolled-back transaction.
test(
  "Call center and direct chat schema: access rows, pair uniqueness, CDR and ticket rules",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 20000 },
  async () => {
    const client = await pool.connect();
    const rejects = async (sql, params, code) => {
      await client.query("SAVEPOINT attempt");
      await assert.rejects(client.query(sql, params), (error) => error.code === code);
      await client.query("ROLLBACK TO SAVEPOINT attempt");
    };
    try {
      await client.query("BEGIN");
      const [low, high] = [randomUUID(), randomUUID()].sort();
      for (const id of [low, high])
        await client.query(
          `INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,'x','Tester')`,
          [id, `${id}@schema.test`],
        );

      const channel = randomUUID();
      await client.query(
        `INSERT INTO channels(id,workspace_id,created_by,name,type,kind) VALUES($1,NULL,$2,'direct','text','direct')`,
        [channel, low],
      );
      await client.query(`INSERT INTO direct_conversations(channel_id,user_low,user_high) VALUES($1,$2,$3)`, [
        channel,
        low,
        high,
      ]);
      const access = await client.query(
        `SELECT user_id,role,can_write FROM channel_access WHERE channel_id=$1 ORDER BY user_id`,
        [channel],
      );
      assert.deepEqual(
        access.rows.map((row) => [row.user_id, row.role, row.can_write]),
        [
          [low, "member", true],
          [high, "member", true],
        ],
      );
      await client.query(`INSERT INTO messages(id,channel_id,author_id,content) VALUES($1,$2,$3,'xin chào')`, [
        randomUUID(),
        channel,
        low,
      ]);

      const second = randomUUID();
      await client.query(
        `INSERT INTO channels(id,workspace_id,created_by,name,type,kind) VALUES($1,NULL,$2,'direct','text','direct')`,
        [second, low],
      );
      await rejects(
        `INSERT INTO direct_conversations(channel_id,user_low,user_high) VALUES($1,$2,$3)`,
        [second, low, high],
        "23505",
      );
      await rejects(
        `INSERT INTO direct_conversations(channel_id,user_low,user_high) VALUES($1,$2,$3)`,
        [second, high, low],
        "23514",
      );
      await rejects(
        `INSERT INTO channels(id,workspace_id,created_by,name,type) VALUES($1,NULL,$2,'x','text')`,
        [randomUUID(), low],
        "23514",
      );

      const unit = randomUUID();
      await client.query(`INSERT INTO academic_units(id,code,name,kind) VALUES($1,$2,'Phòng Đại học','office')`, [
        unit,
        `T${unit.slice(0, 8).toUpperCase()}`,
      ]);
      await client.query(`INSERT INTO cc_departments(unit_id,extension_from,extension_to) VALUES($1,1100,1199)`, [unit]);
      const call = randomUUID();
      await client.query(
        `INSERT INTO cc_calls(id,linkedid,direction,caller_number,callee_number,department_id)
         VALUES($1,$2,'inbound','0909123456','19001234',$3)`,
        [call, `test-${call}`, unit],
      );
      await rejects(`UPDATE cc_calls SET ended_at=now() WHERE id=$1`, [call], "23514");
      await rejects(`UPDATE cc_calls SET ended_at=now(), outcome='answered' WHERE id=$1`, [call], "23514");
      await client.query(`UPDATE cc_calls SET ended_at=now(), outcome='abandoned' WHERE id=$1`, [call]);

      const agent = randomUUID();
      await client.query(`INSERT INTO cc_agent_states(id,user_id,state) VALUES($1,$2,'ready')`, [agent, low]);
      await rejects(`INSERT INTO cc_agent_states(id,user_id,state) VALUES($1,$2,'on_call')`, [randomUUID(), low], "23505");

      const ticket = randomUUID();
      await client.query(
        `INSERT INTO cc_tickets(id,department_id,source,call_id,subject,caller_number)
         VALUES($1,$2,'missed_call',$3,'Gọi nhỡ','0909123456')`,
        [ticket, unit, call],
      );
      await rejects(`UPDATE cc_tickets SET status='resolved' WHERE id=$1`, [ticket], "23514");
      await client.query(`UPDATE cc_tickets SET status='resolved', resolved_at=now() WHERE id=$1`, [ticket]);
      const event = randomUUID();
      await client.query(
        `INSERT INTO cc_ticket_events(id,ticket_id,actor_id,kind,from_status,to_status) VALUES($1,$2,$3,'status','open','resolved')`,
        [event, ticket, low],
      );
      await rejects(`UPDATE cc_ticket_events SET body='sửa' WHERE id=$1`, [event], "55000");
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  },
);
