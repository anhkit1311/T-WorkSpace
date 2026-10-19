import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { test } from "node:test";

test(
  "media job queue: deduplicated, claimed once under concurrency, retried, then failed; stale jobs come back",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 30000 },
  async () => {
    const { pool } = await import("../../../dist/api/infrastructure/database/db.js");
    const { MAX_ATTEMPTS, claimJob, enqueueJob, requeueStale, settleJob } = await import("../../../dist/api/infrastructure/jobs/queue.js");
    const kind = `test_${randomUUID().slice(0, 8)}`;
    const [a, b] = [randomUUID(), randomUUID()];
    try {
      await enqueueJob(kind, a);
      await enqueueJob(kind, a); // same work twice → one job
      await enqueueJob(kind, b);
      const count = await pool.query(`SELECT count(*)::int AS n FROM media_jobs WHERE kind=$1`, [kind]);
      assert.equal(count.rows[0].n, 2);

      // Two workers at the same moment: SKIP LOCKED hands out different jobs, a third finds none.
      const [first, second, third] = await Promise.all([claimJob([kind], "w1"), claimJob([kind], "w2"), claimJob([kind], "w3")]);
      const claimed = [first, second, third].filter(Boolean);
      assert.equal(claimed.length, 2);
      assert.deepEqual(new Set(claimed.map((job) => job.ref_id)), new Set([a, b]));

      const jobA = claimed.find((job) => job.ref_id === a);
      const jobB = claimed.find((job) => job.ref_id === b);
      await settleJob(jobB);
      // While A is running another request for A is not a second job; once done, B may be queued again.
      await enqueueJob(kind, a);
      await enqueueJob(kind, b);
      const states = await pool.query(`SELECT ref_id,status FROM media_jobs WHERE kind=$1 ORDER BY created_at`, [kind]);
      assert.deepEqual(states.rows.map((row) => `${row.ref_id === a ? "a" : "b"}:${row.status}`).sort(), ["a:running", "b:done", "b:queued"]);
      await pool.query(`DELETE FROM media_jobs WHERE kind=$1 AND ref_id=$2 AND status='queued'`, [kind, b]);

      // Failure: back in the queue later (backoff), until the last attempt marks it failed.
      let job = jobA;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        assert.equal(job.attempts, attempt);
        await settleJob(job, new Error(`boom ${attempt}`));
        const row = (await pool.query(`SELECT status,run_after > now() AS later FROM media_jobs WHERE id=$1`, [job.id])).rows[0];
        if (attempt < MAX_ATTEMPTS) {
          assert.deepEqual(row, { status: "queued", later: true });
          assert.equal(await claimJob([kind]), null, "not before its backoff");
          await pool.query(`UPDATE media_jobs SET run_after=now() WHERE id=$1`, [job.id]);
          job = await claimJob([kind]);
        } else assert.equal(row.status, "failed");
      }

      // A worker that died mid-job: after the stale limit the job is queued again.
      await enqueueJob(kind, b);
      const orphan = await claimJob([kind], "dead-worker");
      await pool.query(`UPDATE media_jobs SET locked_at=now()-interval '2 hours' WHERE id=$1`, [orphan.id]);
      assert.ok((await requeueStale(60)) >= 1);
      assert.equal((await claimJob([kind], "w4")).id, orphan.id);
    } finally {
      await pool.query(`DELETE FROM media_jobs WHERE kind=$1`, [kind]);
      await pool.end();
    }
  },
);
