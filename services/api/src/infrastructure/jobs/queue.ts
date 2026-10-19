import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { query } from "../database/db.js";

// Q3: durable job queue in PostgreSQL for media work (HLS transcodes, captions). Jobs survive a
// restart, and several API instances share them: a worker claims a row with FOR UPDATE SKIP
// LOCKED, so two workers never take the same job and neither waits for the other.
// Assumption: every instance sees the same MEDIA_DIR (one host, or a shared volume).

/** `last`: no retry follows if this attempt throws, so the handler records the failure itself. */
export type JobHandler = (refId: string, last: boolean) => Promise<void>;
export type Job = { id: string; kind: string; ref_id: string; attempts: number };

export const MAX_ATTEMPTS = 3;
/** A running job whose worker has not finished in this long is assumed dead and retried. */
const STALE_MINUTES = 60;
const POLL_MS = 2000;

const handlers = new Map<string, JobHandler>();
const workerId = `${hostname()}:${process.pid}`;
let wake: (() => void) | null = null;

export function registerJob(kind: string, handler: JobHandler) {
  handlers.set(kind, handler);
}

/** Queues work for `refId` unless the same work is already queued or running. */
export async function enqueueJob(kind: string, refId: string) {
  await query(
    `INSERT INTO media_jobs (id,kind,ref_id) VALUES ($1,$2,$3)
     ON CONFLICT (kind,ref_id) WHERE status IN ('queued','running') DO NOTHING`,
    [randomUUID(), kind, refId],
  );
  wake?.();
}

/** Takes the oldest ready job of the given kinds, or null. */
export async function claimJob(kinds: string[], worker = workerId): Promise<Job | null> {
  const result = await query<Job>(
    `UPDATE media_jobs SET status='running',attempts=attempts+1,locked_by=$2,locked_at=now(),updated_at=now()
     WHERE id=(SELECT id FROM media_jobs WHERE status='queued' AND run_after<=now() AND kind=ANY($1)
               ORDER BY run_after,created_at FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id,kind,ref_id,attempts`,
    [kinds, worker],
  );
  return result.rows[0] ?? null;
}

/** Done, or back in the queue with a growing delay, or failed after MAX_ATTEMPTS. */
export async function settleJob(job: Job, error: unknown = null) {
  if (error === null) {
    await query(`UPDATE media_jobs SET status='done',error=NULL,updated_at=now() WHERE id=$1`, [job.id]);
    return;
  }
  const retry = job.attempts < MAX_ATTEMPTS;
  await query(
    `UPDATE media_jobs SET status=$2,error=$3,locked_by=NULL,run_after=now()+make_interval(secs=>$4),updated_at=now() WHERE id=$1`,
    [job.id, retry ? "queued" : "failed", String(error).slice(0, 500), 30 * 2 ** (job.attempts - 1)],
  );
}

/** Crash recovery: jobs left "running" by a dead worker go back to the queue. */
export async function requeueStale(minutes = STALE_MINUTES) {
  const result = await query(
    `UPDATE media_jobs SET status='queued',locked_by=NULL,updated_at=now()
     WHERE status='running' AND locked_at < now()-make_interval(mins=>$1)`,
    [minutes],
  );
  return result.rowCount ?? 0;
}

/** One job at a time per instance: transcodes use every core FFmpeg is given. */
export function startJobWorker(log: (event: string, details?: Record<string, unknown>) => void) {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const loop = async () => {
    timer = null;
    if (stopped) return;
    try {
      await requeueStale();
      for (let job = await claimJob([...handlers.keys()]); job && !stopped; job = await claimJob([...handlers.keys()])) {
        const started = Date.now();
        try {
          await handlers.get(job.kind)!(job.ref_id, job.attempts >= MAX_ATTEMPTS);
          await settleJob(job);
          log("media_job_done", { kind: job.kind, refId: job.ref_id, ms: Date.now() - started });
        } catch (error) {
          await settleJob(job, error);
          log("media_job_failed", { kind: job.kind, refId: job.ref_id, attempt: job.attempts, message: String(error) });
        }
      }
    } catch (error) {
      log("media_job_worker_failed", { message: String(error) });
    }
    if (!stopped) timer = setTimeout(() => void loop(), POLL_MS);
  };
  // A job queued by this instance starts at once instead of at the next poll.
  wake = () => {
    if (timer) {
      clearTimeout(timer);
      void loop();
    }
  };
  void loop();
  return () => {
    stopped = true;
    wake = null;
    if (timer) clearTimeout(timer);
  };
}
