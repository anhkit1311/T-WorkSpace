import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { CcDepartment, CcTicket, CcTicketEvent, TicketPriority, TicketStatus } from "@doan/shared";
import { useSocket } from "../../app/providers/SocketContext";
import { Badge, Button, Field, FilterPills, Modal } from "../../shared/ui/Primitives";
import { voicemailUrl } from "./api";

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;
type Detail = { ticket: CcTicket; events: CcTicketEvent[] };

export const TICKET_STATUS: Record<TicketStatus, string> = {
  open: "Mới",
  in_progress: "Đang xử lý",
  waiting: "Chờ phản hồi",
  resolved: "Đã giải quyết",
  closed: "Đã đóng",
};
const STATUS_TONE: Record<TicketStatus, "blue" | "violet" | "amber" | "green" | "neutral"> = {
  open: "blue",
  in_progress: "violet",
  waiting: "amber",
  resolved: "green",
  closed: "neutral",
};
const PRIORITY: Record<TicketPriority, string> = { low: "Thấp", normal: "Bình thường", high: "Cao", urgent: "Khẩn" };
const SOURCE = { call: "Từ cuộc gọi", missed_call: "Cuộc gọi nhỡ", voicemail: "Thư thoại", manual: "Tạo tay", elearning: "Từ khóa học" };
const FILTERS = [
  { key: "active", label: "Đang mở" },
  { key: "mine", label: "Của tôi" },
  { key: "resolved", label: "Đã giải quyết" },
  { key: "all", label: "Tất cả" },
];

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
  const [tickets, setTickets] = useState<CcTicket[] | null>(null);
  const [departments, setDepartments] = useState<CcDepartment[]>([]);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    const query = filter === "mine" ? "mine=1" : filter === "resolved" ? "status=resolved" : "";
    api<CcTicket[]>(`tickets?${query}`)
      .then((list) => setTickets(filter === "active" ? list.filter((ticket) => !["resolved", "closed"].includes(ticket.status)) : list), fail);
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

  return (
    <>
      <div className="desk-toolbar">
        <FilterPills options={FILTERS} activeKey={filter} onChange={setFilter} />
        <Button size="sm" icon="plus" onClick={() => setCreating(true)} disabled={!departments.length}>Tạo phiếu</Button>
      </div>
      <div className="callcenter-main-grid desk-ticket-grid">
        <div className="callcenter-panel">
          {tickets && !tickets.length && <p className="desk-muted">Không có phiếu nào.</p>}
          {tickets?.map((ticket) => (
            <button
              key={ticket.id}
              type="button"
              className={`call-item-card desk-ticket ${selected?.ticket.id === ticket.id ? "is-active" : ""}`}
              onClick={() => open(ticket)}
            >
              <div className="call-item-info">
                <div className="call-item-caller">
                  <span className="desk-muted">{ticket.code}</span>
                  <span>{ticket.subject}</span>
                </div>
                <div className="call-item-meta">
                  <span>{SOURCE[ticket.source]}</span>
                  <span>·</span>
                  <span>{ticket.departmentName}</span>
                  {ticket.assigneeName && <><span>·</span><span>{ticket.assigneeName}</span></>}
                  <span>·</span>
                  <span>{new Date(ticket.updatedAt).toLocaleString("vi-VN")}</span>
                </div>
              </div>
              <div className="desk-agent-state">
                <Badge tone={STATUS_TONE[ticket.status]}>{TICKET_STATUS[ticket.status]}</Badge>
                {(ticket.priority === "high" || ticket.priority === "urgent") && <Badge tone="red">{PRIORITY[ticket.priority]}</Badge>}
              </div>
            </button>
          ))}
        </div>
        {selected ? (
          <TicketDetail
            detail={selected}
            members={departments.find((department) => department.id === selected.ticket.departmentId)?.members ?? []}
            canCall={canCall}
            token={token}
            fail={fail}
            onChange={(body) => apply(api<Detail>(`tickets/${selected.ticket.id}`, "PATCH", body))}
            onEvent={(body) => apply(api<Detail>(`tickets/${selected.ticket.id}/events`, "POST", body))}
            onCallBack={() => {
              apply(api<Detail>(`tickets/${selected.ticket.id}/events`, "POST", { kind: "callback", body: `Gọi lại ${selected.ticket.callerNumber}` }));
              onCallBack(selected.ticket.callerNumber!);
            }}
          />
        ) : (
          <div className="callcenter-panel desk-muted">Chọn một phiếu để xem chi tiết.</div>
        )}
      </div>
      {creating && (
        <Modal title="Tạo phiếu yêu cầu" eyebrow="Tổng đài" onClose={() => setCreating(false)}>
          <form
            className="desk-form"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
              api<Detail>("tickets", "POST", { ...values, callerNumber: values.callerNumber || undefined }).then((detail) => {
                setCreating(false);
                setSelected(detail);
                load();
              }, fail);
            }}
          >
            <Field label="Phòng ban">
              <select name="departmentId" aria-label="Phòng ban">
                {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            </Field>
            <Field label="Tiêu đề"><input name="subject" aria-label="Tiêu đề" required maxLength={200} /></Field>
            <Field label="Số điện thoại liên hệ"><input name="callerNumber" aria-label="Số điện thoại liên hệ" inputMode="tel" pattern="\+?[0-9]{3,15}" /></Field>
            <Field label="Mức ưu tiên">
              <select name="priority" aria-label="Mức ưu tiên" defaultValue="normal">
                {Object.entries(PRIORITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </Field>
            <Field label="Nội dung"><textarea name="description" aria-label="Nội dung" rows={4} maxLength={8000} /></Field>
            <div className="desk-actions">
              <Button variant="ghost" type="button" onClick={() => setCreating(false)}>Hủy</Button>
              <Button type="submit" icon="check">Tạo phiếu</Button>
            </div>
          </form>
        </Modal>
      )}
    </>
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
  const people = members.filter((member, index, all) => all.findIndex((item) => item.userId === member.userId) === index);
  const describe = (event: CcTicketEvent) =>
    event.kind === "status"
      ? `${event.fromStatus ? TICKET_STATUS[event.fromStatus] : ""} → ${event.toStatus ? TICKET_STATUS[event.toStatus] : ""}`
      : event.kind === "assign"
        ? `Phân công: ${event.body}`
        : event.kind === "callback"
          ? `📞 ${event.body || "Gọi lại"}`
          : event.body;

  return (
    <div className="callcenter-panel desk-form">
      <div>
        <div className="desk-muted">{ticket.code} · {SOURCE[ticket.source]} · {ticket.departmentName}</div>
        <h2 className="desk-caller__name">{ticket.subject}</h2>
        {ticket.callerNumber && <div className="desk-caller__meta"><span>{ticket.callerName ?? "Người gọi"}</span><span>{ticket.callerNumber}</span></div>}
      </div>
      {ticket.description && <p className="desk-notes desk-ticket__description">{ticket.description}</p>}
      <div className="desk-admin__inline">
        <Field label="Trạng thái">
          <select aria-label="Trạng thái" value={ticket.status} onChange={(event) => onChange({ status: event.target.value })}>
            {Object.entries(TICKET_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </Field>
        <Field label="Ưu tiên">
          <select aria-label="Ưu tiên" value={ticket.priority} onChange={(event) => onChange({ priority: event.target.value })}>
            {Object.entries(PRIORITY).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </Field>
        <Field label="Người xử lý">
          <select aria-label="Người xử lý" value={ticket.assigneeId ?? ""} onChange={(event) => onChange({ assigneeId: event.target.value || null })}>
            <option value="">— Chưa phân công —</option>
            {people.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
          </select>
        </Field>
      </div>
      <div className="desk-actions desk-actions--start">
        {ticket.callerNumber && (
          <Button size="sm" icon="phone" onClick={onCallBack} disabled={!canCall} title={canCall ? undefined : "Cần đăng ký softphone trước"}>
            Gọi lại {ticket.callerNumber}
          </Button>
        )}
        {ticket.voicemailId &&
          (audio ? (
            <audio src={audio} controls autoPlay />
          ) : (
            <Button size="sm" variant="ghost" icon="play" onClick={() => voicemailUrl(token, ticket.voicemailId!).then(setAudio, fail)}>
              Nghe thư thoại
            </Button>
          ))}
      </div>
      <ol className="desk-timeline">
        <li>
          <span className="desk-muted">{new Date(ticket.createdAt).toLocaleString("vi-VN")}</span>
          <span>Tạo phiếu</span>
        </li>
        {events.map((event) => (
          <li key={event.id}>
            <span className="desk-muted">{new Date(event.createdAt).toLocaleString("vi-VN")}{event.actorName ? ` · ${event.actorName}` : " · Hệ thống"}</span>
            <span>{describe(event)}</span>
          </li>
        ))}
      </ol>
      <form
        className="desk-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!comment.trim()) return;
          onEvent({ kind: "comment", body: comment.trim() });
          setComment("");
        }}
      >
        <textarea rows={2} maxLength={4000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Ghi chú xử lý…" aria-label="Ghi chú xử lý" />
        <div className="desk-actions"><Button size="sm" type="submit" icon="send" disabled={!comment.trim()}>Thêm ghi chú</Button></div>
      </form>
    </div>
  );
}
