import { randomUUID } from "node:crypto";
import { query, withTransaction } from "../../infrastructure/database/db.js";
import {
  audit,
  choice,
  code,
  conflict,
  forbidden,
  id,
  integer,
  invalid,
  loadActor,
  notFound,
  requireUnitRole,
  text,
} from "./access.js";

export const ranks = ["cn", "ths", "ts", "pgs", "gs"] as const;

export async function getAcademicProfile(userId: string) {
  return withTransaction(async (client) => {
    const actor = await loadActor(client, userId);
    const units = await client.query(
      `SELECT id,code,name FROM academic_units WHERE $1::boolean OR id=ANY($2::uuid[]) ORDER BY code`,
      [actor.systemAdmin, [...actor.unitRoles.keys(), ...(actor.staff ? [actor.staff.unitId] : [])]],
    );
    const enrollments = await client.query(
      `SELECT e.term_id AS "termId",t.code AS "termCode",t.name AS "termName",t.status AS "termStatus",e.student_code AS "studentCode",e.eligible,e.withdrawn_at AS "withdrawnAt" FROM thesis_enrollments e JOIN thesis_terms t ON t.id=e.term_id WHERE e.student_id=$1 ORDER BY t.created_at DESC`,
      [userId],
    );
    return {
      systemAdmin: actor.systemAdmin,
      unitRoles: Object.fromEntries([...actor.unitRoles].map(([unit, roles]) => [unit, [...roles]])),
      staff: actor.staff,
      units: units.rows,
      enrollments: enrollments.rows,
    };
  });
}

export async function createUnit(userId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const actor = await loadActor(client, userId);
    if (!actor.systemAdmin) throw forbidden("Chỉ quản trị hệ thống được tạo khoa.");
    const unit = { id: randomUUID(), code: code(body.code, "Mã khoa"), name: text(body.name, "Tên khoa", 2, 160) };
    const inserted = await client.query(
      `INSERT INTO academic_units(id,code,name) VALUES($1,$2,$3) ON CONFLICT(code) DO NOTHING`,
      [unit.id, unit.code, unit.name],
    );
    if (!inserted.rowCount) throw conflict("DUPLICATE_CODE", "Mã khoa đã tồn tại.");
    await audit(client, { unitId: unit.id, actorId: userId, entity: "unit", entityId: unit.id, action: "unit.created", details: unit });
    return unit;
  });
}

export async function createDepartment(userId: string, unitId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    id(unitId);
    requireUnitRole(await loadActor(client, userId), unitId, "unit_admin");
    const department = { id: randomUUID(), code: code(body.code, "Mã bộ môn"), name: text(body.name, "Tên bộ môn", 2, 160) };
    const inserted = await client.query(
      `INSERT INTO academic_departments(id,unit_id,code,name) SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM academic_units WHERE id=$2) ON CONFLICT(unit_id,code) DO NOTHING`,
      [department.id, unitId, department.code, department.name],
    );
    if (!inserted.rowCount) throw conflict("DUPLICATE_CODE", "Mã bộ môn đã tồn tại hoặc khoa không hợp lệ.");
    await audit(client, { unitId, actorId: userId, entity: "department", entityId: department.id, action: "department.created", details: department });
    return department;
  });
}

/** Registers or updates a lecturer of the unit, identified by the email of an existing account. */
export async function upsertStaff(userId: string, unitId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    id(unitId);
    requireUnitRole(await loadActor(client, userId), unitId, "unit_admin");
    const email = text(body.email, "Email", 3, 320).toLowerCase();
    const user = await client.query<{ id: string }>(`SELECT id FROM users WHERE lower(email)=$1`, [email]);
    if (!user.rowCount) throw notFound("Chưa có tài khoản dùng email này.");
    const staffCode = code(body.staffCode, "Mã giảng viên");
    const rank = choice(body.rank, ranks, "Học vị");
    const quota = body.defaultQuota === undefined ? 8 : integer(body.defaultQuota, "Định mức", 0, 30);
    const active = body.active === undefined ? true : body.active === true;
    let departmentId: string | null = null;
    if (body.departmentId) {
      departmentId = id(body.departmentId);
      if (!(await client.query(`SELECT 1 FROM academic_departments WHERE id=$1 AND unit_id=$2`, [departmentId, unitId])).rowCount)
        throw invalid("Bộ môn không thuộc khoa.");
    }
    const existing = await client.query<{ unit_id: string }>(`SELECT unit_id FROM academic_staff WHERE user_id=$1 FOR UPDATE`, [user.rows[0].id]);
    if (existing.rowCount && existing.rows[0].unit_id !== unitId)
      throw conflict("STAFF_OTHER_UNIT", "Giảng viên đang thuộc khoa khác.");
    await client.query(
      `INSERT INTO academic_staff(user_id,unit_id,department_id,staff_code,academic_rank,default_quota,active) VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(user_id) DO UPDATE SET department_id=EXCLUDED.department_id,staff_code=EXCLUDED.staff_code,academic_rank=EXCLUDED.academic_rank,default_quota=EXCLUDED.default_quota,active=EXCLUDED.active`,
      [user.rows[0].id, unitId, departmentId, staffCode, rank, quota, active],
    ).catch((error: { code?: string }) => {
      if (error.code === "23505") throw conflict("DUPLICATE_CODE", "Mã giảng viên đã được dùng.");
      throw error;
    });
    await audit(client, { unitId, actorId: userId, entity: "staff", entityId: user.rows[0].id, action: existing.rowCount ? "staff.updated" : "staff.created", details: { staffCode, rank, quota, active, departmentId } });
    return { userId: user.rows[0].id, staffCode, rank, defaultQuota: quota, active, departmentId };
  });
}

export async function listStaff(userId: string, unitId: string) {
  id(unitId);
  return withTransaction(async (client) => {
    const actor = await loadActor(client, userId);
    if (!actor.systemAdmin && !actor.unitRoles.has(unitId) && actor.staff?.unitId !== unitId) throw forbidden();
    const rows = await client.query(
      `SELECT s.user_id AS "userId",u.display_name AS "displayName",u.email,s.staff_code AS "staffCode",s.academic_rank AS rank,s.default_quota AS "defaultQuota",s.active,d.code AS "departmentCode" FROM academic_staff s JOIN users u ON u.id=s.user_id LEFT JOIN academic_departments d ON d.id=s.department_id WHERE s.unit_id=$1 ORDER BY s.staff_code`,
      [unitId],
    );
    const departments = await client.query(`SELECT id,code,name FROM academic_departments WHERE unit_id=$1 ORDER BY code`, [unitId]);
    return { staff: rows.rows, departments: departments.rows };
  });
}

export async function grantRole(userId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const actor = await loadActor(client, userId);
    const role = choice(body.role, ["system_admin", "unit_admin", "unit_head"] as const, "Vai trò");
    const unitId = role === "system_admin" ? null : id(body.unitId);
    // Only system administrators hand out unit-level authority.
    if (!actor.systemAdmin) throw forbidden("Chỉ quản trị hệ thống được cấp quyền.");
    const email = text(body.email, "Email", 3, 320).toLowerCase();
    const target = await client.query<{ id: string }>(`SELECT id FROM users WHERE lower(email)=$1`, [email]);
    if (!target.rowCount) throw notFound("Chưa có tài khoản dùng email này.");
    if (unitId && !(await client.query(`SELECT 1 FROM academic_units WHERE id=$1`, [unitId])).rowCount)
      throw notFound("Không tìm thấy khoa.");
    const revoke = body.revoke === true;
    if (revoke) {
      if (role === "system_admin" && target.rows[0].id === userId)
        throw conflict("SELF_REVOKE", "Không thể tự thu hồi quyền quản trị hệ thống.");
      await client.query(
        `DELETE FROM academic_role_grants WHERE user_id=$1 AND role=$2 AND unit_id IS NOT DISTINCT FROM $3`,
        [target.rows[0].id, role, unitId],
      );
    } else
      await client.query(
        `INSERT INTO academic_role_grants(id,user_id,role,unit_id,granted_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [randomUUID(), target.rows[0].id, role, unitId, userId],
      );
    await audit(client, { unitId, actorId: userId, entity: "role_grant", entityId: target.rows[0].id, action: revoke ? "role.revoked" : "role.granted", details: { role } });
    return { userId: target.rows[0].id, role, unitId, revoked: revoke };
  });
}

export async function listUnits(userId: string) {
  return (await getAcademicProfile(userId)).units;
}

export async function listAudit(userId: string, termId: string, params: URLSearchParams) {
  id(termId);
  const term = await query<{ unit_id: string }>(`SELECT unit_id FROM thesis_terms WHERE id=$1`, [termId]);
  if (!term.rowCount) throw notFound("Không tìm thấy đợt đồ án.");
  return withTransaction(async (client) => {
    requireUnitRole(await loadActor(client, userId), term.rows[0].unit_id, "unit_admin", "unit_head");
    const before = params.get("before");
    const rows = await client.query(
      `SELECT a.id,a.entity,a.entity_id AS "entityId",a.action,a.details,a.created_at AS "createdAt",u.display_name AS "actorName" FROM academic_audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.term_id=$1 AND ($2::timestamptz IS NULL OR a.created_at<$2) ORDER BY a.created_at DESC,a.id DESC LIMIT 100`,
      [termId, before && Number.isFinite(Date.parse(before)) ? before : null],
    );
    return { events: rows.rows };
  });
}
