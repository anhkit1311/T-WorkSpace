import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../../app/providers/AppContext";
import { Icon } from "../../shared/ui/Icon";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import { cn } from "../../shared/lib/utils";
import { academicApi, rankLabel, type DepartmentUnit } from "./api";
import { parseAccountLines } from "./labels";
import type { Run } from "./AccessPage";
import {
  BTN,
  BTN_GHOST,
  BTN_SM,
  CARD,
  CARD_HEAD,
  CHIP,
  CODE,
  H3,
  MUTED,
  SEG,
  SEG_BTN,
  TABLE,
  TABLE_CARD,
  TINT,
} from "./ui";

type AccountKind = "student" | "lecturer" | "staff";
type Department = { id: string; code: string; name: string };
interface Enrolled {
  email: string;
  userCode: string;
  status: "created" | "moved";
  password: string | null;
  extension: string | null;
  phoneWarning: string | null;
}
type CreatedAccount = {
  email: string;
  displayName: string;
  userCode: string | null;
  extension: string | null;
  status: "created" | "exists" | "moved";
  password: string | null;
};

const KIND_OPTIONS = (
  <>
    <option value="student">Sinh viên (SV)</option>
    <option value="lecturer">Giảng viên (GV)</option>
    <option value="staff">Cán bộ (CB)</option>
  </>
);
const HINT =
  "text-[12.5px] text-muted-foreground [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1";

/** Máy lẻ range of a unit: the stored one, else the one derived from its mã định danh. */
export const extensionRange = (unit: DepartmentUnit) =>
  unit.extensionFrom && unit.extensionTo
    ? `${unit.extensionFrom}–${unit.extensionTo}`
    : unit.idPrefix
      ? `1${unit.idPrefix}01–1${unit.idPrefix}99`
      : null;

/**
 * "Tạo tài khoản" (tab of Quản trị hệ thống). No self sign-up: one account, or a list pasted from
 * Excel. A new email gets an account in the chosen khoa / phòng ban, an existing one moves there. The
 * mã số is issued by the server from the unit's mã định danh; the preview shows it before saving.
 */
export function AccountsTab({
  token,
  run,
  onSaved,
}: {
  token: string;
  run: Run;
  onSaved: () => void;
}) {
  const { notify } = useApp();
  const [mode, setMode] = useState<"one" | "many">("one");
  const [units, setUnits] = useState<DepartmentUnit[]>([]);
  const [unitId, setUnitId] = useState("");
  const [kind, setKind] = useState<AccountKind>("student");
  const [cohort, setCohort] = useState(String(new Date().getFullYear()).slice(2));
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState({ email: "", displayName: "", rank: "ths", departmentId: "" });
  const [lines, setLines] = useState("");
  const [created, setCreated] = useState<CreatedAccount[]>([]);
  const [phoneNote, setPhoneNote] = useState<string | null>(null);
  const unit = units.find((item) => item.id === unitId);
  const cohortOk = kind !== "student" || /^[0-9]{2}$/.test(cohort);

  useEffect(() => {
    academicApi<DepartmentUnit[]>(token, "units").then(setUnits, () => setUnits([]));
  }, [token]);

  useEffect(() => {
    setDepartments([]);
    if (!unitId) return;
    academicApi<{ departments: Department[] }>(token, `units/${unitId}/staff`).then(
      (data) => setDepartments(data.departments || []),
      () => setDepartments([]),
    );
  }, [token, unitId]);

  const parsed = parseAccountLines(lines).filter((row) => row.email);
  const needCodes = mode === "one" ? 1 : parsed.filter((row) => !row.userCode).length;
  // The codes the server would hand out now, in order, for the rows that leave mã số blank.
  const [nextCodes, setNextCodes] = useState<string[]>([]);
  useEffect(() => {
    setNextCodes([]);
    if (!unit?.idPrefix || !needCodes || !cohortOk) return;
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({
        kind,
        count: String(needCodes),
        ...(kind === "student" ? { cohort } : {}),
      });
      academicApi<{ codes: string[] }>(token, `units/${unit.id}/next-codes?${query}`).then(
        (data) => setNextCodes(data.codes),
        () => setNextCodes([]),
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [token, unit?.id, unit?.idPrefix, kind, cohort, cohortOk, needCodes, created]);
  let codeIndex = 0;
  const preview = parsed.map((row) => ({
    ...row,
    code: row.userCode?.toUpperCase() ?? nextCodes[codeIndex++] ?? null,
  }));

  const copy = () =>
    void navigator.clipboard
      .writeText(
        created
          .map((row) =>
            [
              row.email,
              row.displayName,
              row.userCode ?? "",
              row.extension ?? "",
              row.password ?? "(đã có tài khoản)",
            ].join("\t"),
          )
          .join("\n"),
      )
      .then(
        () => notify("Đã sao chép danh sách"),
        () => notify("Không sao chép được danh sách", undefined, "warning"),
      );

  async function submit() {
    if (!unit) return;
    if (mode === "one") {
      const result = await run(`Đã lưu tài khoản ${form.email}`, () =>
        academicApi<Enrolled>(token, `units/${unit.id}/staff`, "POST", {
          ...form,
          kind,
          cohort: kind === "student" ? cohort : undefined,
          departmentId: form.departmentId || undefined,
        }),
      );
      if (!result) return;
      setCreated([{ ...result, displayName: form.displayName }]);
      setPhoneNote(result.phoneWarning);
      setForm({ ...form, email: "", displayName: "" });
    } else {
      const result = await run("Đã xử lý danh sách tài khoản", () =>
        academicApi<{ accounts: CreatedAccount[]; phoneWarning: string | null }>(
          token,
          "accounts",
          "POST",
          {
            accounts: parseAccountLines(lines),
            unitId,
            kind,
            cohort: kind === "student" ? cohort : undefined,
          },
        ),
      );
      if (!result) return;
      setCreated(result.accounts);
      setPhoneNote(result.phoneWarning);
      setLines("");
    }
    onSaved();
  }

  const status: ReactNode = !unit ? (
    "Chọn khoa / phòng ban: mỗi tài khoản đều thuộc một đơn vị và được cấp mã số tự động."
  ) : !unit.idPrefix ? (
    <span className="text-[var(--tint-amber-fg)]">
      Đơn vị chưa có mã định danh 2 số: đặt ở tab <b>Khoa & Phòng ban</b> (nút Sửa) rồi mới cấp được
      mã số.
    </span>
  ) : null;

  return (
    <section className="grid min-w-0 gap-3.5" aria-label="Tạo tài khoản">
      <div className={SEG} role="group" aria-label="Cách tạo">
        {(
          [
            ["one", "Một tài khoản"],
            ["many", "Nhiều tài khoản (dán từ Excel)"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={SEG_BTN}
            aria-pressed={mode === key}
            onClick={() => setMode(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <form
        className="grid items-start gap-4 min-[1150px]:grid-cols-[minmax(0,1fr)_380px]"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className={cn(CARD, "grid min-w-0 gap-3.5 p-4")}>
          <div className="grid gap-2.5 md:grid-cols-3">
            <label>
              Khoa / phòng ban
              <select
                value={unitId}
                onChange={(e) => {
                  const picked = units.find((item) => item.id === e.target.value);
                  setUnitId(e.target.value);
                  setForm({ ...form, departmentId: "" });
                  // Faculties have prefixes 01–49 and mostly enrol students; offices 50–99 enrol staff.
                  if (picked && (mode === "one" || kind !== "student"))
                    setKind(
                      picked.kind === "office" ? "staff" : mode === "one" ? "student" : "lecturer",
                    );
                }}
                required
              >
                <option value="">Chọn khoa / phòng ban…</option>
                {units.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.idPrefix ?? "--"} · {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Loại tài khoản
              <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
                {KIND_OPTIONS}
              </select>
            </label>
            {kind === "student" ? (
              <label>
                Khóa (2 số cuối năm nhập học)
                <input
                  inputMode="numeric"
                  pattern="[0-9]{2}"
                  maxLength={2}
                  value={cohort}
                  onChange={(e) => setCohort(e.target.value.replace(/[^0-9]/g, ""))}
                  required
                />
              </label>
            ) : mode === "one" ? (
              <label>
                Học vị / Chức vụ
                <select
                  value={form.rank}
                  onChange={(e) => setForm({ ...form, rank: e.target.value })}
                >
                  {Object.entries(rankLabel).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {mode === "one" ? (
            <>
              <div className="grid gap-2.5 md:grid-cols-2">
                <label>
                  Email
                  <input
                    type="email"
                    placeholder="VD: 523h0048@student.tdtu.edu.vn"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                </label>
                <label>
                  Họ tên (bắt buộc với tài khoản mới)
                  <input
                    placeholder="VD: Nguyễn Văn A"
                    maxLength={80}
                    value={form.displayName}
                    onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  />
                </label>
              </div>
              {kind !== "student" && unit?.kind === "faculty" && (
                <label className="md:max-w-[50%]">
                  Bộ môn trực thuộc
                  <select
                    value={form.departmentId}
                    onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
                  >
                    <option value="">Không thuộc bộ môn</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code} · {d.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className={HINT}>
                Email chưa có sẽ được tạo tài khoản kèm máy lẻ của đơn vị; email đã có sẽ được
                chuyển vào đơn vị đã chọn.
              </p>
            </>
          ) : (
            <>
              <label>
                Danh sách tài khoản
                <textarea
                  rows={7}
                  className="font-mono! text-[12.5px]! leading-relaxed!"
                  value={lines}
                  onChange={(e) => setLines(e.target.value)}
                  required
                  placeholder={"gv.lan@tdtu.edu.vn, Trần Thị Lan\ncb.minh@tdtu.edu.vn, Lê Văn Minh"}
                />
              </label>
              <p className={HINT}>
                Mỗi dòng: <code>email, Họ tên, Mã số</code>. Dán thẳng từ Excel cũng được; bỏ trống
                mã số để tự cấp. Tối đa 200 dòng.
              </p>
            </>
          )}
        </div>

        <aside
          className={cn(TABLE_CARD, "min-[1150px]:sticky min-[1150px]:top-2")}
          aria-label="Xem trước"
        >
          {mode === "one" ? (
            <div className="grid gap-1 border-b px-4 py-3.5">
              <small className="text-xs text-muted-foreground">Mã số sẽ cấp</small>
              <span className="font-mono text-[26px] font-bold tracking-wide">
                {status ? "—" : (nextCodes[0] ?? "…")}
              </span>
              <small className="text-xs text-muted-foreground">
                Tài khoản đã có mã đúng mẫu của đơn vị thì giữ nguyên.
              </small>
            </div>
          ) : (
            <>
              <div className={CARD_HEAD}>
                <h3 className={H3}>Xem trước</h3>
                <span className={CHIP}>{parsed.length} tài khoản</span>
              </div>
              {unit?.idPrefix && preview.length > 0 && (
                <div className="max-h-[320px] overflow-y-auto">
                  <table className={TABLE} aria-label="Mã số sẽ cấp">
                    <thead>
                      <tr>
                        <th scope="col">Họ tên</th>
                        <th scope="col">Mã số sẽ cấp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, index) => (
                        <tr key={`${row.email}-${index}`}>
                          <td className="max-w-0">
                            <span className="flex min-w-0 items-center gap-2.5">
                              <UserAvatar name={row.displayName || row.email} />
                              <span className="min-w-0">
                                <b className="block truncate font-semibold">
                                  {row.displayName || "—"}
                                </b>
                                <small className="block truncate text-xs text-muted-foreground">
                                  {row.email}
                                </small>
                              </span>
                            </span>
                          </td>
                          <td className="whitespace-nowrap">
                            {row.code ? <code className={CODE}>{row.code}</code> : "Đang lấy mã…"}
                            {row.userCode && <span className={cn(CHIP, "ml-1.5")}>tự nhập</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          <div className="grid gap-2 border-b px-4 py-3 text-[13px]">
            {status ? (
              <p className={MUTED}>{status}</p>
            ) : (
              <>
                <p className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Máy lẻ</span>
                  <b className="font-semibold">trong dải {unit && extensionRange(unit)}</b>
                </p>
                <p className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Mật khẩu</span>
                  <b className="font-semibold">tạo ngẫu nhiên, hiện một lần</b>
                </p>
              </>
            )}
          </div>
          <div className="px-4 py-3">
            <button
              type="submit"
              className={cn(BTN, "w-full")}
              disabled={!unit?.idPrefix || (mode === "many" && !parsed.length)}
            >
              <Icon name="user-plus" size={15} />
              {mode === "one" ? "Tạo tài khoản" : `Tạo ${parsed.length || ""} tài khoản`}
            </button>
          </div>
        </aside>
      </form>

      {created.length > 0 && (
        <section className={TABLE_CARD} aria-label="Kết quả tạo tài khoản">
          <div className={cn(CARD_HEAD, TINT.green)} role="status">
            <Icon name="check" size={16} />
            <h3 className={H3}>Đã xử lý {created.length} tài khoản</h3>
            <span className="text-[12.5px]">
              Mật khẩu chỉ hiện một lần, hãy sao chép và gửi cho từng người; họ có thể đổi trong
              trang Hồ sơ.
            </span>
            <button type="button" className={cn(BTN_GHOST, BTN_SM, "ml-auto")} onClick={copy}>
              <Icon name="copy" size={14} />
              Sao chép danh sách
            </button>
          </div>
          {phoneNote && (
            <p className={cn("border-b px-4 py-2 text-[13px]", TINT.amber)} role="alert">
              {phoneNote}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Họ tên</th>
                  <th scope="col">Mã số</th>
                  <th scope="col">Máy lẻ</th>
                  <th scope="col">Mật khẩu</th>
                </tr>
              </thead>
              <tbody>
                {created.map((row) => (
                  <tr key={row.email}>
                    <td>{row.email}</td>
                    <td>{row.displayName || "—"}</td>
                    <td>{row.userCode ? <code className={CODE}>{row.userCode}</code> : "—"}</td>
                    <td className="tabular-nums">{row.extension ?? "—"}</td>
                    <td>
                      {row.password ? (
                        <code className={cn(CODE, "font-bold")}>{row.password}</code>
                      ) : (
                        <span className="text-muted-foreground">
                          {row.status === "moved"
                            ? "Đã chuyển vào đơn vị, giữ mật khẩu cũ"
                            : "Đã có tài khoản, giữ nguyên"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
