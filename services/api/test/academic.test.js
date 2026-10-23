import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { URLSearchParams } from "node:url";
import { test } from "node:test";

import { pool } from "../../../dist/api/infrastructure/database/db.js";
import * as org from "../../../dist/api/modules/academic/organization.js";
import { verifyPassword } from "../../../dist/api/modules/auth/password.js";

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
    await org.upsertStaff(id("office"), unit.id, { email: people.lecturer.email, staffCode: `GV${Date.now() % 100000}`, rank: "ts", defaultQuota: 6, departmentId: department.id });
    await rejects(org.upsertStaff(id("office"), unit.id, { email: "nobody@example.test", staffCode: "GVX", rank: "ts", defaultQuota: 6 }), "NOT_FOUND");
    const staff = await org.listStaff(id("lecturer"), unit.id);
    assert.equal(staff.staff.length, 1);
    assert.equal(staff.staff[0].departmentCode, "KTPM");
    await rejects(org.listStaff(id("outsider"), unit.id), "FORBIDDEN");

    const profile = await org.getAcademicProfile(id("lecturer"));
    assert.equal(profile.staff.unitId, unit.id);
    assert.equal(profile.systemAdmin, false);

    await rejects(org.listAccess(id("office"), new URLSearchParams()), "FORBIDDEN");
    const access = await org.listAccess(id("root"), new URLSearchParams({ q: people.office.email }));
    assert.deepEqual(access.users.find((row) => row.id === id("office")).grants, [{ role: "unit_admin", unitId: unit.id }]);
    await rejects(org.resetPassword(id("office"), id("lecturer"), {}), "FORBIDDEN");
    await rejects(org.resetPassword(id("root"), id("lecturer"), { password: "short" }), "INVALID_PASSWORD");
    assert.equal((await org.resetPassword(id("root"), id("lecturer"), { password: "MatKhauMoi123" })).password, "MatKhauMoi123");
    const stored = await sql(`SELECT password_hash FROM users WHERE id=$1`, [id("lecturer")]);
    assert.ok(await verifyPassword("MatKhauMoi123", stored.rows[0].password_hash));
    assert.equal((await org.resetPassword(id("root"), id("lecturer"), {})).password.length, 12);
    await org.grantRole(id("root"), { role: "unit_admin", unitId: unit.id, email: people.office.email, revoke: true });
    await rejects(org.createDepartment(id("office"), unit.id, { code: "HTTT", name: "Hệ thống thông tin" }), "FORBIDDEN");
  } finally {
    await cleanup(unit?.id, Object.values(people).map((person) => person.id));
  }
});

test.after(() => pool.end());
