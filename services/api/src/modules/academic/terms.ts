import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "../../infrastructure/database/db.js";
import {
  audit,
  choice,
  code,
  conflict,
  date,
  decimal,
  forbidden,
  hasUnitRole,
  id,
  integer,
  invalid,
  isLecturerOf,
  loadActor,
  lockTerm,
  notFound,
  notify,
  requirePhase,
  requireUnitRole,
  requireVersion,
  text,
  type TermRow,
  type TermStatus,
} from "./access.js";

const phases: TermStatus[] = ["draft", "registration", "execution", "review", "defense", "grading", "closed"];
const terminalProjectStates = ["completed", "failed", "withdrawn", "suspended"];

function termView(row: TermRow & Record<string, unknown>) {
  return {
    id: row.id,
    unitId: row.unit_id,
    code: row.code,
    name: row.name,
    status: row.status,
    registrationOpensAt: row.registration_opens_at,
    registrationClosesAt: row.registration_closes_at,
    finalDueAt: row.final_due_at,
    defenseStartsOn: row.defense_starts_on,
    defenseEndsOn: row.defense_ends_on,
    policy: {
      minCredits: row.min_credits,
      minGpa: Number(row.min_gpa),
      minGroupSize: row.min_group_size,
      maxGroupSize: row.max_group_size,
      maxPreferences: row.max_preferences,
      minSupervisionLogs: row.min_supervision_logs,
      latePolicy: row.late_policy,
      weights: { supervisor: row.supervisor_weight, reviewer: row.reviewer_weight, committee: row.committee_weight },
      maxScoreDeviation: Number(row.max_score_deviation),
      passScore: Number(row.pass_score),
      appealWindowDays: row.appeal_window_days,
      supervisorInCommittee: row.supervisor_in_committee,
    },
    gradesPublishedAt: row.grades_published_at,
    version: row.version,
  };
}

/** Reads every policy field; missing fields keep `current` values so the same reader serves create and update. */
function readPolicy(body: Record<string, unknown>, current?: TermRow & Record<string, unknown>) {
  const pick = <T>(key: string, read: (value: unknown) => T, fallback: T) =>
    body[key] === undefined ? fallback : read(body[key]);
  const weights = (body.weights ?? {}) as Record<string, unknown>;
  const weight = (key: "supervisor" | "reviewer" | "committee", fallback: number) =>
    weights[key] === undefined ? fallback : integer(weights[key], `Trọng số ${key}`, 0, 100);
  return {
    registrationOpensAt: pick("registrationOpensAt", (v) => date(v, "Mở đăng ký"), current?.registration_opens_at as Date),
    registrationClosesAt: pick("registrationClosesAt", (v) => date(v, "Đóng đăng ký"), current?.registration_closes_at as Date),
    finalDueAt: pick("finalDueAt", (v) => date(v, "Hạn nộp cuối"), current?.final_due_at as Date),
    defenseStartsOn: pick("defenseStartsOn", (v) => date(v, "Ngày bắt đầu bảo vệ").toISOString().slice(0, 10), current?.defense_starts_on as string),
    defenseEndsOn: pick("defenseEndsOn", (v) => date(v, "Ngày kết thúc bảo vệ").toISOString().slice(0, 10), current?.defense_ends_on as string),
    minCredits: pick("minCredits", (v) => integer(v, "Tín chỉ tối thiểu", 0, 300), current?.min_credits ?? 120),
    minGpa: pick("minGpa", (v) => decimal(v, "GPA tối thiểu", 0, 4), Number(current?.min_gpa ?? 2)),
    minGroupSize: pick("minGroupSize", (v) => integer(v, "Số SV tối thiểu/nhóm", 1, 5), current?.min_group_size ?? 1),
    maxGroupSize: pick("maxGroupSize", (v) => integer(v, "Số SV tối đa/nhóm", 1, 5), current?.max_group_size ?? 3),
    maxPreferences: pick("maxPreferences", (v) => integer(v, "Số nguyện vọng", 1, 5), current?.max_preferences ?? 3),
    minSupervisionLogs: pick("minSupervisionLogs", (v) => integer(v, "Số buổi hướng dẫn tối thiểu", 0, 30), current?.min_supervision_logs ?? 6),
    latePolicy: pick("latePolicy", (v) => choice(v, ["reject", "allow_flagged"] as const, "Chính sách nộp trễ"), current?.late_policy ?? "allow_flagged"),
    supervisorWeight: weight("supervisor", current?.supervisor_weight ?? 20),
    reviewerWeight: weight("reviewer", current?.reviewer_weight ?? 20),
    committeeWeight: weight("committee", current?.committee_weight ?? 60),
    maxScoreDeviation: pick("maxScoreDeviation", (v) => decimal(v, "Độ lệch tối đa", 0.5, 5), Number(current?.max_score_deviation ?? 2)),
    passScore: pick("passScore", (v) => decimal(v, "Điểm đạt", 0, 10), Number(current?.pass_score ?? 5)),
    appealWindowDays: pick("appealWindowDays", (v) => integer(v, "Số ngày phúc khảo", 1, 30), current?.appeal_window_days ?? 7),
    supervisorInCommittee: pick("supervisorInCommittee", (v) => {
      if (typeof v !== "boolean") throw invalid("supervisorInCommittee phải là boolean.");
      return v;
    }, current?.supervisor_in_committee ?? false),
  };
}

function validatePolicy(policy: ReturnType<typeof readPolicy>) {
  for (const key of ["registrationOpensAt", "registrationClosesAt", "finalDueAt", "defenseStartsOn", "defenseEndsOn"] as const)
    if (!policy[key]) throw invalid(`Thiếu ${key}.`);
  if (!(policy.registrationOpensAt < policy.registrationClosesAt && policy.registrationClosesAt < policy.finalDueAt))
    throw invalid("Thứ tự mốc phải là: mở đăng ký < đóng đăng ký < hạn nộp cuối.");
  if (policy.finalDueAt.toISOString().slice(0, 10) > policy.defenseStartsOn || policy.defenseStartsOn > policy.defenseEndsOn)
    throw invalid("Đợt bảo vệ phải sau hạn nộp cuối và ngày bắt đầu không sau ngày kết thúc.");
  if (policy.minGroupSize > policy.maxGroupSize) throw invalid("Số SV tối thiểu không được lớn hơn tối đa.");
  if (policy.supervisorWeight + policy.reviewerWeight + policy.committeeWeight !== 100 || policy.committeeWeight === 0)
    throw invalid("Tổng trọng số GVHD + phản biện + hội đồng phải bằng 100 và hội đồng > 0.");
}

export async function createTerm(userId: string, unitId: string, body: Record<string, unknown>) {
  id(unitId);
  return withTransaction(async (client) => {
    requireUnitRole(await loadActor(client, userId), unitId, "unit_admin");
    const termCode = code(body.code, "Mã đợt", 30);
    const name = text(body.name, "Tên đợt", 3, 160);
    const policy = readPolicy(body);
    validatePolicy(policy);
    const termId = randomUUID();
    const inserted = await client.query(
      `INSERT INTO thesis_terms(id,unit_id,code,name,registration_opens_at,registration_closes_at,final_due_at,defense_starts_on,defense_ends_on,min_credits,min_gpa,min_group_size,max_group_size,max_preferences,min_supervision_logs,late_policy,supervisor_weight,reviewer_weight,committee_weight,max_score_deviation,pass_score,appeal_window_days,supervisor_in_committee,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) ON CONFLICT(unit_id,code) DO NOTHING`,
      [termId, unitId, termCode, name, policy.registrationOpensAt, policy.registrationClosesAt, policy.finalDueAt, policy.defenseStartsOn, policy.defenseEndsOn, policy.minCredits, policy.minGpa, policy.minGroupSize, policy.maxGroupSize, policy.maxPreferences, policy.minSupervisionLogs, policy.latePolicy, policy.supervisorWeight, policy.reviewerWeight, policy.committeeWeight, policy.maxScoreDeviation, policy.passScore, policy.appealWindowDays, policy.supervisorInCommittee, userId],
    );
    if (!inserted.rowCount) throw conflict("DUPLICATE_CODE", "Mã đợt đã tồn tại trong khoa.");
    await audit(client, { unitId, termId, actorId: userId, entity: "term", entityId: termId, action: "term.created", details: { code: termCode, ...policy } });
    return termView(await lockTerm(client, termId) as TermRow & Record<string, unknown>);
  });
}

export async function updateTerm(userId: string, termId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const term = (await lockTerm(client, termId, "update")) as TermRow & Record<string, unknown>;
    requireUnitRole(await loadActor(client, userId), term.unit_id, "unit_admin");
    requireVersion(term.version, body.version, "Đợt đồ án");
    if (term.status === "closed") throw conflict("TERM_CLOSED", "Đợt đã đóng.");
    // Grading rules and group limits are frozen once students can act on them.
    const frozen = ["minCredits", "minGpa", "minGroupSize", "maxGroupSize", "maxPreferences", "weights", "maxScoreDeviation", "passScore", "supervisorInCommittee", "minSupervisionLogs"];
    if (term.status !== "draft" && frozen.some((key) => body[key] !== undefined))
      throw conflict("POLICY_FROZEN", "Chính sách đánh giá chỉ được sửa khi đợt còn ở trạng thái nháp.");
    const policy = readPolicy(body, term);
    validatePolicy(policy);
    const name = body.name === undefined ? (term.name as string) : text(body.name, "Tên đợt", 3, 160);
    await client.query(
      `UPDATE thesis_terms SET name=$2,registration_opens_at=$3,registration_closes_at=$4,final_due_at=$5,defense_starts_on=$6,defense_ends_on=$7,min_credits=$8,min_gpa=$9,min_group_size=$10,max_group_size=$11,max_preferences=$12,min_supervision_logs=$13,late_policy=$14,supervisor_weight=$15,reviewer_weight=$16,committee_weight=$17,max_score_deviation=$18,pass_score=$19,appeal_window_days=$20,supervisor_in_committee=$21,version=version+1,updated_at=now() WHERE id=$1`,
      [termId, name, policy.registrationOpensAt, policy.registrationClosesAt, policy.finalDueAt, policy.defenseStartsOn, policy.defenseEndsOn, policy.minCredits, policy.minGpa, policy.minGroupSize, policy.maxGroupSize, policy.maxPreferences, policy.minSupervisionLogs, policy.latePolicy, policy.supervisorWeight, policy.reviewerWeight, policy.committeeWeight, policy.maxScoreDeviation, policy.passScore, policy.appealWindowDays, policy.supervisorInCommittee],
    );
    await audit(client, { unitId: term.unit_id, termId, actorId: userId, entity: "term", entityId: termId, action: "term.updated", details: { fields: Object.keys(body).filter((key) => key !== "version") } });
    return termView((await lockTerm(client, termId)) as TermRow & Record<string, unknown>);
  });
}

/** Preconditions that must hold before a term may enter the next phase. */
async function phaseBlockers(client: PoolClient, term: TermRow, next: TermStatus): Promise<string[]> {
  const blockers: string[] = [];
  if (next === "registration") {
    const rubric = await client.query<{ grader_role: string; total: string }>(
      `SELECT grader_role,sum(weight)::text AS total FROM thesis_rubric_criteria WHERE term_id=$1 GROUP BY grader_role`,
      [term.id],
    );
    const totals = new Map(rubric.rows.map((row) => [row.grader_role, Number(row.total)]));
    for (const [role, weight] of [["supervisor", term.supervisor_weight], ["reviewer", term.reviewer_weight], ["committee", term.committee_weight]] as const)
      if (weight > 0 && totals.get(role) !== 100) blockers.push(`Rubric "${role}" chưa có tổng trọng số 100.`);
    if (!(await client.query(`SELECT 1 FROM thesis_milestones WHERE term_id=$1 AND kind='final'`, [term.id])).rowCount)
      blockers.push("Chưa có mốc nộp báo cáo cuối (final).");
    if (!(await client.query(`SELECT 1 FROM thesis_milestones WHERE term_id=$1 AND kind='proposal'`, [term.id])).rowCount)
      blockers.push("Chưa có mốc nộp đề cương (proposal).");
    if (!(await client.query(`SELECT 1 FROM thesis_enrollments WHERE term_id=$1 AND eligible AND withdrawn_at IS NULL`, [term.id])).rowCount)
      blockers.push("Chưa có sinh viên đủ điều kiện.");
  }
  if (next === "execution") {
    if (+term.db_now < +term.registration_closes_at) blockers.push("Chưa hết thời hạn đăng ký.");
  }
  if (next === "review") {
    if (+term.db_now < +term.final_due_at) blockers.push("Chưa hết hạn nộp báo cáo cuối.");
  }
  if (next === "defense") {
    const pending = await client.query(`SELECT count(*)::int AS n FROM thesis_projects WHERE term_id=$1 AND status='under_review'`, [term.id]);
    if (pending.rows[0].n) blockers.push(`${pending.rows[0].n} đồ án chưa có kết quả phản biện.`);
    if (!(await client.query(`SELECT 1 FROM thesis_committees WHERE term_id=$1 AND status='confirmed'`, [term.id])).rowCount)
      blockers.push("Chưa có hội đồng nào được xác nhận.");
  }
  if (next === "grading") {
    const open = await client.query(`SELECT count(*)::int AS n FROM thesis_projects WHERE term_id=$1 AND status='scheduled'`, [term.id]);
    if (open.rows[0].n) blockers.push(`${open.rows[0].n} đồ án đã xếp lịch nhưng chưa bảo vệ.`);
  }
  if (next === "closed") {
    const open = await client.query(`SELECT count(*)::int AS n FROM thesis_projects WHERE term_id=$1 AND status<>ALL($2::text[])`, [term.id, terminalProjectStates]);
    if (open.rows[0].n) blockers.push(`${open.rows[0].n} đồ án chưa ở trạng thái kết thúc.`);
    if (!term.grades_published_at) blockers.push("Chưa công bố điểm.");
    else if (+term.db_now < +term.grades_published_at + term.appeal_window_days * 86_400_000)
      blockers.push("Chưa hết thời hạn phúc khảo.");
    if ((await client.query(`SELECT 1 FROM thesis_appeals a JOIN thesis_projects p ON p.id=a.project_id WHERE p.term_id=$1 AND a.status='submitted'`, [term.id])).rowCount)
      blockers.push("Còn đơn phúc khảo chưa xử lý.");
  }
  return blockers;
}

export async function advanceTerm(userId: string, termId: string, body: Record<string, unknown>) {
  const result = await withTransaction(async (client) => {
    const term = await lockTerm(client, termId, "update");
    requireUnitRole(await loadActor(client, userId), term.unit_id, "unit_admin");
    requireVersion(term.version, body.version, "Đợt đồ án");
    const next = phases[phases.indexOf(term.status) + 1];
    if (!next) throw conflict("TERM_CLOSED", "Đợt đã đóng.");
    const blockers = await phaseBlockers(client, term, next);
    if (blockers.length) throw Object.assign(conflict("PHASE_BLOCKED", blockers.join(" ")), { blockers });
    const notified: string[] = [];
    if (next === "execution") {
      // Registration is over: open wishes expire and unassigned groups dissolve.
      await client.query(
        `UPDATE thesis_registrations r SET status='expired',decided_at=now() FROM thesis_groups g WHERE g.id=r.group_id AND g.term_id=$1 AND r.status='pending'`,
        [termId],
      );
      const dissolved = await client.query<{ student_id: string }>(
        `WITH d AS (UPDATE thesis_groups SET status='dissolved',version=version+1 WHERE term_id=$1 AND status='forming' RETURNING id)
         UPDATE thesis_group_members m SET status='left',responded_at=now() FROM d WHERE m.group_id=d.id AND m.status IN ('active','invited') RETURNING m.student_id`,
        [termId],
      );
      notified.push(...(await notify(client, dissolved.rows.map((row) => row.student_id), "group.dissolved", "term", termId, `Đợt ${term.code} đã hết hạn đăng ký; nhóm chưa được nhận đề tài đã giải thể.`)));
    }
    await client.query(`UPDATE thesis_terms SET status=$2,version=version+1,updated_at=now() WHERE id=$1`, [termId, next]);
    await audit(client, { unitId: term.unit_id, termId, actorId: userId, entity: "term", entityId: termId, action: "term.advanced", details: { from: term.status, to: next } });
    return { term: termView((await lockTerm(client, termId)) as TermRow & Record<string, unknown>), notified };
  });
  return result;
}

export async function getTerm(userId: string, termId: string) {
  return withTransaction(async (client) => {
    const term = (await lockTerm(client, termId)) as TermRow & Record<string, unknown>;
    const actor = await loadActor(client, userId);
    const enrolled = await client.query(`SELECT 1 FROM thesis_enrollments WHERE term_id=$1 AND student_id=$2`, [termId, userId]);
    if (!hasUnitRole(actor, term.unit_id, "unit_admin", "unit_head") && !isLecturerOf(actor, term.unit_id) && !enrolled.rowCount)
      throw forbidden("Bạn không thuộc đợt đồ án này.");
    const milestones = await client.query(
      `SELECT id,code,name,kind,due_at AS "dueAt",required FROM thesis_milestones WHERE term_id=$1 ORDER BY due_at,code`,
      [termId],
    );
    const rubric = await client.query(
      `SELECT id,grader_role AS "graderRole",code,name,weight::float8 AS weight FROM thesis_rubric_criteria WHERE term_id=$1 ORDER BY grader_role,position,code`,
      [termId],
    );
    const nextPhase = phases[phases.indexOf(term.status) + 1];
    return {
      ...termView(term),
      milestones: milestones.rows,
      rubric: rubric.rows,
      nextPhase: nextPhase ?? null,
      blockers: hasUnitRole(actor, term.unit_id, "unit_admin") && nextPhase ? await phaseBlockers(client, term, nextPhase) : [],
      viewer: {
        admin: hasUnitRole(actor, term.unit_id, "unit_admin"),
        head: hasUnitRole(actor, term.unit_id, "unit_head"),
        lecturer: isLecturerOf(actor, term.unit_id),
        student: Boolean(enrolled.rowCount),
      },
    };
  });
}

export async function listTerms(userId: string) {
  return withTransaction(async (client) => {
    const actor = await loadActor(client, userId);
    const units = [...actor.unitRoles.keys(), ...(actor.staff?.active ? [actor.staff.unitId] : [])];
    const rows = await client.query(
      `SELECT t.id,t.code,t.name,t.status,t.unit_id AS "unitId",u.code AS "unitCode",t.final_due_at AS "finalDueAt",(SELECT count(*)::int FROM thesis_projects p WHERE p.term_id=t.id) AS "projectCount"
       FROM thesis_terms t JOIN academic_units u ON u.id=t.unit_id
       WHERE $2::boolean OR t.unit_id=ANY($3::uuid[]) OR EXISTS(SELECT 1 FROM thesis_enrollments e WHERE e.term_id=t.id AND e.student_id=$1)
       ORDER BY t.created_at DESC LIMIT 100`,
      [userId, actor.systemAdmin, units],
    );
    return { terms: rows.rows };
  });
}

export async function setSupervisorQuota(userId: string, termId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId, "update");
    requireUnitRole(await loadActor(client, userId), term.unit_id, "unit_admin");
    if (term.status === "closed") throw conflict("TERM_CLOSED", "Đợt đã đóng.");
    const lecturerId = id(body.lecturerId);
    const quota = integer(body.quota, "Định mức", 0, 30);
    if (!(await client.query(`SELECT 1 FROM academic_staff WHERE user_id=$1 AND unit_id=$2`, [lecturerId, term.unit_id])).rowCount)
      throw invalid("Giảng viên không thuộc khoa.");
    const used = await studentsSupervised(client, termId, lecturerId);
    if (quota < used) throw conflict("QUOTA_BELOW_USAGE", `Giảng viên đang hướng dẫn ${used} sinh viên; định mức không thể thấp hơn.`);
    await client.query(
      `INSERT INTO thesis_term_supervisors(term_id,lecturer_id,quota) VALUES($1,$2,$3) ON CONFLICT(term_id,lecturer_id) DO UPDATE SET quota=EXCLUDED.quota`,
      [termId, lecturerId, quota],
    );
    await audit(client, { unitId: term.unit_id, termId, actorId: userId, entity: "staff", entityId: lecturerId, action: "quota.set", details: { quota } });
    return { lecturerId, quota, used };
  });
}

export async function studentsSupervised(client: PoolClient, termId: string, lecturerId: string): Promise<number> {
  const used = await client.query<{ n: number }>(
    `SELECT COALESCE(sum(student_count),0)::int AS n FROM thesis_projects WHERE term_id=$1 AND supervisor_id=$2 AND status NOT IN ('withdrawn')`,
    [termId, lecturerId],
  );
  return used.rows[0].n;
}

export async function supervisorQuota(client: PoolClient, termId: string, lecturerId: string): Promise<number> {
  const row = await client.query<{ quota: number }>(
    `SELECT COALESCE(ts.quota,s.default_quota)::int AS quota FROM academic_staff s LEFT JOIN thesis_term_supervisors ts ON ts.lecturer_id=s.user_id AND ts.term_id=$1 WHERE s.user_id=$2`,
    [termId, lecturerId],
  );
  return row.rows[0]?.quota ?? 0;
}

export async function lecturerLoad(userId: string, termId: string) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId);
    const actor = await loadActor(client, userId);
    if (!hasUnitRole(actor, term.unit_id, "unit_admin", "unit_head") && !isLecturerOf(actor, term.unit_id)) throw forbidden();
    const rows = await client.query(
      `SELECT s.user_id AS "lecturerId",u.display_name AS "displayName",s.staff_code AS "staffCode",s.academic_rank AS rank,
              COALESCE(ts.quota,s.default_quota)::int AS quota,
              COALESCE((SELECT sum(p.student_count) FROM thesis_projects p WHERE p.term_id=$1 AND p.supervisor_id=s.user_id AND p.status<>'withdrawn'),0)::int AS used,
              (SELECT count(*)::int FROM thesis_reviews r JOIN thesis_projects p ON p.id=r.project_id WHERE p.term_id=$1 AND r.reviewer_id=s.user_id) AS reviews
       FROM academic_staff s JOIN users u ON u.id=s.user_id LEFT JOIN thesis_term_supervisors ts ON ts.term_id=$1 AND ts.lecturer_id=s.user_id
       WHERE s.unit_id=$2 AND s.active ORDER BY s.staff_code`,
      [termId, term.unit_id],
    );
    return { lecturers: rows.rows };
  });
}

// ---- students ---------------------------------------------------------------

/** Bulk import; each row is validated independently and the whole batch commits atomically. */
export async function importEnrollments(userId: string, termId: string, body: Record<string, unknown>) {
  if (!Array.isArray(body.students) || !body.students.length || body.students.length > 2000)
    throw invalid("Danh sách sinh viên phải có 1–2000 dòng.");
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId, "update");
    requireUnitRole(await loadActor(client, userId), term.unit_id, "unit_admin");
    requirePhase(term, "draft", "registration");
    const errors: { row: number; message: string }[] = [];
    let created = 0,
      updated = 0;
    const seenCodes = new Set<string>();
    for (const [index, raw] of (body.students as unknown[]).entries()) {
      // A savepoint per row keeps one bad row from aborting the validation of the rest.
      await client.query("SAVEPOINT import_row");
      try {
        if (!raw || typeof raw !== "object") throw invalid("Dòng không hợp lệ.");
        const row = raw as Record<string, unknown>;
        const email = text(row.email, "Email", 3, 320).toLowerCase();
        const studentCode = text(row.studentCode, "Mã SV", 4, 20);
        if (!/^[A-Za-z0-9]+$/.test(studentCode)) throw invalid("Mã SV chỉ gồm chữ và số.");
        if (seenCodes.has(studentCode)) throw invalid("Mã SV bị lặp trong tệp.");
        seenCodes.add(studentCode);
        const credits = integer(row.credits, "Tín chỉ", 0, 300);
        const gpa = decimal(row.gpa, "GPA", 0, 4);
        const className = row.className === undefined ? "" : text(row.className, "Lớp", 0, 40);
        const user = await client.query<{ id: string }>(`SELECT id FROM users WHERE lower(email)=$1`, [email]);
        if (!user.rowCount) throw invalid("Chưa có tài khoản dùng email này.");
        if ((await client.query(`SELECT 1 FROM academic_staff WHERE user_id=$1`, [user.rows[0].id])).rowCount)
          throw invalid("Tài khoản là giảng viên, không thể ghi danh sinh viên.");
        const eligible = credits >= term.min_credits && gpa >= Number(term.min_gpa);
        const result = await client.query<{ inserted: boolean }>(
          `INSERT INTO thesis_enrollments(term_id,student_id,student_code,class_name,credits,gpa,eligible) VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT(term_id,student_id) DO UPDATE SET student_code=EXCLUDED.student_code,class_name=EXCLUDED.class_name,credits=EXCLUDED.credits,gpa=EXCLUDED.gpa,
             eligible=CASE WHEN thesis_enrollments.eligibility_override_reason IS NULL THEN EXCLUDED.eligible ELSE thesis_enrollments.eligible END
           RETURNING (xmax=0) AS inserted`,
          [termId, user.rows[0].id, studentCode, className, credits, gpa, eligible],
        );
        if (result.rows[0].inserted) created++;
        else updated++;
        await client.query("RELEASE SAVEPOINT import_row");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT import_row");
        const message =
          (error as { code?: string }).code === "23505"
            ? "Mã SV đã được dùng cho sinh viên khác trong đợt."
            : error instanceof Error
              ? error.message
              : "Lỗi không xác định";
        errors.push({ row: index + 1, message });
      }
    }
    // All-or-nothing: a partially valid file is reported back without writing anything.
    if (errors.length) throw Object.assign(invalid(`Có ${errors.length} dòng lỗi; chưa ghi dữ liệu nào.`, "IMPORT_ERRORS"), { details: errors });
    await audit(client, { unitId: term.unit_id, termId, actorId: userId, entity: "term", entityId: termId, action: "enrollment.imported", details: { created, updated } });
    return { created, updated };
  });
}

export async function overrideEligibility(userId: string, termId: string, studentId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId, "update");
    requireUnitRole(await loadActor(client, userId), term.unit_id, "unit_admin");
    requirePhase(term, "draft", "registration");
    id(studentId);
    if (typeof body.eligible !== "boolean") throw invalid("eligible phải là boolean.");
    const reason = text(body.reason, "Lý do", 10, 500);
    if (!body.eligible && (await client.query(`SELECT 1 FROM thesis_group_members WHERE term_id=$1 AND student_id=$2 AND status='active'`, [termId, studentId])).rowCount)
      throw conflict("IN_GROUP", "Sinh viên đang ở trong nhóm; cần rời nhóm trước.");
    const result = await client.query(
      `UPDATE thesis_enrollments SET eligible=$3,eligibility_override_reason=$4 WHERE term_id=$1 AND student_id=$2`,
      [termId, studentId, body.eligible, reason],
    );
    if (!result.rowCount) throw notFound("Sinh viên chưa ghi danh vào đợt.");
    await audit(client, { unitId: term.unit_id, termId, actorId: userId, entity: "enrollment", entityId: studentId, action: "eligibility.overridden", details: { eligible: body.eligible, reason } });
    await notify(client, [studentId], "eligibility.changed", "term", termId, `Điều kiện làm đồ án đợt ${term.code} đã được cập nhật: ${body.eligible ? "đủ" : "không đủ"} điều kiện.`);
    return { studentId, eligible: body.eligible };
  });
}

export async function listEnrollments(userId: string, termId: string, params: URLSearchParams) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId);
    const actor = await loadActor(client, userId);
    if (!hasUnitRole(actor, term.unit_id, "unit_admin", "unit_head") && !isLecturerOf(actor, term.unit_id)) throw forbidden();
    const search = (params.get("q") ?? "").trim().slice(0, 80);
    const rows = await client.query(
      `SELECT e.student_id AS "studentId",u.display_name AS "displayName",u.email,e.student_code AS "studentCode",e.class_name AS "className",e.credits,e.gpa::float8 AS gpa,e.eligible,e.eligibility_override_reason AS "overrideReason",
              g.id AS "groupId",p.code AS "projectCode"
       FROM thesis_enrollments e JOIN users u ON u.id=e.student_id
       LEFT JOIN thesis_group_members m ON m.term_id=e.term_id AND m.student_id=e.student_id AND m.status='active'
       LEFT JOIN thesis_groups g ON g.id=m.group_id LEFT JOIN thesis_projects p ON p.group_id=g.id
       WHERE e.term_id=$1 AND ($2='' OR e.student_code ILIKE '%'||$2||'%' OR u.display_name ILIKE '%'||$2||'%')
       ORDER BY e.student_code LIMIT 1000`,
      [termId, search],
    );
    return { students: rows.rows };
  });
}

// ---- milestones and rubric -------------------------------------------------

export async function createMilestone(userId: string, termId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId, "update");
    requireUnitRole(await loadActor(client, userId), term.unit_id, "unit_admin");
    requirePhase(term, "draft", "registration", "execution");
    const kind = choice(body.kind, ["proposal", "progress", "final"] as const, "Loại mốc");
    const dueAt = date(body.dueAt, "Hạn nộp");
    if (kind === "final" && +dueAt !== +term.final_due_at)
      throw invalid("Hạn của mốc báo cáo cuối phải trùng hạn nộp cuối của đợt.");
    if (dueAt > term.final_due_at) throw invalid("Hạn mốc không được sau hạn nộp cuối của đợt.");
    if (term.status !== "draft" && dueAt.getTime() < +term.db_now) throw invalid("Không tạo mốc có hạn trong quá khứ khi đợt đang chạy.");
    const milestone = {
      id: randomUUID(),
      code: code(body.code, "Mã mốc"),
      name: text(body.name, "Tên mốc", 2, 160),
      kind,
      dueAt,
      required: kind === "progress" ? body.required !== false : true,
    };
    const inserted = await client.query(
      `INSERT INTO thesis_milestones(id,term_id,code,name,kind,due_at,required) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [milestone.id, termId, milestone.code, milestone.name, kind, dueAt, milestone.required],
    );
    if (!inserted.rowCount) throw conflict("DUPLICATE_MILESTONE", "Trùng mã mốc, hoặc đợt đã có mốc đề cương/báo cáo cuối.");
    await audit(client, { unitId: term.unit_id, termId, actorId: userId, entity: "milestone", entityId: milestone.id, action: "milestone.created", details: milestone });
    return milestone;
  });
}

export async function setRubric(userId: string, termId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const term = await lockTerm(client, termId, "update");
    requireUnitRole(await loadActor(client, userId), term.unit_id, "unit_admin");
    requirePhase(term, "draft");
    const role = choice(body.graderRole, ["supervisor", "reviewer", "committee"] as const, "Vai trò chấm");
    if (!Array.isArray(body.criteria) || body.criteria.length < 1 || body.criteria.length > 15)
      throw invalid("Rubric cần 1–15 tiêu chí.");
    const criteria = body.criteria.map((raw, index) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      return {
        code: code(row.code, "Mã tiêu chí", 10),
        name: text(row.name, "Tên tiêu chí", 3, 200),
        weight: decimal(row.weight, "Trọng số", 0.01, 100),
        position: index,
      };
    });
    if (new Set(criteria.map((c) => c.code)).size !== criteria.length) throw invalid("Mã tiêu chí bị trùng.");
    const total = Math.round(criteria.reduce((sum, c) => sum + c.weight, 0) * 100) / 100;
    if (total !== 100) throw invalid(`Tổng trọng số tiêu chí phải bằng 100 (hiện ${total}).`);
    await client.query(`DELETE FROM thesis_rubric_criteria WHERE term_id=$1 AND grader_role=$2`, [termId, role]);
    for (const criterion of criteria)
      await client.query(
        `INSERT INTO thesis_rubric_criteria(id,term_id,grader_role,code,name,weight,position) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), termId, role, criterion.code, criterion.name, criterion.weight, criterion.position],
      );
    await audit(client, { unitId: term.unit_id, termId, actorId: userId, entity: "term", entityId: termId, action: "rubric.set", details: { role, criteria } });
    return { graderRole: role, criteria };
  });
}
