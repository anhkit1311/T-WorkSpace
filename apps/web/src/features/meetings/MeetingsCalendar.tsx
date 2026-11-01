import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AnimatePresence } from "motion/react";
import type { MeetingCalendar, MeetingScheduleItem, WorkspaceItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Icon } from "../../shared/ui/Icon";
import {
  Button,
  ConfirmDialog,
  Field,
  IconButton,
  Modal,
} from "../../shared/ui/Primitives";
import { NoGroups } from "../workspaces/GroupDialogs";
import { cancelMeetingScheduleApi, getMeetingCalendarApi, saveMeetingScheduleApi } from "./api";
import { calendarEvents, FIRST_HOUR, LAST_HOUR, layoutDay, weekStart, type CalendarEvent } from "./calendar";
import { MeetingAttendancePanel } from "./MeetingAttendancePanel";
import { CouncilSetupDialog } from "./CouncilSetupDialog";
import { MeetingCouncilPanel } from "./MeetingCouncilPanel";
import { MeetingOutcomesPanel } from "./MeetingOutcomesPanel";
import { MeetingRecordingPanel } from "./MeetingRecordingPanel";
import { inviteInput, ScheduleInviteFields, type InviteState } from "./ScheduleInviteFields";
import "./meetings-calendar.css";

export type MeetingRoom = { id: string; name: string; workspace: string; workspaceId: string };

const DAY = 86_400_000;
const LAST_WORKSPACE = "meeting:lastWorkspace";
const STATUS_LABEL = { live: "Đang diễn ra", upcoming: "Sắp tới", past: "Đã qua" } as const;
const WEEKDAYS = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];

// Day labels and times in Vietnam time, matching how the week is cut.
const zone = { timeZone: "Asia/Ho_Chi_Minh" } as const;
const dayMonth = (date: Date) => {
  const [{ value: day }, , { value: month }] = new Intl.DateTimeFormat("en-GB", { ...zone, day: "2-digit", month: "2-digit" }).formatToParts(date);
  return `${day}/${month}`;
};
const clock = (date: Date) => date.toLocaleTimeString("vi-VN", { ...zone, hour: "2-digit", minute: "2-digit" });

const isSameDay = (d1: Date, d2: Date) =>
  d1.getDate() === d2.getDate() && d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear();

function localDateTime(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function downloadCalendarEvent(item: MeetingScheduleItem) {
  const escape = (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const stamp = (value: string) =>
    new Date(value)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//T-WorkSpace//Meeting Schedule//VI",
    "BEGIN:VEVENT",
    `UID:${item.id}@tworkspace`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(item.startsAt)}`,
    `DTEND:${stamp(item.endsAt)}`,
    `SUMMARY:${escape(item.title)}`,
    `DESCRIPTION:${escape(item.description)}`,
    `LOCATION:${escape(`${item.workspaceName} - ${item.roomName} (T-WorkSpace)`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([calendar], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `lich-hop-${item.id.slice(0, 8)}.ics`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Cổng Quản lý Hội nghị TDTU (KPIs + Danh sách phòng họp & Chuyển đổi linh hoạt Thẻ/Lịch tuần) */
export function MeetingsCalendar({ groups, rooms }: { groups: WorkspaceItem[] | null; rooms: MeetingRoom[] }) {
  const { accessToken, route, navigate, notify } = useApp();
  const [week, setWeek] = useState(() => weekStart(new Date()));
  const [data, setData] = useState<MeetingCalendar | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [revision, setRevision] = useState(0);
  const [selectedKey, setSelectedKey] = useState("");
  const [form, setForm] = useState<{ item?: MeetingScheduleItem } | null>(null);
  const [startNow, setStartNow] = useState(false);
  const [cancelId, setCancelId] = useState("");
  const [councilFor, setCouncilFor] = useState<MeetingScheduleItem | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // New UI controls for Cổng Hội nghị TDTU
  const [viewMode, setViewMode] = useState<"cards" | "calendar">("cards");
  const [searchQuery, setSearchQuery] = useState("");
  const [quickRoomId, setQuickRoomId] = useState("");

  const groupId = route.workspaceId ?? "";

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    const load = () =>
      getMeetingCalendarApi(accessToken, week, new Date(week.getTime() + 7 * DAY))
        .then((next) => {
          if (!active) return;
          setData(next);
          setNow(new Date());
          setError("");
        })
        .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Không tải được lịch họp."));
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [accessToken, week, revision]);

  const events = useMemo(
    () => (data ? calendarEvents(data, now).filter((item) => !groupId || item.workspaceId === groupId) : []),
    [data, now, groupId],
  );

  const days = Array.from({ length: 7 }, (_, index) => new Date(week.getTime() + index * DAY));
  const today = weekStart(now).getTime() === week.getTime() ? Math.floor((now.getTime() - week.getTime()) / DAY) : -1;
  const selected = events.find((item) => item.key === selectedKey);
  const schedule = (item: CalendarEvent) => data?.schedules.find((entry) => entry.id === item.scheduleId);
  const openRoom = (item: { workspaceId: string; roomId: string; scheduleId?: string | null }) =>
    navigate({ view: "meetings", workspaceId: item.workspaceId, channelId: item.roomId, scheduleId: item.scheduleId ?? undefined });

  // Counts & sessions
  const activeSessions = useMemo(() => data?.sessions.filter((s) => !s.endedAt) ?? [], [data]);
  const pastSessions = useMemo(() => data?.sessions.filter((s) => Boolean(s.endedAt)).slice(0, 5) ?? [], [data]);

  // Filtered rooms based on the search query
  const filteredRooms = useMemo(() => {
    return rooms.filter((room) => {
      if (groupId && room.workspaceId !== groupId) return false;
      const matchSearch =
        !searchQuery ||
        room.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        room.workspace.toLowerCase().includes(searchQuery.toLowerCase());
      return matchSearch;
    });
  }, [rooms, groupId, searchQuery]);

  // Filtered events based on the search query
  const filteredEvents = useMemo(() => {
    return events.filter((item) => {
      const matchSearch =
        !searchQuery ||
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.workspaceName.toLowerCase().includes(searchQuery.toLowerCase());
      return matchSearch;
    });
  }, [events, searchQuery]);

  const cancel = async () => {
    if (!accessToken || !cancelId) return;
    setCancelling(true);
    try {
      await cancelMeetingScheduleApi(accessToken, cancelId);
      setCancelId("");
      setSelectedKey("");
      setRevision((value) => value + 1);
      notify("Đã huỷ lịch họp", "Lịch họp đã được gỡ khỏi lịch của nhóm.", "success");
    } catch (reason) {
      notify("Không huỷ được lịch họp", reason instanceof Error ? reason.message : "Hãy thử lại.", "warning");
    } finally {
      setCancelling(false);
    }
  };

  if (groups?.length === 0) return <NoGroups text="Cuộc họp của các nhóm bạn tham gia sẽ hiện ở đây." />;

  const eventButton = (item: CalendarEvent, style?: React.CSSProperties) => (
    <button
      key={item.key}
      type="button"
      className={`meeting-event is-${item.status} ${item.key === selectedKey ? "is-selected" : ""}`}
      style={style}
      aria-pressed={item.key === selectedKey}
      onClick={() => setSelectedKey(item.key)}
    >
      <strong>{item.title}</strong>
      <span>
        {clock(item.start)}–{clock(item.end)} · {item.workspaceName}
      </span>
    </button>
  );

  return (
    <section className="meetings-calendar" aria-labelledby="meetings-title">
      <h1 id="meetings-title" className="sr-only">
        Quản lý Hội nghị TDTU
      </h1>

      {/* Thanh công cụ & Chuyển đổi chế độ xem */}
      <div className="meetings-hub-toolbar">
        <div className="meetings-hub-toolbar__top">
          <div className="meetings-hub-toolbar__title-group">
            <h2 className="meetings-hub-toolbar__heading">
              <Icon name="video" size={16} /> Hội nghị & Phòng họp
            </h2>

            {/* Bộ lọc nhóm / Khoa */}
            <select
              className="meetings-hub-select"
              value={groupId}
              aria-label="Lọc theo nhóm"
              onChange={(event) =>
                navigate({ view: "meetings", workspaceId: event.target.value || undefined }, true)
              }
            >
              <option value="">Tất cả các nhóm / Khoa</option>
              {groups?.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>

            {/* Ô tìm kiếm nhanh */}
            <div className="meetings-hub-search">
              <Icon name="search" size={13} />
              <input
                type="text"
                placeholder="Tìm phòng hoặc cuộc họp…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="meetings-hub-actions">
            {/* Chuyển đổi chế độ xem: Dạng Thẻ (Danh sách) vs Dạng Lịch tuần */}
            <div className="meetings-view-toggle">
              <button
                type="button"
                className={`meetings-view-toggle-btn ${viewMode === "cards" ? "is-active" : ""}`}
                onClick={() => setViewMode("cards")}
                title="Xem dạng thẻ phòng họp & danh sách"
              >
                <Icon name="grid-2x2" size={13} />
                <span>Danh sách & Phòng</span>
              </button>
              <button
                type="button"
                className={`meetings-view-toggle-btn ${viewMode === "calendar" ? "is-active" : ""}`}
                onClick={() => setViewMode("calendar")}
                title="Xem thời khóa biểu dạng lưới lịch tuần"
              >
                <Icon name="calendar" size={13} />
                <span>Lịch tuần</span>
              </button>
            </div>

            <Button
              size="sm"
              variant="secondary"
              icon="video"
              disabled={!rooms.length}
              onClick={() => setStartNow(true)}
            >
              Họp ngay
            </Button>
            <Button
              size="sm"
              icon="plus"
              disabled={!rooms.length}
              onClick={() => setForm({})}
            >
              Lên lịch
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <p className="inline-alert" role="alert">
          {error}
        </p>
      )}

      {!data && !error && (
        <p role="status" className="loading-note">
          Đang tải dữ liệu hội nghị…
        </p>
      )}

      {/* 3. NỘI DUNG CHÍNH THEO CHẾ ĐỘ XEM */}
      {viewMode === "cards" ? (
        /* CHẾ ĐỘ 1: DẠNG THẺ (DANH SÁCH & PHÒNG HỌP) */
        <div className={`meetings-cards-layout ${selected ? "has-detail" : ""}`}>
          <div className="meetings-cards-main">
            {/* Phân mục 1: Danh sách các phòng họp trực tuyến sẵn sàng */}
            <section className="meetings-rooms-section">
              <div className="meetings-section-head">
                <h3>
                  <Icon name="video" size={15} /> Phòng họp trực tuyến sẵn sàng
                </h3>
                <span>{filteredRooms.length} phòng khả dụng</span>
              </div>

              {filteredRooms.length === 0 ? (
                <div className="meetings-empty-card">
                  <Icon name="video" size={24} />
                  <p>Không tìm thấy phòng họp phù hợp với bộ lọc hiện tại.</p>
                </div>
              ) : (
                <div className="meetings-rooms-grid">
                  {filteredRooms.map((room) => {
                    const isLive = activeSessions.some((s) => s.roomId === room.id);
                    return (
                      <div key={room.id} className="meeting-room-card">
                        <div className="meeting-room-card__head">
                          <div className="meeting-room-card__icon">
                            <Icon name="video" size={16} />
                          </div>
                          <span className={`meeting-room-card__badge ${isLive ? "is-live" : "is-ready"}`}>
                            <span className={isLive ? "meeting-live-dot" : "meeting-ready-dot"} />
                            {isLive ? "Đang họp" : "Sẵn sàng"}
                          </span>
                        </div>

                        <div className="meeting-room-card__info">
                          <h4 className="meeting-room-card__title" title={room.name}>
                            {room.name}
                          </h4>
                          <p className="meeting-room-card__group" title={room.workspace}>
                            {room.workspace}
                          </p>
                        </div>

                        <div className="meeting-room-card__footer">
                          <Button
                            size="sm"
                            variant="primary"
                            icon="video"
                            onClick={() =>
                              navigate({
                                view: "meetings",
                                workspaceId: room.workspaceId,
                                channelId: room.id,
                              })
                            }
                          >
                            Vào phòng
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Phân mục 2: Lịch các cuộc họp theo danh sách (Agenda) */}
            <section className="meetings-agenda-section">
              <div className="meetings-section-head">
                <h3>
                  <Icon name="calendar" size={15} /> Lịch các cuộc họp
                </h3>
                <span>{filteredEvents.length} cuộc họp được lên lịch</span>
              </div>

              {filteredEvents.length === 0 ? (
                <div className="meetings-empty-card">
                  <Icon name="calendar" size={26} />
                  <p>Chưa có cuộc họp nào được lên lịch theo bộ lọc này.</p>
                  <Button size="sm" icon="plus" onClick={() => setForm({})}>
                    Lên lịch cuộc họp mới
                  </Button>
                </div>
              ) : (
                <div className="meeting-agenda-list">
                  {filteredEvents.map((item) => {
                    const isLive = item.status === "live";
                    const isUpcoming = item.status === "upcoming";
                    const isSelected = item.key === selectedKey;

                    return (
                      <div
                        key={item.key}
                        className={`meeting-agenda-item ${isSelected ? "is-selected" : ""}`}
                      >
                        <div className="meeting-agenda-item__left">
                          <div className="meeting-agenda-time-box">
                            <span className="meeting-agenda-time-box__date">
                              {dayMonth(item.start)}
                            </span>
                            <span className="meeting-agenda-time-box__clock">
                              {clock(item.start)}
                            </span>
                          </div>

                          <div className="meeting-agenda-item__info">
                            <div className="meeting-agenda-item__top">
                              <span className="meeting-agenda-item__title">{item.title}</span>
                              <span className={`meeting-agenda-item__badge is-${item.status}`}>
                                {STATUS_LABEL[item.status]}
                              </span>
                            </div>

                            <div className="meeting-agenda-item__meta">
                              <span>{item.workspaceName}</span>
                              <span>•</span>
                              <span>
                                {rooms.find((r) => r.id === item.roomId)?.name ?? "Phòng họp"}
                              </span>
                              <span>•</span>
                              <span>
                                {clock(item.start)} – {clock(item.end)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="meeting-agenda-item__actions">
                          {(isLive || isUpcoming) && (
                            <Button
                              size="sm"
                              variant={isLive ? "primary" : "secondary"}
                              icon="video"
                              onClick={() => openRoom(item)}
                            >
                              Vào họp
                            </Button>
                          )}

                          {schedule(item) && (
                            <IconButton
                              label="Tải lịch .ics"
                              icon="calendar"
                              onClick={() => downloadCalendarEvent(schedule(item)!)}
                            />
                          )}

                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedKey(isSelected ? "" : item.key)}
                          >
                            {isSelected ? "Đóng" : "Chi tiết"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Cột phải (30%): Các Widget tiện ích */}
          <div className="meetings-side-widgets">
            {/* Widget 1: Vào họp nhanh */}
            <div className="meetings-side-card">
              <div className="meetings-side-card__head">
                <h4 className="meetings-side-card__title">
                  <Icon name="video" size={15} /> Vào họp nhanh
                </h4>
              </div>

              <div className="meetings-quick-meet">
                <p>Chọn phòng họp khả dụng để bắt đầu phiên họp tức thì:</p>
                <div className="meetings-quick-meet__row">
                  <select
                    className="meetings-hub-select"
                    style={{ flex: 1 }}
                    value={quickRoomId || (rooms[0]?.id ?? "")}
                    onChange={(e) => setQuickRoomId(e.target.value)}
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.workspace})
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!rooms.length}
                    onClick={() => {
                      const targetId = quickRoomId || rooms[0]?.id;
                      const room = rooms.find((r) => r.id === targetId);
                      if (room) {
                        navigate({
                          view: "meetings",
                          workspaceId: room.workspaceId,
                          channelId: room.id,
                        });
                      }
                    }}
                  >
                    Vào ngay
                  </Button>
                </div>
              </div>
            </div>

            {/* Widget 2: Lịch tuần thu nhỏ (Mini Calendar) */}
            <div className="meetings-side-card">
              <div className="meetings-side-card__head">
                <h4 className="meetings-side-card__title">
                  <Icon name="calendar" size={15} /> Tuần {dayMonth(days[0]).slice(0, 2)}–{dayMonth(days[6])}
                </h4>
                <Button size="sm" variant="text" onClick={() => setViewMode("calendar")}>
                  Xem chi tiết
                </Button>
              </div>

              <div className="meetings-mini-calendar">
                {days.map((day, idx) => {
                  const isCurrentDay = idx === today;
                  const hasEvents = events.some((e) => isSameDay(e.start, day));
                  return (
                    <div
                      key={idx}
                      className={`meetings-mini-calendar__day ${isCurrentDay ? "is-today" : ""}`}
                      onClick={() => setViewMode("calendar")}
                      title={`${WEEKDAYS[idx]} ${dayMonth(day)}`}
                    >
                      <span className="meetings-mini-calendar__weekday">{WEEKDAYS[idx].replace("Thứ ", "T")}</span>
                      <span className="meetings-mini-calendar__date">{day.getDate()}</span>
                      {hasEvents && <span className="meetings-mini-calendar__dot" />}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Widget 3: Biên bản & Kết luận gần đây */}
            {pastSessions.length > 0 && (
              <div className="meetings-side-card">
                <div className="meetings-side-card__head">
                  <h4 className="meetings-side-card__title">
                    <Icon name="file" size={15} /> Biên bản & Ghi âm gần đây
                  </h4>
                </div>

                <div className="meetings-outcomes-list">
                  {pastSessions.map((session) => (
                    <div
                      key={session.id}
                      className="meetings-outcome-item"
                      onClick={() => {
                        const matchedEvent = events.find((e) => e.sessionId === session.id);
                        if (matchedEvent) {
                          setSelectedKey(matchedEvent.key);
                        } else {
                          // Select by id if available
                          setSelectedKey(session.id);
                        }
                      }}
                    >
                      <div className="meetings-outcome-item__info">
                        <span className="meetings-outcome-item__title">
                          {session.title || session.roomName}
                        </span>
                        <span className="meetings-outcome-item__date">
                          {dayMonth(new Date(session.startedAt))} · {session.workspaceName}
                        </span>
                      </div>
                      <IconButton label="Xem chi tiết" icon="chevron-right" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* CHẾ ĐỘ 2: DẠNG LƯỚI LỊCH TUẦN (WEEKLY GRID) */
        <div className={`meetings-calendar__body ${selected ? "has-detail" : ""}`}>
          <div>
            <div className="meetings-calendar__bar" style={{ marginBottom: 12 }}>
              <div className="meetings-calendar__week">
                <IconButton
                  label="Tuần trước"
                  icon="chevron-left"
                  onClick={() => setWeek(new Date(week.getTime() - 7 * DAY))}
                />
                <h2>
                  Tuần {dayMonth(days[0]).slice(0, 2)}–{dayMonth(days[6])}
                </h2>
                <IconButton
                  label="Tuần sau"
                  icon="chevron-right"
                  onClick={() => setWeek(new Date(week.getTime() + 7 * DAY))}
                />
                <Button size="sm" variant="secondary" onClick={() => setWeek(weekStart(new Date()))}>
                  Hôm nay
                </Button>
              </div>

              <span className="meetings-calendar__spacer" />

              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                Kéo hoặc bấm vào ô cuộc họp để xem chi tiết
              </span>
            </div>

            <div className="meeting-week" role="grid" aria-label="Lịch tuần">
              <div className="meeting-week__head" role="row">
                <span />
                {days.map((day, index) => (
                  <span key={index} role="columnheader" className={index === today ? "is-today" : ""}>
                    {WEEKDAYS[index]} <strong>{dayMonth(day)}</strong>
                  </span>
                ))}
              </div>
              <div
                className="meeting-week__grid"
                role="row"
                style={{ "--hours": LAST_HOUR - FIRST_HOUR } as React.CSSProperties}
              >
                <div className="meeting-week__hours" aria-hidden="true">
                  {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, index) => (
                    <span key={index}>{FIRST_HOUR + index}:00</span>
                  ))}
                </div>
                {days.map((day, index) => (
                  <div key={index} role="gridcell" className={`meeting-week__day ${index === today ? "is-today" : ""}`}>
                    {layoutDay(events, day).map(({ event, top, height, column, columns }) =>
                      eventButton(event, {
                        top: `${top}%`,
                        height: `${height}%`,
                        left: `${(column / columns) * 100}%`,
                        width: `${100 / columns}%`,
                      }),
                    )}
                  </div>
                ))}
              </div>
            </div>

            <ol className="meeting-days" aria-label="Lịch tuần theo ngày">
              {days.map((day, index) => {
                const items = layoutDay(events, day).map(({ event }) => event);
                return (
                  <li key={index} className={index === today ? "is-today" : ""}>
                    <h3>
                      {WEEKDAYS[index]} {dayMonth(day)}
                    </h3>
                    {items.length ? items.map((item) => eventButton(item)) : <p>Không có cuộc họp</p>}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}

      {/* 4. PANEL CHI TIẾT CUỘC HỌP (Drawer bên phải) */}
      {selected && (
        <aside className="meeting-detail" aria-label="Chi tiết cuộc họp">
          <div className="meeting-detail__head">
            <span className={`meeting-detail__status is-${selected.status}`}>{STATUS_LABEL[selected.status]}</span>
            <IconButton label="Đóng chi tiết" icon="x" onClick={() => setSelectedKey("")} />
          </div>
          <h2>{selected.title}</h2>
          <p>
            {selected.workspaceName} · {rooms.find((room) => room.id === selected.roomId)?.name ?? "Phòng họp"}
          </p>
          <p>
            <Icon name="clock" size={14} /> {dayMonth(selected.start)} · {clock(selected.start)}–{clock(selected.end)}
          </p>
          {schedule(selected)?.description && (
            <p className="meeting-detail__note">{schedule(selected)?.description}</p>
          )}
          {selected.status !== "past" && (
            <>
              {selected.status === "live" && (
                <p className="meeting-detail__people">
                  <Icon name="users" size={14} />{" "}
                  {selected.people.length ? `Đang trong phòng: ${selected.people.join(", ")}` : "Chưa có ai trong phòng"}
                </p>
              )}
              <div className="meeting-detail__actions">
                <Button icon="video" onClick={() => openRoom(selected)}>
                  Vào phòng
                </Button>
                {schedule(selected) && (
                  <Button
                    variant="text"
                    size="sm"
                    icon="calendar"
                    onClick={() => downloadCalendarEvent(schedule(selected)!)}
                  >
                    Tải .ics
                  </Button>
                )}
                {selected.canManage && schedule(selected) && (
                  <>
                    <Button
                      variant="text"
                      size="sm"
                      icon="edit"
                      onClick={() => setForm({ item: schedule(selected) })}
                    >
                      Sửa
                    </Button>
                    <Button
                      variant="text"
                      size="sm"
                      icon="clipboard"
                      onClick={() => setCouncilFor(schedule(selected)!)}
                    >
                      Hội đồng
                    </Button>
                    <Button
                      variant="text"
                      size="sm"
                      onClick={() => setCancelId(selected.scheduleId ?? "")}
                    >
                      Huỷ
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
          {selected.status !== "live" && selected.sessionId ? (
            <div className="meeting-detail__past">
              {selected.people.length > 0 && <p>Đã tham gia: {selected.people.join(", ")}</p>}
              <MeetingRecordingPanel sessionId={selected.sessionId} live={false} />
              <MeetingOutcomesPanel sessionId={selected.sessionId} live={false} />
              <MeetingCouncilPanel sessionId={selected.sessionId} live={false} />
              <MeetingAttendancePanel sessionId={selected.sessionId} />
            </div>
          ) : selected.status === "past" ? (
            <p>Cuộc họp này đã qua giờ mà chưa ai vào phòng.</p>
          ) : null}
        </aside>
      )}

      {/* 5. CÁC HỘP THOẠI DIALOGS */}
      <AnimatePresence>
        {form && groups && (
          <ScheduleDialog
            item={form.item}
            groups={groups}
            rooms={rooms}
            defaultGroupId={groupId}
            onClose={() => setForm(null)}
            onSaved={(saved) => {
              setForm(null);
              setWeek(weekStart(new Date(saved.startsAt)));
              setSelectedKey(saved.id);
              setRevision((value) => value + 1);
              notify("Đã lưu lịch họp", `${saved.title} · ${new Date(saved.startsAt).toLocaleString("vi-VN")}`, "success");
            }}
          />
        )}
        {startNow && groups && (
          <StartNowDialog
            groups={groups}
            rooms={rooms}
            defaultGroupId={groupId}
            onClose={() => setStartNow(false)}
          />
        )}
        {councilFor && (
          <CouncilSetupDialog
            scheduleId={councilFor.id}
            workspaceId={councilFor.workspaceId}
            onClose={() => setCouncilFor(null)}
            onSaved={() => {
              setCouncilFor(null);
              notify("Đã lưu hội đồng", councilFor.title, "success");
            }}
          />
        )}
        {cancelId && (
          <ConfirmDialog
            title="Huỷ lịch"
            description="Hủy lịch họp này? Lịch sẽ không còn xuất hiện trong lịch của nhóm."
            confirmLabel="Xác nhận huỷ"
            loading={cancelling}
            onClose={() => setCancelId("")}
            onConfirm={() => void cancel()}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

const roomsOf = (rooms: MeetingRoom[], groupId: string) => rooms.filter((room) => room.workspaceId === groupId);
const meetingGroups = (groups: WorkspaceItem[], rooms: MeetingRoom[]) =>
  groups.filter((group) => !group.archivedAt && rooms.some((room) => room.workspaceId === group.id));
const firstGroup = (choices: WorkspaceItem[], ...preferred: (string | null)[]) =>
  preferred.find((id) => id && choices.some((group) => group.id === id)) ?? choices[0]?.id ?? "";
function lastWorkspace() {
  try {
    return localStorage.getItem(LAST_WORKSPACE);
  } catch {
    return null;
  }
}

/** "+ Lên lịch" / "Sửa": the schedule form, now with the group picked first. */
function ScheduleDialog({
  item,
  groups,
  rooms,
  defaultGroupId,
  onClose,
  onSaved,
}: {
  item?: MeetingScheduleItem;
  groups: WorkspaceItem[];
  rooms: MeetingRoom[];
  defaultGroupId: string;
  onClose: () => void;
  onSaved: (saved: MeetingScheduleItem) => void;
}) {
  const { accessToken } = useApp();
  const choices = meetingGroups(groups, rooms);
  const [groupId, setGroupId] = useState(() => item?.workspaceId ?? firstGroup(choices, defaultGroupId, lastWorkspace()));
  const [roomId, setRoomId] = useState(() => item?.roomId ?? roomsOf(rooms, groupId)[0]?.id ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [agenda, setAgenda] = useState((item?.agenda ?? []).join("\n"));
  const [start, setStart] = useState(() => {
    if (item) return localDateTime(new Date(item.startsAt));
    const next = new Date(Date.now() + 3_600_000);
    next.setMinutes(0, 0, 0);
    if (next.getTime() < Date.now() + 60_000) next.setHours(next.getHours() + 1);
    return localDateTime(next);
  });
  const [end, setEnd] = useState(() => (item ? localDateTime(new Date(item.endsAt)) : localDateTime(new Date(new Date(start).getTime() + 3_600_000))));
  const [settings, setSettings] = useState({
    waitingRoom: item?.waitingRoom ?? false,
    autoRecord: item?.autoRecord ?? false,
    muteOnJoin: item?.muteOnJoin ?? false,
  });
  const [invite, setInvite] = useState<InviteState>(() => ({
    mode: item?.inviteeIds?.length ? "list" : "all",
    userIds: item?.inviteeIds ?? [],
    workspaceIds: [],
    unitIds: [],
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!accessToken || saving) return;
    const startsAt = new Date(start);
    const endsAt = new Date(end);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
      setError("Chọn thời gian bắt đầu và kết thúc hợp lệ.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await saveMeetingScheduleApi(
        accessToken,
        {
          roomId,
          title: title.trim(),
          description: description.trim(),
          agenda: agenda
            .split("\n")
            .map((line) => line.replace(/^\s*[-•*]\s*/, "").trim())
            .filter(Boolean),
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          ...settings,
          invite: inviteInput(invite),
        },
        item?.id,
      );
      onSaved(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không lưu được lịch họp.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={item ? "Sửa lịch họp" : "Lên lịch họp"}
      initialFocus="input"
      onClose={() => !saving && onClose()}
      footer={
        <div className="modal-footer-actions">
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Hủy
          </Button>
          <Button loading={saving} disabled={!roomId || title.trim().length < 3} onClick={() => void submit()}>
            {item ? "Lưu thay đổi" : "Tạo lịch họp"}
          </Button>
        </div>
      }
    >
      <form className="ws-modal-form meeting-schedule-dialog" onSubmit={(event) => void submit(event)}>
        <Field label="Tên cuộc họp" error={error}>
          <input required minLength={3} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ví dụ: Họp tiến độ đồ án" />
        </Field>
        <Field label="Nhóm">
          <select
            value={groupId}
            disabled={Boolean(item)}
            onChange={(event) => {
              setGroupId(event.target.value);
              setRoomId(roomsOf(rooms, event.target.value)[0]?.id ?? "");
            }}
          >
            {choices.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
        {roomsOf(rooms, groupId).length > 1 && (
          <Field label="Phòng họp">
            <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
              {roomsOf(rooms, groupId).map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="meeting-schedule-dialog__times">
          <Field label="Bắt đầu">
            <input required type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} />
          </Field>
          <Field label="Kết thúc">
            <input required type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} />
          </Field>
        </div>
        <Field label="Nội dung chuẩn bị">
          <textarea rows={2} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Nội dung, tài liệu cần chuẩn bị…" />
        </Field>
        <Field label="Agenda (mỗi dòng một mục)" hint="Thời gian theo múi giờ của thiết bị bạn.">
          <textarea rows={3} value={agenda} onChange={(event) => setAgenda(event.target.value)} placeholder={"Báo cáo tiến độ\nPhân công tuần tới"} />
        </Field>
        <ScheduleInviteFields workspaceId={groupId} groups={groups} value={invite} onChange={setInvite} />
        <fieldset className="meeting-room-settings">
          <legend>Cấu hình phòng</legend>
          {(
            [
              ["waitingRoom", "Bật phòng chờ (người ngoài danh sách mời chờ duyệt)"],
              ["autoRecord", "Tự động ghi hình khi bắt đầu"],
              ["muteOnJoin", "Tắt micro khi vào phòng"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input type="checkbox" checked={settings[key]} onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })} />
              {label}
            </label>
          ))}
        </fieldset>
      </form>
    </Modal>
  );
}

/** "Họp ngay": pick the group (and the room when it has several), then the device check. */
function StartNowDialog({
  groups,
  rooms,
  defaultGroupId,
  onClose,
}: {
  groups: WorkspaceItem[];
  rooms: MeetingRoom[];
  defaultGroupId: string;
  onClose: () => void;
}) {
  const { navigate } = useApp();
  const choices = meetingGroups(groups, rooms);
  const [groupId, setGroupId] = useState(() => firstGroup(choices, lastWorkspace(), defaultGroupId));
  const [roomId, setRoomId] = useState(() => roomsOf(rooms, groupId)[0]?.id ?? "");
  const go = () => roomId && navigate({ view: "meetings", workspaceId: groupId, channelId: roomId });
  return (
    <Modal
      title="Họp ngay"
      initialFocus="select"
      onClose={onClose}
      footer={
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button icon="video" disabled={!roomId} onClick={go}>
            Tiếp tục
          </Button>
        </div>
      }
    >
      <form
        className="ws-modal-form"
        onSubmit={(event) => {
          event.preventDefault();
          go();
        }}
      >
        <Field label="Nhóm">
          <select
            value={groupId}
            onChange={(event) => {
              setGroupId(event.target.value);
              setRoomId(roomsOf(rooms, event.target.value)[0]?.id ?? "");
            }}
          >
            {choices.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </Field>
        {roomsOf(rooms, groupId).length > 1 && (
          <Field label="Phòng họp">
            <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
              {roomsOf(rooms, groupId).map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </form>
    </Modal>
  );
}
