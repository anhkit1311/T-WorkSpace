import pg, { type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { config } from "../../config/config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 15000,
  query_timeout: 20000,
});
pool.on("error", (error) =>
  console.error(JSON.stringify({ level: "error", event: "db_pool_error", message: error.message })),
);

export function query<Row extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<Row>> {
  return pool.query<Row>(text, [...values]);
}

export async function withTransaction<Result>(
  operation: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
