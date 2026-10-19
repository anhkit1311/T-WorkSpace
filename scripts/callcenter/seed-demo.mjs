// Demo call center data: two departments, a hotline with an IVR menu, dispositions, and one
// extension per agent. Safe to re-run: existing departments, hotline and extensions are kept.
// Usage: npm run build --workspace @doan/api && node scripts/callcenter/seed-demo.mjs agent@x.y [...]
import "../../dist/api/config/env.js";
import { pool } from "../../dist/api/infrastructure/database/db.js";
import { AriPbx } from "../../dist/api/modules/callcenter/infrastructure/ari-pbx.js";
import { CallCenterRepository } from "../../dist/api/modules/callcenter/repository/callcenter-repository.js";
import { CallCenterAdminService } from "../../dist/api/modules/callcenter/service/admin-service.js";

const agentEmails = process.argv.slice(2);
const repo = new CallCenterRepository();
const pbx = process.env.ASTERISK_ARI_PASSWORD
  ? new AriPbx({
      url: process.env.ASTERISK_ARI_URL ?? "http://localhost:8088",
      user: process.env.ASTERISK_ARI_USER ?? "nexo",
      password: process.env.ASTERISK_ARI_PASSWORD,
      app: "nexo",
    })
  : null;
const admin = new CallCenterAdminService(repo, () => pbx, async () => {}, (event, details) => console.warn(event, details));

try {
  const adminRow = await pool.query(`SELECT user_id FROM academic_role_grants WHERE role='system_admin' ORDER BY created_at LIMIT 1`);
  if (!adminRow.rowCount) throw new Error("Cần một tài khoản system_admin trước khi seed tổng đài.");
  const adminId = adminRow.rows[0].user_id;

  const departments = await admin.listDepartments(adminId);
  const ensure = async (code, name, extensionFrom) =>
    departments.find((department) => department.code === code) ??
    (await admin.createDepartment(adminId, { code, name, extensionFrom, extensionTo: extensionFrom + 29 }));
  const admissions = await ensure("CC_TS", "Phòng Tuyển sinh", 1200);
  const academic = await ensure("CC_DT", "Phòng Đại học", 1230);

  if (!(await repo.hotlines()).length)
    await admin.saveHotline(adminId, null, {
      number: "19001234",
      name: "Tổng đài TDTU",
      fallbackDepartmentId: admissions.id,
      options: [
        { digit: "1", departmentId: admissions.id },
        { digit: "2", departmentId: academic.id },
      ],
    });

  if (!(await repo.dispositions(null)).length)
    for (const [code, label] of [
      ["TU_VAN", "Tư vấn thông tin"],
      ["CHUYEN_PB", "Chuyển phòng ban khác"],
      ["KHIEU_NAI", "Khiếu nại / phản ánh"],
      ["GOI_LAI", "Hẹn gọi lại"],
    ])
      await admin.createDisposition(adminId, { code, label });

  for (const email of agentEmails) {
    const user = await repo.userByEmail(email);
    if (!user) throw new Error(`Không tìm thấy người dùng ${email}`);
    if (!(await repo.ownExtension(user.id))) {
      await admin.addMember(adminId, admissions.id, { email, role: "agent" });
      const { extension } = await admin.createExtension(adminId, { departmentId: admissions.id, userId: user.id });
      console.log(`${email}: máy lẻ ${extension.number} (${extension.syncedAt ? "đã đẩy sang Asterisk" : "chưa đồng bộ"})`);
    } else console.log(`${email}: đã có máy lẻ`);
  }
  await admin.addMember(adminId, admissions.id, {
    email: (await pool.query(`SELECT email FROM users WHERE id=$1`, [adminId])).rows[0].email,
    role: "supervisor",
  });
  console.log("Đã seed tổng đài demo: phòng Tuyển sinh (1200-1229), Đại học (1230-1259), hotline 19001234.");
} finally {
  await pool.end();
}
