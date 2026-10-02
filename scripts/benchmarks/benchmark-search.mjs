import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { pool } from "../../dist/api/infrastructure/database/db.js";
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const user = randomUUID(),
    workspace = randomUUID(),
    channel = randomUUID();
  await client.query(
    `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only','Search benchmark',true)`,
    [user, `test-${user}@example.test`],
  );
  await client.query(
    `INSERT INTO workspaces(id,name,slug,owner_id) VALUES($1,'Search benchmark',$3,$2)`,
    [workspace, user, workspace],
  );
  await client.query(`INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')`, [
    workspace,
    user,
  ]);
  await client.query(
    `INSERT INTO channels(id,workspace_id,created_by,name,type,position) VALUES($1,$2,$3,'benchmark','text',1)`,
    [channel, workspace, user],
  );
  await client.query(
    `INSERT INTO messages(id,channel_id,author_id,content) SELECT gen_random_uuid(),$1,$2,CASE WHEN n%20=0 THEN 'Đồ án tiếng Việt: hoàn thiện giao tiếp '||n ELSE 'Trao đổi công việc '||n END FROM generate_series(1,10000) n`,
    [channel, user],
  );
  const sql = `SELECT m.id FROM messages m JOIN channel_access access ON access.channel_id=m.channel_id AND access.user_id=$1 WHERE m.deleted_at IS NULL AND m.content ILIKE $2 AND m.channel_id=$3 ORDER BY m.created_at DESC,m.id DESC LIMIT 30`;
  const samples = [];
  for (let n = 0; n < 10; n++) {
    const start = performance.now();
    await client.query(sql, [user, "%tiếng Việt%", channel]);
    samples.push(performance.now() - start);
  }
  const plan = await client.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${sql}`, [
    user,
    "%tiếng Việt%",
    channel,
  ]);
  console.log(
    JSON.stringify(
      {
        date: new Date().toISOString(),
        node: process.version,
        postgres: (await client.query("SHOW server_version")).rows[0].server_version,
        conditions:
          "Single local PostgreSQL, transaction fixture 10000 rows, channel filter, warm 10 samples. Not load or production evidence.",
        samplesMs: samples,
        plan: plan.rows[0]["QUERY PLAN"],
      },
      null,
      2,
    ),
  );
} finally {
  await client.query("ROLLBACK");
  client.release();
  await pool.end();
}
