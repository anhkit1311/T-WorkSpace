import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { AnimatePresence } from "motion/react";
import { Badge, Button, ConfirmDialog } from "../../shared/ui/Primitives";
import { academicApi, type AcademicProfile } from "./api";
import { parseAccountLines } from "./labels";
import { AccountForm } from "./AccountForm";
import { FacultyPanel } from "./FacultyPanel";
import { HealthPanel } from "./HealthPanel";
import "../workspaces/workspace-admin.css";
import "./admin.css";

type Role = "system_admin" | "unit_admin";
interface AccessRow {
  id: string;
  displayName: string;
  email: string;
  userCode: string | null;
  unitId: string | null;
  grants: { role: Role; unitId: string | null }[];
  staff: { unitId: string; active: boolean } | null;
}

type Run = <T>(label: string, action: () => Promise<T>) => Promise<T | undefined>;
type Unit = AcademicProfile["units"][number];
const unitLabel = (unit: Unit) => `${unit.idPrefix ?? "--"} · ${unit.name}`;

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
          <p className="admin-eyebrow">Quản trị & Tổ chức</p>
          <h1>Quản lý Khoa / Phòng ban & Hệ thống</h1>
          <p className="admin-subtitle">Quản lý cơ cấu khoa, phòng ban, tài khoản và phân quyền.</p>
        </div>
      </header>
      {profile.systemAdmin ? (
        <AccessPanel
          token={token}
          run={run}
          units={profile.units}
          onUnitCreated={(unit) => setProfile({ ...profile, units: [...profile.units, unit].sort((a, b) => (a.code || a.name || "").localeCompare(b.code || b.name || "")) })}
        />
      ) : (
        <p className="admin-note" role="alert">Trang này chỉ dành cho tài khoản quản trị hệ thống.</p>
      )}
    </div>
  );
}

function AccessPanel({ token, run, units, onUnitCreated }: { token: string; run: Run; units: Unit[]; onUnitCreated: (unit: Unit) => void }) {
  const { user } = useApp();
  const [activeTab, setActiveTab] = useState<"departments" | "permissions" | "accounts" | "health">("departments");
  const [query, setQuery] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [rows, setRows] = useState<AccessRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () => academicApi<{ users: AccessRow[] }>(token, `access?q=${encodeURIComponent(query.trim())}&unit=${unitFilter}`).then((data) => setRows(data.users), () => setRows([])),
    [token, query, unitFilter],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const has = (row: AccessRow, role: Role, unitId: string | null = null) => row.grants.some((grant) => grant.role === role && grant.unitId === unitId);
  const unitCode = (unitId: string) => units.find((unit) => unit.id === unitId)?.code || units.find((unit) => unit.id === unitId)?.name || "?";
  const [deleting, setDeleting] = useState<AccessRow | null>(null);
  const remove = async (row: AccessRow) => {
    setBusy(true);
    if (await run(`Đã xoá tài khoản ${row.email}`, () => academicApi(token, `accounts/${row.id}`, "DELETE"))) await load();
    setBusy(false);
    setDeleting(null);
  };
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
  // One cell instead of a column per unit: the units the person is giáo vụ of, ✕ to revoke, a select to add.
  const unitAdminCell = (row: AccessRow) => {
    const granted = units.filter((unit) => has(row, "unit_admin", unit.id));
    const others = units.filter((unit) => !has(row, "unit_admin", unit.id));
    return (
      <div className="admin-toolbar">
        {granted.map((unit) => (
          <Badge key={unit.id} tone="blue">
            {unit.name}{" "}
            <button
              type="button"
              className="dept-action-btn"
              disabled={busy}
              onClick={() => void toggle(row, "unit_admin", unit.id, false)}
              aria-label={`Thu hồi giáo vụ ${unit.name}: ${row.displayName}`}
              title="Thu hồi"
            >
              ✕
            </button>
          </Badge>
        ))}
        {others.length > 0 && (
          <select
            value=""
            disabled={busy}
            onChange={(event) => void toggle(row, "unit_admin", event.target.value, true)}
            aria-label={`Thêm giáo vụ đơn vị: ${row.displayName}`}
          >
            <option value="">+ Thêm đơn vị…</option>
            {others.map((unit) => <option key={unit.id} value={unit.id}>{unitLabel(unit)}</option>)}
          </select>
        )}
      </div>
    );
  };

  return (
    <div className="admin-stack">
      {/* Tab Navigation */}
      <nav className="admin-tabs" aria-label="Phân hệ quản trị">
        <button
          type="button"
          className={`admin-tab-btn ${activeTab === "departments" ? "is-active" : ""}`}
          onClick={() => setActiveTab("departments")}
        >
          Khoa & Phòng ban
        </button>
        <button
          type="button"
          className={`admin-tab-btn ${activeTab === "permissions" ? "is-active" : ""}`}
          onClick={() => setActiveTab("permissions")}
        >
          Phân quyền
        </button>
        <button
          type="button"
          className={`admin-tab-btn ${activeTab === "accounts" ? "is-active" : ""}`}
          onClick={() => setActiveTab("accounts")}
        >
          Tạo tài khoản
        </button>
        <button
          type="button"
          className={`admin-tab-btn ${activeTab === "health" ? "is-active" : ""}`}
          onClick={() => setActiveTab("health")}
        >
          Sức khỏe hệ thống
        </button>
      </nav>

      {/* Tab 1: Khoa & Phòng ban (Mặc định) */}
      {activeTab === "departments" && (
        <FacultyPanel token={token} run={run} units={units} onUnitCreated={onUnitCreated} />
      )}

      {/* Tab 2: Phân quyền */}
      {activeTab === "permissions" && (
        <section>
          <h2>Phân quyền</h2>
          <p className="admin-note">
            Quản trị hệ thống: tích để cấp, bỏ tích để thu hồi. Giáo vụ đơn vị: chọn đơn vị để cấp, bấm ✕ để thu hồi. Tài khoản được tạo ở tab "Tạo tài khoản"; nút Xoá xoá vĩnh viễn tài khoản.
          </p>
          <div className="admin-toolbar">
            <input type="search" placeholder="Tìm theo tên, email hoặc mã số" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Tìm người dùng" />
            <select value={unitFilter} onChange={(event) => setUnitFilter(event.target.value)} aria-label="Lọc theo khoa / phòng ban">
              <option value="">Tất cả khoa / phòng ban</option>
              <option value="none">Chưa thuộc đơn vị nào (cần bổ sung)</option>
              {units.map((unit) => <option key={unit.id} value={unit.id}>{unitLabel(unit)}</option>)}
            </select>
            <span className="admin-note">{rows ? `${rows.length} người${rows.length === 100 ? " (tối đa 100, hãy lọc thêm)" : ""}` : "Đang tải…"}</span>
          </div>
          <div className="admin-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Người dùng</th>
                  <th>Mã số</th>
                  <th>Đơn vị</th>
                  <th>Quản trị hệ thống</th>
                  <th>Giáo vụ đơn vị</th>
                  <th>Hồ sơ</th>
                  <th>Mật khẩu</th>
                  <th>Xoá</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((row) => (
                  <tr key={row.id}>
                    <td>{row.displayName}<br /><small>{row.email}</small></td>
                    {/* Keyed by the code so a mã số issued with a new unit replaces the cell's draft. */}
                    <td><CodeCell key={row.userCode ?? ""} token={token} run={run} row={row} /></td>
                    <td><UnitCell token={token} run={run} row={row} units={units} onSaved={() => void load()} /></td>
                    <td>{box(row, "system_admin", null, "Quản trị hệ thống")}</td>
                    <td>{unitAdminCell(row)}</td>
                    <td>
                      {row.staff && <Badge tone={row.staff.active ? "blue" : "neutral"}>Giảng viên {unitCode(row.staff.unitId)}{row.staff.active ? "" : " (ngừng)"}</Badge>}
                      {!row.staff && "—"}
                    </td>
                    <td><PasswordCell token={token} run={run} row={row} /></td>
                    <td>
                      <Button
                        type="button"
                        variant="danger"
                        disabled={busy || row.id === user?.id}
                        title={row.id === user?.id ? "Không thể tự xoá tài khoản đang đăng nhập" : undefined}
                        onClick={() => setDeleting(row)}
                        aria-label={`Xoá tài khoản ${row.displayName}`}
                      >
                        Xoá
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows && !rows.length && <p className="admin-note">Không có người dùng khớp.</p>}
          <AnimatePresence>
            {deleting && (
              <ConfirmDialog
                title="Xoá tài khoản"
                description={`Xoá vĩnh viễn tài khoản ${deleting.displayName} (${deleting.email})? Thao tác này không thể hoàn tác.`}
                confirmLabel="Xoá tài khoản"
                loading={busy}
                onClose={() => setDeleting(null)}
                onConfirm={() => void remove(deleting)}
              />
            )}
          </AnimatePresence>
          {!units.length && <p className="admin-note">Chưa có khoa nào: tạo khoa ở mục "Khoa & Phòng ban" để cấp quyền giáo vụ.</p>}
        </section>
      )}

      {/* Tab 3: Tạo tài khoản */}
      {activeTab === "accounts" && (
        <>
          <AccountForm token={token} run={run} onSaved={() => void load()} />
          <AccountsCard token={token} run={run} units={units} onCreated={() => void load()} />
        </>
      )}

      {/* Tab 4: Sức khỏe hệ thống */}
      {activeTab === "health" && (
        <HealthPanel token={token} />
      )}
    </div>
  );
}

/** Passwords are stored hashed, so the admin can only set a new one; it is shown once after saving. */
function PasswordCell({ token, run, row }: { token: string; run: Run; row: AccessRow }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  if (saved)
    return (
      <span className="admin-toolbar">
        <code>{saved}</code>
        <Button type="button" variant="secondary" onClick={() => void navigator.clipboard.writeText(saved)}>Sao chép</Button>
        <Button type="button" variant="secondary" onClick={() => setSaved(null)}>Ẩn</Button>
      </span>
    );
  if (!editing)
    return <Button type="button" variant="secondary" onClick={() => setEditing(true)}>Đặt lại</Button>;
  return (
    <form className="admin-toolbar" onSubmit={async (event) => {
      event.preventDefault();
      const result = await run(`Đã đặt mật khẩu mới cho ${row.displayName}`, () =>
        academicApi<{ password: string }>(token, `accounts/${row.id}/password`, "POST", { password: value }));
      if (result) {
        setSaved(result.password);
        setEditing(false);
        setValue("");
      }
    }}>
      <input type="text" autoComplete="new-password" minLength={8} maxLength={128} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Trống = tạo ngẫu nhiên" aria-label={`Mật khẩu mới: ${row.displayName}`} />
      <Button type="submit">Lưu</Button>
      <Button type="button" variant="secondary" onClick={() => { setEditing(false); setValue(""); }}>Huỷ</Button>
    </form>
  );
}

/** Mã số sinh viên / giảng viên: the person signs in with it instead of the email. Blank clears it. */
function CodeCell({ token, run, row }: { token: string; run: Run; row: AccessRow }) {
  const [saved, setSaved] = useState(row.userCode ?? "");
  const [value, setValue] = useState(saved);
  return (
    <form className="admin-toolbar" onSubmit={async (event) => {
      event.preventDefault();
      const result = await run(`Đã lưu mã số của ${row.displayName}`, () =>
        academicApi<{ userCode: string | null }>(token, `accounts/${row.id}/code`, "POST", { userCode: value.trim() }));
      if (result) {
        setSaved(result.userCode ?? "");
        setValue(result.userCode ?? "");
      }
    }}>
      <input type="text" value={value} onChange={(e) => setValue(e.target.value)} pattern="[A-Za-z0-9]{4,20}" maxLength={20} size={10} placeholder="—" aria-label={`Mã số: ${row.displayName}`} />
      {value.trim().toUpperCase() !== saved && <Button type="submit">Lưu</Button>}
    </form>
  );
}

/** The faculty / office the account belongs to; changing it keeps the mã số, and an account without one gets it. */
function UnitCell({ token, run, row, units, onSaved }: { token: string; run: Run; row: AccessRow; units: Unit[]; onSaved: () => void }) {
  const [unitId, setUnitId] = useState(row.unitId ?? "");
  return (
    <select value={unitId} aria-label={`Đơn vị: ${row.displayName}`} onChange={async (event) => {
      const next = event.target.value;
      const result = await run(`Đã chuyển ${row.displayName} sang đơn vị mới`, () =>
        academicApi<{ unitId: string; userCode: string }>(token, `accounts/${row.id}/unit`, "POST", { unitId: next }));
      if (result) {
        setUnitId(result.unitId);
        if (result.userCode !== row.userCode) onSaved();
      }
    }}>
      {!unitId && <option value="" disabled>Chọn đơn vị…</option>}
      {units.map((unit) => <option key={unit.id} value={unit.id}>{unitLabel(unit)}</option>)}
    </select>
  );
}

type CreatedAccount ={ email: string; displayName: string; userCode: string | null; extension: string | null; status: "created" | "exists"; password: string | null };

/** No self sign-up: the system administrator creates accounts here, one or a list pasted from Excel. */
function AccountsCard({ token, run, units, onCreated }: { token: string; run: Run; units: Unit[]; onCreated: () => void }) {
  const [lines, setLines] = useState("");
  const [unitId, setUnitId] = useState("");
  const [kind, setKind] = useState<"student" | "lecturer" | "staff">("staff");
  const [cohort, setCohort] = useState(String(new Date().getFullYear()).slice(2));
  const unit = units.find((item) => item.id === unitId);
  const parsed = parseAccountLines(lines).filter((row) => row.email);
  const needCodes = parsed.filter((row) => !row.userCode).length;
  // The codes the server would hand out now, in order, for the rows that leave mã số blank.
  const [nextCodes, setNextCodes] = useState<string[]>([]);
  useEffect(() => {
    setNextCodes([]);
    if (!unit?.idPrefix || !needCodes || (kind === "student" && !/^[0-9]{2}$/.test(cohort))) return;
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ kind, count: String(needCodes), ...(kind === "student" ? { cohort } : {}) });
      academicApi<{ codes: string[] }>(token, `units/${unit.id}/next-codes?${query}`).then(
        (data) => setNextCodes(data.codes),
        () => setNextCodes([]),
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [token, unit?.id, unit?.idPrefix, kind, cohort, needCodes]);
  let codeIndex = 0;
  const preview = parsed.map((row) => ({ ...row, code: row.userCode?.toUpperCase() ?? nextCodes[codeIndex++] ?? null }));
  const [created, setCreated] = useState<CreatedAccount[]>([]);
  const [phoneNote, setPhoneNote] = useState<string | null>(null);
  const copy = () =>
    void navigator.clipboard.writeText(created.map((row) => [row.email, row.displayName, row.userCode ?? "", row.extension ?? "", row.password ?? "(đã có tài khoản)"].join("\t")).join("\n"));
  return (
    <section>
      <h2>Tạo nhiều tài khoản</h2>
      <form className="admin-form" onSubmit={async (event) => {
        event.preventDefault();
        const result = await run("Đã xử lý danh sách tài khoản", () =>
          academicApi<{ accounts: CreatedAccount[]; phoneWarning: string | null }>(token, "accounts", "POST", {
            accounts: parseAccountLines(lines),
            unitId,
            kind,
            cohort: kind === "student" ? cohort : undefined,
          }));
        if (result) {
          setCreated(result.accounts);
          setPhoneNote(result.phoneWarning);
          setLines("");
          onCreated();
        }
      }}>
        <div className="admin-toolbar">
          <select
            value={unitId}
            onChange={(e) => {
              setUnitId(e.target.value);
              const picked = units.find((item) => item.id === e.target.value);
              // Faculties have prefixes 01–49 (default GV), offices 50–99 (default CB).
              if (picked?.idPrefix && kind !== "student") setKind(Number(picked.idPrefix) < 50 ? "lecturer" : "staff");
            }}
            aria-label="Khoa / phòng ban"
            required
          >
            <option value="">Khoa / phòng ban…</option>
            {units.map((item) => <option key={item.id} value={item.id}>{unitLabel(item)}</option>)}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Loại tài khoản" required>
            <option value="student">Sinh viên (SV)</option>
            <option value="lecturer">Giảng viên (GV)</option>
            <option value="staff">Cán bộ (CB)</option>
          </select>
          {kind === "student" && (
            <input type="text" inputMode="numeric" pattern="[0-9]{2}" maxLength={2} size={3} value={cohort} onChange={(e) => setCohort(e.target.value)} aria-label="Khóa (2 số cuối năm nhập học)" title="Khóa: 2 số cuối năm nhập học" required />
          )}
        </div>
        <p className="admin-note">
          {!unit ? "Chọn khoa / phòng ban: mỗi tài khoản đều thuộc một đơn vị và được cấp mã số tự động. " : null}
          Mỗi tài khoản mới được cấp luôn máy lẻ trong dải của đơn vị{unit?.idPrefix ? <> (<code>1{unit.idPrefix}01</code>–<code>1{unit.idPrefix}99</code>)</> : null} để gọi nội bộ.
          {unit && !unit.idPrefix ? "Đơn vị này chưa có mã định danh 2 số: đặt ở tab Khoa & Phòng ban. " : null}
          Mỗi dòng: <code>email, Họ tên, Mã số</code> (dán thẳng từ Excel cũng được; cột mã số bỏ trống để tự cấp), tối đa 200 dòng.
        </p>
        <textarea rows={5} value={lines} onChange={(e) => setLines(e.target.value)} required aria-label="Danh sách tài khoản" placeholder={"gv.lan@tdtu.edu.vn, Trần Thị Lan\ncb.minh@tdtu.edu.vn, Lê Văn Minh"} />
        {unit && preview.length > 0 && (
          <table className="admin-table" aria-label="Mã số sẽ cấp">
            <thead><tr><th>Email</th><th>Họ tên</th><th>Mã số sẽ cấp</th></tr></thead>
            <tbody>
              {preview.map((row, index) => (
                <tr key={`${row.email}-${index}`}>
                  <td>{row.email}</td>
                  <td>{row.displayName || "—"}</td>
                  <td>{row.code ? <code>{row.code}</code> : unit.idPrefix ? "Đang lấy mã…" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Button type="submit" disabled={!unit?.idPrefix}>Tạo tài khoản</Button>
      </form>
      {created.length > 0 && (
        <>
          {phoneNote && <p className="admin-note" role="alert">{phoneNote}</p>}
          <p className="admin-note" role="status">Mật khẩu chỉ hiện một lần. Hãy sao chép và gửi cho từng người; họ có thể đổi trong trang Hồ sơ.</p>
          <table className="admin-table">
            <thead><tr><th>Email</th><th>Họ tên</th><th>Mã số</th><th>Máy lẻ</th><th>Mật khẩu</th></tr></thead>
            <tbody>
              {created.map((row) => (
                <tr key={row.email}><td>{row.email}</td><td>{row.displayName}</td><td>{row.userCode ?? "—"}</td><td>{row.extension ?? "—"}</td><td>{row.password ? <code>{row.password}</code> : "Đã có tài khoản, giữ nguyên"}</td></tr>
              ))}
            </tbody>
          </table>
          <Button type="button" variant="secondary" onClick={copy}>Sao chép danh sách</Button>
        </>
      )}
    </section>
  );
}
