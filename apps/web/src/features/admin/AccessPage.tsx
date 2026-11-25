import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { AnimatePresence } from "motion/react";
import { ConfirmDialog } from "../../shared/ui/Primitives";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../shared/ui/kit/dropdown-menu";
import { cn } from "../../shared/lib/utils";
import { academicApi, type AcademicProfile } from "./api";
import { AccountsTab } from "./AccountForm";
import { FacultyPanel } from "./FacultyPanel";
import { HealthPanel } from "./HealthPanel";
import { ActivityPanel } from "./ActivityPanel";
import { CHIP, CODE, MUTED, SEARCH, TABLE, TABLE_CARD, TINT } from "./ui";

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

export type Run = <T>(label: string, action: () => Promise<T>) => Promise<T | undefined>;
type Unit = AcademicProfile["units"][number];
export const unitLabel = (unit: Unit) => `${unit.idPrefix ?? "--"} · ${unit.name}`;

type Tab = "departments" | "permissions" | "accounts" | "health" | "activity";
const TABS: [Tab, string, IconName][] = [
  ["departments", "Khoa & Phòng ban", "building"],
  ["permissions", "Phân quyền", "shield"],
  ["accounts", "Tạo tài khoản", "user-plus"],
  ["health", "Sức khỏe hệ thống", "activity"],
  ["activity", "Nhật ký hoạt động", "menu"],
];

/** "Quản trị hệ thống" (sidebar, system admins only): accounts and system / faculty roles. */
export function AccessPage() {
  const { accessToken, notify } = useApp();
  const token = accessToken!;
  const [profile, setProfile] = useState<AcademicProfile | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    academicApi<AcademicProfile>(token, "me").then(setProfile, () => setFailed(true));
  }, [token]);
  const run = useCallback<Run>(
    async (label, action) => {
      try {
        const result = await action();
        notify(label);
        return result;
      } catch (error) {
        notify(error instanceof Error ? error.message : "Thao tác thất bại.", undefined, "warning");
        return undefined;
      }
    },
    [notify],
  );

  return (
    <div className="tw tw-form grid min-w-0 gap-3.5 px-7 pt-5 pb-10 text-sm text-foreground max-md:px-3.5">
      <div>
        <h1 className="text-[22px] font-bold">Quản trị hệ thống</h1>
        <p className={MUTED}>
          Cơ cấu khoa, phòng ban, tài khoản, phân quyền và tình trạng vận hành
        </p>
      </div>
      {failed ? (
        <p className={MUTED} role="alert">
          Không tải được dữ liệu phân quyền.
        </p>
      ) : !profile ? (
        <p className={MUTED} role="status">
          Đang tải…
        </p>
      ) : profile.systemAdmin ? (
        <AccessPanel
          token={token}
          run={run}
          units={profile.units}
          onUnitCreated={(unit) =>
            setProfile({
              ...profile,
              units: [...profile.units, unit].sort((a, b) =>
                (a.code || a.name || "").localeCompare(b.code || b.name || ""),
              ),
            })
          }
        />
      ) : (
        <p className={MUTED} role="alert">
          Trang này chỉ dành cho tài khoản quản trị hệ thống.
        </p>
      )}
    </div>
  );
}

function AccessPanel({
  token,
  run,
  units,
  onUnitCreated,
}: {
  token: string;
  run: Run;
  units: Unit[];
  onUnitCreated: (unit: Unit) => void;
}) {
  const { user } = useApp();
  const [activeTab, setActiveTab] = useState<Tab>("departments");
  const [query, setQuery] = useState("");
  const [unitFilter, setUnitFilter] = useState("");
  const [rows, setRows] = useState<AccessRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      academicApi<{ users: AccessRow[] }>(
        token,
        `access?q=${encodeURIComponent(query.trim())}&unit=${unitFilter}`,
      ).then(
        (data) => setRows(data.users),
        () => setRows([]),
      ),
    [token, query, unitFilter],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const has = (row: AccessRow, role: Role, unitId: string | null = null) =>
    row.grants.some((grant) => grant.role === role && grant.unitId === unitId);
  const unitCode = (unitId: string) =>
    units.find((unit) => unit.id === unitId)?.code ||
    units.find((unit) => unit.id === unitId)?.name ||
    "?";
  const [deleting, setDeleting] = useState<AccessRow | null>(null);
  const remove = async (row: AccessRow) => {
    setBusy(true);
    if (
      await run(`Đã xoá tài khoản ${row.email}`, () =>
        academicApi(token, `accounts/${row.id}`, "DELETE"),
      )
    )
      await load();
    setBusy(false);
    setDeleting(null);
  };
  const toggle = async (row: AccessRow, role: Role, unitId: string | null, on: boolean) => {
    setBusy(true);
    const done = await run(
      on ? `Đã cấp quyền cho ${row.displayName}` : `Đã thu hồi quyền của ${row.displayName}`,
      () =>
        academicApi(token, "roles", "POST", {
          email: row.email,
          role,
          unitId: unitId ?? undefined,
          revoke: !on,
        }),
    );
    if (done) await load();
    setBusy(false);
  };

  return (
    <>
      <nav
        className="flex gap-0.5 overflow-x-auto overflow-y-hidden border-b"
        role="tablist"
        aria-label="Phân hệ quản trị"
      >
        {TABS.map(([key, label, icon]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            className={cn(
              "-mb-px flex cursor-pointer items-center gap-[7px] border-b-2 border-transparent px-3 py-2.5 font-medium whitespace-nowrap text-muted-foreground hover:text-foreground",
              activeTab === key && "border-foreground font-semibold text-foreground",
            )}
            onClick={() => setActiveTab(key)}
          >
            <Icon name={icon} size={16} />
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "departments" && (
        <FacultyPanel token={token} run={run} units={units} onUnitCreated={onUnitCreated} />
      )}

      {activeTab === "permissions" && (
        <section className="grid min-w-0 gap-3.5" aria-label="Phân quyền">
          <div className="flex flex-wrap items-center gap-2">
            <label className={cn(SEARCH, "w-[300px] max-md:w-full")}>
              <Icon name="search" size={15} />
              <input
                type="search"
                placeholder="Tìm theo tên, email hoặc mã số"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Tìm người dùng"
              />
            </label>
            <select
              className="h-[34px]! py-0! text-[13px]! whitespace-nowrap"
              value={unitFilter}
              onChange={(event) => setUnitFilter(event.target.value)}
              aria-label="Lọc theo khoa / phòng ban"
            >
              <option value="">Tất cả khoa / phòng ban</option>
              <option value="none">Chưa thuộc đơn vị nào (cần bổ sung)</option>
              {units.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unitLabel(unit)}
                </option>
              ))}
            </select>
            <span className={MUTED}>
              {rows
                ? `${rows.length} người${rows.length === 100 ? " (tối đa 100, hãy lọc thêm)" : ""}`
                : "Đang tải…"}
            </span>
          </div>
          {!units.length && (
            <p className={MUTED}>
              Chưa có khoa nào: tạo khoa ở tab "Khoa & Phòng ban" để cấp quyền giáo vụ.
            </p>
          )}
          <div className={TABLE_CARD}>
            <div className="overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th scope="col">Người dùng</th>
                    <th scope="col">Mã số</th>
                    <th scope="col" className="max-md:hidden">
                      Đơn vị
                    </th>
                    <th scope="col">Quản trị hệ thống</th>
                    <th scope="col">Giáo vụ đơn vị</th>
                    <th scope="col" className="hidden min-[1500px]:table-cell">
                      Hồ sơ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows?.map((row) => {
                    const self = row.id === user?.id;
                    const granted = units.filter((unit) => has(row, "unit_admin", unit.id));
                    const others = units.filter((unit) => !has(row, "unit_admin", unit.id));
                    return (
                      <tr key={row.id}>
                        <td className="min-w-[220px]">
                          <PersonCell
                            token={token}
                            run={run}
                            row={row}
                            self={self}
                            busy={busy}
                            onDelete={() => setDeleting(row)}
                          />
                        </td>
                        {/* Keyed by the code so a mã số issued with a new unit replaces the cell's draft. */}
                        <td>
                          <CodeCell key={row.userCode ?? ""} token={token} run={run} row={row} />
                        </td>
                        <td className="max-md:hidden">
                          <UnitCell
                            token={token}
                            run={run}
                            row={row}
                            units={units}
                            onSaved={() => void load()}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={has(row, "system_admin")}
                            aria-label={`Quản trị hệ thống: ${row.displayName}`}
                            title={
                              self ? "Không thể tự thu hồi quyền quản trị hệ thống" : undefined
                            }
                            disabled={busy || self}
                            className={cn(
                              "relative h-5 w-[34px] shrink-0 cursor-pointer rounded-full bg-border transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                              "after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-[left]",
                              has(row, "system_admin") &&
                                "bg-foreground after:left-4 dark:after:bg-background",
                            )}
                            onClick={() =>
                              void toggle(row, "system_admin", null, !has(row, "system_admin"))
                            }
                          />
                        </td>
                        <td>
                          {/* One cell instead of a column per unit: ✕ revokes, the select adds. */}
                          <div className="flex max-w-[280px] flex-wrap items-center gap-1">
                            {granted.map((unit) => (
                              <span key={unit.id} className={cn(CHIP, TINT.blue, "pr-1")}>
                                {unit.name}
                                <button
                                  type="button"
                                  className="grid size-4 cursor-pointer place-items-center rounded-full hover:bg-black/10"
                                  disabled={busy}
                                  onClick={() => void toggle(row, "unit_admin", unit.id, false)}
                                  aria-label={`Thu hồi giáo vụ ${unit.name}: ${row.displayName}`}
                                  title="Thu hồi"
                                >
                                  <Icon name="x" size={10} />
                                </button>
                              </span>
                            ))}
                            {others.length > 0 && (
                              <select
                                value=""
                                disabled={busy}
                                className="h-[22px]! w-auto cursor-pointer rounded-full! border-dashed! bg-transparent! px-2! py-0! text-[11.5px]! font-semibold whitespace-nowrap text-muted-foreground! hover:text-foreground!"
                                onChange={(event) =>
                                  void toggle(row, "unit_admin", event.target.value, true)
                                }
                                aria-label={`Thêm giáo vụ đơn vị: ${row.displayName}`}
                              >
                                <option value="">+ Thêm</option>
                                {others.map((unit) => (
                                  <option key={unit.id} value={unit.id}>
                                    {unitLabel(unit)}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </td>
                        <td className="hidden min-[1500px]:table-cell">
                          {row.staff ? (
                            <span className={cn(CHIP, row.staff.active && TINT.blue)}>
                              Giảng viên {unitCode(row.staff.unitId)}
                              {row.staff.active ? "" : " (ngừng)"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {rows && !rows.length && (
                    <tr>
                      <td colSpan={6} className={cn(MUTED, "py-8 text-center")}>
                        Không có người dùng khớp.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
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
        </section>
      )}

      {activeTab === "accounts" && (
        <AccountsTab token={token} run={run} onSaved={() => void load()} />
      )}
      {activeTab === "health" && <HealthPanel token={token} />}
      {activeTab === "activity" && <ActivityPanel token={token} />}
    </>
  );
}

/**
 * Name and email, with the row's ⋯ menu. Passwords are stored hashed, so the admin can only set a
 * new one; it is shown once, under the name, after saving.
 */
function PersonCell({
  token,
  run,
  row,
  self,
  busy,
  onDelete,
}: {
  token: string;
  run: Run;
  row: AccessRow;
  self: boolean;
  busy: boolean;
  onDelete: () => void;
}) {
  const { notify } = useApp();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const copy = (text: string, label: string) =>
    void navigator.clipboard.writeText(text).then(
      () => notify(`Đã sao chép ${label}`),
      () => notify(`Không sao chép được ${label}`, undefined, "warning"),
    );
  return (
    <div className="grid gap-1">
      <div className="flex min-w-0 items-center gap-2.5">
        <UserAvatar name={row.displayName} />
        <span className="min-w-0 flex-1">
          <b className="flex items-center gap-1.5 truncate font-semibold">
            {row.displayName}
            {self && <span className={CHIP}>Bạn</span>}
          </b>
          <small className="block truncate text-xs text-muted-foreground">{row.email}</small>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-[7px] text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label={`Thao tác với ${row.displayName}`}
          >
            <Icon name="more-horizontal" size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[100] w-52 p-1">
            <DropdownMenuItem className="gap-2" onSelect={() => setEditing(true)}>
              <Icon name="lock" size={15} /> Đặt lại mật khẩu
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onSelect={() => copy(row.email, "email")}>
              <Icon name="copy" size={15} /> Sao chép email
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 text-destructive focus:text-destructive"
              disabled={busy || self}
              title={self ? "Không thể tự xoá tài khoản đang đăng nhập" : undefined}
              onSelect={onDelete}
            >
              <Icon name="trash" size={15} /> Xoá tài khoản
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {saved && (
        <div
          className={cn(
            "flex w-max max-w-full flex-wrap items-center gap-1.5 rounded-[7px] py-1 pr-1 pl-2 text-xs",
            TINT.amber,
          )}
        >
          <Icon name="lock" size={13} />
          Mật khẩu mới: <code className="font-mono font-bold">{saved}</code>
          <button
            type="button"
            className="h-[22px] cursor-pointer rounded-[5px] bg-black/5 px-[7px] text-[11.5px] font-semibold"
            onClick={() => copy(saved, "mật khẩu")}
          >
            Sao chép
          </button>
          <button
            type="button"
            className="h-[22px] cursor-pointer rounded-[5px] bg-black/5 px-[7px] text-[11.5px] font-semibold"
            onClick={() => setSaved(null)}
          >
            Ẩn
          </button>
        </div>
      )}
      {editing && (
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await run(`Đã đặt mật khẩu mới cho ${row.displayName}`, () =>
              academicApi<{ password: string }>(token, `accounts/${row.id}/password`, "POST", {
                password: value,
              }),
            );
            if (result) {
              setSaved(result.password);
              setEditing(false);
              setValue("");
            }
          }}
        >
          <input
            type="text"
            className="h-[30px]! w-44 py-0! text-[12.5px]!"
            autoComplete="new-password"
            minLength={8}
            maxLength={128}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Trống = tạo ngẫu nhiên"
            aria-label={`Mật khẩu mới: ${row.displayName}`}
            autoFocus
          />
          <button
            type="submit"
            className="h-[30px] cursor-pointer rounded-[7px] bg-primary px-2.5 text-xs font-semibold text-primary-foreground"
          >
            Lưu
          </button>
          <button
            type="button"
            className="h-[30px] cursor-pointer rounded-[7px] border bg-card px-2.5 text-xs font-semibold hover:bg-secondary"
            onClick={() => {
              setEditing(false);
              setValue("");
            }}
          >
            Huỷ
          </button>
        </form>
      )}
    </div>
  );
}

/** Mã số sinh viên / giảng viên: the person signs in with it instead of the email. Blank clears it. */
function CodeCell({ token, run, row }: { token: string; run: Run; row: AccessRow }) {
  const [saved, setSaved] = useState(row.userCode ?? "");
  const [value, setValue] = useState(saved);
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={async (event) => {
        event.preventDefault();
        const result = await run(`Đã lưu mã số của ${row.displayName}`, () =>
          academicApi<{ userCode: string | null }>(token, `accounts/${row.id}/code`, "POST", {
            userCode: value.trim(),
          }),
        );
        if (result) {
          setSaved(result.userCode ?? "");
          setValue(result.userCode ?? "");
        }
      }}
    >
      <input
        type="text"
        className={cn(CODE, "h-[30px]! w-24 py-0! font-mono! text-[12.5px]!")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        pattern="[A-Za-z0-9]{4,20}"
        maxLength={20}
        placeholder="—"
        aria-label={`Mã số: ${row.displayName}`}
      />
      {value.trim().toUpperCase() !== saved && (
        <button
          type="submit"
          className="h-[30px] cursor-pointer rounded-[7px] bg-primary px-2.5 text-xs font-semibold text-primary-foreground"
        >
          Lưu
        </button>
      )}
    </form>
  );
}

/** The faculty / office the account belongs to; changing it keeps the mã số, and an account without one gets it. */
function UnitCell({
  token,
  run,
  row,
  units,
  onSaved,
}: {
  token: string;
  run: Run;
  row: AccessRow;
  units: Unit[];
  onSaved: () => void;
}) {
  const [unitId, setUnitId] = useState(row.unitId ?? "");
  return (
    <select
      className="h-[30px]! w-max py-0! text-[12.5px]! whitespace-nowrap"
      value={unitId}
      aria-label={`Đơn vị: ${row.displayName}`}
      onChange={async (event) => {
        const next = event.target.value;
        const result = await run(`Đã chuyển ${row.displayName} sang đơn vị mới`, () =>
          academicApi<{ unitId: string; userCode: string }>(
            token,
            `accounts/${row.id}/unit`,
            "POST",
            { unitId: next },
          ),
        );
        if (result) {
          setUnitId(result.unitId);
          if (result.userCode !== row.userCode) onSaved();
        }
      }}
    >
      {!unitId && (
        <option value="" disabled>
          Chọn đơn vị…
        </option>
      )}
      {units.map((unit) => (
        <option key={unit.id} value={unit.id}>
          {unitLabel(unit)}
        </option>
      ))}
    </select>
  );
}
