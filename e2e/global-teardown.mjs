import { readFile, rm } from "node:fs/promises";
import { fixturesFile } from "./fixtures.mjs";

export default async function globalTeardown() {
  const fixtures = JSON.parse(await readFile(fixturesFile, "utf8").catch(() => "null"));
  if (!fixtures) return;
  const { pool } = await import("../dist/api/infrastructure/database/db.js");
  const ids = Object.values(fixtures.users).map((user) => user.id);
  try {
    await pool.query(`DELETE FROM workspaces WHERE id=$1`, [fixtures.workspaceId]);
    await pool.query(`DELETE FROM meeting_sessions WHERE host_id=ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM academic_role_grants WHERE user_id=ANY($1::uuid[])`, [ids]);
    await pool.query(`DELETE FROM users WHERE id=ANY($1::uuid[]) AND email LIKE 'e2e-%@example.test'`, [ids]);
  } finally {
    await pool.end();
    await rm(fixturesFile, { force: true });
  }
}
