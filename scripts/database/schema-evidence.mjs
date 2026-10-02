import { writeFile } from "node:fs/promises";
import { pool } from "../../dist/api/infrastructure/database/db.js";
try {
  const [columns, constraints, indexes, migrations] = await Promise.all([
    pool.query(
      `SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`,
    ),
    pool.query(
      `SELECT conrelid::regclass::text AS table_name,conname AS name,contype AS type,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY conrelid::regclass::text,conname`,
    ),
    pool.query(
      `SELECT tablename AS table_name,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`,
    ),
    pool.query(`SELECT name FROM schema_migrations ORDER BY name`),
  ]);
  await writeFile(
    "docs/evidence/schema-2026-10-01.json",
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        columns: columns.rows,
        constraints: constraints.rows,
        indexes: indexes.rows,
        migrations: migrations.rows,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      relations: [...new Set(columns.rows.map((r) => r.table_name))],
      migrations: migrations.rowCount,
      constraints: constraints.rowCount,
      indexes: indexes.rowCount,
    }),
  );
} finally {
  await pool.end();
}
