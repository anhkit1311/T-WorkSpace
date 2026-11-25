import { useCallback, useEffect, useState, type FormEvent } from "react";
import type {
  CcDepartment,
  CcTicket,
  CcTicketEvent,
  TicketPriority,
  TicketStatus,
} from "@doan/shared";
import { useSocket } from "../../app/providers/SocketContext";
import { Modal } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { cn } from "../../shared/lib/utils";
import { voicemailUrl } from "./api";
import { BTN_GHOST, BTN_PRIMARY, CHIP, FIELD, MUTED, PANEL, PILL, PILL_ON, TINT } from "./ui";

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;
type Detail = { ticket: CcTicket; events: CcTicketEvent[] };

export const TICKET_STATUS: Record<TicketStatus, string> = {
  open: "Mới",
  in_progress: "Đang xử lý",
  waiting: "Chờ phản hồi",
  resolved: "Đã giải quyết",
  closed: "Đã đóng",
};
const STATUS_TONE: Record<TicketStatus, string> = {
  open: "blue",
  in_progress: "violet",
  waiting: "amber",
  resolved: "green",
  closed: "neutral",
};
const PRIORITY: Record<TicketPriority, string> = {
  low: "Thấp",
  normal: "Bình thường",
  high: "Cao",
  urgent: "Khẩn",
};
const SOURCE = {
  call: "Từ cuộc gọi",
  missed_call: "Cuộc gọi nhỡ",
  voicemail: "Thư thoại",
  callback: "Khách hẹn gọi lại",
  manual: "Tạo tay",
  elearning: "Từ khóa học",
};
const FILTERS = [
  { key: "active", label: "Đang mở" },
  { key: "mine", label: "Của tôi" },
  { key: "resolved", label: "Đã giải quyết" },
  { key: "all", label: "Tất cả" },
];
const stamp = (iso: string) =>
  new Date(iso).toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });

/** CC-8: follow-up tickets of the user's departments, with history and call-back from the softphone. */
export function TicketsPanel({
  api,
  fail,
  token,
  onCallBack,
  canCall,
}: {
  api: Api;
  fail: (error: unknown) => void;
  token: string;
  onCallBack: (number: string) => void;
  canCall: boolean;
}) {
  const { socket } = useSocket();
  const [filter, setFilter] = useState("active");
  const [query, setQuery] = useState("");
  const [tickets, setTickets] = useState<CcTicket[] | null>(null);
  const [departments, setDepartments] = useState<CcDepartment[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    const query = filter === "mine" ? "mine=1" : filter === "resolved" ? "status=resolved" : "";
    api<CcTicket[]>(`tickets?${query}`).then(
      (list) =>
        setTickets(
          filter === "active"
            ? list.filter((ticket) => !["resolved", "closed"].includes(ticket.status))
            : list,
        ),
      fail,
    );
  }, [api, fail, filter]);
  useEffect(load, [load]);
  useEffect(() => {
    api<CcDepartment[]>("departments").then(setDepartments, fail);
  }, [api, fail]);
  useEffect(() => {
    // New missed calls and voicemails arrive with the department's live updates.
    socket?.on("callcenter_live", load);
    return () => void socket?.off("callcenter_live", load);
  }, [load, socket]);

  const open = (ticket: CcTicket) => api<Detail>(`tickets/${ticket.id}`).then(setSelected, fail);
  const apply = (request: Promise<Detail>) =>
    request.then((detail) => {
      setSelected(detail);
      load();
    }, fail);
  const q = query.trim().toLowerCase();
  const shown = tickets?.filter(
    (ticket) =>
      !q ||
      [ticket.code, ticket.subject, ticket.callerName, ticket.callerNumber].some((value) =>
        value?.toLowerCase().includes(q),
      ),
  );

  return (
    <div className="tw tw-form grid min-w-0 gap-3.5 text-sm text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lọc phiếu">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cn(PILL, filter === item.key && PILL_ON)}
              aria-pressed={filter === item.key}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex h-[34px] w-64 items-center gap-2 rounded-full bg-secondary px-3 text-muted-foreground max-md:ml-0 max-md:w-full">
          <Icon name="search" size={15} />
          <input
            type="search"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none"
            placeholder="Tìm mã, tiêu đề, số gọi…"
            aria-label="Tìm phiếu"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={BTN_PRIMARY}
          onClick={() => setCreating(true)}
          disabled={!departments.length}
        >
          <Icon name="plus" size={15} />
          Tạo phiếu
        </button>
      </div>

      <div className="grid min-w-0 items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className={PANEL} role="list" aria-label="Phiếu yêu cầu">
          {shown && !shown.length && (
            <p className={cn(MUTED, "px-4 py-8 text-center")}>Không có phiếu nào.</p>
          )}
          {shown?.map((ticket) => {
            const active = selected?.ticket.id === ticket.id;
            return (
              <button
                key={ticket.id}
                type="button"
                role="listitem"
                aria-current={active || undefined}
                className={cn(
                  "flex w-full cursor-pointer items-start gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-secondary",
                  active && "bg-[var(--tint-blue-bg)] hover:bg-[var(--tint-blue-bg)]",
                )}
                onClick={() => open(ticket)}
              >
                <span className="pt-px font-mono text-xs text-muted-foreground">{ticket.code}</span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate font-semibold">{ticket.subject}</b>
                  <small className="block truncate text-xs text-muted-foreground">
                    {[
                      SOURCE[ticket.source],
                      ticket.departmentName,
                      ticket.assigneeName,
                      stamp(ticket.updatedAt),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                  <span className={cn(CHIP, "px-2 py-0.5", TINT[STATUS_TONE[ticket.status]])}>
                    {TICKET_STATUS[ticket.status]}
                  </span>
                  {(ticket.priority === "high" || ticket.priority === "urgent") && (
                    <span className={cn(CHIP, "px-2 py-0.5", TINT.red)}>
                      {PRIORITY[ticket.priority]}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {selected ? (
          <TicketDetail
            detail={selected}
            members={
              departments.find((department) => department.id === selected.ticket.departmentId)
                ?.members ?? []
            }
            canCall={canCall}
            token={token}
            fail={fail}
            onChange={(body) => apply(api<Detail>(`tickets/${selected.ticket.id}`, "PATCH", body))}
            onEvent={(body) =>
              apply(api<Detail>(`tickets/${selected.ticket.id}/events`, "POST", body))
            }
            onCallBack={() => {
              apply(
                api<Detail>(`tickets/${selected.ticket.id}/events`, "POST", {
                  kind: "callback",
                  body: `Gọi lại ${selected.ticket.callerNumber}`,
                }),
              );
              onCallBack(selected.ticket.callerNumber!);
            }}
          />
        ) : (
          <p className={cn(PANEL, MUTED, "p-8 text-center")}>Chọn một phiếu để xem chi tiết.</p>
        )}
      </div>
      {creating && (
        <Modal title="Tạo phiếu yêu cầu" eyebrow="Tổng đài" onClose={() => setCreating(false)}>
          <form
            className="tw tw-form grid gap-3 text-sm"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<
                string,
                string
              >;
              api<Detail>("tickets", "POST", {
                ...values,
                callerNumber: values.callerNumber || undefined,
              }).then((detail) => {
                setCreating(false);
                setSelected(detail);
                load();
              }, fail);
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                Phòng ban
                <select name="departmentId">
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Mức ưu tiên
                <select name="priority" defaultValue="normal">
                  {Object.entries(PRIORITY).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Tiêu đề
              <input name="subject" required maxLength={200} />
            </label>
            <label>
              Số điện thoại liên hệ
              <input name="callerNumber" inputMode="tel" pattern="\+?[0-9]{3,15}" />
            </label>
            <label>
              Nội dung
              <textarea name="description" rows={4} maxLength={8000} />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className={BTN_GHOST} onClick={() => setCreating(false)}>
                Hủy
              </button>
              <button type="submit" className={BTN_PRIMARY}>
                <Icon name="check" size={15} />
                Tạo phiếu
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function TicketDetail({
  detail: { ticket, events },
  members,
  canCall,
  token,
  fail,
  onChange,
  onEvent,
  onCallBack,
}: {
  detail: Detail;
  members: CcDepartment["members"];
  canCall: boolean;
  token: string;
  fail: (error: unknown) => void;
  onChange: (body: object) => void;
  onEvent: (body: object) => void;
  onCallBack: () => void;
}) {
  const [comment, setComment] = useState("");
  const [audio, setAudio] = useState<string | null>(null);
  useEffect(() => () => void (audio && URL.revokeObjectURL(audio)), [audio]);
  useEffect(() => setAudio(null), [ticket.id]);
  const people = members.filter(
    (member, index, all) => all.findIndex((item) => item.userId === member.userId) === index,
  );
  const describe = (event: CcTicketEvent) =>
    event.kind === "status"
      ? `${event.fromStatus ? TICKET_STATUS[event.fromStatus] : ""} → ${event.toStatus ? TICKET_STATUS[event.toStatus] : ""}`
      : event.kind === "assign"
        ? `Phân công: ${event.body}`
        : event.kind === "callback"
          ? event.body || "Gọi lại"
          : event.body;
  // An extension, or an outside number through the SIP trunk (needs the call-out permission, BR-20); web callers are answered in the ticket.
  const callable = ticket.callerNumber && /^(1\d{3,4}|0[1-9]\d{8,9})$/.test(ticket.callerNumber);

  return (
    <section
      className={cn(PANEL, "min-[1100px]:sticky min-[1100px]:top-2")}
      aria-label={`Phiếu ${ticket.code}`}
    >
      <div className="grid gap-1 border-b px-4 py-3.5">
        <small className="text-xs text-muted-foreground">
          <span className="font-mono">{ticket.code}</span> · {SOURCE[ticket.source]} ·{" "}
          {ticket.departmentName}
        </small>
        <h2 className="text-[17px] font-bold">{ticket.subject}</h2>
      </div>
      <div className="grid gap-3 border-b px-4 py-3.5 sm:grid-cols-3">
        <label>
          Trạng thái
          <select
            className={FIELD}
            value={ticket.status}
            onChange={(event) => onChange({ status: event.target.value })}
          >
            {Object.entries(TICKET_STATUS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ưu tiên
          <select
            className={FIELD}
            value={ticket.priority}
            onChange={(event) => onChange({ priority: event.target.value })}
          >
            {Object.entries(PRIORITY).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Người xử lý
          <select
            className={FIELD}
            value={ticket.assigneeId ?? ""}
            onChange={(event) => onChange({ assigneeId: event.target.value || null })}
          >
            <option value="">— Chưa phân công —</option>
            {people.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(ticket.callerNumber || ticket.description || ticket.voicemailId) && (
        <div className="grid gap-2.5 border-b px-4 py-3.5">
          {ticket.callerNumber && (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-lg bg-secondary text-muted-foreground">
                <Icon name="phone" size={15} />
              </span>
              <span className="min-w-0">
                <small className="block text-xs text-muted-foreground">Liên hệ</small>
                <b className="font-semibold">
                  {ticket.callerName ?? "Người gọi"} · {ticket.callerNumber}
                </b>
              </span>
              {callable && (
                <button
                  type="button"
                  className={cn(BTN_PRIMARY, "ml-auto")}
                  onClick={onCallBack}
                  disabled={!canCall}
                  title={canCall ? undefined : "Cần đăng ký softphone trước"}
                >
                  <Icon name="phone" size={15} />
                  Gọi lại {ticket.callerNumber}
                </button>
              )}
            </div>
          )}
          {ticket.description && (
            <p className="rounded-lg bg-secondary px-3 py-2.5 text-[13.5px] whitespace-pre-wrap">
              {ticket.description}
            </p>
          )}
          {ticket.voicemailId &&
            (audio ? (
              <audio src={audio} controls autoPlay className="w-full" />
            ) : (
              <button
                type="button"
                className={cn(BTN_GHOST, "w-max")}
                onClick={() => voicemailUrl(token, ticket.voicemailId!).then(setAudio, fail)}
              >
                <Icon name="play" size={15} />
                Nghe thư thoại
              </button>
            ))}
        </div>
      )}
      <div className="grid gap-3 px-4 py-3.5">
        <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          Diễn biến
        </h3>
        <ol className="grid list-none gap-3 border-l pl-4">
          {[
            { id: "created", at: ticket.createdAt, who: null, text: "Tạo phiếu" },
            ...events.map((event) => ({
              id: event.id,
              at: event.createdAt,
              who: event.actorName ?? "Hệ thống",
              text: describe(event),
            })),
          ].map((item) => (
            <li
              key={item.id}
              className="relative grid gap-0.5 before:absolute before:top-1.5 before:-left-[21px] before:size-2 before:rounded-full before:bg-border"
            >
              <small className="text-xs text-muted-foreground">
                {stamp(item.at)}
                {item.who && ` · ${item.who}`}
              </small>
              <span className="text-[13.5px]">{item.text}</span>
            </li>
          ))}
        </ol>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!comment.trim()) return;
            onEvent({ kind: "comment", body: comment.trim() });
            setComment("");
          }}
        >
          <input
            className="min-w-0 flex-1"
            maxLength={4000}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Ghi chú xử lý…"
            aria-label="Ghi chú xử lý"
          />
          <button type="submit" className={BTN_PRIMARY} disabled={!comment.trim()}>
            <Icon name="send" size={15} />
            Gửi
          </button>
        </form>
      </div>
    </section>
  );
}
