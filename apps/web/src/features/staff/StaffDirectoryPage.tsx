import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DirectConversationItem } from "@doan/shared";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import { cn } from "../../shared/lib/utils";
import { useGlobalSoftphone } from "../../app/providers/SoftphoneContext";
import { useSocket } from "../../app/providers/SocketContext";
import { useApp } from "../../app/providers/AppContext";
import { academicApi, rankLabel } from "../admin/api";
import { governanceApi } from "../workspaces/api";

interface StaffMember {
  userId: string;
  displayName: string;
  email: string;
  userCode: string | null;
  unitName: string | null;
  unitKind: "faculty" | "office" | null;
  departmentName: string | null;
  rank: string | null;
  extension: string | null;
  roleTitle: string;
}
interface Unit {
  name: string;
  kind: StaffMember["unitKind"];
  members: StaffMember[];
}

const NO_UNIT = "Chưa thuộc đơn vị";
/** Members of a unit who are not in one of its departments (the unit office, its head…). */
const OFFICE = "Văn phòng đơn vị";
const KINDS: [StaffMember["unitKind"], string, IconName][] = [
  ["faculty", "Khối giảng dạy", "graduation-cap"],
  ["office", "Khối hành chính", "building"],
  [null, "Khác", "users"],
];
const PHONE_STATE = {
  registered: "Sẵn sàng",
  registering: "Đang kết nối",
  failed: "Lỗi kết nối",
  off: "Chưa bật",
} as const;

const MUTED = "text-[13px] text-muted-foreground";
const CARD = "rounded-[10px] border bg-card";
const LED = "size-2 shrink-0 rounded-full";
const COUNT =
  "min-w-6 rounded-full bg-secondary px-[7px] text-center text-[11.5px] font-semibold text-muted-foreground tabular-nums";
const ACT =
  "grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-[7px] border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";
const BTN =
  "inline-flex h-[34px] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold whitespace-nowrap transition-colors";
const SMALL_LABEL = "text-[11px] font-semibold tracking-wider text-muted-foreground uppercase";

const rankText = (staff: StaffMember) =>
  staff.rank ? (rankLabel[staff.rank] ?? staff.rank) : null;

function groupBy(
  list: StaffMember[],
  key: (staff: StaffMember) => string,
): [string, StaffMember[]][] {
  const groups = new Map<string, StaffMember[]>();
  for (const staff of list) {
    const name = key(staff);
    const group = groups.get(name);
    if (group) group.push(staff);
    else groups.set(name, [staff]);
  }
  return [...groups];
}

const byDepartment = (list: StaffMember[]) =>
  groupBy(list, (staff) => staff.departmentName ?? OFFICE).sort(([a], [b]) =>
    a === OFFICE ? -1 : b === OFFICE ? 1 : a.localeCompare(b, "vi"),
  );

/** Directory of lecturers and staff: list or unit chart, with a profile panel for quick calls and messages. */
export function StaffDirectoryPage() {
  const { accessToken, user, navigate, notify } = useApp();
  const phone = useGlobalSoftphone();
  const { onlineUserIds } = useSocket();

  const [staffList, setStaffList] = useState<StaffMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "org">("list");
  const [unit, setUnit] = useState("all");
  const [department, setDepartment] = useState<string | null>(null);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    setFailed(false);
    academicApi<{ staff: StaffMember[] }>(accessToken, "directory").then(
      (data) => setStaffList(data.staff),
      () => setFailed(true),
    );
  }, [accessToken]);

  const online = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);
  const units = useMemo(() => {
    const map = new Map<string, Unit>();
    for (const staff of staffList ?? []) {
      const name = staff.unitName ?? NO_UNIT;
      const entry = map.get(name);
      if (entry) entry.members.push(staff);
      else map.set(name, { name, kind: staff.unitName ? staff.unitKind : null, members: [staff] });
    }
    return [...map.values()];
  }, [staffList]);

  const q = query.trim().toLowerCase();
  const matches = (staff: StaffMember) =>
    (!onlineOnly || online.has(staff.userId)) &&
    (!q ||
      [
        staff.displayName,
        staff.userCode,
        staff.email,
        staff.extension,
        staff.unitName,
        staff.departmentName,
      ].some((value) => value?.toLowerCase().includes(q)));

  const current = units.find((item) => item.name === unit) ?? null;
  const scope = current ? current.members : (staffList ?? []);
  const visible = scope.filter(
    (staff) => matches(staff) && (!department || (staff.departmentName ?? OFFICE) === department),
  );
  const groups = current
    ? byDepartment(visible)
    : groupBy(visible, (staff) => staff.unitName ?? NO_UNIT);
  const selected =
    view === "list" ? (staffList?.find((staff) => staff.userId === selectedId) ?? null) : null;
  const onlineCount = (staffList ?? []).filter((staff) => online.has(staff.userId)).length;
  const myExtension = staffList?.find((staff) => staff.userId === user?.id)?.extension ?? null;

  const pickUnit = (name: string) => {
    setUnit(name);
    setDepartment(null);
  };
  const pickView = (next: "list" | "org") => {
    setView(next);
    // The chart is per unit: start from the first faculty when "all units" was picked.
    if (next === "org" && !current && units.length)
      pickUnit((units.find((item) => item.kind === "faculty") ?? units[0]).name);
  };

  async function message(staff: StaffMember) {
    if (!accessToken) return;
    try {
      const { conversation } = await governanceApi<{ conversation: DirectConversationItem }>(
        accessToken,
        "direct-conversations",
        "POST",
        { userId: staff.userId },
      );
      navigate({ view: "chat", channelId: conversation.id });
    } catch {
      notify("Không mở được đoạn chat", "Hãy thử lại sau.", "warning");
    }
  }

  const contact = (staff: StaffMember) => (
    <span className="flex shrink-0 justify-end gap-1">
      {staff.extension && staff.userId !== user?.id && (
        <button
          type="button"
          className={cn(ACT, "text-emerald-600 hover:text-emerald-700")}
          title={`Gọi ${staff.displayName} (${staff.extension})`}
          aria-label={`Gọi ${staff.displayName}, máy lẻ ${staff.extension}`}
          onClick={(event) => {
            event.stopPropagation();
            phone.call(staff.extension!);
          }}
        >
          <Icon name="phone" size={14} />
        </button>
      )}
      {staff.userId !== user?.id && (
        <button
          type="button"
          className={ACT}
          title={`Nhắn tin cho ${staff.displayName}`}
          aria-label={`Nhắn tin cho ${staff.displayName}`}
          onClick={(event) => {
            event.stopPropagation();
            void message(staff);
          }}
        >
          <Icon name="message" size={14} />
        </button>
      )}
    </span>
  );

  const open = (staff: StaffMember) =>
    setSelectedId((id) => (id === staff.userId ? null : staff.userId));
  const person = (staff: StaffMember, meta?: string) => (
    <button
      type="button"
      className="flex w-full min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
      aria-expanded={selectedId === staff.userId}
      aria-controls="staff-profile"
      onClick={() => {
        if (view === "org") pickView("list");
        open(staff);
      }}
    >
      <UserAvatar name={staff.displayName} online={online.has(staff.userId)} />
      <span className="min-w-0">
        <b className="block truncate font-semibold">{staff.displayName}</b>
        <small className="block truncate text-xs text-muted-foreground">
          {meta ?? staff.email}
        </small>
      </span>
    </button>
  );

  const status = failed
    ? "Không tải được danh sách nhân sự. Hãy tải lại trang."
    : !staffList
      ? "Đang tải danh sách nhân sự…"
      : !staffList.length
        ? "Chưa có tài khoản cán bộ, giảng viên nào trên hệ thống."
        : !visible.length
          ? "Không tìm thấy nhân sự phù hợp với điều kiện tìm kiếm."
          : null;

  const treeButton = (
    label: string,
    count: number,
    icon: IconName,
    active: boolean,
    onClick: () => void,
    chevron?: "down" | "right",
  ) => (
    <button
      type="button"
      className={cn(
        "flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13.5px] hover:bg-secondary max-md:w-auto max-md:shrink-0",
        active && "bg-secondary font-semibold",
      )}
      aria-current={active || undefined}
      onClick={onClick}
    >
      <span
        className={cn(
          "grid size-[26px] shrink-0 place-items-center rounded-[7px] bg-secondary text-muted-foreground",
          active && "bg-foreground text-background",
        )}
      >
        <Icon name={icon} size={14} />
      </span>
      <span className="min-w-0 flex-1 truncate max-md:flex-none" title={label}>
        {label}
      </span>
      <small className={cn(COUNT, active && "bg-card")}>{count}</small>
      {chevron && (
        <Icon
          name={chevron === "down" ? "chevron-down" : "chevron-right"}
          size={14}
          className="shrink-0 text-muted-foreground max-md:hidden"
        />
      )}
    </button>
  );

  return (
    <div className="tw grid min-w-0 gap-3.5 px-7 pt-5 pb-10 text-sm text-foreground max-md:px-3.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="grid gap-0.5">
          <h1 className="flex items-center gap-2 text-[22px] font-bold">
            Nhân sự
            {onlineCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--tint-green-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--tint-green-fg)]">
                <span className={cn(LED, "bg-emerald-500")} />
                {onlineCount} trực tuyến
              </span>
            )}
          </h1>
          <p className={MUTED}>
            {units.length} đơn vị · {staffList?.length ?? 0} cán bộ, giảng viên
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 max-md:ml-0">
          <div
            className="flex rounded-[9px] bg-secondary p-[3px]"
            role="group"
            aria-label="Cách xem"
          >
            {(
              [
                ["list", "Danh sách", "menu"],
                ["org", "Sơ đồ đơn vị", "users"],
              ] as const
            ).map(([key, label, icon]) => (
              <button
                key={key}
                type="button"
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-[7px] px-3 py-[5px] text-[13px] font-medium text-muted-foreground",
                  view === key && "bg-card font-semibold text-foreground shadow-sm",
                )}
                aria-pressed={view === key}
                onClick={() => pickView(key)}
              >
                <Icon name={icon} size={14} />
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={cn(
              "inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[13px] text-muted-foreground hover:bg-secondary",
              onlineOnly && "border-foreground bg-foreground text-background hover:bg-foreground",
            )}
            aria-pressed={onlineOnly}
            onClick={() => setOnlineOnly((value) => !value)}
          >
            <span className={cn(LED, "bg-emerald-500")} aria-hidden="true" />
            Đang trực tuyến
          </button>
          <label className="flex h-[34px] w-[300px] items-center gap-2 rounded-full bg-secondary px-3 text-muted-foreground max-md:w-full">
            <Icon name="search" size={15} />
            <input
              type="search"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none"
              aria-label="Tìm nhân sự"
              placeholder="Tên, mã cán bộ, email hoặc máy lẻ…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
      </div>

      <div
        className={cn(
          "grid min-w-0 items-start gap-4 lg:grid-cols-[240px_minmax(0,1fr)]",
          selected && "min-[1250px]:grid-cols-[240px_minmax(0,1fr)_320px]",
        )}
      >
        <div className="grid min-w-0 content-start gap-2.5 lg:sticky lg:top-2">
          <nav
            className={cn(
              CARD,
              "grid min-w-0 gap-px overflow-hidden p-1.5 max-md:flex max-md:overflow-x-auto",
            )}
            aria-label="Đơn vị"
          >
            {view === "list" &&
              treeButton("Tất cả đơn vị", staffList?.length ?? 0, "grid-2x2", unit === "all", () =>
                pickUnit("all"),
              )}
            {KINDS.map(([kind, label, icon]) => {
              const list = units.filter((item) => item.kind === kind);
              if (!list.length) return null;
              return (
                <Fragment key={label}>
                  <p className={cn(SMALL_LABEL, "px-2 pt-3 pb-1 max-md:hidden")}>{label}</p>
                  {list.map((item) => {
                    const active = unit === item.name;
                    const departments = byDepartment(item.members);
                    return (
                      <Fragment key={item.name}>
                        {treeButton(
                          item.name,
                          item.members.length,
                          icon,
                          active,
                          () => pickUnit(item.name),
                          active ? "down" : "right",
                        )}
                        {view === "list" && active && departments.length > 1 && (
                          <div className="mt-0.5 mb-1 ml-5 grid min-w-0 gap-px border-l pl-3 max-md:hidden">
                            {departments.map(([name, members]) => (
                              <button
                                key={name}
                                type="button"
                                className={cn(
                                  "flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-secondary",
                                  department === name &&
                                    "bg-[var(--tint-blue-bg)] font-semibold text-[var(--tint-blue-fg)] hover:bg-[var(--tint-blue-bg)]",
                                )}
                                aria-pressed={department === name}
                                onClick={() =>
                                  setDepartment((value) => (value === name ? null : name))
                                }
                              >
                                <span className="min-w-0 flex-1 truncate" title={name}>
                                  {name}
                                </span>
                                <small className={cn(COUNT, department === name && "bg-card")}>
                                  {members.length}
                                </small>
                              </button>
                            ))}
                          </div>
                        )}
                      </Fragment>
                    );
                  })}
                </Fragment>
              );
            })}
          </nav>
          {phone.hasExtension && myExtension && (
            <div className={cn(CARD, "flex items-center gap-2.5 p-3 max-md:hidden")}>
              <span className="grid size-[34px] shrink-0 place-items-center rounded-[9px] bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]">
                <Icon name="phone" size={16} />
              </span>
              <span className="grid min-w-0 flex-1">
                <small className="text-xs text-muted-foreground">Máy lẻ của bạn</small>
                <b className="text-lg leading-tight font-bold tabular-nums">{myExtension}</b>
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold",
                  phone.status === "registered"
                    ? "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]"
                    : phone.status === "failed"
                      ? "bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)]"
                      : "bg-secondary text-muted-foreground",
                )}
              >
                {PHONE_STATE[phone.status]}
              </span>
            </div>
          )}
        </div>

        {view === "list" ? (
          <section className={cn(CARD, "min-w-0 overflow-hidden")} aria-labelledby="sd-list-title">
            <div className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3">
              <h2 id="sd-list-title" className="text-[15px] font-semibold">
                {department ?? current?.name ?? "Tất cả đơn vị"}
              </h2>
              <small className={MUTED}>
                {visible.length} cán bộ ·{" "}
                {visible.filter((staff) => online.has(staff.userId)).length} trực tuyến
              </small>
            </div>
            <div className="relative overflow-x-auto">
              <table className="w-full border-collapse text-[13.5px]">
                <thead className="bg-background text-left text-xs text-muted-foreground">
                  <tr className="border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
                    <th scope="col">Cán bộ</th>
                    <th scope="col" className="max-md:hidden">
                      Học vị · Vai trò
                    </th>
                    <th scope="col" className={cn("max-[1099px]:hidden", selected && "hidden")}>
                      Mã CB
                    </th>
                    <th scope="col">Máy lẻ</th>
                    <th scope="col" className="max-md:hidden">
                      Trạng thái
                    </th>
                    <th scope="col">
                      <span className="sr-only">Liên lạc</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {status && (
                    <tr>
                      <td colSpan={6} className={cn(MUTED, "px-4 py-8 text-center")}>
                        {status}
                      </td>
                    </tr>
                  )}
                  {!failed &&
                    groups.map(([name, members]) => (
                      <Fragment key={name}>
                        <tr className="border-b bg-secondary">
                          <th
                            colSpan={6}
                            scope="colgroup"
                            className="px-3 py-1.5 text-left text-[12.5px] font-semibold"
                          >
                            {name} · {members.length}
                          </th>
                        </tr>
                        {members.map((staff) => {
                          const isOnline = online.has(staff.userId);
                          return (
                            <tr
                              key={staff.userId}
                              className={cn(
                                "border-b hover:bg-secondary [&>td]:px-3 [&>td]:py-2",
                                selectedId === staff.userId &&
                                  "bg-[var(--tint-blue-bg)] hover:bg-[var(--tint-blue-bg)]",
                              )}
                            >
                              <td className="max-w-0 min-w-[180px]">{person(staff)}</td>
                              <td className="whitespace-nowrap max-md:hidden">
                                {rankText(staff) && (
                                  <span
                                    className={cn(
                                      "mr-1.5 rounded-[5px] px-[7px] py-px text-[11.5px] font-semibold",
                                      staff.rank === "ths" || staff.rank === "cn"
                                        ? "bg-secondary text-muted-foreground"
                                        : "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]",
                                    )}
                                  >
                                    {rankText(staff)}
                                  </span>
                                )}
                                {staff.roleTitle}
                              </td>
                              <td className={cn("max-[1099px]:hidden", selected && "hidden")}>
                                {staff.userCode ? (
                                  <code className="font-mono text-[12.5px] text-muted-foreground">
                                    {staff.userCode}
                                  </code>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="font-semibold tabular-nums">
                                {staff.extension ?? (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="whitespace-nowrap max-md:hidden">
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1.5 text-[12.5px]",
                                    !isOnline && "text-muted-foreground",
                                  )}
                                >
                                  <span
                                    className={cn(LED, isOnline ? "bg-emerald-500" : "bg-border")}
                                    aria-hidden="true"
                                  />
                                  {isOnline ? "Trực tuyến" : "Ngoại tuyến"}
                                </span>
                              </td>
                              <td>{contact(staff)}</td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : current ? (
          <OrgChart
            unit={current}
            members={current.members.filter(matches)}
            online={online}
            person={person}
            contact={contact}
          />
        ) : (
          <p className={cn(CARD, MUTED, "p-6 text-center")}>{status ?? "Chưa có đơn vị nào."}</p>
        )}

        {selected && (
          <aside
            id="staff-profile"
            className={cn(
              CARD,
              "min-w-0 overflow-hidden lg:col-span-full min-[1250px]:sticky min-[1250px]:top-2 min-[1250px]:col-span-1",
            )}
            aria-label={`Hồ sơ ${selected.displayName}`}
            onKeyDown={(event) => event.key === "Escape" && setSelectedId(null)}
          >
            <div className="relative grid justify-items-center gap-3 border-b p-[18px] text-center">
              <button
                type="button"
                className="absolute top-2.5 right-2.5 grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="Đóng hồ sơ"
                onClick={() => setSelectedId(null)}
              >
                <Icon name="x" size={15} />
              </button>
              <UserAvatar
                name={selected.displayName}
                online={online.has(selected.userId)}
                className="size-[72px] text-2xl"
              />
              <div className="grid gap-0.5">
                <h2 className="text-lg font-bold">{selected.displayName}</h2>
                <p className={MUTED}>
                  {[rankText(selected), selected.roleTitle].filter(Boolean).join(" · ")}
                </p>
                <small className="text-xs text-muted-foreground">
                  {[selected.unitName ?? NO_UNIT, selected.departmentName]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  online.has(selected.userId)
                    ? "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]"
                    : "bg-secondary text-muted-foreground",
                )}
              >
                <span
                  className={cn(LED, online.has(selected.userId) ? "bg-emerald-500" : "bg-border")}
                />
                {selected.userId === user?.id
                  ? "Đây là bạn"
                  : online.has(selected.userId)
                    ? "Đang trực tuyến"
                    : "Ngoại tuyến"}
              </span>
              {selected.userId !== user?.id && (
                <div className="flex w-full gap-2">
                  {selected.extension && (
                    <button
                      type="button"
                      className={cn(BTN, "bg-primary text-primary-foreground hover:bg-primary/90")}
                      onClick={() => phone.call(selected.extension!)}
                    >
                      <Icon name="phone" size={15} />
                      Gọi {selected.extension}
                    </button>
                  )}
                  <button
                    type="button"
                    className={cn(BTN, "border bg-card hover:bg-secondary")}
                    onClick={() => void message(selected)}
                  >
                    <Icon name="message" size={15} />
                    Nhắn tin
                  </button>
                </div>
              )}
            </div>
            <dl className="grid grid-cols-[90px_minmax(0,1fr)] gap-x-2.5 gap-y-2 px-[18px] py-3.5 text-[13px] [&_dd]:min-w-0 [&_dd]:font-medium [&_dt]:text-muted-foreground">
              <dt>Email</dt>
              <dd className="flex items-center gap-1.5">
                <a
                  href={`mailto:${selected.email}`}
                  className="truncate text-[#2f6bff] hover:underline"
                >
                  {selected.email}
                </a>
                <button
                  type="button"
                  className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="Sao chép email"
                  onClick={() =>
                    void navigator.clipboard.writeText(selected.email).then(
                      () => notify("Đã sao chép email"),
                      () => notify("Không sao chép được email", undefined, "warning"),
                    )
                  }
                >
                  <Icon name="copy" size={13} />
                </button>
              </dd>
              <dt>Máy lẻ</dt>
              <dd className="tabular-nums">{selected.extension ?? "Chưa có"}</dd>
              <dt>Mã cán bộ</dt>
              <dd>
                {selected.userCode ? (
                  <code className="font-mono text-[12.5px]">{selected.userCode}</code>
                ) : (
                  "—"
                )}
              </dd>
              <dt>Đơn vị</dt>
              <dd>{selected.unitName ?? NO_UNIT}</dd>
              {selected.departmentName && (
                <>
                  <dt>Bộ môn</dt>
                  <dd>{selected.departmentName}</dd>
                </>
              )}
            </dl>
          </aside>
        )}
      </div>
    </div>
  );
}

const RANK_GROUPS: [string, (rank: string | null) => boolean, string][] = [
  ["PGS.TS / GS.TS", (rank) => rank === "pgs" || rank === "gs", "bg-[#2f6bff]"],
  ["TS", (rank) => rank === "ts", "bg-[#7aa2ff]"],
  ["ThS", (rank) => rank === "ths", "bg-[#b9cdff]"],
  ["Khác", (rank) => !rank || rank === "cn", "bg-border"],
];

/** One unit: its head and administrators above, its departments (and office) below. */
function OrgChart({
  unit,
  members,
  online,
  person,
  contact,
}: {
  unit: Unit;
  members: StaffMember[];
  online: Set<string>;
  person: (staff: StaffMember, meta?: string) => ReactNode;
  contact: (staff: StaffMember) => ReactNode;
}) {
  const heads = members.filter((staff) => staff.roleTitle === "Trưởng đơn vị");
  const admins = members.filter((staff) => staff.roleTitle === "Quản trị đơn vị");
  const top = new Set([...heads, ...admins]);
  // Someone shown above stays in their department's column, but is not repeated under the office.
  const departments = byDepartment(
    members.filter((staff) => staff.departmentName || !top.has(staff)),
  );
  const onlineCount = unit.members.filter((staff) => online.has(staff.userId)).length;
  const office = admins.find((staff) => staff.extension)?.extension ?? null;
  const ranks = RANK_GROUPS.map(
    ([label, test, color]) =>
      [label, unit.members.filter((staff) => test(staff.rank)).length, color] as const,
  );
  const meta = (staff: StaffMember) =>
    [rankText(staff), staff.roleTitle, staff.extension].filter(Boolean).join(" · ");
  const STAT = cn(CARD, "grid min-w-0 gap-1 px-3.5 py-3");

  return (
    <section className="grid min-w-0 gap-4" aria-label={`Sơ đồ ${unit.name}`}>
      <div className="grid gap-3 min-[1100px]:grid-cols-[1fr_2fr_1fr_1fr] min-[600px]:grid-cols-2">
        <div className={STAT}>
          <small className="text-[12.5px] text-muted-foreground">Cán bộ</small>
          <b className="text-[22px] leading-tight font-bold tabular-nums">{unit.members.length}</b>
          <small className="text-xs text-muted-foreground">
            {departments.filter(([name]) => name !== OFFICE).length} bộ môn
          </small>
        </div>
        <div className={STAT}>
          <small className="text-[12.5px] text-muted-foreground">Học vị</small>
          <span className="my-1.5 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
            {ranks.map(
              ([label, count, color]) =>
                count > 0 && <i key={label} className={color} style={{ flexGrow: count }} />,
            )}
          </span>
          <small className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {ranks.map(([label, count, color]) => (
              <span key={label} className="flex items-center gap-1.5">
                <i className={cn("size-2 rounded-sm", color)} />
                <b className="text-foreground">{count}</b> {label}
              </span>
            ))}
          </small>
        </div>
        <div className={STAT}>
          <small className="text-[12.5px] text-muted-foreground">Đang trực tuyến</small>
          <b className="text-[22px] leading-tight font-bold tabular-nums">
            {onlineCount}
            <em className="text-sm font-medium text-muted-foreground not-italic">
              /{unit.members.length}
            </em>
          </b>
          <small className="text-xs text-muted-foreground">
            {unit.members.length - onlineCount} ngoại tuyến
          </small>
        </div>
        <div className={STAT}>
          <small className="text-[12.5px] text-muted-foreground">Văn phòng đơn vị</small>
          <b className="text-[22px] leading-tight font-bold tabular-nums">{office ?? "—"}</b>
          <small className="truncate text-xs text-muted-foreground">
            {admins[0]?.displayName ?? "Chưa có quản trị đơn vị"}
          </small>
        </div>
      </div>

      {top.size > 0 && (
        <div
          className={cn(
            "relative flex flex-wrap justify-center gap-3",
            departments.length &&
              "pb-[18px] after:absolute after:bottom-0 after:left-1/2 after:h-[18px] after:w-px after:bg-border",
          )}
        >
          {[...heads, ...admins].map((staff) => (
            <div
              key={staff.userId}
              className={cn(
                CARD,
                "grid w-[300px] max-w-full gap-2 px-3.5 py-3",
                heads.includes(staff) && "border-foreground",
              )}
            >
              <span className={SMALL_LABEL}>
                {heads.includes(staff) ? "Trưởng đơn vị" : "Quản trị đơn vị"}
              </span>
              <div className="flex min-w-0 items-center gap-2.5">
                {person(staff, [rankText(staff), staff.extension].filter(Boolean).join(" · "))}
                {contact(staff)}
              </div>
            </div>
          ))}
        </div>
      )}

      {departments.length > 0 ? (
        <div
          className={cn(
            "grid gap-3 min-[1100px]:grid-cols-3 min-[761px]:grid-cols-2",
            top.size > 0 && "border-t pt-[18px]",
          )}
        >
          {departments.map(([name, list]) => (
            <section key={name} className={cn(CARD, "min-w-0 overflow-hidden")} aria-label={name}>
              <header className="border-b bg-background px-3.5 py-2.5">
                <h3 className="text-sm font-semibold">{name}</h3>
                <small className="text-xs text-muted-foreground">
                  {list.length} cán bộ · {list.filter((staff) => online.has(staff.userId)).length}{" "}
                  trực tuyến
                </small>
              </header>
              <ul className="list-none px-1.5 py-1">
                {list.map((staff) => (
                  <li
                    key={staff.userId}
                    className="flex min-w-0 items-center gap-2 rounded-[7px] px-2 py-1.5 hover:bg-secondary"
                  >
                    {person(staff, meta(staff))}
                    {contact(staff)}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        !top.size && (
          <p className={cn(CARD, MUTED, "p-6 text-center")}>
            Không tìm thấy nhân sự phù hợp với điều kiện tìm kiếm.
          </p>
        )
      )}
    </section>
  );
}
