// Creates throw-away accounts and a group with a video room for the E2E run; global-teardown deletes them.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fixturesFile } from "./fixtures.mjs";

export default async function globalSetup() {
  const { pool } = await import("../dist/api/infrastructure/database/db.js");
  const { hashPassword } = await import("../dist/api/modules/auth/password.js");
  const { createWorkspace, addWorkspaceMember, getWorkspaceChannels } = await import("../dist/api/modules/workspaces/service.js");
  // Repeated local runs would hit the 10-logins-per-10-minutes limit of the loopback address.
  const buckets = ["::1", "127.0.0.1", "::ffff:127.0.0.1"].map((ip) => createHash("sha256").update(`login:${ip}`).digest("hex"));
  await pool.query(`DELETE FROM request_rate_limits WHERE bucket_key=ANY($1)`, [buckets]);
  const password = randomBytes(12).toString("base64url");
  const hash = await hashPassword(password);
  const users = {};
  // The pool stays open: teardown runs in this same process and ends it.
  {
    for (const [key, name] of [["admin", "E2E Quản trị"], ["alice", "E2E Alice"], ["bob", "E2E Bob"], ["carol", "E2E Carol"]]) {
      const id = randomUUID();
      const email = `e2e-${key}-${id.slice(0, 8)}@example.test`;
      await pool.query(`INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,$3,$4,true)`, [id, email, hash, name]);
      users[key] = { id, email, name };
    }
    await pool.query(`INSERT INTO academic_role_grants(id,user_id,role) VALUES($1,$2,'system_admin')`, [randomUUID(), users.admin.id]);
    const workspace = await createWorkspace(users.alice.id, `E2E ${Date.now()}`);
    await addWorkspaceMember(workspace.id, users.bob.id);
    const room = (await getWorkspaceChannels(users.alice.id, workspace.id)).find((channel) => channel.type === "video");
    await writeFile(fixturesFile, JSON.stringify({ password, users, workspaceId: workspace.id, roomId: room.id }));
  }
}
