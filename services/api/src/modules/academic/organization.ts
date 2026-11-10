import { randomBytes, randomUUID } from "node:crypto";
import { withTransaction } from "../../infrastructure/database/db.js";
import type { PoolClient } from "pg";
import { hashPassword } from "../auth/password.js";
import { normalizeEmail, normalizeUserCode, validateDisplayName } from "../auth/service.js";
import {
  audit,
  choice,
  code,
  conflict,
  forbidden,
  id,
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
      `SELECT id,code,name,id_prefix AS "idPrefix" FROM academic_units WHERE $1::boolean OR id=ANY($2::uuid[]) ORDER BY code`,
      [
        actor.systemAdmin,
        [...actor.unitRoles.keys(), ...(actor.staff ? [actor.staff.unitId] : [])],
      ],
    );
    return {
      systemAdmin: actor.systemAdmin,
      unitRoles: Object.fromEntries(
        [...actor.unitRoles].map(([unit, roles]) => [unit, [...roles]]),
      ),
      staff: actor.staff,
      units: units.rows,
    };
  });
}

/** Mã định danh 2 số: faculties use 01–49, offices 50–99, so a mã số shows which kind issued it. */
function idPrefix(value: unknown, kind: string): string {
  const prefix = String(value).trim();
  const [low, high] = kind === "office" ? [50, 99] : [1, 49];
  if (!/^[0-9]{2}$/.test(prefix) || Number(prefix) < low || Number(prefix) > high)
    throw invalid(
      `Mã định danh của ${kind === "office" ? "phòng ban" : "khoa"} là 2 chữ số từ ${String(low).padStart(2, "0")} đến ${high}.`,
      "INVALID_ID_PREFIX",
    );
  return prefix;
}

/** The lowest unused prefix in the kind's range, or null when the range is full. */
async function freePrefix(client: PoolClient, kind: string): Promise<string | null> {
  const [low, high] = kind === "office" ? [50, 99] : [1, 49];
  const free = await client.query<{ prefix: string }>(
    `SELECT lpad(n::text,2,'0') AS prefix FROM generate_series($1::int,$2::int) n
     WHERE lpad(n::text,2,'0') NOT IN (SELECT id_prefix FROM academic_units WHERE id_prefix IS NOT NULL) ORDER BY n LIMIT 1`,
    [low, high],
  );
  return free.rows[0]?.prefix ?? null;
}

/** Máy lẻ of a unit: 1{mã định danh}{01–99}, e.g. 01 → 10101–10199 (see migration 045). */
const prefixRange = (prefix: string): [number, number] => [
  10000 + Number(prefix) * 100 + 1,
  10000 + Number(prefix) * 100 + 99,
];

const unitTaken = (err: { code?: string; constraint?: string }) => {
  if (err.code === "23505" && err.constraint === "academic_units_id_prefix_key")
    throw conflict("DUPLICATE_ID_PREFIX", "Mã định danh này đã thuộc về khoa / phòng ban khác.");
  if (err.code === "23505") throw conflict("DUPLICATE_CODE", "Mã số khoa/phòng ban đã tồn tại.");
  throw err;
};

export async function createUnit(userId: string, body: Record<string, unknown>) {
  return withTransaction(async (client) => {
    const actor = await loadActor(client, userId);
    if (!actor.systemAdmin) throw forbidden("Chỉ quản trị hệ thống được tạo khoa / phòng ban.");
    const id = randomUUID();
    const name = text(body.name, "Tên khoa / phòng ban", 2, 160);
    const kind = body.kind === "office" ? "office" : "faculty";
    const rawCode = body.code ? String(body.code).trim().toUpperCase() : null;
    const unitCode = rawCode ? code(rawCode, "Mã số") : null;
    const enableFreePbx = Boolean(body.enableFreePbx || body.hasFreePbx);
    const prefix = body.idPrefix ? idPrefix(body.idPrefix, kind) : await freePrefix(client, kind);

    await client
      .query(
        `INSERT INTO academic_units(id, code, name, kind, id_prefix) VALUES($1, $2, $3, $4, $5)`,
        [id, unitCode, name, kind, prefix],
      )
      .catch(unitTaken);

    if (enableFreePbx) {
      let extFrom = body.extensionFrom ? Number(body.extensionFrom) : null;
      let extTo = body.extensionTo ? Number(body.extensionTo) : null;
      if (!extFrom && prefix) {
        [extFrom, extTo] = prefixRange(prefix);
      } else if (!extFrom) {
        const maxExt = await client.query<{ max_to: number }>(
          `SELECT MAX(extension_to) AS max_to FROM cc_departments`,
        );
        extFrom = Math.max(600, (maxExt.rows[0]?.max_to || 599) + 1);
        extTo = extFrom + 99;
      } else if (!extTo) {
        extTo = extFrom + 99;
      }
      await client.query(
        `INSERT INTO cc_departments(unit_id, extension_from, extension_to, strategy, ring_seconds, max_wait_seconds, wrap_up_seconds, active)
         VALUES($1, $2, $3, 'longest_idle', 20, 300, 15, true)
         ON CONFLICT (unit_id) DO UPDATE SET extension_from = EXCLUDED.extension_from, extension_to = EXCLUDED.extension_to, active = true`,
        [id, extFrom, extTo],
      );
    }

    await audit(client, {
      unitId: id,
      actorId: userId,
      entity: "unit",
      entityId: id,
      action: "unit.created",
      details: { id, code: unitCode, name, kind, enableFreePbx },
    });
    return { id, code: unitCode, name, kind, idPrefix: prefix, hasFreePbx: enableFreePbx };
  });
}

export async function updateUnit(userId: string, unitId: string, body: Record<string, unknown>) {
  id(unitId);
  return withTransaction(async (client) => {
    const actor = await loadActor(client, userId);
    if (!actor.systemAdmin) throw forbidden("Chỉ quản trị hệ thống được sửa khoa / phòng ban.");
    const existing = await client.query<{
      id: string;
      code: string | null;
      name: string;
      kind: string;
      id_prefix: string | null;
    }>(`SELECT id, code, name, kind, id_prefix FROM academic_units WHERE id = $1`, [unitId]);
    if (!existing.rowCount) throw notFound("Khoa / phòng ban không tồn tại.");

    const name =
      body.name !== undefined
        ? text(body.name, "Tên khoa / phòng ban", 2, 160)
        : existing.rows[0].name;
    const kind =
      body.kind !== undefined
        ? body.kind === "office"
          ? "office"
          : "faculty"
        : existing.rows[0].kind;
    let unitCode = existing.rows[0].code;
    if (body.code !== undefined) {
      const rawCode = body.code ? String(body.code).trim().toUpperCase() : null;
      unitCode = rawCode ? code(rawCode, "Mã số") : null;
    }

    const prefix =
      body.idPrefix !== undefined
        ? body.idPrefix
          ? idPrefix(body.idPrefix, kind)
          : null
        : existing.rows[0].id_prefix;

    await client
      .query(
        `UPDATE academic_units SET name = $1, kind = $2, code = $3, id_prefix = $4 WHERE id = $5`,
        [name, kind, unitCode, prefix, unitId],
      )
      .catch(unitTaken);

    if (body.enableFreePbx !== undefined || body.hasFreePbx !== undefined) {
      const enableFreePbx = Boolean(body.enableFreePbx ?? body.hasFreePbx);
      if (enableFreePbx) {
        let extFrom = body.extensionFrom ? Number(body.extensionFrom) : null;
        let extTo = body.extensionTo ? Number(body.extensionTo) : null;
        if (!extFrom) {
          const cur = await client.query<{ extension_from: number; extension_to: number }>(
            `SELECT extension_from, extension_to FROM cc_departments WHERE unit_id = $1`,
            [unitId],
          );
          if (cur.rowCount) {
            extFrom = cur.rows[0].extension_from;
            extTo = cur.rows[0].extension_to;
          } else if (prefix) {
            [extFrom, extTo] = prefixRange(prefix);
          } else {
            const maxExt = await client.query<{ max_to: number }>(
              `SELECT MAX(extension_to) AS max_to FROM cc_departments`,
            );
            extFrom = Math.max(600, (maxExt.rows[0]?.max_to || 599) + 1);
            extTo = extFrom + 99;
          }
        } else if (!extTo) {
          extTo = extFrom + 99;
        }
        await client.query(
          `INSERT INTO cc_departments(unit_id, extension_from, extension_to, strategy, ring_seconds, max_wait_seconds, wrap_up_seconds, active)
           VALUES($1, $2, $3, 'longest_idle', 20, 300, 15, true)
           ON CONFLICT (unit_id) DO UPDATE SET extension_from = EXCLUDED.extension_from, extension_to = EXCLUDED.extension_to, active = true`,
          [unitId, extFrom, extTo],
        );
      } else {
        await client.query(`DELETE FROM cc_departments WHERE unit_id = $1`, [unitId]);
      }
    }

    await audit(client, {
      unitId,
      actorId: userId,
      entity: "unit",
      entityId: unitId,
      action: "unit.updated",
      details: { name, kind, code: unitCode },
    });
    return { id: unitId, code: unitCode, name, kind };
  });
}

export async function deleteUnit(userId: string, unitId: string) {
  id(unitId);
  return withTransaction(async (client) => {
    const actor = await loadActor(client, userId);
    if (!actor.systemAdmin) throw forbidden("Chỉ quản trị hệ thống được xoá khoa / phòng ban.");
    await client.query(`DELETE FROM cc_departments WHERE unit_id = $1`, [unitId]);
    await client.query(`DELETE FROM academic_departments WHERE unit_id = $1`, [unitId]);
    await client.query(`DELETE FROM academic_role_grants WHERE unit_id = $1`, [unitId]);
    const res = await client.query(`DELETE FROM academic_units WHERE id = $1 RETURNING id, name`, [
      unitId,
    ]);
    if (!res.rowCount) throw notFound("Khoa / phòng ban không tồn tại.");
    await audit(client, {
      unitId,
      actorId: userId,
      entity: "unit",
      entityId: unitId,
      action: "unit.deleted",
      details: res.rows[0],
    });
    return { ok: true, deleted: res.rows[0] };
  });
}

export async function createDepartment(
  userId: string,
  unitId: string,
  body: Record<string, unknown>,
) {
  return withTransaction(async (client) => {
    id(unitId);
    requireUnitRole(await loadActor(client, userId), unitId, "unit_admin");
    const department = {
      id: randomUUID(),
      code: code(body.code, "Mã bộ môn"),
      name: text(body.name, "Tên bộ môn", 2, 160),
    };
    const inserted = await client.query(
      `INSERT INTO academic_departments(id,unit_id,code,name) SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM academic_units WHERE id=$2) ON CONFLICT(unit_id,code) DO NOTHING`,
      [department.id, unitId, department.code, department.name],
    );
    if (!inserted.rowCount)
      throw conflict("DUPLICATE_CODE", "Mã bộ môn đã tồn tại hoặc khoa không hợp lệ.");
    await audit(client, {
      unitId,
      actorId: userId,
      entity: "department",
      entityId: department.id,
      action: "department.created",
      details: department,
    });
    return department;
  });
}

/**
 * "Tạo tài khoản" of a khoa / phòng ban, by email: a new email gets an account with a random password
 * (returned once), an existing one moves here. Either way it gets the unit's next mã số for its kind,
 * unless its mã số already follows that pattern. Lecturers and staff also get the record e-learning reads.
 */
export async function enrollAccount(userId: string, unitId: string, body: Record<string, unknown>) {
  id(unitId);
  const email = normalizeEmail(body.email);
  const kind = choice(body.kind, ACCOUNT_KINDS, "Loại tài khoản");
  const cohort = kind === "student" ? cohortOf(body.cohort) : null;
  const rank = kind === "student" ? null : choice(body.rank ?? "ths", ranks, "Học vị");
  await withTransaction(async (client) => {
    if (!(await loadActor(client, userId)).systemAdmin)
      throw forbidden("Chỉ quản trị hệ thống được tạo tài khoản.");
  });
  // Hashed before the transaction like createAccounts; unused when the account already exists.
  const password = randomBytes(9).toString("base64url");
  const hash = await hashPassword(password);
  return withTransaction(async (client) => {
    const issue = await codeIssuer(client, unitId, kind, cohort);
    let departmentId: string | null = null;
    if (body.departmentId && kind !== "student") {
      departmentId = id(body.departmentId);
      if (
        !(
          await client.query(`SELECT 1 FROM academic_departments WHERE id=$1 AND unit_id=$2`, [
            departmentId,
            unitId,
          ])
        ).rowCount
      )
        throw invalid("Bộ môn không thuộc khoa.");
    }
    const existing = await client.query<{ id: string; user_code: string | null }>(
      `SELECT id,user_code FROM users WHERE lower(email)=$1 FOR UPDATE`,
      [email],
    );
    const target = existing.rows[0];
    const userCode = target && issue.fits(target.user_code) ? target.user_code! : await issue();
    const accountId = target?.id ?? randomUUID();
    if (target)
      await client.query(`UPDATE users SET unit_id=$1,user_code=$2,updated_at=now() WHERE id=$3`, [
        unitId,
        userCode,
        accountId,
      ]);
    else
      await client.query(
        `INSERT INTO users(id,email,password_hash,display_name,email_verified,auth_provider,user_code,unit_id) VALUES($1,$2,$3,$4,true,'local',$5,$6)`,
        [accountId, email, hash, validateDisplayName(body.displayName), userCode, unitId],
      );
    if (!rank)
      await client
        .query(`DELETE FROM academic_staff WHERE user_id=$1`, [accountId])
        .catch((error: { code?: string }) => {
          if (error.code === "23503")
            throw conflict(
              "STAFF_IN_USE",
              "Tài khoản đang hướng dẫn / chấm đồ án nên chưa chuyển thành sinh viên được.",
            );
          throw error;
        });
    else
      await client
        .query(
          `INSERT INTO academic_staff(user_id,unit_id,department_id,staff_code,academic_rank,active) VALUES($1,$2,$3,$4,$5,true)
         ON CONFLICT(user_id) DO UPDATE SET unit_id=EXCLUDED.unit_id,department_id=EXCLUDED.department_id,staff_code=EXCLUDED.staff_code,academic_rank=EXCLUDED.academic_rank,active=true`,
          [accountId, unitId, departmentId, userCode, rank],
        )
        .catch(codeTaken(userCode));
    await audit(client, {
      unitId,
      actorId: userId,
      entity: "account",
      entityId: accountId,
      action: target ? "account.unit_set" : "account.created",
      details: { email, kind, userCode },
    });
    // An existing account keeps the máy lẻ it has; one without gets the unit's next (routes.ts).
    const phoneless = !(
      await client.query(`SELECT 1 FROM cc_extensions WHERE user_id=$1`, [accountId])
    ).rowCount;
    return {
      userId: accountId,
      email,
      kind,
      userCode,
      status: target ? ("moved" as const) : ("created" as const),
      password: target ? null : password,
      phoneless,
    };
  });
}

/** Every account of the unit (users.unit_id), plus lecturers whose record is here; rank only for lecturers / staff. */
export async function listStaff(userId: string, unitId: string) {
  id(unitId);
  return withTransaction(async (client) => {
    const actor = await loadActor(client, userId);
    if (!actor.systemAdmin && !actor.unitRoles.has(unitId) && actor.staff?.unitId !== unitId)
      throw forbidden();
    const rows = await client.query(
      `SELECT u.id AS "userId",u.display_name AS "displayName",u.email,COALESCE(u.user_code,s.staff_code) AS "staffCode",s.academic_rank AS rank,COALESCE(s.active,true) AS active,d.code AS "departmentCode"
       FROM users u LEFT JOIN academic_staff s ON s.user_id=u.id LEFT JOIN academic_departments d ON d.id=s.department_id
       WHERE u.unit_id=$1 OR s.unit_id=$1 ORDER BY 4 NULLS LAST,u.display_name`,
      [unitId],
    );
    const departments = await client.query(
      `SELECT id,code,name FROM academic_departments WHERE unit_id=$1 ORDER BY code`,
      [unitId],
    );
    return { staff: rows.rows, departments: departments.rows };
  });
}

export const MAX_ACCOUNTS = 200;
const ACCOUNT_KINDS = ["student", "lecturer", "staff"] as const;

/** Khóa: the last two digits of the intake year. */
function cohortOf(value: unknown): string {
  const cohort = String(value ?? "").trim();
  if (!/^[0-9]{2}$/.test(cohort))
    throw invalid("Khóa là 2 chữ số cuối của năm nhập học, ví dụ 23.", "INVALID_COHORT");
  return cohort;
}

/**
 * Hands out the next mã số under the unit's prefix: SV `{khóa}{mã đơn vị}{STT 4}`, GV `GV{mã đơn vị}{STT 3}`,
 * CB `CB{mã đơn vị}{STT 3}`. The advisory lock keeps two concurrent imports from drawing the same number.
 */
async function codeIssuer(
  client: PoolClient,
  unitId: string,
  kind: (typeof ACCOUNT_KINDS)[number],
  cohort: string | null,
) {
  const unit = await client.query<{ id_prefix: string | null; name: string }>(
    `SELECT id_prefix,name FROM academic_units WHERE id=$1`,
    [unitId],
  );
  if (!unit.rowCount) throw notFound("Không tìm thấy khoa / phòng ban.");
  const unitPrefix = unit.rows[0].id_prefix;
  if (!unitPrefix)
    throw invalid(`${unit.rows[0].name} chưa có mã định danh 2 số.`, "MISSING_ID_PREFIX");
  const prefix =
    kind === "student"
      ? `${cohort}${unitPrefix}`
      : `${kind === "lecturer" ? "GV" : "CB"}${unitPrefix}`;
  const width = kind === "student" ? 4 : 3;
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('user_code:' || $1))`, [prefix]);
  const last = await client.query<{ n: number | null }>(
    `SELECT MAX(substr(user_code, $2::int + 1)::int) AS n FROM users WHERE user_code ~ ('^' || $1 || '[0-9]{' || $3 || '}$')`,
    [prefix, prefix.length, width],
  );
  let next = (last.rows[0].n ?? 0) + 1;
  const pattern = new RegExp(`^${prefix}[0-9]{${width}}$`);
  const issue = async () => {
    if (next >= 10 ** width)
      throw conflict("USER_CODE_EXHAUSTED", `Đã hết số thứ tự cho mã ${prefix}.`);
    return prefix + String(next++).padStart(width, "0");
  };
  // fits: the code already belongs to this unit / kind (/ khóa), so moving the account keeps it.
  return Object.assign(issue, {
    fits: (userCode: string | null) => userCode !== null && pattern.test(userCode),
  });
}

/**
 * No self sign-up (TDTU only): the system administrator creates verified accounts, one or a pasted
 * list. Each new account gets a random password that is returned once and only stored hashed.
 */
export async function createAccounts(userId: string, body: Record<string, unknown>) {
  const rows = body.accounts;
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ACCOUNTS)
    throw invalid(`Cần từ 1 đến ${MAX_ACCOUNTS} tài khoản mỗi lần.`);
  const accounts = rows.map(
    (row: { email?: unknown; displayName?: unknown; userCode?: unknown } | null, index) => {
      try {
        return {
          email: normalizeEmail(row?.email),
          displayName: validateDisplayName(row?.displayName),
          userCode: row?.userCode ? normalizeUserCode(row.userCode) : null,
        };
      } catch (error) {
        throw invalid(
          `Dòng ${index + 1}: ${error instanceof Error ? error.message : "không hợp lệ."}`,
        );
      }
    },
  );
  // Every account belongs to a faculty / office and has a mã số: both are required here.
  if (!body.unitId || !body.kind)
    throw invalid("Chọn khoa / phòng ban và loại tài khoản để cấp mã số.", "UNIT_REQUIRED");
  const unitId = id(body.unitId);
  const kind = choice(body.kind, ACCOUNT_KINDS, "Loại tài khoản");
  const cohort = kind === "student" ? cohortOf(body.cohort) : null;
  // Checked before hashing: scrypt for a whole list is too costly to spend on a refused request.
  await withTransaction(async (client) => {
    if (!(await loadActor(client, userId)).systemAdmin)
      throw forbidden("Chỉ quản trị hệ thống được tạo tài khoản.");
  });
  const prepared = await Promise.all(
    accounts.map(async (account) => {
      const password = randomBytes(9).toString("base64url");
      return { ...account, password, hash: await hashPassword(password) };
    }),
  );
  return withTransaction(async (client) => {
    const issue = await codeIssuer(client, unitId, kind, cohort);
    const results = [];
    for (const account of prepared) {
      const exists = await client.query(`SELECT 1 FROM users WHERE lower(email)=$1`, [
        account.email,
      ]);
      if (!exists.rowCount && !account.userCode) account.userCode = await issue();
      const created = await client
        .query<{ id: string }>(
          `INSERT INTO users(id,email,password_hash,display_name,email_verified,auth_provider,user_code,unit_id) VALUES($1,$2,$3,$4,true,'local',$5,$6)
           ON CONFLICT ((lower(email))) DO NOTHING RETURNING id`,
          [
            randomUUID(),
            account.email,
            account.hash,
            account.displayName,
            account.userCode,
            unitId,
          ],
        )
        .catch(codeTaken(account.userCode));
      if (!created.rowCount) {
        results.push({
          userId: null,
          email: account.email,
          displayName: account.displayName,
          userCode: account.userCode,
          status: "exists" as const,
          password: null,
        });
        continue;
      }
      await audit(client, {
        actorId: userId,
        entity: "account",
        entityId: created.rows[0].id,
        action: "account.created",
        details: { email: account.email },
      });
      results.push({
        userId: created.rows[0].id,
        email: account.email,
        displayName: account.displayName,
        userCode: account.userCode,
        status: "created" as const,
        password: account.password,
      });
    }
    return { unitId, kind, accounts: results };
  });
}

/**
 * The next mã số the unit would hand out, for the create-account form to show before saving.
 * Read only: the numbers are not reserved, so a concurrent import may take them first.
 */
export async function previewCodes(userId: string, unitId: string, params: URLSearchParams) {
  id(unitId);
  const kind = choice(params.get("kind"), ACCOUNT_KINDS, "Loại tài khoản");
  const cohort = kind === "student" ? cohortOf(params.get("cohort")) : null;
  const count = Math.min(Math.max(Number(params.get("count")) || 1, 1), MAX_ACCOUNTS);
  return withTransaction(async (client) => {
    if (!(await loadActor(client, userId)).systemAdmin)
      throw forbidden("Chỉ quản trị hệ thống được tạo tài khoản.");
    const issue = await codeIssuer(client, unitId, kind, cohort);
    const codes = [];
    for (let index = 0; index < count; index++) codes.push(await issue());
    return { codes };
  });
}

/** Turns a duplicate mã số into a readable 409 instead of a database error. */
const codeTaken = (userCode: string | null) => (error: { code?: string; constraint?: string }) => {
  if (error.code === "23505" && error.constraint === "users_user_code_key")
    throw conflict("USER_CODE_TAKEN", `Mã số ${userCode} đã thuộc về tài khoản khác.`);
  throw error;
};

/** The system administrator sets or clears an account's mã số sinh viên / giảng viên. */
export async function setUserCode(userId: string, targetId: string, body: Record<string, unknown>) {
  id(targetId);
  const userCode = body.userCode ? normalizeUserCode(body.userCode) : null;
  return withTransaction(async (client) => {
    if (!(await loadActor(client, userId)).systemAdmin)
      throw forbidden("Chỉ quản trị hệ thống được đặt mã số.");
    const updated = await client
      .query(`UPDATE users SET user_code=$1,updated_at=now() WHERE id=$2`, [userCode, targetId])
      .catch(codeTaken(userCode));
    if (!updated.rowCount) throw notFound("Không tìm thấy tài khoản.");
    await audit(client, {
      actorId: userId,
      entity: "account",
      entityId: targetId,
      action: "account.code_set",
      details: { userCode },
    });
    return { userCode };
  });
}

/**
 * The system administrator moves an account to a faculty / office. An existing mã số stays; an account
 * without one gets the unit's next code (lecturer if it has a lecturer record, else staff, unless `kind` says).
 */
export async function setUserUnit(userId: string, targetId: string, body: Record<string, unknown>) {
  id(targetId);
  if (!body.unitId)
    throw invalid("Mỗi tài khoản phải thuộc một khoa / phòng ban.", "UNIT_REQUIRED");
  const unitId = id(body.unitId);
  return withTransaction(async (client) => {
    if (!(await loadActor(client, userId)).systemAdmin)
      throw forbidden("Chỉ quản trị hệ thống được đổi đơn vị.");
    const target = await client.query<{ user_code: string | null; lecturer: boolean }>(
      `SELECT user_code,EXISTS(SELECT 1 FROM academic_staff s WHERE s.user_id=u.id) AS lecturer FROM users u WHERE id=$1 FOR UPDATE`,
      [targetId],
    );
    if (!target.rowCount) throw notFound("Không tìm thấy tài khoản.");
    let userCode = target.rows[0].user_code;
    if (!userCode) {
      const kind = body.kind
        ? choice(body.kind, ACCOUNT_KINDS, "Loại tài khoản")
        : target.rows[0].lecturer
          ? "lecturer"
          : "staff";
      userCode = await (
        await codeIssuer(client, unitId, kind, kind === "student" ? cohortOf(body.cohort) : null)
      )();
    } else if (!(await client.query(`SELECT 1 FROM academic_units WHERE id=$1`, [unitId])).rowCount)
      throw notFound("Không tìm thấy khoa / phòng ban.");
    await client.query(`UPDATE users SET unit_id=$1,user_code=$2,updated_at=now() WHERE id=$3`, [
      unitId,
      userCode,
      targetId,
    ]);
    await audit(client, {
      actorId: userId,
      entity: "account",
      entityId: targetId,
      action: "account.unit_set",
      details: { unitId, userCode },
    });
    return { unitId, userCode };
  });
}

/**
 * The system administrator sets a new password for an account: the one typed, or a random one when
 * left blank. Passwords are only stored hashed, so the new one is returned once and never readable later.
 * Every session of that account is signed out.
 */
export async function resetPassword(
  userId: string,
  targetId: string,
  body: Record<string, unknown>,
) {
  id(targetId);
  const typed = body.password;
  if (
    typed !== undefined &&
    typed !== "" &&
    (typeof typed !== "string" || typed.length < 8 || typed.length > 128)
  )
    throw invalid("Mật khẩu phải có từ 8 đến 128 ký tự.", "INVALID_PASSWORD");
  const password =
    typeof typed === "string" && typed ? typed : randomBytes(9).toString("base64url");
  await withTransaction(async (client) => {
    if (!(await loadActor(client, userId)).systemAdmin)
      throw forbidden("Chỉ quản trị hệ thống được đặt lại mật khẩu.");
  });
  const hash = await hashPassword(password);
  return withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE users SET password_hash=$1,auth_provider='local',updated_at=now() WHERE id=$2`,
      [hash, targetId],
    );
    if (!updated.rowCount) throw notFound("Không tìm thấy tài khoản.");
    await client.query(
      `UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,
      [targetId],
    );
    await audit(client, {
      actorId: userId,
      entity: "account",
      entityId: targetId,
      action: "account.password_reset",
    });
    return { password };
  });
}

/** What still points at an account and blocks deleting it (foreign keys without ON DELETE CASCADE). */
const blockingData: Record<string, string> = {
  messages: "tin nhắn đã gửi",
  channels: "kênh đã tạo",
  workspaces: "nhóm làm chủ",
  courses: "khóa học phụ trách",
  meeting_sessions: "cuộc họp đã chủ trì",
  academic_audit_events: "nhật ký quản trị",
  tasks: "công việc đã tạo",
};

/**
 * The system administrator deletes an account for good; its memberships, sessions and progress go with it.
 * Content others rely on (messages, courses, đồ án, audit trail…) is kept, so such an account is refused.
 */
export async function deleteAccount(userId: string, targetId: string) {
  id(targetId);
  if (targetId === userId)
    throw conflict("SELF_DELETE", "Không thể tự xoá tài khoản đang đăng nhập.");
  return withTransaction(async (client) => {
    if (!(await loadActor(client, userId)).systemAdmin)
      throw forbidden("Chỉ quản trị hệ thống được xoá tài khoản.");
    const target = await client.query<{ email: string }>(
      `SELECT email FROM users WHERE id=$1 FOR UPDATE`,
      [targetId],
    );
    if (!target.rowCount) throw notFound("Không tìm thấy tài khoản.");
    const refused = (error: { code?: string; table?: string }) => {
      if (error.code !== "23503") throw error;
      const what = blockingData[error.table ?? ""] ?? `dữ liệu (${error.table})`;
      throw conflict(
        "ACCOUNT_IN_USE",
        `Không xoá được ${target.rows[0].email}: tài khoản còn ${what}.`,
      );
    };
    // Its máy lẻ become unassigned (ON DELETE SET NULL); returned so the switchboard can free them.
    const extensions = await client.query<{ id: string }>(
      `SELECT id FROM cc_extensions WHERE user_id=$1`,
      [targetId],
    );
    await client.query(`DELETE FROM academic_staff WHERE user_id=$1`, [targetId]).catch(refused);
    await client.query(`DELETE FROM users WHERE id=$1`, [targetId]).catch(refused);
    await audit(client, {
      actorId: userId,
      entity: "account",
      entityId: targetId,
      action: "account.deleted",
      details: { email: target.rows[0].email },
    });
    return { deleted: target.rows[0].email, extensionIds: extensions.rows.map((row) => row.id) };
  });
}

/** "Phân quyền": accounts with their grants and lecturer record, for the system admin. */
export async function listAccess(userId: string, params: URLSearchParams) {
  const search = (params.get("q") ?? "").trim().slice(0, 100);
  // "none" lists accounts not yet in any faculty / office.
  const unit = params.get("unit") || null;
  if (unit && unit !== "none") id(unit);
  return withTransaction(async (client) => {
    if (!(await loadActor(client, userId)).systemAdmin)
      throw forbidden("Chỉ quản trị hệ thống xem được phân quyền.");
    const rows = await client.query(
      `SELECT u.id,u.display_name AS "displayName",u.email,u.user_code AS "userCode",u.unit_id AS "unitId",
         COALESCE((SELECT json_agg(json_build_object('role',g.role,'unitId',g.unit_id)) FROM academic_role_grants g WHERE g.user_id=u.id),'[]') AS grants,
         (SELECT json_build_object('unitId',s.unit_id,'active',s.active) FROM academic_staff s WHERE s.user_id=u.id) AS staff
       FROM users u
       WHERE ($1='' OR u.email ILIKE '%'||$1||'%' OR u.display_name ILIKE '%'||$1||'%' OR u.user_code ILIKE '%'||$1||'%')
         AND ($2::text IS NULL OR ($2='none' AND u.unit_id IS NULL) OR u.unit_id::text=$2)
       ORDER BY EXISTS(SELECT 1 FROM academic_role_grants g WHERE g.user_id=u.id) DESC,u.display_name
       LIMIT 100`,
      [search, unit],
    );
    return { users: rows.rows };
  });
}

/**
 * "Danh sách nhân sự": every account that is not a student, with its unit, rank, role and máy lẻ.
 * Any signed-in member may read it, like the chat people search. Students: a mã số starting with digits, whatever the email domain.
 */
export async function listDirectory(userId: string) {
  return withTransaction(async (client) => {
    await loadActor(client, userId);
    const rows = await client.query(
      `SELECT u.id AS "userId",u.display_name AS "displayName",u.email,COALESCE(s.staff_code,u.user_code) AS "userCode",
         au.name AS "unitName",au.kind AS "unitKind",d.name AS "departmentName",s.academic_rank AS rank,
         (SELECT e.number FROM cc_extensions e WHERE e.user_id=u.id AND e.active ORDER BY e.number LIMIT 1) AS extension,
         CASE
           WHEN EXISTS(SELECT 1 FROM academic_role_grants g WHERE g.user_id=u.id AND g.role='system_admin') THEN 'Quản trị hệ thống'
           WHEN EXISTS(SELECT 1 FROM academic_role_grants g WHERE g.user_id=u.id AND g.role='unit_head') THEN 'Trưởng đơn vị'
           WHEN EXISTS(SELECT 1 FROM academic_role_grants g WHERE g.user_id=u.id AND g.role='unit_admin') THEN 'Quản trị đơn vị'
           WHEN u.user_code LIKE 'GV%' OR (s.user_id IS NOT NULL AND au.kind='faculty') THEN 'Giảng viên'
           ELSE 'Cán bộ'
         END AS "roleTitle"
       FROM users u
       LEFT JOIN academic_staff s ON s.user_id=u.id
       LEFT JOIN academic_units au ON au.id=COALESCE(u.unit_id,s.unit_id,(SELECT department_id FROM cc_extensions WHERE user_id=u.id AND active LIMIT 1))
       LEFT JOIN academic_departments d ON d.id=s.department_id
       WHERE u.user_code IS NULL OR u.user_code !~ '^[0-9]'
       ORDER BY au.name NULLS LAST,u.display_name,u.id
       LIMIT 1000`,
    );
    return { staff: rows.rows };
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
    const target = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email)=$1`,
      [email],
    );
    if (!target.rowCount) throw notFound("Chưa có tài khoản dùng email này.");
    if (
      unitId &&
      !(await client.query(`SELECT 1 FROM academic_units WHERE id=$1`, [unitId])).rowCount
    )
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
    await audit(client, {
      unitId,
      actorId: userId,
      entity: "role_grant",
      entityId: target.rows[0].id,
      action: revoke ? "role.revoked" : "role.granted",
      details: { role },
    });
    return { userId: target.rows[0].id, role, unitId, revoked: revoke };
  });
}

export async function listUnits(userId: string) {
  return withTransaction(async (client) => {
    const actor = await loadActor(client, userId);
    const result = await client.query<{
      id: string;
      code: string | null;
      name: string;
      kind: "office" | "faculty";
      idPrefix: string | null;
      hasFreePbx: boolean;
      extensionFrom: number | null;
      extensionTo: number | null;
      staffCount: number;
    }>(
      `SELECT 
        u.id,
        u.code,
        u.name,
        COALESCE(u.kind, 'faculty') AS kind,
        u.id_prefix AS "idPrefix",
        (d.unit_id IS NOT NULL) AS "hasFreePbx",
        d.extension_from AS "extensionFrom",
        d.extension_to AS "extensionTo",
        COALESCE(sc.cnt, 0)::int AS "staffCount"
      FROM academic_units u
      LEFT JOIN cc_departments d ON d.unit_id = u.id
      LEFT JOIN (
        SELECT unit_id, COUNT(DISTINCT user_id) AS cnt
        FROM (
          SELECT unit_id, user_id FROM academic_staff
          UNION
          SELECT department_id AS unit_id, user_id FROM cc_members
          UNION
          SELECT unit_id, user_id FROM academic_role_grants WHERE unit_id IS NOT NULL
          UNION
          SELECT unit_id, id FROM users WHERE unit_id IS NOT NULL
        ) combined
        GROUP BY unit_id
      ) sc ON sc.unit_id = u.id
      WHERE $1::boolean OR u.id = ANY($2::uuid[])
      ORDER BY 
        CASE WHEN u.kind = 'office' THEN 0 ELSE 1 END,
        u.code NULLS LAST,
        u.name`,
      [
        actor.systemAdmin,
        [...actor.unitRoles.keys(), ...(actor.staff ? [actor.staff.unitId] : [])],
      ],
    );
    return result.rows;
  });
}
