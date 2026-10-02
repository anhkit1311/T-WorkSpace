// Temporary development-only browser fixtures. Never select human accounts by pattern.
import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { pool } from "../../dist/api/infrastructure/database/db.js";
import { hashPassword } from "../../dist/api/modules/auth/password.js";
const recordPath = "docs/evidence/ui-member-qa.json";
const ownerId = "131b5564-0170-44d3-84e7-a93d7c588638";
const ownerEmail = `qa-core-${ownerId}@example.test`;
const workspaceIds = [
  "3c60aae6-eed0-44cd-8524-c4c6ab42df9b",
  "85193260-1b15-41bd-96d3-99a86c8eab3f",
];
try {
  if (process.argv[2] === "seed-member") {
    const id = randomUUID(),
      email = `qa-ui-${id}@example.test`;
    await pool.query(
      `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,$3,'QA thành viên',true)`,
      [id, email, await hashPassword("QaCore123!")],
    );
    await writeFile(recordPath, JSON.stringify({ id, email }, null, 2));
    console.log(JSON.stringify({ id, email }));
  } else if (process.argv[2] === "cleanup") {
    const member = JSON.parse(await readFile(recordPath, "utf8").catch(() => '{"id":null}'));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const owner = (await client.query(`SELECT email FROM users WHERE id=$1`, [ownerId])).rows[0];
      if (owner && owner.email !== ownerEmail) throw new Error("Owner QA identity mismatch");
      for (const id of workspaceIds) {
        const workspace = (await client.query(`SELECT owner_id FROM workspaces WHERE id=$1`, [id]))
          .rows[0];
        if (workspace && workspace.owner_id !== ownerId)
          throw new Error("Workspace owner mismatch");
        await client.query(`DELETE FROM workspaces WHERE id=$1`, [id]);
      }
      if (member.id) {
        const account = (await client.query(`SELECT email FROM users WHERE id=$1`, [member.id]))
          .rows[0];
        if (account && account.email !== member.email)
          throw new Error("Member QA identity mismatch");
        await client.query(`DELETE FROM users WHERE id=$1 AND email=$2`, [member.id, member.email]);
      }
      await client.query(`DELETE FROM users WHERE id=$1 AND email=$2`, [ownerId, ownerEmail]);
      await client.query("COMMIT");
      console.log("Only the exact recorded QA workspaces and accounts were removed.");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await unlink(recordPath).catch(() => {});
  } else throw new Error("Choose seed-member or cleanup");
} finally {
  await pool.end();
}
