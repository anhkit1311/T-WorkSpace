import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { Badge, Button } from "../../shared/ui/Primitives";
import { academicApi, type AcademicProfile } from "./api";
import { parseAccountLines } from "./labels";
import { FacultyPanel } from "./FacultyPanel";
import { HealthPanel } from "./HealthPanel";
import "../workspaces/workspace-admin.css";
import "./admin.css";

type Role = "system_admin" | "unit_admin";
interface AccessRow {
  id: string;
  displayName: string;
  email: string;
  grants: { role: Role; unitId: string | null }[];
  staff: { unitId: string; active: boolean } | null;
}

type Run = <T>(label: string, action: () => Promise<T>) => Promise<T | undefined>;
type Unit = AcademicProfile["units"][number];

/** "Quản trị hệ thống" (sidebar, system admins only): accounts and system / faculty roles. */
export function AccessPage() {
  const { accessToken, notify } = useApp();
  const token = accessToken!;
  const [profile, setProfile] = useState<AcademicProfile | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    academicApi<AcademicProfile>(token, "me").then(setProfile, () => setFailed(true));
  }, [token]);
  const run = useCallback<Run>(async (label, action) => {
    try {
      const result = await action();
      notify(label);
      return result;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Thao tác thất bại.", undefined, "warning");
      return undefined;
    }
  }, [notify]);

  if (failed) return <p className="loading-note" role="alert">Không tải được dữ liệu phân quyền.</p>;
  if (!profile) return <p className="loading-note" role="status">Đang tải…</p>;
  return (
    <div className="workspace-admin admin-page">
      <header className="admin-header">
        <div>
          <p className="admin-eyebrow">Chỉ dành cho quản trị hệ thống</p>
          <h1>Quản trị hệ thống</h1>
          <p className="admin-subtitle">Hệ thống không cho tự đăng ký: tạo tài khoản, khoa và giảng viên ở đây rồi cấp quyền quản trị hệ thống hoặc giáo vụ khoa.</p>
        </div>
      </header>
      {profile.systemAdmin ? (
        <AccessPanel
          token={token}
          run={run}
          units={profile.units}
          onUnitCreated={(unit) => setProfile({ ...profile, units: [...profile.units, unit].sort((a, b) => a.code.localeCompare(b.code)) })}
        />
      ) : (
        <p className="admin-note" role="alert">Trang này chỉ dành cho tài khoản quản trị hệ thống.</p>
      )}
    </div>
  );
}

function AccessPanel({ token, run, units, onUnitCreated }: { token: string; run: Run; units: Unit[]; onUnitCreated: (unit: Unit) => void }) {
  const { user } = useApp();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AccessRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () => academicApi<{ users: AccessRow[] }>(token, `access?q=${encodeURIComponent(query.trim())}`).then((data) => setRows(data.users), () => setRows([])),
    [token, query],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const has = (row: AccessRow, role: Role, unitId: string | null = null) => row.grants.some((grant) => grant.role === role && grant.unitId === unitId);
  const unitCode = (unitId: string) => units.find((unit) => unit.id === unitId)?.code ?? "?";
  const toggle = async (row: AccessRow, role: Role, unitId: string | null, on: boolean) => {
    setBusy(true);
    const done = await run(on ? `Đã cấp quyền cho ${row.displayName}` : `Đã thu hồi quyền của ${row.displayName}`, () =>
      academicApi(token, "roles", "POST", { email: row.email, role, unitId: unitId ?? undefined, revoke: !on }));
    if (done) await load();
    setBusy(false);
  };
  const box = (row: AccessRow, role: Role, unitId: string | null, label: string) => (
    <input
      type="checkbox"
      checked={has(row, role, unitId)}
      disabled={busy || (role === "system_admin" && row.id === user?.id)}
      onChange={(event) => void toggle(row, role, unitId, event.target.checked)}
      aria-label={`${label}: ${row.displayName}`}
      title={role === "system_admin" && row.id === user?.id ? "Không thể tự thu hồi quyền quản trị hệ thống" : label}
    />
  );

  return (
    <div className="admin-stack">
      <HealthPanel token={token} />
      <AccountsCard token={token} run={run} onCreated={() => void load()} />
      <FacultyPanel token={token} run={run} units={units} onUnitCreated={onUnitCreated} />
      <section>
        <h2>Phân quyền</h2>
        <p className="admin-note">
          Tích để cấp, bỏ tích để thu hồi. Giảng viên được thêm ở mục "Khoa & giảng viên" phía trên.
        </p>
        <div className="admin-toolbar">
          <input type="search" placeholder="Tìm theo tên hoặc email" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Tìm người dùng" />
          <span className="admin-note">{rows ? `${rows.length} người${rows.length === 100 ? " (tối đa 100, hãy lọc thêm)" : ""}` : "Đang tải…"}</span>
        </div>
        <div className="admin-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Người dùng</th>
                <th>Quản trị hệ thống</th>
                {units.map((unit) => <th key={unit.id} title={unit.name}>Giáo vụ {unit.code}</th>)}
                <th>Hồ sơ</th>
              </tr>
            </thead>
            <tbody>
              {rows?.map((row) => (
                <tr key={row.id}>
                  <td>{row.displayName}<br /><small>{row.email}</small></td>
                  <td>{box(row, "system_admin", null, "Quản trị hệ thống")}</td>
                  {units.map((unit) => <td key={unit.id}>{box(row, "unit_admin", unit.id, `Giáo vụ ${unit.code}`)}</td>)}
                  <td>
                    {row.staff && <Badge tone={row.staff.active ? "blue" : "neutral"}>Giảng viên {unitCode(row.staff.unitId)}{row.staff.active ? "" : " (ngừng)"}</Badge>}
                    {!row.staff && "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows && !rows.length && <p className="admin-note">Không có người dùng khớp.</p>}
        {!units.length && <p className="admin-note">Chưa có khoa nào: tạo khoa ở mục "Khoa & giảng viên" để cấp quyền giáo vụ.</p>}
      </section>
    </div>
  );
}

type CreatedAccount = { email: string; displayName: string; status: "created" | "exists"; password: string | null };

/** No self sign-up: the system administrator creates accounts here, one or a list pasted from Excel. */
function AccountsCard({ token, run, onCreated }: { token: string; run: Run; onCreated: () => void }) {
  const [lines, setLines] = useState("");
  const [created, setCreated] = useState<CreatedAccount[]>([]);
  const copy = () =>
    void navigator.clipboard.writeText(created.map((row) => [row.email, row.displayName, row.password ?? "(đã có tài khoản)"].join("\t")).join("\n"));
  return (
    <section>
      <h2>Tạo tài khoản</h2>
      <form className="admin-form" onSubmit={async (event) => {
        event.preventDefault();
        const result = await run("Đã xử lý danh sách tài khoản", () =>
          academicApi<{ accounts: CreatedAccount[] }>(token, "accounts", "POST", { accounts: parseAccountLines(lines) }));
        if (result) {
          setCreated(result.accounts);
          setLines("");
          onCreated();
        }
      }}>
        <p className="admin-note">Mỗi dòng: <code>email, Họ tên</code> (dán thẳng 2 cột từ Excel cũng được), tối đa 200 dòng.</p>
        <textarea rows={5} value={lines} onChange={(e) => setLines(e.target.value)} required aria-label="Danh sách tài khoản" placeholder={"52100001@student.tdtu.edu.vn, Nguyễn Văn A\ngv.lan@tdtu.edu.vn, Trần Thị Lan"} />
        <Button type="submit">Tạo tài khoản</Button>
      </form>
      {created.length > 0 && (
        <>
          <p className="admin-note" role="status">Mật khẩu chỉ hiện một lần. Hãy sao chép và gửi cho từng người; họ có thể đổi qua "Quên mật khẩu".</p>
          <table className="admin-table">
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
    </section>
  );
}
