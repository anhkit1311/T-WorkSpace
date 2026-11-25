import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { ConfirmDialog, Modal } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import { cn } from "../../shared/lib/utils";
import { academicApi, rankLabel, type AcademicProfile, type DepartmentUnit } from "./api";
import { extensionRange } from "./AccountForm";
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
  SEARCH,
  TABLE,
  TABLE_CARD,
  TINT,
} from "./ui";

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
const KINDS = [
  ["faculty", "Khối giảng dạy"],
  ["office", "Khối hành chính"],
] as const;

/** "Khoa & Phòng ban": units on the left, the picked one's departments and accounts on the right. */
export function FacultyPanel({ token, run, onUnitCreated }: Props) {
  const [departments, setDepartments] = useState<DepartmentUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<DepartmentUnit | null>(null);
  const [deleting, setDeleting] = useState<DepartmentUnit | null>(null);
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
    setDeleting(null);
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
          onUnitCreated({
            id: created.id,
            code: created.code || "",
            name: created.name,
            idPrefix: created.idPrefix,
          });
          setSelectedUnitId(created.id);
          await loadDepartments();
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const selectedDept = departments.find((d) => d.id === selectedUnitId);
  const q = query.trim().toLowerCase();
  const shown = departments.filter(
    (dept) => !q || [dept.name, dept.code, dept.idPrefix].some((v) => v?.toLowerCase().includes(q)),
  );

  return (
    <section
      className="grid min-w-0 items-start gap-4 min-[900px]:grid-cols-[320px_minmax(0,1fr)]"
      aria-label="Khoa & Phòng ban"
    >
      <nav
        className={cn(CARD, "grid min-w-0 gap-px p-1.5 min-[900px]:sticky min-[900px]:top-2")}
        aria-label="Đơn vị"
      >
        <div className="flex items-center gap-2 px-1.5 pt-1.5 pb-2">
          <b className="text-[15px]">Đơn vị</b>
          <span className={CHIP}>{departments.length}</span>
          <button type="button" className={cn(BTN, BTN_SM, "ml-auto")} onClick={openCreateModal}>
            <Icon name="plus" size={15} />
            Thêm
          </button>
        </div>
        <label className={cn(SEARCH, "mx-1 mb-1")}>
          <Icon name="search" size={15} />
          <input
            type="search"
            placeholder="Tìm đơn vị…"
            aria-label="Tìm đơn vị"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {loading && !departments.length && (
          <p className={cn(MUTED, "px-2 py-4")}>Đang tải danh sách khoa và phòng ban…</p>
        )}
        {!loading && !departments.length && (
          <p className={cn(MUTED, "px-2 py-4")}>Chưa có khoa hoặc phòng ban nào được tạo.</p>
        )}
        {KINDS.map(([kind, label]) => {
          const list = shown.filter((dept) => dept.kind === kind);
          if (!list.length) return null;
          return (
            <Fragment key={kind}>
              <p className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {label}
              </p>
              {list.map((dept) => {
                const active = dept.id === selectedUnitId;
                return (
                  <button
                    key={dept.id}
                    type="button"
                    className={cn(
                      "flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-[7px] text-left hover:bg-secondary",
                      active && "bg-secondary",
                    )}
                    aria-current={active || undefined}
                    onClick={() => setSelectedUnitId(dept.id)}
                  >
                    <span
                      className={cn(
                        "grid size-[30px] shrink-0 place-items-center rounded-[7px] bg-secondary font-mono text-xs font-semibold text-muted-foreground",
                        active && "bg-foreground text-background",
                      )}
                    >
                      {dept.idPrefix ?? "--"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <b
                        className={cn(
                          "block truncate text-[13.5px]",
                          active ? "font-semibold" : "font-medium",
                        )}
                      >
                        {dept.name}
                      </b>
                      <small className="block truncate text-[11.5px] text-muted-foreground">
                        {[dept.code, extensionRange(dept) && `máy lẻ ${extensionRange(dept)}`]
                          .filter(Boolean)
                          .join(" · ") || "Chưa có mã"}
                      </small>
                    </span>
                    <small
                      className={cn(
                        "min-w-6 rounded-full bg-secondary px-[7px] text-center text-[11.5px] font-semibold text-muted-foreground tabular-nums",
                        active && "bg-card",
                      )}
                    >
                      {dept.staffCount}
                    </small>
                  </button>
                );
              })}
            </Fragment>
          );
        })}
      </nav>

      {selectedDept ? (
        <UnitDetail
          key={selectedDept.id}
          unit={selectedDept}
          token={token}
          run={run}
          onEdit={() => openEditModal(selectedDept)}
          onDelete={() => setDeleting(selectedDept)}
        />
      ) : (
        <p className={cn(CARD, MUTED, "p-6 text-center")}>
          Chọn một đơn vị để xem bộ môn và tài khoản.
        </p>
      )}

      {modalOpen && (
        <Modal
          title={editingDept ? "Cập nhật khoa / phòng ban" : "Thêm khoa / phòng ban"}
          eyebrow="Quản lý cơ cấu tổ chức"
          onClose={() => setModalOpen(false)}
        >
          <form className="tw tw-form grid gap-3.5 text-sm" onSubmit={handleSubmit}>
            <label>
              Tên khoa / phòng ban *
              <input
                type="text"
                required
                placeholder="VD: Khoa Công nghệ thông tin hoặc Phòng Đào tạo"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label>
                Khối đơn vị *
                <select
                  value={formData.kind}
                  onChange={(e) =>
                    setFormData({ ...formData, kind: e.target.value as "office" | "faculty" })
                  }
                >
                  <option value="office">Khối hành chính (Phòng ban/Trung tâm)</option>
                  <option value="faculty">Khối giảng dạy (Khoa/Bộ môn)</option>
                </select>
              </label>
              <label>
                Mã số (Viết tắt/Tiền tố)
                <input
                  type="text"
                  placeholder="VD: 001 hoặc CNTT (để trống = –)"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                />
              </label>
              <label>
                Mã định danh (2 số, đầu mã SV/GV/CB)
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{2}"
                  maxLength={2}
                  placeholder={
                    formData.kind === "office"
                      ? "50–99 (trống = tự chọn)"
                      : "01–49 (trống = tự chọn)"
                  }
                  value={formData.idPrefix}
                  onChange={(e) =>
                    setFormData({ ...formData, idPrefix: e.target.value.replace(/[^0-9]/g, "") })
                  }
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className={BTN_GHOST} onClick={() => setModalOpen(false)}>
                Huỷ
              </button>
              <button type="submit" className={BTN} disabled={submitting}>
                {submitting ? "Đang xử lý…" : editingDept ? "Lưu thay đổi" : "Tạo đơn vị"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Xóa đơn vị"
          description={`Xóa "${deleting.name}" khỏi hệ thống?`}
          confirmLabel="Xóa"
          onClose={() => setDeleting(null)}
          onConfirm={() => void handleDelete(deleting)}
        />
      )}
    </section>
  );
}

function UnitDetail({
  unit,
  token,
  run,
  onEdit,
  onDelete,
}: {
  unit: DepartmentUnit;
  token: string;
  run: Run;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [departments, setDepartments] = useState<{ id: string; code: string; name: string }[]>([]);
  const [department, setDepartment] = useState({ code: "", name: "" });
  const [query, setQuery] = useState("");

  useEffect(() => {
    void academicApi<{
      staff: StaffRow[];
      departments: { id: string; code: string; name: string }[];
    }>(token, `units/${unit.id}/staff`)
      .then((d) => {
        setStaff(d.staff || []);
        setDepartments(d.departments || []);
      })
      .catch(() => undefined);
  }, [token, unit.id, revision]);

  const range = extensionRange(unit);
  const q = query.trim().toLowerCase();
  const shown = staff.filter(
    (s) => !q || [s.displayName, s.email, s.staffCode].some((v) => v.toLowerCase().includes(q)),
  );
  const facts: [string, string | number][] = [
    ["Tài khoản", staff.length],
    ["Đang hoạt động", staff.filter((s) => s.active).length],
    ["Bộ môn", unit.kind === "faculty" ? departments.length : "—"],
    ["Máy lẻ", range ?? "—"],
  ];

  return (
    <div className="grid min-w-0 gap-3.5">
      <section className={CARD} aria-label={unit.name}>
        <div className="flex flex-wrap items-start gap-3.5 p-4">
          <span className="grid size-[46px] shrink-0 place-items-center rounded-[11px] bg-foreground font-mono text-base font-bold text-background">
            {unit.idPrefix ?? "--"}
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold">{unit.name}</h2>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className={cn(CHIP, TINT.blue)}>
                {unit.kind === "office" ? "Khối hành chính" : "Khối giảng dạy"}
              </span>
              {unit.code && <span className={CHIP}>Mã {unit.code}</span>}
              <span className={CHIP}>Mã định danh {unit.idPrefix ?? "chưa đặt"}</span>
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <button type="button" className={cn(BTN_GHOST, BTN_SM)} onClick={onEdit}>
              <Icon name="edit" size={14} />
              Sửa
            </button>
            <button
              type="button"
              className={cn(BTN_GHOST, BTN_SM, "text-destructive")}
              onClick={onDelete}
            >
              <Icon name="trash" size={14} />
              Xoá
            </button>
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t min-[1150px]:grid-cols-4">
          {facts.map(([label, value], index) => (
            <div
              key={label}
              className={cn(
                "grid gap-0.5 px-4 py-3",
                index % 2 && "border-l",
                index > 1 && "border-t min-[1150px]:border-t-0",
                index === 2 && "min-[1150px]:border-l",
              )}
            >
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-lg font-bold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {unit.kind === "faculty" && (
        <section className={CARD} aria-label="Bộ môn trực thuộc">
          <div className={CARD_HEAD}>
            <h3 className={H3}>Bộ môn trực thuộc</h3>
            <span className={CHIP}>{departments.length}</span>
          </div>
          <div className="grid gap-2.5 px-4 py-3.5">
            {departments.length > 0 && (
              <ul className="flex list-none flex-wrap gap-1.5">
                {departments.map((d) => (
                  <li
                    key={d.id}
                    className="inline-flex items-center gap-1.5 rounded-[7px] border px-2.5 py-1 text-[13px]"
                  >
                    <b className="font-mono text-xs font-semibold text-muted-foreground">
                      {d.code}
                    </b>
                    {d.name}
                  </li>
                ))}
              </ul>
            )}
            <form
              className="tw-form grid gap-2 md:grid-cols-[140px_minmax(0,1fr)_auto]"
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
              <input
                placeholder="Mã, VD: HTTT"
                value={department.code}
                onChange={(e) =>
                  setDepartment({ ...department, code: e.target.value.toUpperCase() })
                }
                required
                aria-label="Mã bộ môn"
              />
              <input
                placeholder="Tên bộ môn, VD: Hệ thống thông tin"
                value={department.name}
                onChange={(e) => setDepartment({ ...department, name: e.target.value })}
                required
                aria-label="Tên bộ môn"
              />
              <button type="submit" className={BTN_GHOST}>
                <Icon name="plus" size={15} />
                Thêm bộ môn
              </button>
            </form>
          </div>
        </section>
      )}

      <section className={TABLE_CARD} aria-label={`Tài khoản của ${unit.name}`}>
        <div className={CARD_HEAD}>
          <h3 className={H3}>Tài khoản thuộc đơn vị</h3>
          <span className={CHIP}>{staff.length}</span>
          <label className={cn(SEARCH, "ml-auto w-60 max-md:ml-0 max-md:w-full")}>
            <Icon name="search" size={15} />
            <input
              type="search"
              placeholder="Tìm trong đơn vị…"
              aria-label="Tìm tài khoản trong đơn vị"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col">Mã số</th>
                <th scope="col">Họ tên</th>
                <th scope="col" className="max-md:hidden">
                  Học vị
                </th>
                <th scope="col" className="max-md:hidden">
                  Bộ môn
                </th>
                <th scope="col">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {!shown.length && (
                <tr>
                  <td colSpan={5} className={cn(MUTED, "px-4 py-8 text-center")}>
                    {staff.length
                      ? "Không có tài khoản khớp."
                      : 'Chưa có tài khoản nào thuộc đơn vị này. Tạo hoặc chuyển tài khoản vào ở tab "Tạo tài khoản": hệ thống tự cấp mã số theo mã định danh của đơn vị.'}
                  </td>
                </tr>
              )}
              {shown.map((s) => (
                <tr key={s.userId}>
                  <td>
                    <code className={CODE}>{s.staffCode}</code>
                  </td>
                  <td className="max-w-0 min-w-[200px]">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <UserAvatar name={s.displayName} />
                      <span className="min-w-0">
                        <b className="block truncate font-semibold">{s.displayName}</b>
                        <small className="block truncate text-xs text-muted-foreground">
                          {s.email}
                        </small>
                      </span>
                    </span>
                  </td>
                  <td className="max-md:hidden">
                    {s.rank ? (
                      <span
                        className={cn(
                          "rounded-[5px] px-[7px] py-px text-[11.5px] font-semibold",
                          s.rank === "ths" || s.rank === "cn"
                            ? "bg-secondary text-muted-foreground"
                            : TINT.blue,
                        )}
                      >
                        {rankLabel[s.rank] || s.rank}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="max-md:hidden">{s.departmentCode ?? "—"}</td>
                  <td>
                    <span className={cn(CHIP, s.active && TINT.green)}>
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          s.active ? "bg-emerald-500" : "bg-border",
                        )}
                      />
                      {s.active ? "Đang hoạt động" : "Ngừng"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
