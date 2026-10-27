import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Modal } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { academicApi, rankLabel, type AcademicProfile, type DepartmentUnit } from "./api";
import "./admin.css";

type Run = <T>(label: string, action: () => Promise<T>) => Promise<T | undefined>;

interface StaffRow {
  userId: string;
  displayName: string;
  email: string;
  staffCode: string;
  rank: string | null;
  active: boolean;
  departmentCode: string | null;
}

type Unit = AcademicProfile["units"][number];

interface Props {
  token: string;
  run: Run;
  units: Unit[];
  onUnitCreated: (unit: Unit) => void;
}

interface FormState {
  name: string;
  kind: "office" | "faculty";
  code: string;
  idPrefix: string;
}

const DEFAULT_FORM: FormState = {
  name: "",
  kind: "office",
  code: "",
  idPrefix: "",
};

export function FacultyPanel({ token, run, onUnitCreated }: Props) {
  const [departments, setDepartments] = useState<DepartmentUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

  // Modal create/edit
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<DepartmentUnit | null>(null);
  const [formData, setFormData] = useState<FormState>(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);

  const loadDepartments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await academicApi<DepartmentUnit[]>(token, "units");
      setDepartments(res || []);
      if (!selectedUnitId && res && res.length > 0) {
        setSelectedUnitId(res[0].id);
      }
    } catch {
      // Ignore or empty
    } finally {
      setLoading(false);
    }
  }, [token, selectedUnitId]);

  useEffect(() => {
    void loadDepartments();
  }, [loadDepartments]);

  const openCreateModal = () => {
    setEditingDept(null);
    setFormData(DEFAULT_FORM);
    setModalOpen(true);
  };

  const openEditModal = (dept: DepartmentUnit) => {
    setEditingDept(dept);
    setFormData({
      name: dept.name,
      kind: dept.kind,
      code: dept.code || "",
      idPrefix: dept.idPrefix || "",
    });
    setModalOpen(true);
  };

  const handleDelete = async (dept: DepartmentUnit) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa "${dept.name}" khỏi hệ thống?`)) {
      return;
    }
    const res = await run(`Đã xóa ${dept.name}`, () =>
      academicApi(token, `units/${dept.id}`, "DELETE"),
    );
    if (res) {
      if (selectedUnitId === dept.id) {
        setSelectedUnitId(null);
      }
      await loadDepartments();
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;

    setSubmitting(true);
    const payload = {
      name: formData.name.trim(),
      kind: formData.kind,
      code: formData.code.trim() ? formData.code.trim().toUpperCase() : null,
      // Blank on create: the server picks the next free one.
      idPrefix: formData.idPrefix.trim() || (editingDept ? null : undefined),
      // Every unit has the internal switchboard: the server keeps an existing máy lẻ range, else derives it from the mã định danh.
      enableFreePbx: true,
    };

    try {
      if (editingDept) {
        const updated = await run(`Đã cập nhật ${payload.name}`, () =>
          academicApi<DepartmentUnit>(token, `units/${editingDept.id}`, "PATCH", payload),
        );
        if (updated) {
          setModalOpen(false);
          await loadDepartments();
        }
      } else {
        const created = await run(`Đã tạo ${payload.name}`, () =>
          academicApi<DepartmentUnit>(token, "units", "POST", payload),
        );
        if (created) {
          setModalOpen(false);
          onUnitCreated({ id: created.id, code: created.code || "", name: created.name, idPrefix: created.idPrefix });
          setSelectedUnitId(created.id);
          await loadDepartments();
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const selectedDept = departments.find((d) => d.id === selectedUnitId);

  return (
    <section className="dept-panel">
      {/* 1. Header: Tiêu đề & Nút thêm */}
      <div className="dept-header">
        <h2 className="dept-title">Danh sách khoa / phòng ban</h2>
        <button type="button" className="dept-add-btn" onClick={openCreateModal}>
          <Icon name="plus" size={16} />
          <span>Thêm khoa / phòng ban</span>
        </button>
      </div>

      {/* 2. Bảng dữ liệu theo mẫu người dùng */}
      <div className="dept-table-wrapper">
        <table className="dept-table">
          <thead>
            <tr>
              <th>Tên khoa / phòng ban</th>
              <th>Mã số</th>
              <th>Mã định danh</th>
              <th>Khối</th>
              <th>Số tài khoản</th>
              <th style={{ textAlign: "right" }}>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 24, color: "var(--nexo-text-muted)" }}>
                  Đang tải danh sách khoa và phòng ban…
                </td>
              </tr>
            )}
            {!loading && departments.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 24, color: "var(--nexo-text-muted)" }}>
                  Chưa có khoa hoặc phòng ban nào được tạo.
                </td>
              </tr>
            )}
            {!loading &&
              departments.map((dept) => {
                const isSelected = dept.id === selectedUnitId;
                return (
                  <tr
                    key={dept.id}
                    className={isSelected ? "is-selected" : ""}
                    onClick={() => setSelectedUnitId(dept.id)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <strong>{dept.name}</strong>
                    </td>
                    <td>{dept.code || "–"}</td>
                    <td>{dept.idPrefix || "–"}</td>
                    <td>{dept.kind === "office" ? "Khối hành chính" : "Khối giảng dạy"}</td>
                    <td>{dept.staffCount}</td>
                    <td style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="dept-action-btn dept-action-edit"
                        onClick={() => openEditModal(dept)}
                      >
                        Sửa
                      </button>
                      <button
                        type="button"
                        className="dept-action-btn dept-action-delete"
                        onClick={() => handleDelete(dept)}
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* 3. Chi tiết nhân sự / giảng viên của đơn vị đang chọn */}
      {selectedDept && (
        <div style={{ marginTop: 28 }}>
          <StaffCard key={selectedDept.id} unit={selectedDept} token={token} run={run} />
        </div>
      )}

      {/* 4. Modal Thêm / Sửa khoa & phòng ban */}
      {modalOpen && (
        <Modal
          title={editingDept ? "Cập nhật khoa / phòng ban" : "Thêm khoa / phòng ban"}
          eyebrow="Quản lý cơ cấu tổ chức"
          onClose={() => setModalOpen(false)}
        >
          <form className="dept-modal-form" onSubmit={handleSubmit}>
            <div className="dept-form-group">
              <label htmlFor="dept-name">Tên khoa / phòng ban *</label>
              <input
                id="dept-name"
                type="text"
                required
                placeholder="VD: Khoa Công nghệ thông tin hoặc Phòng Đào tạo"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="dept-form-row">
              <div className="dept-form-group">
                <label htmlFor="dept-kind">Khối đơn vị *</label>
                <select
                  id="dept-kind"
                  value={formData.kind}
                  onChange={(e) =>
                    setFormData({ ...formData, kind: e.target.value as "office" | "faculty" })
                  }
                >
                  <option value="office">Khối hành chính (Phòng ban/Trung tâm)</option>
                  <option value="faculty">Khối giảng dạy (Khoa/Bộ môn)</option>
                </select>
              </div>

              <div className="dept-form-group">
                <label htmlFor="dept-code">Mã số (Viết tắt/Tiền tố)</label>
                <input
                  id="dept-code"
                  type="text"
                  placeholder="VD: 001 hoặc CNTT (để trống = –)"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="dept-form-group">
                <label htmlFor="dept-id-prefix">Mã định danh (2 số, đầu mã SV/GV/CB)</label>
                <input
                  id="dept-id-prefix"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{2}"
                  maxLength={2}
                  placeholder={formData.kind === "office" ? "50–99 (trống = tự chọn)" : "01–49 (trống = tự chọn)"}
                  value={formData.idPrefix}
                  onChange={(e) => setFormData({ ...formData, idPrefix: e.target.value.replace(/[^0-9]/g, "") })}
                />
              </div>
            </div>

            <div className="dept-modal-footer">
              <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
                Huỷ
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Đang xử lý…" : editingDept ? "Lưu thay đổi" : "Tạo đơn vị"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

function StaffCard({ unit, token, run }: { unit: DepartmentUnit; token: string; run: Run }) {
  const [revision, setRevision] = useState(0);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [departments, setDepartments] = useState<{ id: string; code: string; name: string }[]>([]);
  const [department, setDepartment] = useState({ code: "", name: "" });

  useEffect(() => {
    void academicApi<{ staff: StaffRow[]; departments: { id: string; code: string; name: string }[] }>(
      token,
      `units/${unit.id}/staff`,
    )
      .then((d) => {
        setStaff(d.staff || []);
        setDepartments(d.departments || []);
      })
      .catch(() => undefined);
  }, [token, unit.id, revision]);

  return (
    <div className="staff-panel-card">
      <div className="staff-panel-header">
        <div className="staff-panel-title-group">
          <div className="staff-panel-title-row">
            <h3 className="staff-panel-title">Tài khoản của {unit.name}</h3>
            <span className="staff-count-badge">{staff.length}</span>
          </div>
          <p className="staff-panel-sub">Sinh viên, giảng viên và cán bộ thuộc đơn vị, kèm mã số</p>
        </div>
        <div className="staff-panel-meta">
          <span className="dept-badge-unit">
            {unit.kind === "office" ? "Khối hành chính" : "Khối giảng dạy"}
          </span>
        </div>
      </div>

      <div className="staff-table-wrapper">
        <table className="staff-table">
          <thead>
            <tr>
              <th>Mã số</th>
              <th>Họ tên & Email</th>
              <th>Học vị / Chức vụ</th>
              <th>Bộ môn</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="staff-empty-state">
                    <div className="staff-empty-icon">
                      <Icon name="users" size={26} />
                    </div>
                    <p className="staff-empty-title">Chưa có tài khoản nào thuộc đơn vị này</p>
                    <p className="staff-empty-desc">
                      Tạo hoặc chuyển tài khoản vào đơn vị ở tab "Tạo tài khoản": hệ thống tự cấp mã số theo mã định danh của đơn vị.
                    </p>
                  </div>
                </td>
              </tr>
            ) : (
              staff.map((s) => (
                <tr key={s.userId}>
                  <td>
                    <strong style={{ fontFamily: "monospace", fontSize: 13, color: "#1e293b" }}>{s.staffCode}</strong>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600, color: "#0f172a" }}>{s.displayName}</div>
                    <small style={{ color: "#64748b", fontSize: 12 }}>{s.email}</small>
                  </td>
                  <td>
                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 4, background: "#f1f5f9", fontSize: 12.5, fontWeight: 500, color: "#334155" }}>
                      {s.rank ? rankLabel[s.rank] || s.rank : "—"}
                    </span>
                  </td>
                  <td>{s.departmentCode ?? "—"}</td>
                  <td>
                    {s.active ? (
                      <span className="dept-badge-created">
                        <span className="dept-dot" style={{ backgroundColor: "#10B981" }} />
                        Đang hoạt động
                      </span>
                    ) : (
                      <span className="dept-badge-uncreated">
                        <span className="dept-dot" style={{ backgroundColor: "#9CA3AF" }} />
                        Ngừng hoạt động
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="staff-forms-grid">
        {unit.kind === "faculty" && (
          <form
            className="staff-form-card"
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await run("Đã tạo bộ môn", () =>
                  academicApi(token, `units/${unit.id}/departments`, "POST", department),
                )
              ) {
                setDepartment({ code: "", name: "" });
                setRevision((n) => n + 1);
              }
            }}
          >
            <div className="staff-form-head">
              <div className="staff-form-head-icon" style={{ background: "#f0fdf4", color: "#16a34a" }}>
                <Icon name="building" size={18} />
              </div>
              <div>
                <h4>Bộ môn trực thuộc ({departments.length})</h4>
                <span style={{ fontSize: 12, color: "#64748b" }}>Các tổ / bộ môn của khoa</span>
              </div>
            </div>

            <div className="staff-form-body">
              {departments.length > 0 && (
                <ul className="staff-dept-list">
                  {departments.map((d) => (
                    <li key={d.id} className="staff-dept-pill">
                      <strong>{d.code}</strong> · {d.name}
                    </li>
                  ))}
                </ul>
              )}

              <div className="staff-form-row">
                <div className="staff-form-group">
                  <label className="staff-field-label">Mã bộ môn <span className="req">*</span></label>
                  <input
                    className="staff-input"
                    placeholder="VD: HTTT, KHMT"
                    value={department.code}
                    onChange={(e) => setDepartment({ ...department, code: e.target.value.toUpperCase() })}
                    required
                    aria-label="Mã bộ môn"
                  />
                </div>
                <div className="staff-form-group">
                  <label className="staff-field-label">Tên bộ môn <span className="req">*</span></label>
                  <input
                    className="staff-input"
                    placeholder="VD: Hệ thống thông tin"
                    value={department.name}
                    onChange={(e) => setDepartment({ ...department, name: e.target.value })}
                    required
                    aria-label="Tên bộ môn"
                  />
                </div>
              </div>

              <button type="submit" className="staff-submit-btn is-secondary">
                <Icon name="plus" size={16} />
                Thêm bộ môn
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
