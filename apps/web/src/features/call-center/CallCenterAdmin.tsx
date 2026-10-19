import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { CcDepartment, CcExtension, CcHotline } from "@doan/shared";
import { Badge, Button, Field, Modal } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;
type Notify = (title: string, description?: string, tone?: "success" | "info" | "warning") => void;

const OFFICE_HOURS = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opens: "07:30", closes: "17:00" }));
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const form = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  const target = event.currentTarget;
  return { values: Object.fromEntries(new FormData(target)) as Record<string, string>, reset: () => target.reset() };
};

/** NT-2 / CC-2: departments, members, extensions and the hotline IVR, for system admins. */
export function CallCenterAdmin({ api, fail, notify, onChanged }: { api: Api; fail: (error: unknown) => void; notify: Notify; onChanged: () => void }) {
  const [departments, setDepartments] = useState<CcDepartment[]>([]);
  const [extensions, setExtensions] = useState<CcExtension[]>([]);
  const [hotlines, setHotlines] = useState<CcHotline[]>([]);
  const [secret, setSecret] = useState<{ number: string; secret: string } | null>(null);
  const [courses, setCourses] = useState<{ id: string; code: string; title: string }[]>([]);

  const load = useCallback(() => {
    api<CcDepartment[]>("departments").then(setDepartments, fail);
    api<CcExtension[]>("extensions").then(setExtensions, fail);
    api<CcHotline[]>("hotlines").then(setHotlines, fail);
    api<{ id: string; code: string; title: string }[]>("training-courses").then(setCourses, fail);
  }, [api, fail]);
  useEffect(load, [load]);
  const run = (request: Promise<unknown>, done?: string) =>
    request.then(() => {
      if (done) notify("Tổng đài", done, "success");
      load();
      onChanged();
    }, fail);
  const nameOf = (id: string | null) => departments.find((department) => department.id === id)?.name ?? "—";

  return (
    <div className="desk-admin">
      <section className="callcenter-panel">
        <div className="callcenter-panel__head">
          <h2 className="callcenter-panel__title"><Icon name="building" size={18} /><span>Phòng ban tổng đài</span></h2>
        </div>
        {departments.map((department) => (
          <div key={department.id} className="desk-admin__card">
            <div className="desk-admin__row">
              <strong>{department.name}</strong>
              <span className="desk-muted">{department.code} · máy lẻ {department.extensionFrom}–{department.extensionTo}</span>
              {!department.active && <Badge tone="amber">Tạm ngưng</Badge>}
            </div>
            <div className="desk-admin__row">
              <select
                aria-label="Chiến lược phân phối"
                value={department.strategy}
                onChange={(event) => run(api(`departments/${department.id}`, "PATCH", { strategy: event.target.value }))}
              >
                <option value="longest_idle">Rảnh lâu nhất</option>
                <option value="round_robin">Xoay vòng</option>
              </select>
              <span className="desk-muted">Đổ chuông {department.ringSeconds}s · chờ tối đa {department.maxWaitSeconds}s · hoàn tất {department.wrapUpSeconds}s</span>
              <Button size="sm" variant="ghost" onClick={() => run(api(`departments/${department.id}`, "PATCH", { active: !department.active }))}>
                {department.active ? "Tạm ngưng" : "Kích hoạt"}
              </Button>
            </div>
            <div className="desk-admin__row">
              <span className="desk-muted">
                Giờ làm việc: {department.hours.length ? department.hours.map((hour) => `${WEEKDAYS[hour.weekday]} ${hour.opens}–${hour.closes}`).join(", ") : "luôn mở"}
              </span>
              <Button size="sm" variant="ghost" onClick={() => run(api(`departments/${department.id}/hours`, "POST", { hours: OFFICE_HOURS }))}>Giờ hành chính</Button>
              <Button size="sm" variant="ghost" onClick={() => run(api(`departments/${department.id}/hours`, "POST", { hours: [] }))}>Luôn mở</Button>
            </div>
            <div className="desk-admin__row">
              {/* LT-4 / E2: e-learning courses that gate and coach the department's agents. */}
              <label className="desk-muted">
                Khóa bắt buộc trước khi trực{" "}
                <select
                  aria-label="Khóa đào tạo bắt buộc"
                  value={department.trainingCourseId ?? ""}
                  onChange={(event) => run(api(`departments/${department.id}`, "PATCH", { trainingCourseId: event.target.value || null }), "Đã cập nhật khóa bắt buộc.")}
                >
                  <option value="">Không yêu cầu</option>
                  {courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}
                </select>
              </label>
              <label className="desk-muted">
                Khóa bồi dưỡng khi điểm QA dưới{" "}
                <input
                  type="number"
                  min={0}
                  max={100}
                  defaultValue={department.qaThreshold}
                  aria-label="Ngưỡng điểm chất lượng (%)"
                  style={{ width: 64 }}
                  onBlur={(event) => Number(event.target.value) !== department.qaThreshold && run(api(`departments/${department.id}`, "PATCH", { qaThreshold: Number(event.target.value) }))}
                />
                %{" "}
                <select
                  aria-label="Khóa bồi dưỡng"
                  value={department.coachingCourseId ?? ""}
                  onChange={(event) => run(api(`departments/${department.id}`, "PATCH", { coachingCourseId: event.target.value || null }), "Đã cập nhật khóa bồi dưỡng.")}
                >
                  <option value="">Không gán tự động</option>
                  {courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}
                </select>
              </label>
            </div>
            <div className="desk-admin__members">
              {department.members.map((member) => (
                <span key={`${member.userId}-${member.role}`} className="desk-chip">
                  {member.displayName} · {member.role === "supervisor" ? "giám sát" : "tổng đài viên"}
                  <button
                    type="button"
                    aria-label={`Gỡ ${member.displayName}`}
                    onClick={() => run(api(`departments/${department.id}/members/${member.userId}?role=${member.role}`, "DELETE"))}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
            </div>
            <form
              className="desk-admin__inline"
              onSubmit={(event) => {
                const { values, reset } = form(event);
                void run(api(`departments/${department.id}/members`, "POST", values), "Đã thêm thành viên.").then(reset);
              }}
            >
              <input name="email" type="email" required placeholder="Email người dùng" aria-label="Email người dùng" />
              <select name="role" aria-label="Vai trò">
                <option value="agent">Tổng đài viên</option>
                <option value="supervisor">Giám sát</option>
              </select>
              <Button size="sm" type="submit" icon="user-plus">Thêm</Button>
            </form>
          </div>
        ))}
        <form
          className="desk-admin__inline"
          onSubmit={(event) => {
            const { values, reset } = form(event);
            void run(
              api("departments", "POST", { ...values, extensionFrom: Number(values.extensionFrom), extensionTo: Number(values.extensionTo) }),
              "Đã tạo phòng ban.",
            ).then(reset);
          }}
        >
          <input name="code" required placeholder="Mã (VD: CC_TC)" pattern="[A-Z0-9_\-]{2,20}" aria-label="Mã phòng ban" />
          <input name="name" required placeholder="Tên phòng ban" aria-label="Tên phòng ban" />
          <input name="extensionFrom" type="number" required min={100} placeholder="Máy lẻ từ" aria-label="Máy lẻ từ" />
          <input name="extensionTo" type="number" required min={100} placeholder="đến" aria-label="Máy lẻ đến" />
          <Button size="sm" type="submit" icon="plus">Tạo phòng ban</Button>
        </form>
      </section>

      <section className="callcenter-panel">
        <div className="callcenter-panel__head">
          <h2 className="callcenter-panel__title"><Icon name="phone" size={18} /><span>Máy lẻ</span></h2>
        </div>
        <div className="cdr-table-wrapper">
          <table className="cdr-table">
            <thead><tr><th>Số</th><th>Phòng ban</th><th>Người dùng</th><th>Loại</th><th>Asterisk</th><th /></tr></thead>
            <tbody>
              {extensions.map((extension) => (
                <tr key={extension.id}>
                  <td><strong>{extension.number}</strong></td>
                  <td>{nameOf(extension.departmentId)}</td>
                  <td>{extension.userName || extension.label || "—"}</td>
                  <td>{extension.transport === "webrtc" ? "Trình duyệt" : "Softphone SIP"}</td>
                  <td>{!extension.active ? <Badge>Tắt</Badge> : extension.syncedAt ? <Badge tone="green">Đã đồng bộ</Badge> : <Badge tone="amber">Chưa đồng bộ</Badge>}</td>
                  <td className="desk-admin__actions">
                    <Button size="sm" variant="ghost" onClick={() => api<{ secret: string }>(`extensions/${extension.id}/reset-secret`, "POST").then((result) => setSecret({ number: extension.number, secret: result.secret }), fail)}>
                      Đổi mật khẩu
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => run(api(`extensions/${extension.id}`, "PATCH", { active: !extension.active }))}>
                      {extension.active ? "Tắt" : "Bật"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => window.confirm(`Xóa máy lẻ ${extension.number}?`) && run(api(`extensions/${extension.id}`, "DELETE"), "Đã xóa máy lẻ.")}>
                      Xóa
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ExtensionForm departments={departments} onCreate={(body) => api<{ extension: CcExtension; secret: string }>("extensions", "POST", body).then((result) => {
          setSecret({ number: result.extension.number, secret: result.secret });
          load();
          onChanged();
        }, fail)} />
      </section>

      <section className="callcenter-panel">
        <div className="callcenter-panel__head">
          <h2 className="callcenter-panel__title"><Icon name="phone-call" size={18} /><span>Đường dây nóng & IVR</span></h2>
        </div>
        {hotlines.map((hotline) => (
          <HotlineForm key={hotline.id} hotline={hotline} departments={departments} onSave={(body) => run(api(`hotlines/${hotline.id}`, "PATCH", body), "Đã lưu đường dây nóng.")} />
        ))}
        {!hotlines.length && <HotlineForm hotline={null} departments={departments} onSave={(body) => run(api("hotlines", "POST", body), "Đã tạo đường dây nóng.")} />}
      </section>

      {secret && (
        <Modal title={`Mật khẩu SIP máy lẻ ${secret.number}`} eyebrow="Chỉ hiển thị một lần" onClose={() => setSecret(null)}>
          <p className="desk-muted">
            Trình duyệt của tổng đài viên tự lấy mật khẩu này khi vào tổng đài. Chỉ cần lưu lại nếu dùng softphone ngoài (Zoiper, Linphone).
          </p>
          <code className="desk-secret">{secret.secret}</code>
        </Modal>
      )}
    </div>
  );
}

function ExtensionForm({ departments, onCreate }: { departments: CcDepartment[]; onCreate: (body: object) => void }) {
  const [departmentId, setDepartmentId] = useState("");
  const department = departments.find((item) => item.id === departmentId) ?? departments[0];
  return (
    <form
      className="desk-admin__inline"
      onSubmit={(event) => {
        const { values } = form(event);
        onCreate({ departmentId: department.id, userId: values.userId || null, transport: values.transport, number: values.number || undefined, label: values.label });
      }}
    >
      <select aria-label="Phòng ban" value={department?.id ?? ""} onChange={(event) => setDepartmentId(event.target.value)}>
        {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      <select name="userId" aria-label="Người dùng">
        <option value="">— Chưa gán —</option>
        {department?.members.filter((member, index, all) => all.findIndex((item) => item.userId === member.userId) === index).map((member) => (
          <option key={member.userId} value={member.userId}>{member.displayName}</option>
        ))}
      </select>
      <select name="transport" aria-label="Loại máy lẻ">
        <option value="webrtc">Trình duyệt (WebRTC)</option>
        <option value="sip">Softphone SIP</option>
      </select>
      <input name="number" placeholder="Số (tự cấp nếu trống)" inputMode="numeric" aria-label="Số máy lẻ" />
      <input name="label" placeholder="Nhãn" maxLength={80} aria-label="Nhãn" />
      <Button size="sm" type="submit" icon="plus" disabled={!department}>Cấp máy lẻ</Button>
    </form>
  );
}

function HotlineForm({ hotline, departments, onSave }: { hotline: CcHotline | null; departments: CcDepartment[]; onSave: (body: object) => void }) {
  const [options, setOptions] = useState(hotline?.options ?? []);
  useEffect(() => setOptions(hotline?.options ?? []), [hotline]);
  const departmentSelect = (value: string, onChange: (value: string) => void, label: string) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </select>
  );
  return (
    <form
      className="desk-admin__card"
      onSubmit={(event) => {
        const { values } = form(event);
        onSave({ number: values.number, name: values.name, fallbackDepartmentId: values.fallbackDepartmentId || null, active: true, options });
      }}
    >
      <div className="desk-admin__inline">
        <Field label="Số đường dây"><input name="number" required defaultValue={hotline?.number} pattern="\+?[0-9]{3,15}" /></Field>
        <Field label="Tên"><input name="name" required defaultValue={hotline?.name} /></Field>
        <Field label="Phòng ban mặc định">
          <select name="fallbackDepartmentId" defaultValue={hotline?.fallbackDepartmentId ?? ""}>
            <option value="">—</option>
            {departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="desk-admin__members">
        {options.map((option, index) => (
          <span key={index} className="desk-chip">
            Phím
            <select aria-label="Phím" value={option.digit} onChange={(event) => setOptions(options.map((item, i) => (i === index ? { ...item, digit: event.target.value } : item)))}>
              {"0123456789".split("").map((digit) => <option key={digit}>{digit}</option>)}
            </select>
            →
            {departmentSelect(option.departmentId, (value) => setOptions(options.map((item, i) => (i === index ? { ...item, departmentId: value } : item))), "Phòng ban của phím")}
            <button type="button" aria-label="Xóa phím" onClick={() => setOptions(options.filter((_, i) => i !== index))}><Icon name="x" size={12} /></button>
          </span>
        ))}
        <Button size="sm" variant="ghost" icon="plus" disabled={!departments.length} onClick={() => setOptions([...options, { digit: String(options.length + 1), departmentId: departments[0].id }])}>
          Thêm phím IVR
        </Button>
      </div>
      <div className="desk-actions"><Button size="sm" type="submit" icon="check">Lưu</Button></div>
    </form>
  );
}
