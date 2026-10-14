import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "../infrastructure/database/db.js";

const bundledMigrationsDirectory = fileURLToPath(new URL("../../migrations", import.meta.url));
const sourceMigrationsDirectory = fileURLToPath(
  new URL("../../../services/api/migrations", import.meta.url),
);

async function migrate(): Promise<void> {
  const migrationsDirectory = await access(bundledMigrationsDirectory)
    .then(() => bundledMigrationsDirectory)
    .catch(() => sourceMigrationsDirectory);
  const runner=await pool.connect();
  try {
  await runner.query(`SELECT pg_advisory_lock(778921402)`);
  await runner.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = await readFile(`${migrationsDirectory}/${file}`, "utf8");
    // Hash LF-normalized text so a Windows CRLF checkout matches the LF blob stored in git.
    const checksum = createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
    const existing = await runner.query<{ checksum: string }>(
      `SELECT checksum FROM schema_migrations WHERE name = $1`,
      [file],
    );

    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== checksum) {
        throw new Error(`Migration ${file} was modified after being applied`);
      }
      console.log(`skip ${file}`);
      continue;
    }

    const client = runner;
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)`, [
        file,
        checksum,
      ]);
      await client.query("COMMIT");
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  } finally {await runner.query(`SELECT pg_advisory_unlock(778921402)`);runner.release();}
}

migrate()
  .then(() => pool.end())
  .catch(async (error: unknown) => {
    console.error(error);
    await pool.end();
    process.exitCode = 1;
  });
