import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { Badge, Button } from "../../shared/ui/Primitives";
import { academicApi } from "./api";
import { useThesis } from "./context";
import { parseAccountLines } from "./labels";

type Role = "system_admin" | "unit_admin" | "unit_head";
interface AccessRow {
  id: string;
  displayName: string;
  email: string;
  grants: { role: Role; unitId: string | null }[];
  staff: { unitId: string; active: boolean } | null;
  enrollments: number;
}

/** "Phân quyền" (system admin): create accounts, then grant or revoke system and faculty roles in one table. */
export function AccessPanel() {
  const { token, run, profile } = useThesis();
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
  const unitCode = (unitId: string) => profile.units.find((unit) => unit.id === unitId)?.code ?? "?";
  const toggle = async (row: AccessRow, role: Role, unitId: string | null, on: boolean) => {
    setBusy(true);
    const done = await run(on ? `Đã cấp quyền cho ${row.displayName}` : `Đã thu hồi quyền của ${row.displayName}`, () =>
      academicApi(token, "roles", "POST", { email: row.email, role, unitId: unitId ?? undefined, revoke: !on }), { reload: false });
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
    <div className="thesis-stack">
      <AccountsCard onCreated={() => void load()} />
      <section>
        <h2>Phân quyền</h2>
        <p className="thesis-note">
          Tích để cấp, bỏ tích để thu hồi. Giảng viên và sinh viên không cấp ở đây: thêm giảng viên trong "Thiết lập khoa", ghi danh sinh viên trong "Quản trị đợt".
        </p>
        <div className="thesis-toolbar">
          <input type="search" placeholder="Tìm theo tên hoặc email" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Tìm người dùng" />
          <span className="thesis-note">{rows ? `${rows.length} người${rows.length === 100 ? " (tối đa 100, hãy lọc thêm)" : ""}` : "Đang tải…"}</span>
        </div>
        <div className="thesis-scroll">
          <table className="thesis-table">
            <thead>
              <tr>
                <th rowSpan={2}>Người dùng</th>
                <th rowSpan={2}>Quản trị hệ thống</th>
                {profile.units.map((unit) => <th key={unit.id} colSpan={2} title={unit.name}>{unit.code}</th>)}
                <th rowSpan={2}>Hồ sơ</th>
              </tr>
              <tr>
                {profile.units.flatMap((unit) => [<th key={`${unit.id}-a`}>Giáo vụ</th>, <th key={`${unit.id}-h`}>Lãnh đạo</th>])}
              </tr>
            </thead>
            <tbody>
              {rows?.map((row) => (
                <tr key={row.id}>
                  <td>{row.displayName}<br /><small>{row.email}</small></td>
                  <td>{box(row, "system_admin", null, "Quản trị hệ thống")}</td>
                  {profile.units.flatMap((unit) => [
                    <td key={`${unit.id}-a`}>{box(row, "unit_admin", unit.id, `Giáo vụ ${unit.code}`)}</td>,
                    <td key={`${unit.id}-h`}>{box(row, "unit_head", unit.id, `Lãnh đạo ${unit.code}`)}</td>,
                  ])}
                  <td>
                    {row.staff && <Badge tone={row.staff.active ? "blue" : "neutral"}>Giảng viên {unitCode(row.staff.unitId)}{row.staff.active ? "" : " (ngừng)"}</Badge>}{" "}
                    {row.enrollments > 0 && <Badge tone="green">Sinh viên · {row.enrollments} đợt</Badge>}
                    {!row.staff && !row.enrollments && "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows && !rows.length && <p className="thesis-note">Không có người dùng khớp.</p>}
        {!profile.units.length && <p className="thesis-note">Chưa có khoa nào: tạo khoa trong "Thiết lập khoa" để cấp quyền giáo vụ / lãnh đạo.</p>}
      </section>
    </div>
  );
}

type CreatedAccount = { email: string; displayName: string; status: "created" | "exists"; password: string | null };

/** No self sign-up: the system administrator creates accounts here, one or a list pasted from Excel. */
function AccountsCard({ onCreated }: { onCreated: () => void }) {
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
          onCreated();
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
