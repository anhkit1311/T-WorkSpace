import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { query } from "../../infrastructure/database/db.js";
import { HttpError } from "./http-error.js";

// PostgreSQL keeps limits consistent across API processes and restarts.
export async function limitRequest(
  request: IncomingMessage,
  category: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<void> {
  const forwarded = request.headers["x-forwarded-for"];
  const ip =
    process.env.TRUST_PROXY === "true" && typeof forwarded === "string"
      ? forwarded.split(",")[0].trim()
      : (request.socket.remoteAddress ?? "unknown");
  await limitActor(ip,category,maxAttempts,windowSeconds);
}
export async function limitActor(actor:string,category:string,maxAttempts:number,windowSeconds:number){
  const key = createHash("sha256").update(`${category}:${actor}`).digest("hex");
  const result = await query<{ attempts: number }>(
    `INSERT INTO request_rate_limits (bucket_key, window_start, attempts)
     VALUES ($1, now(), 1)
     ON CONFLICT (bucket_key) DO UPDATE SET
       attempts = CASE WHEN request_rate_limits.window_start < now() - ($2 * interval '1 second')
         THEN 1 ELSE request_rate_limits.attempts + 1 END,
       window_start = CASE WHEN request_rate_limits.window_start < now() - ($2 * interval '1 second')
         THEN now() ELSE request_rate_limits.window_start END
     RETURNING attempts`,
    [key, windowSeconds],
  );
  if (result.rows[0].attempts > maxAttempts) {
    throw new HttpError(429, "RATE_LIMITED", "Quá nhiều yêu cầu. Vui lòng thử lại sau.");
  }
}
