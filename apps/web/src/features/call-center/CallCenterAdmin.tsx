import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { CcDepartment, CcExtension, CcHotline } from "@doan/shared";
import { ConfirmDialog, Modal } from "../../shared/ui/Primitives";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { cn } from "../../shared/lib/utils";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  CHIP,
  FIELD,
  ICON_BTN,
  MUTED,
  PANEL,
  PANEL_HEAD,
  TABLE,
  TINT,
} from "./ui";

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;
type Notify = (title: string, description?: string, tone?: "success" | "info" | "warning") => void;

const OFFICE_HOURS = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  opens: "07:30",
  closes: "17:00",
}));
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const SM = "h-[30px]! px-2.5 text-[12.5px]";
const LABEL = "grid! min-w-0 gap-1 text-xs! font-semibold text-muted-foreground!";
const SECTIONS: { id: "departments" | "extensions" | "hotlines"; label: string; icon: IconName }[] =
  [
    { id: "departments", label: "Phòng ban", icon: "building" },
    { id: "extensions", label: "Máy lẻ", icon: "phone" },
    { id: "hotlines", label: "Đường dây nóng & IVR", icon: "phone-call" },
  ];
const form = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  const target = event.currentTarget;
  return {
    values: Object.fromEntries(new FormData(target)) as Record<string, string>,
    reset: () => target.reset(),
  };
};

/** NT-2 / CC-2: departments, members, extensions and the hotline IVR, for system admins. */
export function CallCenterAdmin({
  api,
  fail,
  notify,
  onChanged,
}: {
  api: Api;
  fail: (error: unknown) => void;
  notify: Notify;
  onChanged: () => void;
}) {
  const [departments, setDepartments] = useState<CcDepartment[]>([]);
  const [extensions, setExtensions] = useState<CcExtension[]>([]);
  const [hotlines, setHotlines] = useState<CcHotline[]>([]);
  const [secret, setSecret] = useState<{ number: string; secret: string } | null>(null);
  const [removing, setRemoving] = useState<CcExtension | null>(null);
  const [courses, setCourses] = useState<{ id: string; code: string; title: string }[]>([]);
  const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>("departments");
  const [openId, setOpenId] = useState<string | null>(null);

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
  const nameOf = (id: string | null) =>
    departments.find((department) => department.id === id)?.name ?? "—";
  const counts = {
    departments: departments.length,
    extensions: extensions.length,
    hotlines: hotlines.length,
  };
  const open = departments.find((item) => item.id === openId) ?? departments[0];

  const courseSelect = (
    department: CcDepartment,
    field: "trainingCourseId" | "coachingCourseId",
    empty: string,
    done: string,
  ) => (
    <select
      className={FIELD}
      value={department[field] ?? ""}
      onChange={(event) =>
        run(
          api(`departments/${department.id}`, "PATCH", { [field]: event.target.value || null }),
          done,
        )
      }
    >
      <option value="">{empty}</option>
      {courses.map((course) => (
        <option key={course.id} value={course.id}>
          {course.code} — {course.title}
        </option>
      ))}
    </select>
  );

  return (
    <div className="tw tw-form grid min-w-0 items-start gap-4 text-sm text-foreground min-[1000px]:grid-cols-[220px_minmax(0,1fr)]">
      <nav
        aria-label="Mục cấu hình"
        className="grid gap-0.5 rounded-[10px] border bg-card p-1.5 min-[1000px]:sticky min-[1000px]:top-2"
      >
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={section === item.id || undefined}
            onClick={() => setSection(item.id)}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13.5px] text-muted-foreground hover:bg-secondary hover:text-foreground aria-[current]:bg-secondary aria-[current]:font-semibold aria-[current]:text-foreground"
          >
            <Icon name={item.icon} size={16} />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <small className="text-xs text-muted-foreground tabular-nums">{counts[item.id]}</small>
          </button>
        ))}
      </nav>

      <div className="grid min-w-0 gap-4">
        {section === "departments" && (
          <>
            {departments.map((department) => {
              const expanded = open?.id === department.id;
              const agents = department.members.filter((m) => m.role === "agent").length;
              return (
                <section key={department.id} className={PANEL}>
                  <div className={cn(PANEL_HEAD, !expanded && "border-b-0")}>
                    <h3 className="text-[15px] font-semibold">{department.name}</h3>
                    <span className="rounded bg-secondary px-1.5 py-0.5 font-mono! text-xs text-muted-foreground">
                      {department.code}
                    </span>
                    <span
                      className={cn(
                        CHIP,
                        "px-2 py-0.5",
                        TINT[department.active ? "green" : "amber"],
                      )}
                    >
                      {department.active ? `${agents} tổng đài viên` : "Tạm ngưng"}
                    </span>
                    <span className={cn(MUTED, "text-xs")}>
                      máy lẻ {department.extensionFrom}–{department.extensionTo}
                    </span>
                    <button
                      type="button"
                      className={cn(BTN_GHOST, SM, "ml-auto")}
                      aria-expanded={expanded}
                      onClick={() => setOpenId(expanded ? "" : department.id)}
                    >
                      {expanded ? "Thu gọn" : "Mở"}
                    </button>
                  </div>
                  {expanded && (
                    <div className="grid gap-3.5 px-4 py-3.5">
                      <div className="grid gap-3 min-[900px]:grid-cols-4">
                        <label className={LABEL}>
                          Chiến lược phân phối
                          <select
                            className={FIELD}
                            value={department.strategy}
                            onChange={(event) =>
                              run(
                                api(`departments/${department.id}`, "PATCH", {
                                  strategy: event.target.value,
                                }),
                              )
                            }
                          >
                            <option value="longest_idle">Rảnh lâu nhất</option>
                            <option value="round_robin">Xoay vòng</option>
                          </select>
                        </label>
                        {/* LT-4 / E2: e-learning courses that gate and coach the department's agents. */}
                        <label className={LABEL}>
                          Khóa bắt buộc trước khi trực
                          {courseSelect(
                            department,
                            "trainingCourseId",
                            "Không yêu cầu",
                            "Đã cập nhật khóa bắt buộc.",
                          )}
                        </label>
                        <label className={LABEL}>
                          Ngưỡng điểm chất lượng (%)
                          <input
                            className={FIELD}
                            type="number"
                            min={0}
                            max={100}
                            defaultValue={department.qaThreshold}
                            onBlur={(event) =>
                              Number(event.target.value) !== department.qaThreshold &&
                              run(
                                api(`departments/${department.id}`, "PATCH", {
                                  qaThreshold: Number(event.target.value),
                                }),
                              )
                            }
                          />
                        </label>
                        <label className={LABEL}>
                          Khóa bồi dưỡng khi dưới ngưỡng
                          {courseSelect(
                            department,
                            "coachingCourseId",
                            "Không gán tự động",
                            "Đã cập nhật khóa bồi dưỡng.",
                          )}
                        </label>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-[13px]">
                        <Icon name="clock" size={14} className="text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          {department.hours.length
                            ? department.hours
                                .map(
                                  (hour) =>
                                    `${WEEKDAYS[hour.weekday]} ${hour.opens}–${hour.closes}`,
                                )
                                .join(", ")
                            : "Luôn mở"}{" "}
                          <span className="text-muted-foreground">
                            · đổ chuông {department.ringSeconds}s · chờ tối đa{" "}
                            {department.maxWaitSeconds}s · hoàn tất {department.wrapUpSeconds}s
                          </span>
                        </span>
                        <button
                          type="button"
                          className={cn(BTN_GHOST, SM)}
                          onClick={() =>
                            run(
                              api(`departments/${department.id}/hours`, "POST", {
                                hours: OFFICE_HOURS,
                              }),
                            )
                          }
                        >
                          Giờ hành chính
                        </button>
                        <button
                          type="button"
                          className={cn(BTN_GHOST, SM)}
                          onClick={() =>
                            run(api(`departments/${department.id}/hours`, "POST", { hours: [] }))
                          }
                        >
                          Luôn mở
                        </button>
                        <button
                          type="button"
                          className={cn(BTN_GHOST, SM)}
                          onClick={() =>
                            run(
                              api(`departments/${department.id}`, "PATCH", {
                                active: !department.active,
                              }),
                            )
                          }
                        >
                          {department.active ? "Tạm ngưng" : "Kích hoạt"}
                        </button>
                      </div>
                      <div className="overflow-x-auto rounded-lg border">
                        <table className={TABLE}>
                          <thead>
                            <tr>
                              <th>Người dùng</th>
                              <th>Vai trò</th>
                              <th>Máy lẻ</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {department.members.map((member) => (
                              <tr key={`${member.userId}-${member.role}`}>
                                <td className="font-semibold">{member.displayName}</td>
                                <td>
                                  <span
                                    className={cn(
                                      CHIP,
                                      "px-2 py-0.5",
                                      TINT[member.role === "supervisor" ? "blue" : "neutral"],
                                    )}
                                  >
                                    {member.role === "supervisor" ? "Giám sát" : "Tổng đài viên"}
                                  </span>
                                </td>
                                <td className="font-mono! text-[13px]">
                                  {extensions
                                    .filter((item) => item.userId === member.userId)
                                    .map((item) => item.number)
                                    .join(", ") || "—"}
                                </td>
                                <td className="text-right">
                                  <button
                                    type="button"
                                    className={cn(BTN_GHOST, SM)}
                                    aria-label={`Gỡ ${member.displayName}`}
                                    onClick={() =>
                                      run(
                                        api(
                                          `departments/${department.id}/members/${member.userId}?role=${member.role}`,
                                          "DELETE",
                                        ),
                                      )
                                    }
                                  >
                                    Gỡ
                                  </button>
                                </td>
                              </tr>
                            ))}
                            {!department.members.length && (
                              <tr>
                                <td colSpan={4} className="text-center text-muted-foreground">
                                  Chưa có thành viên.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <form
                        className="flex flex-wrap gap-2"
                        onSubmit={(event) => {
                          const { values, reset } = form(event);
                          void run(
                            api(`departments/${department.id}/members`, "POST", values),
                            "Đã thêm thành viên.",
                          ).then(reset);
                        }}
                      >
                        <input
                          className={cn(FIELD, "min-w-[200px] flex-1")}
                          name="email"
                          type="email"
                          required
                          placeholder="Email người dùng"
                          aria-label="Email người dùng"
                        />
                        <select className={cn(FIELD, "w-max!")} name="role" aria-label="Vai trò">
                          <option value="agent">Tổng đài viên</option>
                          <option value="supervisor">Giám sát</option>
                        </select>
                        <button type="submit" className={BTN_PRIMARY}>
                          <Icon name="user-plus" size={15} />
                          Thêm
                        </button>
                      </form>
                    </div>
                  )}
                </section>
              );
            })}
            <section className={PANEL}>
              <div className={PANEL_HEAD}>
                <h2 className="text-[15px] font-semibold">Thêm phòng ban</h2>
              </div>
              <form
                className="flex flex-wrap gap-2 px-4 py-3.5"
                onSubmit={(event) => {
                  const { values, reset } = form(event);
                  void run(
                    api("departments", "POST", {
                      ...values,
                      extensionFrom: Number(values.extensionFrom),
                      extensionTo: Number(values.extensionTo),
                    }),
                    "Đã tạo phòng ban.",
                  ).then(reset);
                }}
              >
                <input
                  className={cn(FIELD, "w-[150px]!")}
                  name="code"
                  required
                  placeholder="Mã (VD: CC_TC)"
                  pattern="[A-Z0-9_\-]{2,20}"
                  aria-label="Mã phòng ban"
                />
                <input
                  className={cn(FIELD, "min-w-[180px] flex-1")}
                  name="name"
                  required
                  placeholder="Tên phòng ban"
                  aria-label="Tên phòng ban"
                />
                <input
                  className={cn(FIELD, "w-[110px]!")}
                  name="extensionFrom"
                  type="number"
                  required
                  min={100}
                  placeholder="Máy lẻ từ"
                  aria-label="Máy lẻ từ"
                />
                <input
                  className={cn(FIELD, "w-[110px]!")}
                  name="extensionTo"
                  type="number"
                  required
                  min={100}
                  placeholder="đến"
                  aria-label="Máy lẻ đến"
                />
                <button type="submit" className={BTN_PRIMARY}>
                  <Icon name="plus" size={15} />
                  Tạo phòng ban
                </button>
              </form>
            </section>
          </>
        )}

        {section === "extensions" && (
          <section className={PANEL}>
            <div className={PANEL_HEAD}>
              <h2 className="text-[15px] font-semibold">Máy lẻ</h2>
            </div>
            <div className="overflow-x-auto">
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th>Số</th>
                    <th>Phòng ban</th>
                    <th>Người dùng</th>
                    <th>Loại</th>
                    <th title="BR-20: được gọi số ngoài trường qua SIP trunk">Gọi ra ngoài</th>
                    <th>Asterisk</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {extensions.map((extension) => (
                    <tr key={extension.id}>
                      <td className="font-mono! font-semibold">{extension.number}</td>
                      <td>{nameOf(extension.departmentId)}</td>
                      <td>{extension.userName || extension.label || "—"}</td>
                      <td>{extension.transport === "webrtc" ? "Trình duyệt" : "Softphone SIP"}</td>
                      <td>
                        <label className="inline-flex! cursor-pointer items-center gap-2 text-[13px]! text-foreground!">
                          <input
                            type="checkbox"
                            checked={extension.canCallOut}
                            onChange={(event) =>
                              run(
                                api(`extensions/${extension.id}`, "PATCH", {
                                  active: extension.active,
                                  canCallOut: event.target.checked,
                                }),
                                event.target.checked
                                  ? `Máy lẻ ${extension.number} được gọi ra ngoài.`
                                  : `Đã chặn gọi ra ngoài từ ${extension.number}.`,
                              )
                            }
                          />
                          {extension.canCallOut ? "Được phép" : "Chặn"}
                        </label>
                      </td>
                      <td>
                        <span
                          className={cn(
                            CHIP,
                            "px-2 py-0.5",
                            TINT[
                              !extension.active ? "neutral" : extension.syncedAt ? "green" : "amber"
                            ],
                          )}
                        >
                          {!extension.active
                            ? "Tắt"
                            : extension.syncedAt
                              ? "Đã đồng bộ"
                              : "Chưa đồng bộ"}
                        </span>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            className={cn(BTN_GHOST, SM)}
                            onClick={() =>
                              api<{ secret: string }>(
                                `extensions/${extension.id}/reset-secret`,
                                "POST",
                              ).then(
                                (result) =>
                                  setSecret({ number: extension.number, secret: result.secret }),
                                fail,
                              )
                            }
                          >
                            Đổi mật khẩu
                          </button>
                          <button
                            type="button"
                            className={cn(BTN_GHOST, SM)}
                            onClick={() =>
                              run(
                                api(`extensions/${extension.id}`, "PATCH", {
                                  active: !extension.active,
                                }),
                              )
                            }
                          >
                            {extension.active ? "Tắt" : "Bật"}
                          </button>
                          <button
                            type="button"
                            className={cn(BTN_GHOST, SM, "text-destructive")}
                            onClick={() => setRemoving(extension)}
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ExtensionForm
              departments={departments}
              onCreate={(body) =>
                api<{ extension: CcExtension; secret: string }>("extensions", "POST", body).then(
                  (result) => {
                    setSecret({ number: result.extension.number, secret: result.secret });
                    load();
                    onChanged();
                  },
                  fail,
                )
              }
            />
          </section>
        )}

        {section === "hotlines" && (
          <>
            {hotlines.map((hotline) => (
              <HotlineForm
                key={hotline.id}
                hotline={hotline}
                departments={departments}
                onSave={(body) =>
                  run(api(`hotlines/${hotline.id}`, "PATCH", body), "Đã lưu đường dây nóng.")
                }
              />
            ))}
            {!hotlines.length && (
              <HotlineForm
                hotline={null}
                departments={departments}
                onSave={(body) => run(api("hotlines", "POST", body), "Đã tạo đường dây nóng.")}
              />
            )}
          </>
        )}
      </div>

      {secret && (
        <Modal
          title={`Mật khẩu SIP máy lẻ ${secret.number}`}
          eyebrow="Chỉ hiển thị một lần"
          onClose={() => setSecret(null)}
        >
          <div className="tw grid gap-3 text-sm">
            <p className={MUTED}>
              Trình duyệt của tổng đài viên tự lấy mật khẩu này khi vào tổng đài. Chỉ cần lưu lại
              nếu dùng softphone ngoài (Zoiper, Linphone).
            </p>
            <code className="rounded-lg bg-secondary px-3 py-2.5 font-mono! text-[15px] font-semibold break-all select-all">
              {secret.secret}
            </code>
          </div>
        </Modal>
      )}
      {removing && (
        <ConfirmDialog
          title="Xóa máy lẻ"
          description={`Xóa máy lẻ ${removing.number}? Tài khoản SIP của máy lẻ này sẽ ngừng hoạt động.`}
          confirmLabel="Xóa"
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            setRemoving(null);
            void run(api(`extensions/${removing.id}`, "DELETE"), "Đã xóa máy lẻ.");
          }}
        />
      )}
    </div>
  );
}

function ExtensionForm({
  departments,
  onCreate,
}: {
  departments: CcDepartment[];
  onCreate: (body: object) => void;
}) {
  const [departmentId, setDepartmentId] = useState("");
  const department = departments.find((item) => item.id === departmentId) ?? departments[0];
  return (
    <form
      className="flex flex-wrap gap-2 border-t bg-background px-4 py-3"
      onSubmit={(event) => {
        const { values } = form(event);
        onCreate({
          departmentId: department.id,
          userId: values.userId || null,
          transport: values.transport,
          number: values.number || undefined,
          label: values.label,
        });
      }}
    >
      <select
        className={cn(FIELD, "w-max!")}
        aria-label="Phòng ban"
        value={department?.id ?? ""}
        onChange={(event) => setDepartmentId(event.target.value)}
      >
        {departments.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <select className={cn(FIELD, "w-max!")} name="userId" aria-label="Người dùng">
        <option value="">— Chưa gán —</option>
        {department?.members
          .filter(
            (member, index, all) =>
              all.findIndex((item) => item.userId === member.userId) === index,
          )
          .map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.displayName}
            </option>
          ))}
      </select>
      <select className={cn(FIELD, "w-max!")} name="transport" aria-label="Loại máy lẻ">
        <option value="webrtc">Trình duyệt (WebRTC)</option>
        <option value="sip">Softphone SIP</option>
      </select>
      <input
        className={cn(FIELD, "w-[170px]!")}
        name="number"
        placeholder="Số (tự cấp nếu trống)"
        inputMode="numeric"
        aria-label="Số máy lẻ"
      />
      <input
        className={cn(FIELD, "min-w-[120px] flex-1")}
        name="label"
        placeholder="Nhãn"
        maxLength={80}
        aria-label="Nhãn"
      />
      <button type="submit" className={BTN_PRIMARY} disabled={!department}>
        <Icon name="plus" size={15} />
        Cấp máy lẻ
      </button>
    </form>
  );
}

function HotlineForm({
  hotline,
  departments,
  onSave,
}: {
  hotline: CcHotline | null;
  departments: CcDepartment[];
  onSave: (body: object) => void;
}) {
  const [options, setOptions] = useState(hotline?.options ?? []);
  useEffect(() => setOptions(hotline?.options ?? []), [hotline]);
  return (
    <form
      className={PANEL}
      onSubmit={(event) => {
        const { values } = form(event);
        onSave({
          number: values.number,
          name: values.name,
          fallbackDepartmentId: values.fallbackDepartmentId || null,
          active: true,
          options,
        });
      }}
    >
      <div className={PANEL_HEAD}>
        <h2 className="text-[15px] font-semibold">
          {hotline ? hotline.name : "Tạo đường dây nóng"}
        </h2>
        {hotline && (
          <span className={cn(CHIP, "px-2 py-0.5", TINT[hotline.active ? "green" : "neutral"])}>
            {hotline.active ? "Đang bật" : "Tắt"}
          </span>
        )}
        <button type="submit" className={cn(BTN_PRIMARY, SM, "ml-auto")}>
          <Icon name="check" size={14} />
          Lưu
        </button>
      </div>
      <div className="grid gap-3.5 px-4 py-3.5">
        <div className="grid gap-3 min-[800px]:grid-cols-3">
          <label className={LABEL}>
            Số đường dây
            <input
              className={FIELD}
              name="number"
              required
              defaultValue={hotline?.number}
              pattern="\+?[0-9]{3,15}"
            />
          </label>
          <label className={LABEL}>
            Tên
            <input className={FIELD} name="name" required defaultValue={hotline?.name} />
          </label>
          <label className={LABEL}>
            Phòng ban mặc định
            <select
              className={FIELD}
              name="fallbackDepartmentId"
              defaultValue={hotline?.fallbackDepartmentId ?? ""}
            >
              <option value="">—</option>
              {departments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Menu IVR</span>
          <div className="flex flex-wrap items-center gap-2">
            {options.map((option, index) => (
              <span
                key={index}
                className="inline-flex items-center gap-1.5 rounded-lg border bg-background py-1 pr-1 pl-2"
              >
                <select
                  className={cn(FIELD, "h-[28px]! w-max! font-mono! font-bold")}
                  aria-label="Phím"
                  value={option.digit}
                  onChange={(event) =>
                    setOptions(
                      options.map((item, i) =>
                        i === index ? { ...item, digit: event.target.value } : item,
                      ),
                    )
                  }
                >
                  {"0123456789".split("").map((digit) => (
                    <option key={digit}>{digit}</option>
                  ))}
                </select>
                <Icon name="arrow-right" size={13} className="text-muted-foreground" />
                <select
                  className={cn(FIELD, "h-[28px]! w-max!")}
                  aria-label="Phòng ban của phím"
                  value={option.departmentId}
                  onChange={(event) =>
                    setOptions(
                      options.map((item, i) =>
                        i === index ? { ...item, departmentId: event.target.value } : item,
                      ),
                    )
                  }
                >
                  {departments.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={cn(ICON_BTN, "size-7")}
                  aria-label="Xóa phím"
                  onClick={() => setOptions(options.filter((_, i) => i !== index))}
                >
                  <Icon name="x" size={13} />
                </button>
              </span>
            ))}
            <button
              type="button"
              className={cn(BTN_GHOST, SM)}
              disabled={!departments.length}
              onClick={() =>
                setOptions([
                  ...options,
                  { digit: String(options.length + 1), departmentId: departments[0].id },
                ])
              }
            >
              <Icon name="plus" size={14} />
              Thêm phím IVR
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
