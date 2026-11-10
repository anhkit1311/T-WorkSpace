import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { DirectConversationItem } from "@doan/shared";
import { Icon } from "../../shared/ui/Icon";
import { Avatar } from "../../shared/ui/Primitives";
import { useGlobalSoftphone } from "../../app/providers/SoftphoneContext";
import { useSocket } from "../../app/providers/SocketContext";
import { useApp } from "../../app/providers/AppContext";
import { academicApi, rankLabel } from "../admin/api";
import { governanceApi } from "../workspaces/api";
import "./staff-directory.css";

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
const KINDS: [StaffMember["unitKind"], string][] = [
  ["faculty", "Khối giảng dạy"],
  ["office", "Khối hành chính"],
  [null, "Khác"],
];
const PHONE_STATE = {
  registered: "Sẵn sàng",
  registering: "Đang kết nối",
  failed: "Lỗi kết nối",
  off: "Chưa bật",
} as const;

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
  const selected = staffList?.find((staff) => staff.userId === selectedId) ?? null;
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
    <span className="sd-actions">
      {staff.extension && staff.userId !== user?.id && (
        <button
          type="button"
          className="sd-act is-call"
          title={`Gọi ${staff.displayName} (${staff.extension})`}
          aria-label={`Gọi ${staff.displayName}, máy lẻ ${staff.extension}`}
          onClick={() => phone.call(staff.extension!)}
        >
          <Icon name="phone" size={14} />
        </button>
      )}
      {staff.userId !== user?.id && (
        <button
          type="button"
          className="sd-act"
          title={`Nhắn tin cho ${staff.displayName}`}
          aria-label={`Nhắn tin cho ${staff.displayName}`}
          onClick={() => void message(staff)}
        >
          <Icon name="message" size={14} />
        </button>
      )}
    </span>
  );

  const open = (staff: StaffMember) =>
    setSelectedId((id) => (id === staff.userId ? null : staff.userId));
  const person = (staff: StaffMember) => (
    <button
      type="button"
      className="sd-person"
      aria-expanded={selectedId === staff.userId}
      aria-controls="staff-profile"
      onClick={() => open(staff)}
    >
      <Presence staff={staff} online={online.has(staff.userId)} />
      <span className="sd-person__text">
        <b>{staff.displayName}</b>
        <small className="sd-person__email">{staff.email}</small>
        <small className="sd-person__meta">
          {[rankText(staff), staff.roleTitle, staff.extension].filter(Boolean).join(" · ")}
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

  return (
    <div className="staff-page">
      <header className="sd-head">
        <div className="sd-head__title">
          <p className="sd-eyebrow">
            <i className="sd-led" aria-hidden="true" />
            Danh bạ · {units.length} đơn vị · {staffList?.length ?? 0} cán bộ · {onlineCount} đang
            trực tuyến
          </p>
          <h1>Nhân sự</h1>
        </div>
        <div className="sd-seg" role="group" aria-label="Cách xem">
          <button type="button" aria-pressed={view === "list"} onClick={() => pickView("list")}>
            Danh sách
          </button>
          <button type="button" aria-pressed={view === "org"} onClick={() => pickView("org")}>
            Sơ đồ đơn vị
          </button>
        </div>
        <button
          type="button"
          className="sd-chip"
          aria-pressed={onlineOnly}
          onClick={() => setOnlineOnly((value) => !value)}
        >
          <i className="sd-led" aria-hidden="true" />
          Đang trực tuyến
        </button>
        <select
          className="sd-select sd-unit-select"
          aria-label="Đơn vị"
          value={unit}
          onChange={(event) => pickUnit(event.target.value)}
        >
          {view === "list" && <option value="all">Tất cả đơn vị</option>}
          {units.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
        <label className="sd-search">
          <Icon name="search" size={15} />
          <input
            type="search"
            aria-label="Tìm nhân sự"
            placeholder="Tên, mã cán bộ, email hoặc máy lẻ…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </header>

      <div className={`sd-body${selected ? " has-profile" : ""}`}>
        <nav className="sd-tree" aria-label="Đơn vị">
          {view === "list" && (
            <button
              type="button"
              className="sd-tree__item"
              aria-current={unit === "all" || undefined}
              onClick={() => pickUnit("all")}
            >
              <span>Tất cả đơn vị</span>
              <small>{staffList?.length ?? 0}</small>
            </button>
          )}
          {KINDS.map(([kind, label]) => {
            const list = units.filter((item) => item.kind === kind);
            if (!list.length) return null;
            return (
              <Fragment key={label}>
                <p className="sd-tree__group">{label}</p>
                {list.map((item) => (
                  <Fragment key={item.name}>
                    <button
                      type="button"
                      className="sd-tree__item"
                      aria-current={unit === item.name || undefined}
                      onClick={() => pickUnit(item.name)}
                    >
                      <Icon
                        name={unit === item.name ? "chevron-down" : "chevron-right"}
                        size={12}
                      />
                      <span>{item.name}</span>
                      <small>{item.members.length}</small>
                    </button>
                    {view === "list" &&
                      unit === item.name &&
                      byDepartment(item.members).length > 1 &&
                      byDepartment(item.members).map(([name, members]) => (
                        <button
                          key={name}
                          type="button"
                          className="sd-tree__item is-sub"
                          aria-pressed={department === name}
                          onClick={() => setDepartment((value) => (value === name ? null : name))}
                        >
                          <span>{name}</span>
                          <small>{members.length}</small>
                        </button>
                      ))}
                  </Fragment>
                ))}
              </Fragment>
            );
          })}
          {phone.hasExtension && myExtension && (
            <div className="sd-mine">
              <span className="sd-mono-label">Máy lẻ của bạn</span>
              <div>
                <strong>{myExtension}</strong>
                <i
                  className={`sd-led${phone.status === "registered" ? "" : phone.status === "failed" ? " is-red" : " is-off"}`}
                  aria-hidden="true"
                />
                <span className="sd-mono-label is-state">{PHONE_STATE[phone.status]}</span>
              </div>
              <p>Bấm số máy lẻ trong danh bạ để gọi bằng softphone.</p>
            </div>
          )}
        </nav>

        {view === "list" ? (
          <section className="sd-card" aria-labelledby="sd-list-title">
            <div className="sd-card__head">
              <h2 id="sd-list-title">{department ?? current?.name ?? "Tất cả đơn vị"}</h2>
              <span className="sd-mono-label">
                {visible.length} cán bộ ·{" "}
                {visible.filter((staff) => online.has(staff.userId)).length} trực tuyến
              </span>
            </div>
            <table className="sd-table">
              <thead>
                <tr>
                  <th scope="col">Cán bộ</th>
                  <th scope="col">Học vị · Vai trò</th>
                  <th scope="col" className="sd-col-code">
                    Mã CB
                  </th>
                  <th scope="col">Máy lẻ</th>
                  <th scope="col" className="sd-col-status">
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
                    <td colSpan={6} className="sd-table__empty">
                      {status}
                    </td>
                  </tr>
                )}
                {!failed &&
                  groups.map(([name, members]) => (
                    <Fragment key={name}>
                      <tr className="sd-table__group">
                        <th colSpan={6} scope="colgroup">
                          {name} · {members.length}
                        </th>
                      </tr>
                      {members.map((staff) => (
                        <tr
                          key={staff.userId}
                          className={selectedId === staff.userId ? "is-selected" : undefined}
                        >
                          <td>{person(staff)}</td>
                          <td>
                            {rankText(staff) && (
                              <span
                                className={`sd-rank${staff.rank === "ths" || staff.rank === "cn" ? " is-light" : ""}`}
                              >
                                {rankText(staff)}
                              </span>
                            )}
                            {staff.roleTitle}
                          </td>
                          <td className="sd-col-code">
                            {staff.userCode ? <code>{staff.userCode}</code> : "—"}
                          </td>
                          <td>
                            {staff.extension ? (
                              <span className="sd-ext">{staff.extension}</span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="sd-col-status">
                            <span
                              className={`sd-status${online.has(staff.userId) ? "" : " is-off"}`}
                            >
                              <i
                                className={`sd-led${online.has(staff.userId) ? "" : " is-off"}`}
                                aria-hidden="true"
                              />
                              {online.has(staff.userId) ? "Trực tuyến" : "Ngoại tuyến"}
                            </span>
                          </td>
                          <td className="sd-table__actions">{contact(staff)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
              </tbody>
            </table>
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
          <p className="sd-card sd-table__empty">{status ?? "Chưa có đơn vị nào."}</p>
        )}

        {selected && (
          <aside
            id="staff-profile"
            className="sd-profile"
            aria-label={`Hồ sơ ${selected.displayName}`}
            onKeyDown={(event) => event.key === "Escape" && setSelectedId(null)}
          >
            <div className="sd-profile__head">
              <button
                type="button"
                className="sd-profile__back"
                onClick={() => setSelectedId(null)}
              >
                <Icon name="chevron-left" size={18} />
                Nhân sự
              </button>
              <div className="sd-profile__id">
                <Presence staff={selected} online={online.has(selected.userId)} size="lg" />
                <div>
                  <h2>{selected.displayName}</h2>
                  <p>{[rankText(selected), selected.roleTitle].filter(Boolean).join(" · ")}</p>
                  <span className="sd-mono-label">
                    {[selected.unitName ?? NO_UNIT, selected.departmentName]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <button
                  type="button"
                  className="sd-profile__close"
                  aria-label="Đóng hồ sơ"
                  onClick={() => setSelectedId(null)}
                >
                  <Icon name="x" size={15} />
                </button>
              </div>
              <p className="sd-profile__state">
                <i
                  className={`sd-led${online.has(selected.userId) ? "" : " is-off"}`}
                  aria-hidden="true"
                />
                {selected.userId === user?.id
                  ? "Đây là bạn"
                  : online.has(selected.userId)
                    ? "Đang trực tuyến"
                    : "Ngoại tuyến"}
              </p>
              {selected.userId !== user?.id && (
                <div className="sd-profile__actions">
                  {selected.extension && (
                    <button
                      type="button"
                      className="sd-btn is-primary"
                      onClick={() => phone.call(selected.extension!)}
                    >
                      <Icon name="phone" size={15} />
                      Gọi {selected.extension}
                    </button>
                  )}
                  <button type="button" className="sd-btn" onClick={() => void message(selected)}>
                    <Icon name="message" size={15} />
                    Nhắn tin
                  </button>
                </div>
              )}
            </div>
            <dl className="sd-facts">
              <div>
                <dt>Email</dt>
                <dd>
                  <a href={`mailto:${selected.email}`}>{selected.email}</a>
                  <button
                    type="button"
                    className="sd-act"
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
              </div>
              <div>
                <dt>Máy lẻ</dt>
                <dd>
                  {selected.extension ? (
                    <span className="sd-ext">{selected.extension}</span>
                  ) : (
                    "Chưa có"
                  )}
                </dd>
              </div>
              <div>
                <dt>Mã cán bộ</dt>
                <dd>{selected.userCode ? <code>{selected.userCode}</code> : "—"}</dd>
              </div>
              <div>
                <dt>Đơn vị</dt>
                <dd>{selected.unitName ?? NO_UNIT}</dd>
              </div>
              {selected.departmentName && (
                <div>
                  <dt>Bộ môn</dt>
                  <dd>{selected.departmentName}</dd>
                </div>
              )}
            </dl>
          </aside>
        )}
      </div>
    </div>
  );
}

function Presence({
  staff,
  online,
  size = "md",
}: {
  staff: StaffMember;
  online: boolean;
  size?: "md" | "lg";
}) {
  return (
    <span className={`sd-avatar is-${size}`}>
      <Avatar name={staff.displayName} size={size} />
      <i className={`sd-dot${online ? "" : " is-off"}`} aria-hidden="true" />
    </span>
  );
}

const RANK_GROUPS: [string, (rank: string | null) => boolean][] = [
  ["PGS.TS / GS.TS", (rank) => rank === "pgs" || rank === "gs"],
  ["TS", (rank) => rank === "ts"],
  ["ThS", (rank) => rank === "ths"],
  ["Khác", (rank) => !rank || rank === "cn"],
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
  person: (staff: StaffMember) => ReactNode;
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
    ([label, test]) => [label, unit.members.filter((staff) => test(staff.rank)).length] as const,
  );

  return (
    <section className="sd-org" aria-label={`Sơ đồ ${unit.name}`}>
      <div className="sd-rack">
        <div className="sd-rack__unit">
          <span className="sd-mono-label">Cán bộ</span>
          <strong>{unit.members.length}</strong>
          <small>{departments.filter(([name]) => name !== OFFICE).length} bộ môn</small>
        </div>
        <div className="sd-rack__unit is-wide">
          <span className="sd-mono-label">Học vị</span>
          <span className="sd-ranks" aria-hidden="true">
            {ranks.map(
              ([label, count], index) =>
                count > 0 && (
                  <i key={label} className={`is-${index}`} style={{ flexGrow: count }} />
                ),
            )}
          </span>
          <small className="sd-ranks__legend">
            {ranks.map(([label, count]) => (
              <span key={label}>
                <b>{count}</b> {label}
              </span>
            ))}
          </small>
        </div>
        <div className="sd-rack__unit">
          <span className="sd-mono-label">Đang trực tuyến</span>
          <strong>
            {onlineCount}
            <em>/{unit.members.length}</em>
          </strong>
          <small>{unit.members.length - onlineCount} ngoại tuyến</small>
        </div>
        <div className="sd-rack__unit">
          <span className="sd-mono-label">Văn phòng đơn vị</span>
          <strong className={office ? "is-ext" : undefined}>{office ?? "—"}</strong>
          <small>{admins[0]?.displayName ?? "Chưa có quản trị đơn vị"}</small>
        </div>
      </div>

      {top.size > 0 && (
        <div className={`sd-org__top${departments.length ? " has-depts" : ""}`}>
          {heads.map((staff) => (
            <div key={staff.userId} className="sd-node is-head">
              <span className="sd-mono-label">Trưởng đơn vị</span>
              <div className="sd-node__row">
                {person(staff)}
                {contact(staff)}
              </div>
            </div>
          ))}
          {admins.map((staff) => (
            <div key={staff.userId} className="sd-node is-admin">
              <span className="sd-mono-label">Quản trị đơn vị</span>
              <div className="sd-node__row">
                {person(staff)}
                {contact(staff)}
              </div>
            </div>
          ))}
        </div>
      )}

      {departments.length > 0 ? (
        <div
          className="sd-org__depts"
          style={{ "--cols": Math.min(departments.length, 3) } as CSSProperties}
        >
          {departments.map(([name, list]) => (
            <section key={name} className="sd-dept" aria-label={name}>
              <header>
                <h3>{name}</h3>
                <span className="sd-mono-label">
                  {list.length} cán bộ · {list.filter((staff) => online.has(staff.userId)).length}{" "}
                  trực tuyến
                </span>
              </header>
              <ul>
                {list.map((staff) => (
                  <li key={staff.userId}>
                    {person(staff)}
                    {contact(staff)}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        !top.size && (
          <p className="sd-card sd-table__empty">
            Không tìm thấy nhân sự phù hợp với điều kiện tìm kiếm.
          </p>
        )
      )}
    </section>
  );
}
