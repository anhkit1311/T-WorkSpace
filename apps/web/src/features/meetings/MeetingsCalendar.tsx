import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AnimatePresence } from "motion/react";
import type { MeetingCalendar, MeetingScheduleItem, WorkspaceItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Icon } from "../../shared/ui/Icon";
import { Button, ConfirmDialog, Field, Modal } from "../../shared/ui/Primitives";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import { cn } from "../../shared/lib/utils";
import { NoGroups } from "../workspaces/GroupDialogs";
import { cancelMeetingScheduleApi, getMeetingCalendarApi, saveMeetingScheduleApi } from "./api";
import { SEG, SEG_BTN } from "../admin/ui";
import { calendarEvents, weekStart, type CalendarEvent } from "./calendar";
import { MeetingAttendancePanel } from "./MeetingAttendancePanel";
import { DatePicker, isoDay, TimePicker } from "./DateTimeFields";
import { MeetingClock } from "./MeetingClock";
import { MeetingOutcomesPanel } from "./MeetingOutcomesPanel";
import { MeetingRecordingPanel } from "./MeetingRecordingPanel";
import { inviteInput, ScheduleInviteFields, type InviteState } from "./ScheduleInviteFields";

export type MeetingRoom = { id: string; name: string; workspace: string; workspaceId: string };

const DAY = 86_400_000;
const LAST_WORKSPACE = "meeting:lastWorkspace";
const BTN =
  "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 text-[13.5px] font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-primary text-primary-foreground hover:bg-primary/90`;
const BTN_GHOST = `${BTN} border bg-card text-foreground hover:bg-secondary`;
const BTN_SM = "h-[30px] px-3 text-[13px]";
const LINK =
  "h-[30px] cursor-pointer rounded-md px-2 text-[13px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground";
const GROUP_LABEL =
  "grid! gap-1.5! text-xs! font-semibold tracking-[.05em] text-muted-foreground! uppercase";
const INPUT =
  "h-[38px] w-full rounded-lg! bg-card! px-3! py-0! text-sm! font-normal tracking-normal text-foreground normal-case outline-none focus:border-foreground!";
// Grows with its text instead of a drag handle (field-sizing: Chromium; others keep `rows`).
const AREA =
  "min-h-[60px] w-full resize-none rounded-lg! bg-card! px-3! py-2! text-sm! leading-relaxed text-foreground outline-none [field-sizing:content] focus:border-foreground!";
const ICON_BTN =
  "grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground";
const CHIP =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap";
const WEEKDAYS = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];

// Day labels and times in Vietnam time, matching how the week is cut.
const zone = { timeZone: "Asia/Ho_Chi_Minh" } as const;
const dayMonth = (date: Date) => {
  const [{ value: day }, , { value: month }] = new Intl.DateTimeFormat("en-GB", {
    ...zone,
    day: "2-digit",
    month: "2-digit",
  }).formatToParts(date);
  return `${day}/${month}`;
};
const clock = (date: Date) =>
  date.toLocaleTimeString("vi-VN", { ...zone, hour: "2-digit", minute: "2-digit" });

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

/** "Họp": meetings running now, the week's agenda as a timeline, rooms and recent minutes; or the week grid. */
export function MeetingsCalendar({
  groups,
  rooms,
}: {
  groups: WorkspaceItem[] | null;
  rooms: MeetingRoom[];
}) {
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
  const [cancelling, setCancelling] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<"next" | "past" | "rooms">("next");

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
        .catch(
          (reason) =>
            active &&
            setError(reason instanceof Error ? reason.message : "Không tải được lịch họp."),
        );
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [accessToken, week, revision]);

  const events = useMemo(
    () =>
      data
        ? calendarEvents(data, now).filter((item) => !groupId || item.workspaceId === groupId)
        : [],
    [data, now, groupId],
  );

  const days = Array.from({ length: 7 }, (_, index) => new Date(week.getTime() + index * DAY));
  const today =
    weekStart(now).getTime() === week.getTime()
      ? Math.floor((now.getTime() - week.getTime()) / DAY)
      : -1;
  const schedule = (item: CalendarEvent) =>
    data?.schedules.find((entry) => entry.id === item.scheduleId);
  const openRoom = (item: { workspaceId: string; roomId: string; scheduleId?: string | null }) =>
    navigate({
      view: "meetings",
      workspaceId: item.workspaceId,
      channelId: item.roomId,
      scheduleId: item.scheduleId ?? undefined,
    });

  // Counts & sessions
  const activeSessions = useMemo(() => data?.sessions.filter((s) => !s.endedAt) ?? [], [data]);

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
      notify(
        "Không huỷ được lịch họp",
        reason instanceof Error ? reason.message : "Hãy thử lại.",
        "warning",
      );
    } finally {
      setCancelling(false);
    }
  };

  if (groups?.length === 0)
    return <NoGroups text="Cuộc họp của các nhóm bạn tham gia sẽ hiện ở đây." />;

  // Day of the loaded week (Vietnam time), so labels match how the week is cut.
  const dayIndex = (date: Date) => Math.floor((date.getTime() - week.getTime()) / DAY);
  const dayLabel = (date: Date) => {
    const index = dayIndex(date);
    const name = index >= 0 && index < 7 ? `${WEEKDAYS[index]}, ` : "";
    const prefix =
      today >= 0 && index === today
        ? "Hôm nay · "
        : today >= 0 && index === today + 1
          ? "Ngày mai · "
          : "";
    return `${prefix}${name}${dayMonth(date)}`;
  };
  const query = searchQuery.trim().toLowerCase();
  const liveSessions = activeSessions.filter(
    (session) =>
      (!groupId || session.workspaceId === groupId) &&
      (!query ||
        (session.title ?? session.roomName).toLowerCase().includes(query) ||
        session.workspaceName.toLowerCase().includes(query)),
  );
  const liveIn = (roomId: string) => activeSessions.find((session) => session.roomId === roomId);
  const counts = {
    next: filteredEvents.filter((item) => item.status !== "past").length,
    past: filteredEvents.filter((item) => item.status === "past").length,
  };
  const agendaDays = filteredEvents
    .filter((item) => (tab === "past") === (item.status === "past"))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .reduce<{ label: string; items: CalendarEvent[] }[]>((list, item) => {
      const label = dayLabel(item.start);
      const last = list[list.length - 1];
      if (last?.label === label) last.items.push(item);
      else list.push({ label, items: [item] });
      return list;
    }, []);
  const roomOf = (roomId: string) => rooms.find((room) => room.id === roomId)?.name ?? "Phòng họp";
  const weekTitle = `Tuần ${dayMonth(days[0]).slice(0, 2)}–${dayMonth(days[6])}`;
  const weekNav = (
    <div className="flex items-center gap-1 text-[13px]">
      <button
        type="button"
        className={ICON_BTN}
        aria-label="Tuần trước"
        title="Tuần trước"
        onClick={() => setWeek(new Date(week.getTime() - 7 * DAY))}
      >
        <Icon name="chevron-left" size={16} />
      </button>
      <span className="font-medium text-foreground">{weekTitle}</span>
      <button
        type="button"
        className={ICON_BTN}
        aria-label="Tuần sau"
        title="Tuần sau"
        onClick={() => setWeek(new Date(week.getTime() + 7 * DAY))}
      >
        <Icon name="chevron-right" size={16} />
      </button>
      {today < 0 && (
        <button
          type="button"
          className={cn(BTN_GHOST, BTN_SM, "ml-auto")}
          onClick={() => setWeek(weekStart(new Date()))}
        >
          Hôm nay
        </button>
      )}
    </div>
  );

  const listed = agendaDays.flatMap((day) => day.items);
  const current = listed.find((item) => item.key === selectedKey) ?? listed[0];
  const statusChip = (item: CalendarEvent) =>
    item.status === "live" ? (
      <span className={cn(CHIP, "bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)]")}>
        <i className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />
        Đang họp
      </span>
    ) : item.status === "past" ? (
      <span className={cn(CHIP, "bg-secondary text-muted-foreground")}>Đã kết thúc</span>
    ) : (
      <span className={cn(CHIP, "bg-brand-soft text-brand")}>Sắp tới</span>
    );
  const facts = (item: CalendarEvent) => (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <Icon name="calendar" size={14} />
        {dayLabel(item.start)}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Icon name="clock" size={14} />
        {clock(item.start)}–{clock(item.end)} ·{" "}
        {Math.max(1, Math.round((item.end.getTime() - item.start.getTime()) / 60_000))} phút
      </span>
      {item.people.length > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <Icon name="users" size={14} />
          {item.people.length} người {item.status === "live" ? "trong phòng" : "tham gia"}
        </span>
      )}
    </div>
  );

  // Upcoming or live: when, where, who is in, and how to get in.
  const detailOf = (item: CalendarEvent) => {
    const plan = schedule(item);
    return (
      <div className="grid content-start gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {statusChip(item)}
          {item.status === "live" && (
            <span className="text-[13px] text-muted-foreground">
              <MeetingClock since={item.start.toISOString()} />
            </span>
          )}
          <span className="flex-1" />
          {plan && (
            <button
              type="button"
              className={cn(BTN_GHOST, BTN_SM)}
              onClick={() => downloadCalendarEvent(plan)}
            >
              <Icon name="calendar" size={15} />
              Tải .ics
            </button>
          )}
          {plan && item.canManage && (
            <>
              <button type="button" className={LINK} onClick={() => setForm({ item: plan })}>
                Sửa
              </button>
              <button
                type="button"
                className={cn(LINK, "text-red-600 hover:text-red-600")}
                onClick={() => setCancelId(item.scheduleId ?? "")}
              >
                Hủy họp
              </button>
            </>
          )}
        </div>
        <h2 className="text-[22px]! leading-tight font-bold! tracking-tight text-foreground!">
          {item.title}
        </h2>
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13.5px] [&_dt]:text-muted-foreground">
          <dt>Thời gian</dt>
          <dd>
            {clock(item.start)}–{clock(item.end)} · {dayLabel(item.start)}
          </dd>
          <dt>Nhóm / phòng</dt>
          <dd>
            {item.workspaceName} · {roomOf(item.roomId)}
          </dd>
          {plan?.description && (
            <>
              <dt>Mô tả</dt>
              <dd className="whitespace-pre-wrap">{plan.description}</dd>
            </>
          )}
          {item.canManage && (
            <>
              <dt>Quyền</dt>
              <dd>Bạn quản lý cuộc họp này</dd>
            </>
          )}
        </dl>
        <div className="grid gap-2.5 rounded-xl border p-4">
          <b className="text-sm font-semibold">
            {item.status === "live" ? `Trong phòng (${item.people.length})` : "Người tham gia"}
          </b>
          {item.people.length ? (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {item.people.map((name) => (
                <span key={name} className="inline-flex items-center gap-2 text-[13px]">
                  <UserAvatar name={name} className="size-7 text-[11px]" />
                  {name}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-[13px] text-muted-foreground">
              {item.status === "live" ? "Chưa có ai trong phòng." : "Chưa có ai vào phòng."}
            </span>
          )}
        </div>
        <div>
          <button
            type="button"
            className={cn(BTN_PRIMARY, "h-[42px] px-5")}
            onClick={() => openRoom(item)}
          >
            <Icon name="video" size={17} />
            Vào phòng họp
          </button>
        </div>
      </div>
    );
  };

  // Past: the meeting report, read top to bottom like minutes; agenda and notes stay beside it.
  const reportOf = (item: CalendarEvent) => (
    <div className="grid content-start gap-4">
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          {statusChip(item)}
          <span className="text-[13px] text-muted-foreground">
            {item.workspaceName} · {roomOf(item.roomId)}
          </span>
        </div>
        <h2 className="text-[22px]! leading-tight font-bold! tracking-tight text-foreground!">
          {item.title}
        </h2>
        {facts(item)}
      </div>
      {item.sessionId ? (
        <div className="grid min-w-0 items-start gap-4 min-[1300px]:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid min-w-0 gap-4">
            <MeetingRecordingPanel sessionId={item.sessionId} live={false} />
            <MeetingOutcomesPanel sessionId={item.sessionId} live={false} sections={["tasks"]} />
            <MeetingAttendancePanel sessionId={item.sessionId} auto />
          </div>
          <div className="min-w-0 min-[1300px]:sticky min-[1300px]:top-2">
            <MeetingOutcomesPanel
              sessionId={item.sessionId}
              live={false}
              sections={["agenda", "notes", "channel"]}
            />
          </div>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed p-6 text-center text-[13px] text-muted-foreground">
          Đã qua giờ mà chưa ai vào phòng, nên không có biên bản.
        </p>
      )}
    </div>
  );

  const empty = (text: string, action?: React.ReactNode) => (
    <div className="grid justify-items-center gap-3 px-4 py-10 text-center text-sm text-muted-foreground">
      <Icon name="calendar" size={22} />
      <span>{text}</span>
      {action}
    </div>
  );
  const group = groups?.find((item) => item.id === groupId);

  return (
    <section
      className="tw flex w-full flex-col gap-4 text-sm text-foreground"
      aria-labelledby="meetings-title"
    >
      <header className="flex flex-wrap items-center gap-2.5">
        <h1
          id="meetings-title"
          className="mr-auto text-[22px] leading-8 font-bold tracking-normal text-foreground"
        >
          Họp
        </h1>
        <label className="flex h-[34px] w-[280px] items-center gap-2 rounded-md border bg-card px-2.5 text-muted-foreground focus-within:border-foreground max-md:order-last max-md:w-full">
          <Icon name="search" size={15} />
          <input
            type="search"
            className="w-0 min-w-0 flex-1 bg-transparent text-[13px] text-foreground !outline-none placeholder:text-muted-foreground"
            placeholder="Tìm cuộc họp, phòng hoặc nhóm"
            aria-label="Tìm cuộc họp, phòng hoặc nhóm"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={BTN_GHOST}
          disabled={!rooms.length}
          onClick={() => setForm({})}
        >
          <Icon name="calendar" size={17} />
          Lên lịch
        </button>
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={!rooms.length}
          onClick={() => setStartNow(true)}
        >
          <Icon name="video" size={17} />
          Họp ngay
        </button>
      </header>

      {error && (
        <p
          className="rounded-md bg-[var(--tint-red-bg)] px-3 py-2 text-[13px] text-[var(--tint-red-fg)]"
          role="alert"
        >
          {error}
        </p>
      )}
      {!data && !error && (
        <p role="status" className="text-[13px] text-muted-foreground">
          Đang tải dữ liệu cuộc họp…
        </p>
      )}

      {/* Rooms in use right now, scheduled or not. */}
      {liveSessions.map((session) => (
        <article
          key={session.id}
          className="flex flex-wrap items-center gap-3.5 rounded-[14px] bg-primary px-4.5 py-3.5 text-primary-foreground"
        >
          <span className="size-2.5 shrink-0 rounded-full bg-red-500 ring-4 ring-red-500/25 motion-safe:animate-pulse" />
          <div className="grid min-w-0 flex-1 basis-56">
            <b className="truncate text-base font-semibold">{session.title ?? session.roomName}</b>
            <span className="truncate text-[13px] opacity-70">
              Đang diễn ra · {session.roomName} · {session.workspaceName} ·{" "}
              <MeetingClock since={session.startedAt} />
              {session.people.length > 0 && ` · ${session.people.length} người trong phòng`}
            </span>
          </div>
          <PeopleStack names={session.people} />
          <button
            type="button"
            className={cn(BTN, "bg-primary-foreground text-primary hover:bg-primary-foreground/90")}
            onClick={() =>
              openRoom({
                workspaceId: session.workspaceId,
                roomId: session.roomId,
                scheduleId: session.scheduleId,
              })
            }
          >
            Tham gia
          </button>
        </article>
      ))}

      <div className="grid min-h-[560px] min-w-0 overflow-hidden rounded-xl border bg-card min-[900px]:grid-cols-[340px_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start border-b bg-background max-[899px]:max-h-[420px] max-[899px]:overflow-y-auto min-[900px]:border-r min-[900px]:border-b-0">
          <div className="sticky top-0 z-[1] grid gap-2 border-b bg-background p-3">
            <div className={cn(SEG, "w-full")} role="tablist" aria-label="Cuộc họp">
              {(
                [
                  ["next", "Sắp tới", counts.next],
                  ["past", "Đã họp", counts.past],
                  ["rooms", "Phòng", filteredRooms.length],
                ] as const
              ).map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  aria-pressed={tab === value}
                  className={cn(SEG_BTN, "flex-1")}
                  onClick={() => {
                    setTab(value);
                    setSelectedKey("");
                  }}
                >
                  {label}
                  <small className="ml-1 text-xs font-normal text-muted-foreground">{count}</small>
                </button>
              ))}
            </div>
            {tab !== "rooms" && weekNav}
            {group && (
              <button
                type="button"
                className={cn(CHIP, "w-max cursor-pointer bg-secondary text-foreground")}
                title="Bỏ lọc theo nhóm"
                onClick={() => navigate({ view: "meetings" }, true)}
              >
                {group.name} <Icon name="x" size={12} />
              </button>
            )}
          </div>

          {tab === "rooms" ? (
            filteredRooms.length === 0 ? (
              empty("Không tìm thấy phòng họp phù hợp.")
            ) : (
              <ul className="py-1">
                {filteredRooms.map((room) => {
                  const live = liveIn(room.id);
                  return (
                    <li key={room.id} className="flex items-center gap-3 px-3.5 py-2.5">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          live ? "bg-emerald-500" : "bg-border",
                        )}
                      />
                      <span className="grid min-w-0 flex-1">
                        <b className="truncate text-[13.5px] font-semibold">{room.name}</b>
                        <small className="truncate text-xs text-muted-foreground">
                          {live ? `Đang họp · ${live.people.length} người` : "Sẵn sàng"} ·{" "}
                          {room.workspace}
                        </small>
                      </span>
                      <button
                        type="button"
                        className={cn(live ? BTN_PRIMARY : BTN_GHOST, BTN_SM)}
                        aria-label={`Vào ${room.name}`}
                        onClick={() =>
                          navigate({
                            view: "meetings",
                            workspaceId: room.workspaceId,
                            channelId: room.id,
                          })
                        }
                      >
                        {live ? "Tham gia" : "Vào"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : agendaDays.length === 0 ? (
            empty(
              tab === "past"
                ? "Tuần này chưa có cuộc họp nào đã qua."
                : "Tuần này chưa có cuộc họp nào sắp tới.",
              tab === "next" && (
                <button
                  type="button"
                  className={cn(BTN_PRIMARY, BTN_SM)}
                  disabled={!rooms.length}
                  onClick={() => setForm({})}
                >
                  Lên lịch cuộc họp mới
                </button>
              ),
            )
          ) : (
            agendaDays.map((day) => (
              <div key={day.label} className="pb-1">
                <h2
                  className={cn(
                    "px-3.5 pt-3 pb-1 text-[11.5px]! leading-4 font-semibold! tracking-wider uppercase",
                    day.label.startsWith("Hôm nay") ? "text-brand!" : "text-muted-foreground!",
                  )}
                >
                  {day.label}
                </h2>
                {day.items.map((item) => {
                  const on = item.key === current?.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      data-meeting-row
                      aria-current={on || undefined}
                      onClick={() => setSelectedKey(item.key)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-3 border-l-[3px] border-transparent px-3 py-2.5 text-left hover:bg-card",
                        on && "border-brand bg-card",
                      )}
                    >
                      <span className="w-11 shrink-0 text-[13px] leading-tight font-semibold tabular-nums">
                        {clock(item.start)}
                        <small className="block text-[11px] font-normal text-muted-foreground">
                          {clock(item.end)}
                        </small>
                      </span>
                      <span className="grid min-w-0 flex-1">
                        <b className="truncate text-[13.5px] font-semibold">{item.title}</b>
                        <small className="truncate text-xs text-muted-foreground">
                          {item.workspaceName} · {roomOf(item.roomId)}
                        </small>
                      </span>
                      {item.status === "live" && (
                        <span
                          className="size-2 shrink-0 rounded-full bg-red-500 ring-4 ring-red-500/20"
                          aria-label="Đang họp"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="min-w-0 px-6 py-5 max-md:px-4" aria-label="Chi tiết cuộc họp">
          {tab === "rooms" || !current
            ? empty(
                tab === "rooms"
                  ? "Chọn một phòng để vào họp bất cứ lúc nào."
                  : "Chọn một cuộc họp ở cột trái để xem chi tiết.",
              )
            : current.status === "past"
              ? reportOf(current)
              : detailOf(current)}
        </div>
      </div>

      <AnimatePresence>
        {form && groups && (
          <ScheduleDialog
            item={form.item}
            groups={groups}
            rooms={rooms}
            defaultGroupId={groupId}
            busyDays={new Set(events.map((event) => isoDay(event.start)))}
            onClose={() => setForm(null)}
            onSaved={(saved) => {
              setForm(null);
              setWeek(weekStart(new Date(saved.startsAt)));
              setTab("next");
              setSelectedKey(saved.id);
              setRevision((value) => value + 1);
              notify(
                "Đã lưu lịch họp",
                `${saved.title} · ${new Date(saved.startsAt).toLocaleString("vi-VN")}`,
                "success",
              );
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

/** Up to three faces of the people in a room, then "+N". */
function PeopleStack({ names, max = 3 }: { names: string[]; max?: number }) {
  if (!names.length) return null;
  return (
    <span className="tw flex shrink-0" title={names.join(", ")}>
      {names.slice(0, max).map((name, index) => (
        <UserAvatar
          key={`${name}-${index}`}
          name={name}
          className="-ml-2 size-[26px] text-[10.5px] ring-2 ring-background first:ml-0"
        />
      ))}
      {names.length > max && (
        <span className="-ml-2 grid size-[26px] place-items-center rounded-full bg-secondary text-[10.5px] font-semibold text-foreground ring-2 ring-background">
          +{names.length - max}
        </span>
      )}
    </span>
  );
}

const roomsOf = (rooms: MeetingRoom[], groupId: string) =>
  rooms.filter((room) => room.workspaceId === groupId);
const meetingGroups = (groups: WorkspaceItem[], rooms: MeetingRoom[]) =>
  groups.filter(
    (group) => !group.archivedAt && rooms.some((room) => room.workspaceId === group.id),
  );
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
  busyDays,
  onClose,
  onSaved,
}: {
  item?: MeetingScheduleItem;
  busyDays?: Set<string>;
  groups: WorkspaceItem[];
  rooms: MeetingRoom[];
  defaultGroupId: string;
  onClose: () => void;
  onSaved: (saved: MeetingScheduleItem) => void;
}) {
  const { accessToken } = useApp();
  const choices = meetingGroups(groups, rooms);
  const [groupId, setGroupId] = useState(
    () => item?.workspaceId ?? firstGroup(choices, defaultGroupId, lastWorkspace()),
  );
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
  const [end, setEnd] = useState(() =>
    item
      ? localDateTime(new Date(item.endsAt))
      : localDateTime(new Date(new Date(start).getTime() + 3_600_000)),
  );
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

  // One day per meeting: the date and the two times are edited apart, `start`/`end` stay the source.
  const date = start.slice(0, 10);
  const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
  const setDate = (value: string) => {
    if (!value) return;
    setStart(`${value}T${start.slice(11, 16)}`);
    setEnd(`${value}T${end.slice(11, 16)}`);
  };
  const setDuration = (length: number) =>
    setEnd(localDateTime(new Date(new Date(start).getTime() + length * 60_000)));
  const startDate = new Date(start);
  const summary = Number.isFinite(startDate.getTime())
    ? `${WEEKDAYS[(startDate.getDay() + 6) % 7]} ${dayMonth(startDate)} · ${start.slice(11, 16)}–${end.slice(11, 16)}`
    : "";
  const picked = invite.userIds.length + invite.workspaceIds.length + invite.unitIds.length;
  const groupName = choices.find((group) => group.id === groupId)?.name;

  return (
    <Modal
      title={item ? "Sửa lịch họp" : "Lên lịch họp"}
      eyebrow={groupName}
      icon="calendar"
      size="wide"
      initialFocus="input"
      onClose={() => !saving && onClose()}
      footer={
        <>
          <span className="mr-auto min-w-0 text-[12.5px] text-muted-foreground">
            <b className="font-semibold text-foreground">{summary}</b>
            {" · "}
            {invite.mode === "all" ? "cả nhóm" : `${picked} lựa chọn mời`}
          </span>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Hủy
          </Button>
          <Button
            icon="check"
            loading={saving}
            disabled={!roomId || title.trim().length < 3 || minutes <= 0}
            onClick={() => void submit()}
          >
            {item ? "Lưu thay đổi" : "Tạo lịch họp"}
          </Button>
        </>
      }
    >
      <form
        className="tw tw-form grid min-[820px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
        onSubmit={(event) => void submit(event)}
      >
        <div className="grid content-start gap-[18px] px-5 py-[18px]">
          <div className="grid gap-1">
            <input
              className={cn(
                "w-full rounded-none! border-0! border-b! bg-transparent! px-0! pt-1! pb-2.5! text-xl! font-semibold outline-none placeholder:font-medium placeholder:text-muted-foreground focus:border-foreground!",
                error && "border-destructive!",
              )}
              aria-label="Tên cuộc họp"
              required
              minLength={3}
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Tên cuộc họp, ví dụ: Họp tiến độ đồ án"
            />
            {error && (
              <small className="text-[12.5px] font-medium text-destructive" role="alert">
                {error}
              </small>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <label className={GROUP_LABEL}>
              Nhóm
              <select
                className={INPUT}
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
            </label>
            <label className={GROUP_LABEL}>
              Phòng họp
              <select
                className={INPUT}
                value={roomId}
                disabled={roomsOf(rooms, groupId).length < 2}
                onChange={(event) => setRoomId(event.target.value)}
              >
                {roomsOf(rooms, groupId).map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="grid gap-2">
            <legend className={cn(GROUP_LABEL, "mb-2")}>Thời gian</legend>
            <DatePicker label="Ngày họp" value={date} onChange={setDate} marked={busyDays} />
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              <TimePicker
                label="Bắt đầu"
                value={start.slice(11, 16)}
                onChange={(time) => {
                  const next = `${date}T${time}`;
                  // Moving the start keeps the length of the meeting.
                  setEnd(
                    localDateTime(
                      new Date(new Date(next).getTime() + Math.max(minutes, 15) * 60_000),
                    ),
                  );
                  setStart(next);
                }}
              />
              <span className="text-muted-foreground">–</span>
              <TimePicker
                label="Kết thúc"
                value={end.slice(11, 16)}
                from={start.slice(11, 16)}
                invalid={minutes <= 0}
                onChange={(time) => setEnd(`${date}T${time}`)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  [30, "30 phút"],
                  [60, "1 giờ"],
                  [90, "1,5 giờ"],
                  [120, "2 giờ"],
                ] as const
              ).map(([length, label]) => (
                <button
                  key={length}
                  type="button"
                  aria-pressed={minutes === length}
                  className="cursor-pointer rounded-full border bg-card px-[11px] py-1 text-[12.5px] text-muted-foreground hover:bg-secondary aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:font-semibold aria-pressed:text-background"
                  onClick={() => setDuration(length)}
                >
                  {label}
                </button>
              ))}
              <span
                className={cn(
                  "ml-auto text-xs",
                  minutes <= 0 ? "font-medium text-destructive" : "text-muted-foreground",
                )}
              >
                {minutes <= 0 ? "Giờ kết thúc phải sau giờ bắt đầu" : "Giờ theo thiết bị của bạn"}
              </span>
            </div>
          </fieldset>
          <div className="grid gap-2">
            <span className={GROUP_LABEL}>Nội dung</span>
            <textarea
              className={AREA}
              rows={2}
              maxLength={1000}
              aria-label="Nội dung chuẩn bị"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Nội dung, tài liệu cần chuẩn bị…"
            />
            <textarea
              className={AREA}
              rows={3}
              aria-label="Agenda (mỗi dòng một mục)"
              value={agenda}
              onChange={(event) => setAgenda(event.target.value)}
              placeholder={"Agenda — mỗi dòng một mục\nBáo cáo tiến độ\nPhân công tuần tới"}
            />
          </div>
        </div>

        <div className="grid content-start gap-[18px] border-t bg-background px-5 py-[18px] min-[820px]:border-t-0 min-[820px]:border-l">
          <ScheduleInviteFields
            workspaceId={groupId}
            groups={groups}
            value={invite}
            onChange={setInvite}
          />
          <div className="grid gap-1">
            <span className={GROUP_LABEL}>Cấu hình phòng</span>
            {(
              [
                ["waitingRoom", "Phòng chờ", "Người ngoài danh sách mời phải chờ duyệt"],
                ["autoRecord", "Tự động ghi hình", "Bắt đầu ghi khi cuộc họp bắt đầu"],
                ["muteOnJoin", "Tắt micro khi vào", "Mọi người vào phòng ở trạng thái tắt micro"],
              ] as const
            ).map(([key, label, hint]) => (
              <div
                key={key}
                className="flex items-center gap-3 border-t py-2.5 first-of-type:border-t-0"
              >
                <span className="min-w-0 flex-1">
                  <b className="block text-[13.5px] font-semibold">{label}</b>
                  <small className="text-[12.5px] text-muted-foreground">{hint}</small>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings[key]}
                  aria-label={label}
                  className="relative h-5 w-9 shrink-0 cursor-pointer rounded-full bg-border transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-all aria-checked:bg-foreground aria-checked:after:left-[18px]"
                  onClick={() => setSettings({ ...settings, [key]: !settings[key] })}
                />
              </div>
            ))}
          </div>
        </div>
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
  const [groupId, setGroupId] = useState(() =>
    firstGroup(choices, lastWorkspace(), defaultGroupId),
  );
  const [roomId, setRoomId] = useState(() => roomsOf(rooms, groupId)[0]?.id ?? "");
  const go = () =>
    roomId && navigate({ view: "meetings", workspaceId: groupId, channelId: roomId });
  return (
    <Modal
      title="Họp ngay"
      icon="video"
      iconTone="blue"
      initialFocus="select"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button icon="video" disabled={!roomId} onClick={go}>
            Tiếp tục
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3.5"
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
