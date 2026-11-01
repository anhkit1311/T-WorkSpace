// Seeds a demonstration faculty: CNTT with departments, lecturers (who may teach E-learning courses)
// and student accounts.
//
//   node scripts/ops/create-user.mjs admin@tdtu.edu.vn "Quản trị hệ thống" --admin   (once)
//   SEED_ACADEMIC_PASSWORD=<password> npm run seed:academic
//
// Every record goes through the real service layer, acting as the existing system administrator.
// All accounts share SEED_ACADEMIC_PASSWORD; without it a random password is generated and printed once.
// `--reset` removes the demo faculty and its accounts first (development databases only).
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "../../dist/api/infrastructure/database/db.js";
import { hashPassword } from "../../dist/api/modules/auth/password.js";
import * as org from "../../dist/api/modules/academic/organization.js";

const DOMAIN = "demo.nexo.test";
const sql = (text, values = []) => pool.query(text, values);

const lecturers = [
  ["truongkhoa", "Trần Minh Khoa", "pgs", "KHMT", "GV001"],
  ["gv.lan", "Nguyễn Thị Lan", "ts", "KHMT", "GV002"],
  ["gv.hung", "Lê Quốc Hùng", "ts", "HTTT", "GV003"],
  ["gv.mai", "Phạm Ngọc Mai", "ths", "HTTT", "GV004"],
  ["gv.tuan", "Đỗ Anh Tuấn", "ts", "KTPM", "GV005"],
  ["gv.ha", "Vũ Thu Hà", "ths", "KTPM", "GV006"],
  ["gv.son", "Hoàng Văn Sơn", "pgs", "KHMT", "GV007"],
  ["gv.linh", "Bùi Khánh Linh", "ts", "HTTT", "GV008"],
];
const familyNames = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Phan", "Vũ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô"];
const givenNames = ["An", "Bình", "Chi", "Dũng", "Giang", "Hải", "Hạnh", "Khánh", "Long", "My", "Nam", "Ngân", "Phúc", "Quân", "Thảo", "Trang", "Tú", "Vy", "Yến", "Đạt", "Huy", "Kiệt", "Minh", "Nhi", "Phong", "Sơn", "Tâm", "Uyên"];

async function account(handle, displayName, passwordHash) {
  const email = `${handle}@${DOMAIN}`;
  const row = await sql(
    `INSERT INTO users(id,email,password_hash,display_name,email_verified) VALUES($1,$2,$3,$4,true)
     ON CONFLICT ((lower(email))) DO UPDATE SET display_name=EXCLUDED.display_name RETURNING id`,
    [randomUUID(), email, passwordHash, displayName],
  );
  return { id: row.rows[0].id, email };
}

/** Deletes the demo faculty. Append-only guards are bypassed for this session only. */
async function reset() {
  const unit = (await sql(`SELECT id FROM academic_units WHERE code='CNTT'`)).rows[0];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (unit) {
      await client.query(`SET LOCAL session_replication_role = replica`);
      await client.query(`DELETE FROM academic_audit_events WHERE unit_id=$1`, [unit.id]);
      for (const table of ["academic_role_grants", "academic_staff", "academic_departments"]) await client.query(`DELETE FROM ${table} WHERE unit_id=$1`, [unit.id]);
      await client.query(`DELETE FROM academic_units WHERE id=$1`, [unit.id]);
      await client.query(`SET LOCAL session_replication_role = origin`);
    }
    const users = `(SELECT id FROM users WHERE email LIKE '%@${DOMAIN}')`;
    await client.query(`DELETE FROM academic_role_grants WHERE user_id IN ${users}`);
    await client.query(`DELETE FROM academic_notifications WHERE user_id IN ${users}`);
    await client.query(`DELETE FROM workspaces WHERE owner_id IN ${users}`);
    await client.query(`DELETE FROM users WHERE id IN ${users}`);
    await client.query("COMMIT");
    console.log("Removed the demo faculty and its accounts.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  if (process.argv.includes("--reset")) await reset();
  if ((await sql(`SELECT 1 FROM academic_units WHERE code='CNTT'`)).rowCount) {
    console.log("Demo faculty CNTT already exists; nothing to do.");
    return;
  }
  const admin = (await sql(`SELECT user_id FROM academic_role_grants WHERE role='system_admin' ORDER BY created_at LIMIT 1`)).rows[0];
  if (!admin) throw new Error('Cần một tài khoản system_admin: node scripts/ops/create-user.mjs admin@tdtu.edu.vn "Quản trị hệ thống" --admin');
  const as = admin.user_id;
  const password = process.env.SEED_ACADEMIC_PASSWORD || randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(password);
  const people = {};
  people.giaovu = await account("giaovu", "Phòng Giáo vụ khoa CNTT", passwordHash);
  for (const [handle, name] of lecturers) people[handle] = await account(handle, name, passwordHash);
  for (let i = 1; i <= 30; i++) {
    const handle = `sv${String(i).padStart(2, "0")}`;
    const name = `${familyNames[i % familyNames.length]} ${["Văn", "Thị", "Minh", "Gia", "Ngọc"][i % 5]} ${givenNames[i % givenNames.length]}`;
    people[handle] = await account(handle, name, passwordHash);
  }

  const unit = await org.createUnit(as, { code: "CNTT", name: "Khoa Công nghệ Thông tin" });
  await org.grantRole(as, { role: "unit_admin", unitId: unit.id, email: people.giaovu.email });
  await org.grantRole(as, { role: "unit_head", unitId: unit.id, email: people.truongkhoa.email });
  const departments = {};
  for (const [code, name] of [["KHMT", "Khoa học máy tính"], ["HTTT", "Hệ thống thông tin"], ["KTPM", "Kỹ thuật phần mềm"]])
    departments[code] = (await org.createDepartment(as, unit.id, { code, name })).id;
  for (const [handle, , rank, department, staffCode] of lecturers)
    await org.upsertStaff(as, unit.id, { email: people[handle].email, staffCode, rank, departmentId: departments[department], defaultQuota: 6 });

  console.log(`Seeded faculty CNTT: ${Object.keys(people).length} accounts @${DOMAIN}.`);
  console.log("Accounts: giaovu (giáo vụ CNTT), truongkhoa (lãnh đạo khoa), gv.* (lecturers), sv01–sv30 (students).");
  if (!process.env.SEED_ACADEMIC_PASSWORD) console.log(`Generated password for every demo account: ${password}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
