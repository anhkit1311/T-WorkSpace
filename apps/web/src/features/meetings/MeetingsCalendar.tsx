import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AnimatePresence } from "motion/react";
import type { MeetingCalendar, MeetingScheduleItem, WorkspaceItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Icon } from "../../shared/ui/Icon";
import { Button, ConfirmDialog, Field, IconButton, Modal } from "../../shared/ui/Primitives";
import { NoGroups } from "../workspaces/GroupDialogs";
import { cancelMeetingScheduleApi, getMeetingCalendarApi, saveMeetingScheduleApi } from "./api";
import { calendarEvents, FIRST_HOUR, LAST_HOUR, layoutDay, weekStart, type CalendarEvent } from "./calendar";
import { MeetingAttendancePanel } from "./MeetingAttendancePanel";
import { MeetingOutcomesPanel } from "./MeetingOutcomesPanel";
import { MeetingRecordingPanel } from "./MeetingRecordingPanel";
import "./meetings-calendar.css";

export type MeetingRoom = { id: string; name: string; workspace: string; workspaceId: string };

const DAY = 86_400_000;
const LAST_WORKSPACE = "meeting:lastWorkspace";
const STATUS_LABEL = { live: "Đang diễn ra", upcoming: "Sắp tới", past: "Đã qua" } as const;
const WEEKDAYS = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];
// Day labels and times in Vietnam time, matching how the week is cut.
const zone = { timeZone: "Asia/Ho_Chi_Minh" } as const;
// vi-VN prints "19-10"; the page uses dd/mm.
const dayMonth = (date: Date) => {
  const [{ value: day }, , { value: month }] = new Intl.DateTimeFormat("en-GB", { ...zone, day: "2-digit", month: "2-digit" }).formatToParts(date);
  return `${day}/${month}`;
};
const clock = (date: Date) => date.toLocaleTimeString("vi-VN", { ...zone, hour: "2-digit", minute: "2-digit" });

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

/** "Họp": the week's meetings of every group; a meeting opens its details, "Vào" goes to the device check. */
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
  const [cancelling, setCancelling] = useState(false);
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
    // Keeps "Đang diễn ra" and who is in a room current without a reload.
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
  const openRoom = (item: CalendarEvent) =>
    navigate({ view: "meetings", workspaceId: item.workspaceId, channelId: item.roomId, scheduleId: item.scheduleId ?? undefined });

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
      <header className="meetings-calendar__bar">
        <h1 id="meetings-title" className="sr-only">
          Họp
        </h1>
        <div className="meetings-calendar__week">
          <IconButton label="Tuần trước" icon="chevron-left" onClick={() => setWeek(new Date(week.getTime() - 7 * DAY))} />
          <h2>
            Tuần {dayMonth(days[0]).slice(0, 2)}–{dayMonth(days[6])}
          </h2>
          <IconButton label="Tuần sau" icon="chevron-right" onClick={() => setWeek(new Date(week.getTime() + 7 * DAY))} />
          <Button size="sm" variant="secondary" onClick={() => setWeek(weekStart(new Date()))}>
            Hôm nay
          </Button>
        </div>
        <label className="meetings-calendar__group">
          <span className="sr-only">Nhóm</span>
          <select value={groupId} onChange={(event) => navigate({ view: "meetings", workspaceId: event.target.value || undefined }, true)}>
            <option value="">Nhóm: Tất cả</option>
            {groups?.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        <span className="meetings-calendar__spacer" />
        <Button size="sm" variant="secondary" icon="video" disabled={!rooms.length} onClick={() => setStartNow(true)}>
          Họp ngay
        </Button>
        <Button size="sm" icon="plus" disabled={!rooms.length} onClick={() => setForm({})}>
          Lên lịch
        </Button>
      </header>
      {error && (
        <p className="inline-alert" role="alert">
          {error}
        </p>
      )}
      {!data && !error && (
        <p role="status" className="loading-note">
          Đang tải lịch họp…
        </p>
      )}

      <div className={`meetings-calendar__body ${selected ? "has-detail" : ""}`}>
        <div className="meeting-week" role="grid" aria-label="Lịch tuần">
          <div className="meeting-week__head" role="row">
            <span />
            {days.map((day, index) => (
              <span key={index} role="columnheader" className={index === today ? "is-today" : ""}>
                {WEEKDAYS[index]} <strong>{dayMonth(day)}</strong>
              </span>
            ))}
          </div>
          <div className="meeting-week__grid" role="row" style={{ "--hours": LAST_HOUR - FIRST_HOUR } as React.CSSProperties}>
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
            {schedule(selected)?.description && <p className="meeting-detail__note">{schedule(selected)?.description}</p>}
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
                    Vào
                  </Button>
                  {schedule(selected) && (
                    <Button variant="text" size="sm" icon="calendar" onClick={() => downloadCalendarEvent(schedule(selected)!)}>
                      Tải .ics
                    </Button>
                  )}
                  {selected.canManage && schedule(selected) && (
                    <>
                      <Button variant="text" size="sm" icon="edit" onClick={() => setForm({ item: schedule(selected) })}>
                        Sửa
                      </Button>
                      <Button variant="text" size="sm" onClick={() => setCancelId(selected.scheduleId ?? "")}>
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
                <MeetingAttendancePanel sessionId={selected.sessionId} />
              </div>
            ) : selected.status === "past" ? (
              <p>Cuộc họp này đã qua giờ mà chưa ai vào phòng.</p>
            ) : null}
          </aside>
        )}
      </div>

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
          <StartNowDialog groups={groups} rooms={rooms} defaultGroupId={groupId} onClose={() => setStartNow(false)} />
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
/** Groups the user can meet in: not archived and with at least one meeting room. */
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
