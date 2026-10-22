import { useEffect, useState } from "react";
import { Button } from "../../shared/ui/Primitives";
import { academicApi, rankLabel, type AcademicProfile } from "./api";

type Run = <T>(label: string, action: () => Promise<T>) => Promise<T | undefined>;

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

type Unit = AcademicProfile["units"][number];

/** Faculties, their departments and lecturers (who may teach E-learning courses of the faculty). */
export function FacultyPanel({ token, run, units, onUnitCreated }: { token: string; run: Run; units: Unit[]; onUnitCreated: (unit: Unit) => void }) {
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [unit, setUnit] = useState({ code: "", name: "" });
  return (
    <section>
      <h2>Khoa & giảng viên</h2>
      <p className="admin-note">Giảng viên của khoa được tạo khóa học E-learning cho khoa; giáo vụ quản lý mọi khóa học của khoa mình.</p>
      <div className="admin-toolbar">
        {units.length > 0 && (
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} aria-label="Khoa">
            {units.map((u) => <option key={u.id} value={u.id}>{u.code} · {u.name}</option>)}
          </select>
        )}
      </div>
      <form className="admin-form admin-gap" onSubmit={async (event) => {
        event.preventDefault();
        const created = await run("Đã tạo khoa", () => academicApi<Unit>(token, "units", "POST", unit));
        if (created) {
          onUnitCreated(created);
          setUnitId(created.id);
          setUnit({ code: "", name: "" });
        }
      }}>
        <h3>Tạo khoa</h3>
        <div className="admin-form-row">
          <input placeholder="Mã khoa (VD: CNTT)" value={unit.code} onChange={(e) => setUnit({ ...unit, code: e.target.value.toUpperCase() })} required aria-label="Mã khoa" />
          <input placeholder="Tên khoa" value={unit.name} onChange={(e) => setUnit({ ...unit, name: e.target.value })} required aria-label="Tên khoa" />
        </div>
        <Button type="submit" variant="secondary">Tạo khoa</Button>
      </form>
      {unitId ? <StaffCard key={unitId} unitId={unitId} token={token} run={run} /> : <p className="admin-note">Chưa có khoa nào.</p>}
    </section>
  );
}

function StaffCard({ unitId, token, run }: { unitId: string; token: string; run: Run }) {
  const [revision, setRevision] = useState(0);
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
    <>
      <h3>Giảng viên của khoa ({staff.length})</h3>
      <table className="admin-table">
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
      <div className="admin-columns admin-gap">
        <form className="admin-form" onSubmit={async (event) => {
          event.preventDefault();
          if (await run("Đã lưu giảng viên", () => academicApi(token, `units/${unitId}/staff`, "POST", { ...form, departmentId: form.departmentId || undefined, defaultQuota: Number(form.defaultQuota) })))
          {
            setForm({ ...form, email: "", staffCode: "" });
            setRevision((n) => n + 1);
          }
        }}>
          <h3>Thêm / cập nhật giảng viên</h3>
          <input type="email" placeholder="Email tài khoản" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required aria-label="Email giảng viên" />
          <div className="admin-form-row">
            <input placeholder="Mã GV" value={form.staffCode} onChange={(e) => setForm({ ...form, staffCode: e.target.value.toUpperCase() })} required aria-label="Mã giảng viên" />
            <select value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value })} aria-label="Học vị">
              {Object.entries(rankLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div className="admin-form-row">
            <select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} aria-label="Bộ môn">
              <option value="">Không thuộc bộ môn</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
            </select>
            <input type="number" min={0} max={30} value={form.defaultQuota} onChange={(e) => setForm({ ...form, defaultQuota: Number(e.target.value) })} aria-label="Định mức mặc định" />
          </div>
          <Button type="submit">Lưu</Button>
        </form>
        <form className="admin-form" onSubmit={async (event) => {
          event.preventDefault();
          if (await run("Đã tạo bộ môn", () => academicApi(token, `units/${unitId}/departments`, "POST", department))) {
            setDepartment({ code: "", name: "" });
            setRevision((n) => n + 1);
          }
        }}>
          <h3>Bộ môn</h3>
          <ul className="admin-members">{departments.map((d) => <li key={d.id}>{d.code} · {d.name}</li>)}</ul>
          <input placeholder="Mã bộ môn" value={department.code} onChange={(e) => setDepartment({ ...department, code: e.target.value.toUpperCase() })} required aria-label="Mã bộ môn" />
          <input placeholder="Tên bộ môn" value={department.name} onChange={(e) => setDepartment({ ...department, name: e.target.value })} required aria-label="Tên bộ môn" />
          <Button type="submit" variant="secondary">Thêm bộ môn</Button>
        </form>
      </div>
    </>
  );
}
