import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { CouncilPresenter, CouncilRole, CouncilSheet, CouncilView } from "@doan/shared";
import { query, withTransaction } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";
import { validateId } from "../workspaces/service.js";
import { studentIdFromEmail } from "./attendance.js";
import type { Table } from "../../shared/http/table-export.js";

// NV-MT3 họp hội đồng on top of a meeting schedule. The organizer sets up members, criteria and
// presenters; the chair runs the presentations; members score; the chair finalizes (BR-12).

type ScheduleRow = { id: string; channel_id: string; title: string; can_manage: boolean };
type Change = { roomId: string; sessionId: string | null };
// A pool client inside a transaction, or the pool itself for reads.
type Db = { query: typeof query };

/** The schedule as seen by `userId`, who must be able to open its room. */
async function scheduleFor(db: Db, userId: string, scheduleId: unknown) {
  validateId(scheduleId);
  const row = (
    await db.query<ScheduleRow>(
      `SELECT s.id,s.channel_id,s.title,(s.created_by=$2 OR m.role IN ('owner','admin')) AS can_manage
       FROM meeting_schedules s JOIN channel_access m ON m.channel_id=s.channel_id AND m.user_id=$2
       WHERE s.id=$1 AND s.canceled_at IS NULL`,
      [scheduleId, userId],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, "SCHEDULE_NOT_FOUND", "Không tìm thấy lịch họp.");
  return row;
}

async function councilRole(db: Db, scheduleId: string, userId: string) {
  return (
    await db.query<{ role: CouncilRole; absent: boolean }>(
      `SELECT role,absent FROM council_members WHERE schedule_id=$1 AND user_id=$2`,
      [scheduleId, userId],
    )
  ).rows[0];
}

/** Presenter row locked for the change, with the caller's council role. */
async function lockPresenter(client: PoolClient, userId: string, presenterId: unknown) {
  validateId(presenterId);
  const presenter = (
    await client.query<{ id: string; schedule_id: string; finalized_at: Date | null }>(
      `SELECT id,schedule_id,finalized_at FROM council_presenters WHERE id=$1 FOR UPDATE`,
      [presenterId],
    )
  ).rows[0];
  if (!presenter)
    throw new HttpError(404, "PRESENTER_NOT_FOUND", "Không tìm thấy người trình bày.");
  const schedule = await scheduleFor(client, userId, presenter.schedule_id);
  if (presenter.finalized_at)
    throw new HttpError(
      409,
      "COUNCIL_FINALIZED",
      "Kết quả đã được chủ tịch chốt, không thể thay đổi.",
    );
  return { presenter, schedule, member: await councilRole(client, schedule.id, userId) };
}

const requireChair = (member: { role: CouncilRole } | undefined) => {
  if (member?.role !== "chair")
    throw new HttpError(403, "CHAIR_ONLY", "Chỉ chủ tịch hội đồng thực hiện được thao tác này.");
};

async function changeFor(db: Db, schedule: ScheduleRow): Promise<Change> {
  const live = await db.query<{ id: string }>(
    `SELECT id FROM meeting_sessions WHERE schedule_id=$1 AND ended_at IS NULL`,
    [schedule.id],
  );
  return { roomId: schedule.channel_id, sessionId: live.rows[0]?.id ?? null };
}

/** Weighted total of one sheet on the 10-point scale. */
export function sheetTotal(
  scores: Record<string, number>,
  criteria: { id: string; weight: number }[],
) {
  return (
    Math.round(criteria.reduce((sum, item) => sum + (scores[item.id] ?? 0) * item.weight, 0)) / 100
  );
}

export async function getCouncil(userId: string, scheduleId: unknown): Promise<CouncilView | null> {
  const schedule = await scheduleFor({ query }, userId, scheduleId);
  const members = (
    await query<{ userId: string; displayName: string; role: CouncilRole; absent: boolean }>(
      `SELECT m.user_id AS "userId",u.display_name AS "displayName",m.role,m.absent
       FROM council_members m JOIN users u ON u.id=m.user_id
       WHERE m.schedule_id=$1 ORDER BY (m.role='chair') DESC,u.display_name,m.user_id`,
      [schedule.id],
    )
  ).rows;
  if (!members.length) return null;
  const myRole = members.find((member) => member.userId === userId)?.role ?? null;
  const criteria = (
    await query<{ id: string; label: string; weight: number }>(
      `SELECT id,label,weight FROM council_criteria WHERE schedule_id=$1 ORDER BY position`,
      [schedule.id],
    )
  ).rows;
  const presenters = (
    await query<{
      id: string;
      userId: string;
      displayName: string;
      email: string;
      topic: string;
      status: CouncilPresenter["status"];
      finalScore: number | null;
      conclusion: string | null;
      finalizedAt: string | null;
    }>(
      `SELECT p.id,p.user_id AS "userId",u.display_name AS "displayName",u.email,p.topic,p.status,
        p.final_score::float8 AS "finalScore",p.conclusion,p.finalized_at AS "finalizedAt"
       FROM council_presenters p JOIN users u ON u.id=p.user_id
       WHERE p.schedule_id=$1 ORDER BY p.position`,
      [schedule.id],
    )
  ).rows;
  const sheets = (
    await query<{
      presenterId: string;
      memberId: string;
      scores: Record<string, number>;
      comment: string;
    }>(
      `SELECT s.presenter_id AS "presenterId",s.member_id AS "memberId",s.scores,s.comment
       FROM council_sheets s JOIN council_presenters p ON p.id=s.presenter_id
       WHERE p.schedule_id=$1 ORDER BY s.submitted_at`,
      [schedule.id],
    )
  ).rows;
  const nameOf = new Map(members.map((member) => [member.userId, member.displayName]));
  const insider = Boolean(myRole) || schedule.can_manage;
  return {
    scheduleId: schedule.id,
    roomId: schedule.channel_id,
    title: schedule.title,
    myRole,
    canManage: schedule.can_manage,
    locked: sheets.length > 0 || presenters.some((item) => item.status !== "waiting"),
    members,
    criteria,
    presenters: presenters.map(({ email, ...presenter }) => {
      const own = sheets.filter((sheet) => sheet.presenterId === presenter.id);
      const mine = own.find((sheet) => sheet.memberId === userId);
      const final = Boolean(presenter.finalizedAt);
      // Scores stay private to their author until the chair finalizes (BR-12); the chair sees all.
      const seeSheets = myRole === "chair" || (final && insider);
      const seeResult = final && (insider || presenter.userId === userId);
      return {
        ...presenter,
        studentCode: studentIdFromEmail(email),
        submittedBy: own.map((sheet) => sheet.memberId),
        mySheet: mine ? { scores: mine.scores, comment: mine.comment } : null,
        sheets: seeSheets
          ? own.map((sheet): CouncilSheet => ({
              memberId: sheet.memberId,
              displayName: nameOf.get(sheet.memberId) ?? "",
              scores: sheet.scores,
              comment: sheet.comment,
              total: sheetTotal(sheet.scores, criteria),
            }))
          : null,
        finalScore: seeResult ? presenter.finalScore : null,
        conclusion: seeResult ? presenter.conclusion : null,
        finalizedAt: seeResult ? presenter.finalizedAt : null,
      };
    }),
  };
}

export async function getSessionCouncil(userId: string, sessionId: unknown) {
  validateId(sessionId);
  const session = (
    await query<{ schedule_id: string | null }>(
      `SELECT schedule_id FROM meeting_sessions WHERE id=$1`,
      [sessionId],
    )
  ).rows[0];
  if (!session) throw new HttpError(404, "SESSION_NOT_FOUND", "Phiên họp không tồn tại.");
  return session.schedule_id ? getCouncil(userId, session.schedule_id) : null;
}

const invalid = (message: string) => new HttpError(400, "INVALID_COUNCIL", message);
const text = (value: unknown, max: number, what: string) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw invalid(`${what} cần 1–${max} ký tự.`);
  return value.trim();
};

/** Replaces the whole setup; only before the first presentation or sheet. */
export async function saveCouncil(
  userId: string,
  scheduleId: unknown,
  input: Record<string, unknown>,
) {
  const { chairId, memberIds, presenters, criteria } = input;
  validateId(chairId);
  if (!Array.isArray(memberIds) || !Array.isArray(presenters) || !Array.isArray(criteria))
    throw invalid("Thiếu thành viên, người trình bày hoặc tiêu chí.");
  memberIds.forEach(validateId);
  const members = [...new Set([chairId as string, ...(memberIds as string[])])];
  if (members.length < 2 || members.length > 7)
    throw invalid("Hội đồng cần 2–7 thành viên kể cả chủ tịch.");
  if (!presenters.length || presenters.length > 40) throw invalid("Cần 1–40 người trình bày.");
  const presenterRows = presenters.map((item: { userId?: unknown; topic?: unknown }) => {
    validateId(item?.userId);
    return { userId: item.userId as string, topic: text(item.topic, 200, "Tên đề tài") };
  });
  const presenterIds = presenterRows.map((item) => item.userId);
  if (new Set(presenterIds).size !== presenterIds.length)
    throw invalid("Mỗi người chỉ trình bày một lần.");
  if (presenterIds.some((id) => members.includes(id)))
    throw invalid("Thành viên hội đồng không thể đồng thời là người trình bày.");
  if (!criteria.length || criteria.length > 10) throw invalid("Cần 1–10 tiêu chí chấm.");
  const criteriaRows = criteria.map((item: { label?: unknown; weight?: unknown }) => {
    if (
      !Number.isInteger(item?.weight) ||
      (item.weight as number) < 1 ||
      (item.weight as number) > 100
    )
      throw invalid("Trọng số mỗi tiêu chí là số nguyên 1–100.");
    return { label: text(item.label, 120, "Tên tiêu chí"), weight: item.weight as number };
  });
  if (criteriaRows.reduce((sum, item) => sum + item.weight, 0) !== 100)
    throw invalid("Tổng trọng số các tiêu chí phải bằng 100.");

  return withTransaction(async (client) => {
    const schedule = await scheduleFor(client, userId, scheduleId);
    if (!schedule.can_manage)
      throw new HttpError(403, "FORBIDDEN", "Chỉ người tổ chức thiết lập được hội đồng.");
    await client.query(`SELECT id FROM meeting_schedules WHERE id=$1 FOR UPDATE`, [schedule.id]);
    const started = await client.query(
      `SELECT 1 FROM council_presenters p WHERE p.schedule_id=$1
       AND (p.status<>'waiting' OR EXISTS(SELECT 1 FROM council_sheets s WHERE s.presenter_id=p.id))`,
      [schedule.id],
    );
    if (started.rowCount)
      throw new HttpError(
        409,
        "COUNCIL_LOCKED",
        "Hội đồng đã bắt đầu chấm, không thể sửa thiết lập.",
      );
    const everyone = [...members, ...presenterIds];
    const allowed = await client.query(
      `SELECT user_id FROM channel_access WHERE channel_id=$1 AND user_id=ANY($2::uuid[])`,
      [schedule.channel_id, everyone],
    );
    if (allowed.rowCount !== everyone.length)
      throw invalid("Thành viên và người trình bày phải thuộc nhóm của phòng họp.");
    await client.query(`DELETE FROM council_members WHERE schedule_id=$1`, [schedule.id]);
    await client.query(`DELETE FROM council_criteria WHERE schedule_id=$1`, [schedule.id]);
    await client.query(`DELETE FROM council_presenters WHERE schedule_id=$1`, [schedule.id]);
    for (const member of members)
      await client.query(`INSERT INTO council_members(schedule_id,user_id,role) VALUES($1,$2,$3)`, [
        schedule.id,
        member,
        member === chairId ? "chair" : "member",
      ]);
    for (const [index, item] of criteriaRows.entries())
      await client.query(
        `INSERT INTO council_criteria(id,schedule_id,label,weight,position) VALUES($1,$2,$3,$4,$5)`,
        [randomUUID(), schedule.id, item.label, item.weight, index],
      );
    for (const [index, item] of presenterRows.entries())
      await client.query(
        `INSERT INTO council_presenters(id,schedule_id,user_id,topic,position) VALUES($1,$2,$3,$4,$5)`,
        [randomUUID(), schedule.id, item.userId, item.topic, index],
      );
    return changeFor(client, schedule);
  });
}

/** Chair calls the next presenter; whoever was presenting is done. */
export async function startPresenter(userId: string, presenterId: unknown) {
  return withTransaction(async (client) => {
    const { presenter, schedule, member } = await lockPresenter(client, userId, presenterId);
    requireChair(member);
    await client.query(
      `UPDATE council_presenters SET status='done' WHERE schedule_id=$1 AND status='presenting' AND id<>$2`,
      [schedule.id, presenter.id],
    );
    await client.query(`UPDATE council_presenters SET status='presenting' WHERE id=$1`, [
      presenter.id,
    ]);
    return changeFor(client, schedule);
  });
}

/** A present member submits (or resubmits) their sheet until the chair finalizes. */
export async function submitSheet(
  userId: string,
  presenterId: unknown,
  input: Record<string, unknown>,
) {
  return withTransaction(async (client) => {
    const { presenter, schedule, member } = await lockPresenter(client, userId, presenterId);
    if (!member) throw new HttpError(403, "COUNCIL_ONLY", "Chỉ thành viên hội đồng được chấm.");
    if (member.absent)
      throw new HttpError(409, "MEMBER_ABSENT", "Bạn đang được ghi nhận vắng mặt.");
    const criteria = (
      await client.query<{ id: string }>(`SELECT id FROM council_criteria WHERE schedule_id=$1`, [
        schedule.id,
      ])
    ).rows;
    const raw = input.scores as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== "object" || Object.keys(raw).length !== criteria.length)
      throw invalid("Cần chấm đủ mọi tiêu chí.");
    const scores: Record<string, number> = {};
    for (const { id } of criteria) {
      const value = raw[id];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10)
        throw invalid("Điểm mỗi tiêu chí từ 0 đến 10.");
      scores[id] = Math.round(value * 100) / 100;
    }
    const comment = typeof input.comment === "string" ? input.comment.trim() : "";
    if (comment.length > 2000) throw invalid("Nhận xét tối đa 2000 ký tự.");
    await client.query(
      `INSERT INTO council_sheets(presenter_id,member_id,scores,comment) VALUES($1,$2,$3,$4)
       ON CONFLICT(presenter_id,member_id) DO UPDATE SET scores=EXCLUDED.scores,comment=EXCLUDED.comment,submitted_at=now()`,
      [presenter.id, userId, JSON.stringify(scores), comment],
    );
    return changeFor(client, schedule);
  });
}

/** Chair marks a member absent (or back); absent members are not waited for at finalization. */
export async function setMemberAbsent(
  userId: string,
  scheduleId: unknown,
  memberId: unknown,
  absent: unknown,
) {
  validateId(memberId);
  if (typeof absent !== "boolean") throw invalid("Thiếu trạng thái vắng mặt.");
  return withTransaction(async (client) => {
    const schedule = await scheduleFor(client, userId, scheduleId);
    requireChair(await councilRole(client, schedule.id, userId));
    const result = await client.query(
      `UPDATE council_members SET absent=$3 WHERE schedule_id=$1 AND user_id=$2 AND role='member'`,
      [schedule.id, memberId, absent],
    );
    if (!result.rowCount)
      throw new HttpError(404, "MEMBER_NOT_FOUND", "Không tìm thấy thành viên hội đồng.");
    return changeFor(client, schedule);
  });
}

/** BR-12: the chair concludes once every present member has submitted; the result is then locked. */
export async function finalizePresenter(
  userId: string,
  presenterId: unknown,
  input: Record<string, unknown>,
) {
  const conclusion = typeof input.conclusion === "string" ? input.conclusion.trim() : "";
  if (conclusion.length > 2000) throw invalid("Kết luận tối đa 2000 ký tự.");
  return withTransaction(async (client) => {
    const { presenter, schedule, member } = await lockPresenter(client, userId, presenterId);
    requireChair(member);
    const missing = await client.query<{ display_name: string }>(
      `SELECT u.display_name FROM council_members m JOIN users u ON u.id=m.user_id
       WHERE m.schedule_id=$1 AND NOT m.absent
         AND NOT EXISTS(SELECT 1 FROM council_sheets s WHERE s.presenter_id=$2 AND s.member_id=m.user_id)
       ORDER BY u.display_name`,
      [schedule.id, presenter.id],
    );
    if (missing.rowCount)
      throw new HttpError(
        409,
        "SHEETS_MISSING",
        `Chưa đủ phiếu chấm: ${missing.rows.map((row) => row.display_name).join(", ")}.`,
      );
    const criteria = (
      await client.query<{ id: string; weight: number }>(
        `SELECT id,weight FROM council_criteria WHERE schedule_id=$1`,
        [schedule.id],
      )
    ).rows;
    const sheets = (
      await client.query<{ scores: Record<string, number> }>(
        `SELECT s.scores FROM council_sheets s JOIN council_members m ON m.schedule_id=$1 AND m.user_id=s.member_id
         WHERE s.presenter_id=$2 AND NOT m.absent`,
        [schedule.id, presenter.id],
      )
    ).rows;
    const average =
      sheets.reduce((sum, sheet) => sum + sheetTotal(sheet.scores, criteria), 0) / sheets.length;
    await client.query(
      `UPDATE council_presenters SET status='done',final_score=$2,conclusion=$3,finalized_at=now(),finalized_by=$4 WHERE id=$1`,
      [presenter.id, Math.round(average * 100) / 100, conclusion, userId],
    );
    return changeFor(client, schedule);
  });
}

/** Result sheet for Excel (the route adds the BOM); council members and the organizer only. */
export async function exportCouncil(userId: string, scheduleId: unknown) {
  const council = await getCouncil(userId, scheduleId);
  if (!council || !(council.myRole || council.canManage))
    throw new HttpError(403, "FORBIDDEN", "Chỉ hội đồng và người tổ chức xuất được bảng điểm.");
  const lines = [
    ["STT", "Họ tên", "MSSV", "Đề tài", "Điểm", "Kết luận"],
    ...council.presenters.map((item, index) => [
      String(index + 1),
      item.displayName,
      item.studentCode,
      item.topic,
      item.finalScore === null ? "Chưa chốt" : item.finalScore.toFixed(2),
      item.conclusion ?? "",
    ]),
  ];
  return { name: `hoi-dong-${council.scheduleId.slice(0, 8)}`, rows: lines } satisfies Table;
}
