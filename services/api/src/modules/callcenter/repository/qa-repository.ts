import { randomUUID } from "node:crypto";
import type { CcQaCriterion, CcQaReview } from "@doan/shared";
import { query, withTransaction } from "../../../infrastructure/database/db.js";
import { notify } from "../../academic/access.js";
import type { QaScoreItem } from "../domain/qa.js";

const REVIEW = `SELECT r.id,r.call_id AS "callId",r.department_id AS "departmentId",r.agent_id AS "agentId",au.display_name AS "agentName",
  ru.display_name AS "reviewerName",c.started_at AS "callStartedAt",c.caller_number AS "callerNumber",r.scores AS items,
  r.percent::float8 AS percent,r.comment,r.coaching_assigned AS "coachingAssigned",r.created_at AS "createdAt"
  FROM cc_qa_reviews r JOIN cc_calls c ON c.id=r.call_id JOIN users au ON au.id=r.agent_id LEFT JOIN users ru ON ru.id=r.reviewer_id`;

type ReviewRow = Omit<CcQaReview, "callStartedAt" | "createdAt"> & { callStartedAt: Date; createdAt: Date };
const toReview = (row: ReviewRow): CcQaReview => ({ ...row, callStartedAt: row.callStartedAt.toISOString(), createdAt: row.createdAt.toISOString() });

/** V7 / E2 persistence: scorecards, reviews, and the coaching assignment they trigger. */
export class QaRepository {
  async criteria(departmentId: string): Promise<CcQaCriterion[]> {
    return (
      await query<CcQaCriterion>(`SELECT id,label,weight FROM cc_qa_criteria WHERE department_id=$1 AND active ORDER BY position`, [departmentId])
    ).rows;
  }

  /** Replaces the sheet; removed criteria are deactivated so past reviews keep their snapshot. */
  async saveCriteria(departmentId: string, criteria: { id: string | null; label: string; weight: number }[]) {
    await withTransaction(async (client) => {
      await client.query(`UPDATE cc_qa_criteria SET active=false WHERE department_id=$1`, [departmentId]);
      for (const [position, criterion] of criteria.entries())
        await client.query(
          `INSERT INTO cc_qa_criteria(id,department_id,label,weight,position,active) VALUES($1,$2,$3,$4,$5,true)
           ON CONFLICT (id) DO UPDATE SET label=$3,weight=$4,position=$5,active=true WHERE cc_qa_criteria.department_id=$2`,
          [criterion.id ?? randomUUID(), departmentId, criterion.label, criterion.weight, position],
        );
    });
  }

  async callForReview(callId: string) {
    return (
      await query<{ id: string; departmentId: string | null; agentId: string | null; answeredAt: Date | null; endedAt: Date | null }>(
        `SELECT id,department_id AS "departmentId",agent_user_id AS "agentId",answered_at AS "answeredAt",ended_at AS "endedAt" FROM cc_calls WHERE id=$1`,
        [callId],
      )
    ).rows[0] ?? null;
  }

  async review(callId: string): Promise<CcQaReview | null> {
    const row = (await query<ReviewRow>(`${REVIEW} WHERE r.call_id=$1`, [callId])).rows[0];
    return row ? toReview(row) : null;
  }

  async reviews(filter: { departmentIds: string[] | null; agentId: string | null; limit: number }): Promise<CcQaReview[]> {
    return (
      await query<ReviewRow>(
        `${REVIEW} WHERE ($1::uuid[] IS NULL OR r.department_id=ANY($1::uuid[])) AND ($2::uuid IS NULL OR r.agent_id=$2)
         ORDER BY r.created_at DESC LIMIT $3`,
        [filter.departmentIds, filter.agentId, filter.limit],
      )
    ).rows.map(toReview);
  }

  /**
   * Saves (or re-scores) the review. With `coachingCourseId` the agent is enrolled in that course and
   * notified, in the same transaction, so a review never assigns twice.
   */
  async saveReview(input: {
    callId: string;
    departmentId: string;
    agentId: string;
    reviewerId: string;
    items: QaScoreItem[];
    percent: number;
    comment: string;
    coachingCourseId: string | null;
  }) {
    await withTransaction(async (client) => {
      const saved = await client.query<{ id: string; coaching_assigned: boolean }>(
        `INSERT INTO cc_qa_reviews(id,call_id,department_id,agent_id,reviewer_id,scores,percent,comment)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (call_id) DO UPDATE SET reviewer_id=$5,scores=$6,percent=$7,comment=$8,updated_at=now()
         RETURNING id,coaching_assigned`,
        [randomUUID(), input.callId, input.departmentId, input.agentId, input.reviewerId, JSON.stringify(input.items), input.percent, input.comment],
      );
      if (!input.coachingCourseId || saved.rows[0].coaching_assigned) return;
      await client.query(
        `INSERT INTO course_enrollments(course_id,user_id,source,assigned_by) VALUES($1,$2,'assigned',$3)
         ON CONFLICT DO NOTHING`,
        [input.coachingCourseId, input.agentId, input.reviewerId],
      );
      await client.query(`UPDATE cc_qa_reviews SET coaching_assigned=true WHERE id=$1`, [saved.rows[0].id]);
      const course = (await client.query<{ code: string; title: string }>(`SELECT code,title FROM courses WHERE id=$1`, [input.coachingCourseId])).rows[0];
      await notify(client, [input.agentId], "coaching_assigned", "course", input.coachingCourseId,
        `Bạn được gán khóa bồi dưỡng ${course.code} — ${course.title} sau buổi chấm điểm cuộc gọi (${input.percent}%).`);
    });
  }
}
