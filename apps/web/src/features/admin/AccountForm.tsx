import { useEffect, useState } from "react";
import { Icon } from "../../shared/ui/Icon";
import { academicApi, rankLabel, type DepartmentUnit } from "./api";
import "./admin.css";

type Run = <T>(label: string, action: () => Promise<T>) => Promise<T | undefined>;

type AccountKind = "student" | "lecturer" | "staff";
interface Enrolled {
  email: string;
  userCode: string;
  status: "created" | "moved";
  password: string | null;
  extension: string | null;
  phoneWarning: string | null;
}

/**
 * "Tạo tài khoản" (tab of Quản trị hệ thống): a new email gets an account in the chosen khoa / phòng ban,
 * an existing one moves there. The mã số is issued by the server from the unit's mã định danh; the
 * preview shows the next one before saving.
 */
export function AccountForm({
  token,
  run,
  onSaved,
}: {
  token: string;
  run: Run;
  onSaved: () => void;
}) {
  const [units, setUnits] = useState<DepartmentUnit[]>([]);
  const [unitId, setUnitId] = useState("");
  const [departments, setDepartments] = useState<{ id: string; code: string; name: string }[]>([]);
  const unit = units.find((item) => item.id === unitId);
  const [form, setForm] = useState({
    email: "",
    displayName: "",
    kind: "student" as AccountKind,
    cohort: String(new Date().getFullYear()).slice(2),
    rank: "ths",
    departmentId: "",
  });
  const [nextCode, setNextCode] = useState<string | null>(null);
  const [saved, setSaved] = useState<Enrolled | null>(null);
  const cohortOk = form.kind !== "student" || /^[0-9]{2}$/.test(form.cohort);

  useEffect(() => {
    academicApi<DepartmentUnit[]>(token, "units").then(setUnits, () => setUnits([]));
  }, [token]);

  useEffect(() => {
    setDepartments([]);
    if (!unitId) return;
    academicApi<{ departments: { id: string; code: string; name: string }[] }>(
      token,
      `units/${unitId}/staff`,
    ).then(
      (data) => setDepartments(data.departments || []),
      () => setDepartments([]),
    );
  }, [token, unitId]);

  useEffect(() => {
    setNextCode(null);
    if (!unit?.idPrefix || !cohortOk) return;
    const query = new URLSearchParams({
      kind: form.kind,
      ...(form.kind === "student" ? { cohort: form.cohort } : {}),
    });
    academicApi<{ codes: string[] }>(token, `units/${unit.id}/next-codes?${query}`).then(
      (data) => setNextCode(data.codes[0] ?? null),
      () => setNextCode(null),
    );
  }, [token, unit?.id, unit?.idPrefix, form.kind, form.cohort, cohortOk, saved]);

  return (
    <form
      className="staff-form-card"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!unit) return;
        const result = await run(`Đã lưu tài khoản ${form.email}`, () =>
          academicApi<Enrolled>(token, `units/${unit.id}/staff`, "POST", {
            ...form,
            cohort: form.kind === "student" ? form.cohort : undefined,
            departmentId: form.departmentId || undefined,
          }),
        );
        if (result) {
          setSaved(result);
          setForm({ ...form, email: "", displayName: "" });
          onSaved();
        }
      }}
    >
      <div className="staff-form-head">
        <div className="staff-form-head-icon">
          <Icon name="user-plus" size={18} />
        </div>
        <div>
          <h4>Tạo tài khoản</h4>
          <span style={{ fontSize: 13, color: "#64748b" }}>
            Email chưa có sẽ được tạo tài khoản kèm máy lẻ của đơn vị; email đã có sẽ được chuyển
            vào đơn vị đã chọn.
          </span>
        </div>
      </div>

      <div className="staff-form-body">
        <div className="staff-form-group">
          <label className="staff-field-label" htmlFor="enroll-unit">
            Khoa / phòng ban <span className="req">*</span>
          </label>
          <select
            id="enroll-unit"
            className="staff-select"
            value={unitId}
            onChange={(e) => {
              const picked = units.find((item) => item.id === e.target.value);
              setUnitId(e.target.value);
              // Faculties mostly enrol students, offices staff.
              setForm({
                ...form,
                kind: picked?.kind === "office" ? "staff" : "student",
                departmentId: "",
              });
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
        </div>

        <div className="staff-form-row">
          <div className="staff-form-group">
            <label className="staff-field-label" htmlFor="enroll-email">
              Email <span className="req">*</span>
            </label>
            <input
              id="enroll-email"
              className="staff-input"
              type="email"
              placeholder="VD: 523h0048@student.tdtu.edu.vn"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>
          <div className="staff-form-group">
            <label className="staff-field-label" htmlFor="enroll-name">
              Họ tên (bắt buộc với tài khoản mới)
            </label>
            <input
              id="enroll-name"
              className="staff-input"
              placeholder="VD: Nguyễn Văn A"
              maxLength={80}
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </div>
        </div>

        <div className="staff-form-row">
          <div className="staff-form-group">
            <label className="staff-field-label" htmlFor="enroll-kind">
              Loại tài khoản
            </label>
            <select
              id="enroll-kind"
              className="staff-select"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as AccountKind })}
            >
              <option value="student">Sinh viên (SV)</option>
              <option value="lecturer">Giảng viên (GV)</option>
              <option value="staff">Cán bộ (CB)</option>
            </select>
          </div>
          {form.kind === "student" ? (
            <div className="staff-form-group">
              <label className="staff-field-label" htmlFor="enroll-cohort">
                Khóa (2 số cuối năm nhập học) <span className="req">*</span>
              </label>
              <input
                id="enroll-cohort"
                className="staff-input"
                inputMode="numeric"
                pattern="[0-9]{2}"
                maxLength={2}
                value={form.cohort}
                onChange={(e) =>
                  setForm({ ...form, cohort: e.target.value.replace(/[^0-9]/g, "") })
                }
                required
              />
            </div>
          ) : (
            <div className="staff-form-group">
              <label className="staff-field-label" htmlFor="enroll-rank">
                Học vị / Chức vụ
              </label>
              <select
                id="enroll-rank"
                className="staff-select"
                value={form.rank}
                onChange={(e) => setForm({ ...form, rank: e.target.value })}
              >
                {Object.entries(rankLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {form.kind !== "student" && unit?.kind === "faculty" && (
          <div className="staff-form-group">
            <label className="staff-field-label" htmlFor="enroll-department">
              Bộ môn trực thuộc
            </label>
            <select
              id="enroll-department"
              className="staff-select"
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
          </div>
        )}

        <div className="staff-code-hint" role="status">
          <Icon name="info" size={16} className="staff-code-hint-icon" />
          <div className="staff-code-hint-text">
            {!unit ? (
              <span>
                Chọn khoa / phòng ban: mã số sẽ được cấp tự động theo mã định danh của đơn vị.
              </span>
            ) : !unit.idPrefix ? (
              <span className="is-warning">
                Đơn vị chưa có mã định danh 2 số: đặt ở tab <strong>Khoa & Phòng ban</strong> (nút
                Sửa) rồi mới cấp được mã số.
              </span>
            ) : nextCode ? (
              <span>
                Mã số sẽ cấp: <code className="staff-code-pill">{nextCode}</code>{" "}
                <span className="staff-code-sub">
                  (tài khoản đã có mã đúng mẫu của đơn vị thì giữ nguyên)
                </span>
              </span>
            ) : (
              <span>Đang lấy mã số…</span>
            )}
          </div>
        </div>

        <div className="staff-form-actions">
          <button type="submit" className="staff-submit-btn" disabled={!unit?.idPrefix}>
            <Icon name="check" size={16} />
            <span>Tạo tài khoản</span>
          </button>
        </div>

        {saved && (
          <div className="staff-saved-alert" role="status">
            <Icon name="check" size={18} className="staff-saved-icon" />
            <div className="staff-saved-body">
              <div className="staff-saved-title">
                {saved.status === "created"
                  ? "Đã tạo tài khoản mới thành công!"
                  : "Đã chuyển tài khoản vào đơn vị thành công!"}
              </div>
              <div className="staff-saved-grid">
                <div>
                  Email: <strong>{saved.email}</strong>
                </div>
                <div>
                  Mã số: <code className="staff-code-pill">{saved.userCode}</code>
                </div>
                {saved.extension && (
                  <div>
                    Máy lẻ Softphone: <strong>{saved.extension}</strong>
                  </div>
                )}
                {saved.password ? (
                  <div className="staff-saved-pwd">
                    <span>
                      Mật khẩu: <code className="staff-code-pill">{saved.password}</code>
                    </span>
                    <button
                      type="button"
                      className="staff-copy-btn"
                      onClick={() => void navigator.clipboard.writeText(saved.password!)}
                    >
                      <Icon name="copy" size={13} />
                      Sao chép
                    </button>
                    <span className="staff-pwd-warning">(chỉ hiện một lần)</span>
                  </div>
                ) : (
                  <span>(tài khoản đã có, giữ nguyên mật khẩu cũ)</span>
                )}
              </div>
              {saved.phoneWarning && (
                <div style={{ color: "#b45309", marginTop: 4 }}>{saved.phoneWarning}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
