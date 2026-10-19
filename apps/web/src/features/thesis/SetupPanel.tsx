import { useEffect, useState } from "react";
import { Button, Field } from "../../shared/ui/Primitives";
import { academicApi } from "./api";
import { useThesis } from "./context";
import { parseAccountLines, rankLabel, toLocalInput } from "./labels";

interface StaffRow {
  userId: string;
  displayName: string;
  email: string;
  staffCode: string;
  rank: string;
  defaultQuota: number;
  active: boolean;
  departmentCode: string | null;
}

export function SetupPanel({ onTermCreated }: { onTermCreated: (termId: string) => void }) {
  const { profile } = useThesis();
  const adminUnits = profile.units.filter((unit) => profile.systemAdmin || profile.unitRoles[unit.id]?.includes("unit_admin"));
  const [unitId, setUnitId] = useState(adminUnits[0]?.id ?? "");
  return (
    <div className="thesis-stack">
      {profile.systemAdmin && <SystemAdminCard />}
      {adminUnits.length > 0 && (
        <>
          {adminUnits.length > 1 && (
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)} aria-label="Khoa">
              {adminUnits.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
            </select>
          )}
          {unitId && <StaffCard unitId={unitId} />}
          {unitId && <CreateTermCard unitId={unitId} onCreated={onTermCreated} />}
        </>
      )}
    </div>
  );
}

function SystemAdminCard() {
  const { token, run } = useThesis();
  const [unit, setUnit] = useState({ code: "", name: "" });
  const [grant, setGrant] = useState({ email: "", role: "unit_admin", unitId: "" });
  const { profile } = useThesis();
  return (
    <section>
      <h2>Quản trị hệ thống</h2>
      <div className="thesis-columns">
        <form className="thesis-form" onSubmit={async (event) => {
          event.preventDefault();
          if (await run("Đã tạo khoa", () => academicApi(token, "units", "POST", unit))) setUnit({ code: "", name: "" });
        }}>
          <h3>Tạo khoa</h3>
          <input placeholder="Mã khoa (VD: CNTT)" value={unit.code} onChange={(e) => setUnit({ ...unit, code: e.target.value.toUpperCase() })} required aria-label="Mã khoa" />
          <input placeholder="Tên khoa" value={unit.name} onChange={(e) => setUnit({ ...unit, name: e.target.value })} required aria-label="Tên khoa" />
          <Button type="submit">Tạo khoa</Button>
        </form>
        <form className="thesis-form" onSubmit={async (event) => {
          event.preventDefault();
          await run("Đã cấp quyền", () => academicApi(token, "roles", "POST", { ...grant, unitId: grant.role === "system_admin" ? undefined : grant.unitId }));
        }}>
          <h3>Cấp quyền</h3>
          <input type="email" placeholder="Email tài khoản" value={grant.email} onChange={(e) => setGrant({ ...grant, email: e.target.value })} required aria-label="Email" />
          <select value={grant.role} onChange={(e) => setGrant({ ...grant, role: e.target.value })} aria-label="Vai trò">
            <option value="unit_admin">Giáo vụ khoa</option>
            <option value="unit_head">Lãnh đạo khoa (duyệt đề tài)</option>
            <option value="system_admin">Quản trị hệ thống</option>
          </select>
          {grant.role !== "system_admin" && (
            <select value={grant.unitId} onChange={(e) => setGrant({ ...grant, unitId: e.target.value })} required aria-label="Khoa">
              <option value="">Chọn khoa</option>
              {profile.units.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
            </select>
          )}
          <Button type="submit">Cấp quyền</Button>
        </form>
      </div>
      <AccountsCard />
    </section>
  );
}

type CreatedAccount = { email: string; displayName: string; status: "created" | "exists"; password: string | null };

/** No self sign-up: the system administrator creates accounts here, one or a list pasted from Excel. */
function AccountsCard() {
  const { token, run } = useThesis();
  const [lines, setLines] = useState("");
  const [created, setCreated] = useState<CreatedAccount[]>([]);
  const copy = () =>
    void navigator.clipboard.writeText(created.map((row) => [row.email, row.displayName, row.password ?? "(đã có tài khoản)"].join("\t")).join("\n"));
  return (
    <div className="thesis-gap">
      <form className="thesis-form" onSubmit={async (event) => {
        event.preventDefault();
        const result = await run("Đã xử lý danh sách tài khoản", () =>
          academicApi<{ accounts: CreatedAccount[] }>(token, "accounts", "POST", { accounts: parseAccountLines(lines) }), { reload: false });
        if (result) {
          setCreated(result.accounts);
          setLines("");
        }
      }}>
        <h3>Tạo tài khoản</h3>
        <p className="thesis-note">Hệ thống không cho tự đăng ký. Mỗi dòng: <code>email, Họ tên</code> (dán thẳng 2 cột từ Excel cũng được), tối đa 200 dòng.</p>
        <textarea rows={5} value={lines} onChange={(e) => setLines(e.target.value)} required aria-label="Danh sách tài khoản" placeholder={"52100001@student.tdtu.edu.vn, Nguyễn Văn A\ngv.lan@tdtu.edu.vn, Trần Thị Lan"} />
        <Button type="submit">Tạo tài khoản</Button>
      </form>
      {created.length > 0 && (
        <>
          <p className="thesis-note" role="status">Mật khẩu chỉ hiện một lần. Hãy sao chép và gửi cho từng người; họ có thể đổi qua "Quên mật khẩu".</p>
          <table className="thesis-table">
            <thead><tr><th>Email</th><th>Họ tên</th><th>Mật khẩu</th></tr></thead>
            <tbody>
              {created.map((row) => (
                <tr key={row.email}><td>{row.email}</td><td>{row.displayName}</td><td>{row.password ? <code>{row.password}</code> : "Đã có tài khoản, giữ nguyên"}</td></tr>
              ))}
            </tbody>
          </table>
          <Button type="button" variant="secondary" onClick={copy}>Sao chép danh sách</Button>
        </>
      )}
    </div>
  );
}

function StaffCard({ unitId }: { unitId: string }) {
  const { token, run, revision } = useThesis();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [departments, setDepartments] = useState<{ id: string; code: string; name: string }[]>([]);
  const [form, setForm] = useState({ email: "", staffCode: "", rank: "ths", defaultQuota: 8, departmentId: "" });
  const [department, setDepartment] = useState({ code: "", name: "" });
  useEffect(() => {
    void academicApi<{ staff: StaffRow[]; departments: { id: string; code: string; name: string }[] }>(token, `units/${unitId}/staff`).then((d) => {
      setStaff(d.staff);
      setDepartments(d.departments);
    }).catch(() => undefined);
  }, [token, unitId, revision]);
  return (
    <section>
      <h2>Giảng viên của khoa ({staff.length})</h2>
      <table className="thesis-table">
        <thead><tr><th>Mã</th><th>Họ tên</th><th>Học vị</th><th>Bộ môn</th><th>Định mức</th><th>Trạng thái</th></tr></thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.userId}>
              <td>{s.staffCode}</td>
              <td>{s.displayName}<br /><small>{s.email}</small></td>
              <td>{rankLabel[s.rank]}</td>
              <td>{s.departmentCode ?? "—"}</td>
              <td>{s.defaultQuota}</td>
              <td>{s.active ? "Đang hoạt động" : "Ngừng"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="thesis-columns thesis-gap">
        <form className="thesis-form" onSubmit={async (event) => {
          event.preventDefault();
          if (await run("Đã lưu giảng viên", () => academicApi(token, `units/${unitId}/staff`, "POST", { ...form, departmentId: form.departmentId || undefined, defaultQuota: Number(form.defaultQuota) })))
            setForm({ ...form, email: "", staffCode: "" });
        }}>
          <h3>Thêm / cập nhật giảng viên</h3>
          <input type="email" placeholder="Email tài khoản" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required aria-label="Email giảng viên" />
          <div className="thesis-form-row">
            <input placeholder="Mã GV" value={form.staffCode} onChange={(e) => setForm({ ...form, staffCode: e.target.value.toUpperCase() })} required aria-label="Mã giảng viên" />
            <select value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value })} aria-label="Học vị">
              {Object.entries(rankLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="thesis-form-row">
            <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} aria-label="Bộ môn">
              <option value="">Không thuộc bộ môn</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
            </select>
            <input type="number" min={0} max={30} value={form.defaultQuota} onChange={(e) => setForm({ ...form, defaultQuota: Number(e.target.value) })} aria-label="Định mức mặc định" />
          </div>
          <Button type="submit">Lưu</Button>
        </form>
        <form className="thesis-form" onSubmit={async (event) => {
          event.preventDefault();
          if (await run("Đã tạo bộ môn", () => academicApi(token, `units/${unitId}/departments`, "POST", department))) setDepartment({ code: "", name: "" });
        }}>
          <h3>Bộ môn</h3>
          <ul className="thesis-members">{departments.map((d) => <li key={d.id}>{d.code} · {d.name}</li>)}</ul>
          <input placeholder="Mã bộ môn" value={department.code} onChange={(e) => setDepartment({ ...department, code: e.target.value.toUpperCase() })} required aria-label="Mã bộ môn" />
          <input placeholder="Tên bộ môn" value={department.name} onChange={(e) => setDepartment({ ...department, name: e.target.value })} required aria-label="Tên bộ môn" />
          <Button type="submit" variant="secondary">Thêm bộ môn</Button>
        </form>
      </div>
    </section>
  );
}

function CreateTermCard({ unitId, onCreated }: { unitId: string; onCreated: (termId: string) => void }) {
  const { token, run } = useThesis();
  const day = 86_400_000;
  const now = Date.now();
  const [form, setForm] = useState({
    code: "",
    name: "",
    registrationOpensAt: toLocalInput(new Date(now + day)),
    registrationClosesAt: toLocalInput(new Date(now + 15 * day)),
    finalDueAt: toLocalInput(new Date(now + 110 * day)),
    defenseStartsOn: new Date(now + 120 * day).toISOString().slice(0, 10),
    defenseEndsOn: new Date(now + 127 * day).toISOString().slice(0, 10),
    minCredits: 120,
    minGpa: 2,
    minGroupSize: 1,
    maxGroupSize: 2,
    maxPreferences: 3,
    minSupervisionLogs: 6,
    supervisor: 20,
    reviewer: 20,
    committee: 60,
  });
  const num = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: Number(e.target.value) });
  return (
    <section>
      <h2>Tạo đợt đồ án</h2>
      <form className="thesis-form" onSubmit={async (event) => {
        event.preventDefault();
        const created = await run("Đã tạo đợt đồ án", () =>
          academicApi<{ id: string }>(token, `units/${unitId}/terms`, "POST", {
            code: form.code,
            name: form.name,
            registrationOpensAt: new Date(form.registrationOpensAt).toISOString(),
            registrationClosesAt: new Date(form.registrationClosesAt).toISOString(),
            finalDueAt: new Date(form.finalDueAt).toISOString(),
            defenseStartsOn: form.defenseStartsOn,
            defenseEndsOn: form.defenseEndsOn,
            minCredits: form.minCredits,
            minGpa: form.minGpa,
            minGroupSize: form.minGroupSize,
            maxGroupSize: form.maxGroupSize,
            maxPreferences: form.maxPreferences,
            minSupervisionLogs: form.minSupervisionLogs,
            weights: { supervisor: form.supervisor, reviewer: form.reviewer, committee: form.committee },
          }),
        );
        if (created) onCreated(created.id);
      }}>
        <div className="thesis-form-row">
          <Field label="Mã đợt"><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="DATN-2027" required /></Field>
          <Field label="Tên đợt"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Đồ án tốt nghiệp học kỳ 2, 2026–2027" required /></Field>
        </div>
        <div className="thesis-form-row">
          <Field label="Mở đăng ký"><input type="datetime-local" value={form.registrationOpensAt} onChange={(e) => setForm({ ...form, registrationOpensAt: e.target.value })} /></Field>
          <Field label="Đóng đăng ký"><input type="datetime-local" value={form.registrationClosesAt} onChange={(e) => setForm({ ...form, registrationClosesAt: e.target.value })} /></Field>
          <Field label="Hạn nộp báo cáo"><input type="datetime-local" value={form.finalDueAt} onChange={(e) => setForm({ ...form, finalDueAt: e.target.value })} /></Field>
        </div>
        <div className="thesis-form-row">
          <Field label="Bảo vệ từ ngày"><input type="date" value={form.defenseStartsOn} onChange={(e) => setForm({ ...form, defenseStartsOn: e.target.value })} /></Field>
          <Field label="Đến ngày"><input type="date" value={form.defenseEndsOn} onChange={(e) => setForm({ ...form, defenseEndsOn: e.target.value })} /></Field>
        </div>
        <div className="thesis-form-row">
          <Field label="Tín chỉ tối thiểu"><input type="number" value={form.minCredits} onChange={num("minCredits")} /></Field>
          <Field label="GPA tối thiểu"><input type="number" step={0.01} value={form.minGpa} onChange={num("minGpa")} /></Field>
          <Field label="SV/nhóm"><input type="number" min={1} max={5} value={form.maxGroupSize} onChange={num("maxGroupSize")} /></Field>
          <Field label="Số nguyện vọng"><input type="number" min={1} max={5} value={form.maxPreferences} onChange={num("maxPreferences")} /></Field>
          <Field label="Buổi HD tối thiểu"><input type="number" min={0} max={30} value={form.minSupervisionLogs} onChange={num("minSupervisionLogs")} /></Field>
        </div>
        <div className="thesis-form-row">
          <Field label="% điểm GVHD"><input type="number" value={form.supervisor} onChange={num("supervisor")} /></Field>
          <Field label="% điểm phản biện"><input type="number" value={form.reviewer} onChange={num("reviewer")} /></Field>
          <Field label="% điểm hội đồng" hint={`Tổng: ${form.supervisor + form.reviewer + form.committee}`}><input type="number" value={form.committee} onChange={num("committee")} /></Field>
        </div>
        <Button type="submit" icon="plus">Tạo đợt</Button>
      </form>
    </section>
  );
}
