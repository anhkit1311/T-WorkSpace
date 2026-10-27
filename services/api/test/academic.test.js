import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { URLSearchParams } from "node:url";
import { test } from "node:test";

import { pool } from "../../../dist/api/infrastructure/database/db.js";
import * as org from "../../../dist/api/modules/academic/organization.js";
import { verifyPassword } from "../../../dist/api/modules/auth/password.js";
import { login } from "../../../dist/api/modules/auth/service.js";

const skip = process.env.RUN_DB_TESTS !== "1";
const sql = (text, values = []) => pool.query(text, values);
const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code || assert.fail(`expected ${code}, got ${error.code}: ${error.message}`));

async function user(name) {
  const id = randomUUID();
  await sql(`INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,'test-only',$3,true)`, [id, `acad-${id}@example.test`, name]);
  return { id, email: `acad-${id}@example.test` };
}

/** Removes everything the test created. The append-only audit trigger is bypassed only here, in the test session. */
async function cleanup(unitId, userIds) {
  const client = await pool.connect();
  try {
    await client.query(`SET session_replication_role = replica`);
    if (unitId)
      for (const statement of [
        `DELETE FROM academic_audit_events WHERE unit_id=$1`,
        `DELETE FROM academic_role_grants WHERE unit_id=$1`,
        `DELETE FROM academic_staff WHERE unit_id=$1`,
        `DELETE FROM academic_departments WHERE unit_id=$1`,
        `DELETE FROM academic_units WHERE id=$1`,
      ])
        await client.query(statement, [unitId]);
    await client.query(`DELETE FROM academic_audit_events WHERE actor_id=ANY($1::uuid[])`, [userIds]);
    await client.query(`SET session_replication_role = origin`);
    await client.query(`DELETE FROM academic_role_grants WHERE user_id=ANY($1::uuid[])`, [userIds]);
    await client.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [userIds]);
  } finally {
    client.release();
  }
}

test("Organisation: faculties, lecturers and role grants are system-admin controlled", { skip, timeout: 30000 }, async () => {
  const people = { root: await user("Quản trị"), office: await user("Giáo vụ"), lecturer: await user("Giảng viên"), outsider: await user("Người ngoài") };
  const id = (name) => people[name].id;
  let unit;
  try {
    await sql(`INSERT INTO academic_role_grants(id,user_id,role) VALUES($1,$2,'system_admin')`, [randomUUID(), id("root")]);
    await rejects(org.createUnit(id("office"), { code: "QA", name: "Khoa QA" }), "FORBIDDEN");
    unit = await org.createUnit(id("root"), { code: `QA${Date.now() % 100000}`, name: "Khoa Công nghệ thông tin (QA)" });
    await rejects(org.createUnit(id("root"), { code: unit.code, name: "Trùng mã" }), "DUPLICATE_CODE");

    await org.grantRole(id("root"), { role: "unit_admin", unitId: unit.id, email: people.office.email });
    await rejects(org.grantRole(id("office"), { role: "unit_head", unitId: unit.id, email: people.lecturer.email }), "FORBIDDEN");
    await rejects(org.grantRole(id("root"), { role: "system_admin", email: people.root.email, revoke: true }), "SELF_REVOKE");

    const department = await org.createDepartment(id("office"), unit.id, { code: "KTPM", name: "Kỹ thuật phần mềm" });
    // Tạo tài khoản in a unit: an existing email moves here and gets the unit's next mã số, kept on a repeat.
    await rejects(org.enrollAccount(id("office"), unit.id, { email: people.lecturer.email, kind: "lecturer" }), "FORBIDDEN");
    const enrolled = await org.enrollAccount(id("root"), unit.id, { email: people.lecturer.email, kind: "lecturer", rank: "ts", departmentId: department.id });
    assert.deepEqual([enrolled.status, enrolled.password, enrolled.userCode], ["moved", null, `GV${unit.idPrefix}001`]);
    assert.equal((await org.enrollAccount(id("root"), unit.id, { email: people.lecturer.email, kind: "lecturer", rank: "ts", departmentId: department.id })).userCode, enrolled.userCode);
    await rejects(org.enrollAccount(id("root"), unit.id, { email: `acad-${randomUUID()}@example.test`, kind: "lecturer" }), "INVALID_DISPLAY_NAME");
    const fresh = await org.enrollAccount(id("root"), unit.id, { email: `acad-${randomUUID()}@example.test`, displayName: "Sinh viên mới", kind: "student", cohort: "97" });
    people.fresh = { id: fresh.userId };
    assert.deepEqual([fresh.status, fresh.password.length, fresh.userCode], ["created", 12, `97${unit.idPrefix}0001`]);
    const staff = await org.listStaff(id("lecturer"), unit.id);
    // Every account of the unit: the lecturer (with bộ môn) and the new student.
    assert.deepEqual(staff.staff.map((row) => row.departmentCode).sort(), ["KTPM", null]);
    await rejects(org.listStaff(id("outsider"), unit.id), "FORBIDDEN");

    const profile = await org.getAcademicProfile(id("lecturer"));
    assert.equal(profile.staff.unitId, unit.id);
    assert.equal(profile.systemAdmin, false);

    await rejects(org.listAccess(id("office"), new URLSearchParams()), "FORBIDDEN");
    // Danh sách nhân sự: any member reads it; students (numeric mã số, any email domain) are left out.
    const directory = (await org.listDirectory(id("office"))).staff;
    assert.ok(directory.some((row) => row.email === people.office.email));
    assert.ok(directory.every((row) => !/^[0-9]/.test(row.userCode ?? "")));
    const access = await org.listAccess(id("root"), new URLSearchParams({ q: people.office.email }));
    assert.deepEqual(access.users.find((row) => row.id === id("office")).grants, [{ role: "unit_admin", unitId: unit.id }]);
    await rejects(org.resetPassword(id("office"), id("lecturer"), {}), "FORBIDDEN");
    await rejects(org.resetPassword(id("root"), id("lecturer"), { password: "short" }), "INVALID_PASSWORD");
    assert.equal((await org.resetPassword(id("root"), id("lecturer"), { password: "MatKhauMoi123" })).password, "MatKhauMoi123");
    const stored = await sql(`SELECT password_hash FROM users WHERE id=$1`, [id("lecturer")]);
    assert.ok(await verifyPassword("MatKhauMoi123", stored.rows[0].password_hash));
    assert.equal((await org.resetPassword(id("root"), id("lecturer"), {})).password.length, 12);

    const code = `T${Date.now() % 10000000}`;
    await rejects(org.setUserCode(id("office"), id("lecturer"), { userCode: code }), "FORBIDDEN");
    await rejects(org.setUserCode(id("root"), id("lecturer"), { userCode: "a-b" }), "INVALID_USER_CODE");
    assert.equal((await org.setUserCode(id("root"), id("lecturer"), { userCode: code.toLowerCase() })).userCode, code);
    await rejects(org.setUserCode(id("root"), id("outsider"), { userCode: code }), "USER_CODE_TAKEN");
    await org.resetPassword(id("root"), id("lecturer"), { password: "MatKhauMoi123" });
    const signedIn = await login({ email: code.toLowerCase(), password: "MatKhauMoi123" }, {});
    assert.equal(signedIn.user.id, id("lecturer"));
    await rejects(login({ email: code, password: "SaiMatKhau123" }, {}), "INVALID_CREDENTIALS");
    await sql(`DELETE FROM refresh_sessions WHERE user_id=$1`, [id("lecturer")]);

    // Mã định danh: faculties 01–49, offices 50–99; accounts get the next mã số under it.
    await rejects(org.updateUnit(id("root"), unit.id, { idPrefix: "77" }), "INVALID_ID_PREFIX");
    const free = (await sql(`SELECT lpad(n::text,2,'0') p FROM generate_series(1,49) n WHERE lpad(n::text,2,'0') NOT IN (SELECT id_prefix FROM academic_units WHERE id_prefix IS NOT NULL) LIMIT 1`)).rows[0].p;
    await org.updateUnit(id("root"), unit.id, { idPrefix: free });
    const taken = (await sql(`SELECT id_prefix FROM academic_units WHERE id_prefix IS NOT NULL AND id<>$1 AND COALESCE(kind,'faculty')='faculty' LIMIT 1`, [unit.id])).rows[0];
    if (taken) await rejects(org.updateUnit(id("root"), unit.id, { idPrefix: taken.id_prefix }), "DUPLICATE_ID_PREFIX");
    await rejects(org.createAccounts(id("root"), { kind: "student", unitId: unit.id, cohort: "2023", accounts: [{ email: "x@example.test", displayName: "Sinh viên" }] }), "INVALID_COHORT");
    const mails = [randomUUID(), randomUUID(), randomUUID()].map((key) => `acad-${key}@example.test`);
    const students = await org.createAccounts(id("root"), { kind: "student", unitId: unit.id, cohort: "99", accounts: mails.slice(0, 2).map((email) => ({ email, displayName: "Sinh viên" })) });
    assert.deepEqual(students.accounts.map((row) => row.userCode), [`99${free}0001`, `99${free}0002`]);
    const lecturers = await org.createAccounts(id("root"), { kind: "lecturer", unitId: unit.id, accounts: [{ email: mails[2], displayName: "GV" }] });
    assert.equal(lecturers.accounts[0].userCode, `GV${free}001`);
    const created = (await sql(`SELECT id FROM users WHERE email=ANY($1)`, [mails])).rows.map((row) => row.id);
    Object.assign(people, Object.fromEntries(created.map((userId, index) => [`new${index}`, { id: userId }])));
    const inUnit = await org.listAccess(id("root"), new URLSearchParams({ unit: unit.id }));
    assert.equal(inUnit.users.length, 5); // the three new accounts, the enrolled student and the lecturer
    // Every account needs a unit and a mã số: the form previews the next codes, the unit cannot be cleared,
    // and an account without a code gets one when it is placed in a unit.
    await rejects(org.createAccounts(id("root"), { accounts: [{ email: "x@example.test", displayName: "Không đơn vị" }] }), "UNIT_REQUIRED");
    assert.deepEqual((await org.previewCodes(id("root"), unit.id, new URLSearchParams({ kind: "lecturer", count: "2" }))).codes, [`GV${free}002`, `GV${free}003`]);
    await rejects(org.previewCodes(id("office"), unit.id, new URLSearchParams({ kind: "staff" })), "FORBIDDEN");
    await rejects(org.setUserUnit(id("root"), created[0], {}), "UNIT_REQUIRED");
    assert.deepEqual(await org.setUserUnit(id("root"), id("outsider"), { unitId: unit.id }), { unitId: unit.id, userCode: `CB${free}001` });
    assert.equal((await org.setUserUnit(id("root"), id("outsider"), { unitId: unit.id })).userCode, `CB${free}001`);
    // Turned into a student: a new SV code and the lecturer record is dropped.
    assert.equal((await org.enrollAccount(id("root"), unit.id, { email: people.lecturer.email, kind: "student", cohort: "98" })).userCode, `98${free}0001`);
    assert.equal((await sql(`SELECT 1 FROM academic_staff WHERE user_id=$1`, [id("lecturer")])).rowCount, 0);
    // Xoá tài khoản: system admin only, never oneself, refused while the account owns kept data (here: audit trail).
    await rejects(org.deleteAccount(id("office"), id("fresh")), "FORBIDDEN");
    await rejects(org.deleteAccount(id("root"), id("root")), "SELF_DELETE");
    await rejects(org.deleteAccount(id("root"), id("office")), "ACCOUNT_IN_USE");
    assert.equal((await org.deleteAccount(id("root"), id("fresh"))).deleted.startsWith("acad-"), true);
    assert.equal((await sql(`SELECT 1 FROM users WHERE id=$1`, [id("fresh")])).rowCount, 0);
    await org.grantRole(id("root"), { role: "unit_admin", unitId: unit.id, email: people.office.email, revoke: true });
    await rejects(org.createDepartment(id("office"), unit.id, { code: "HTTT", name: "Hệ thống thông tin" }), "FORBIDDEN");
  } finally {
    await cleanup(unit?.id, Object.values(people).map((person) => person.id));
  }
});

test.after(() => pool.end());
