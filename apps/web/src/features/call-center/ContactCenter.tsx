import { useCallback, useEffect, useRef, useState } from "react";
import type { CcContactDepartment, CcTicket, CcTicketEvent, CcWebCallAccount, TicketStatus } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { Badge, Button, Field, Modal } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { ApiError } from "../auth/api";
import { callCenterApi } from "./api";
import { useSoftphone } from "./useSoftphone";
import "./contact-center.css";

const STATUS: Record<TicketStatus, { label: string; tone: "neutral" | "blue" | "amber" | "green" | "violet" }> = {
  open: { label: "Mới", tone: "blue" },
  in_progress: { label: "Đang xử lý", tone: "violet" },
  waiting: { label: "Chờ bạn phản hồi", tone: "amber" },
  resolved: { label: "Đã giải quyết", tone: "green" },
  closed: { label: "Đã đóng", tone: "neutral" },
};

const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const message = (error: unknown) => (error instanceof ApiError || error instanceof Error ? error.message : "Không thể thực hiện yêu cầu.");

/**
 * NV-CC1 / NV-CC3 for every user: call a department straight from the browser, send it a written
 * request, and follow the requests you opened (reply, rate once resolved).
 */
export function ContactCenter() {
  const { accessToken, notify } = useApp();
  const { socket } = useSocket();
  const token = accessToken!;
  const [departments, setDepartments] = useState<CcContactDepartment[] | null>(null);
  const [tickets, setTickets] = useState<CcTicket[] | null>(null);
  const [calling, setCalling] = useState<CcContactDepartment | null>(null);
  const [writing, setWriting] = useState<CcContactDepartment | null>(null);
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadTickets = useCallback(() => void callCenterApi<CcTicket[]>(token, "my-tickets").then(setTickets, () => setTickets([])), [token]);
  useEffect(() => {
    callCenterApi<CcContactDepartment[]>(token, "contacts").then(setDepartments, (failure) => {
      setDepartments([]);
      setError(message(failure));
    });
    loadTickets();
  }, [token, loadTickets]);
  useEffect(() => {
    if (!socket) return;
    socket.on("callcenter_ticket", loadTickets);
    return () => void socket.off("callcenter_ticket", loadTickets);
  }, [socket, loadTickets]);

  return (
    <div className="contact-center">
      <section className="callcenter-panel">
        <div className="callcenter-panel__head">
          <h2 className="callcenter-panel__title">
            <Icon name="headset" size={18} />
            <span>Liên hệ phòng ban</span>
          </h2>
        </div>
        <p className="desk-muted">Gọi trực tiếp từ trình duyệt (cần micro) hoặc gửi yêu cầu bằng văn bản. Ngoài giờ làm việc, cuộc gọi chuyển vào hộp thư thoại của phòng.</p>
        {error && <p role="alert" className="desk-warning">{error}</p>}
        {departments === null ? (
          <p className="desk-muted">Đang tải danh sách phòng ban…</p>
        ) : !departments.length ? (
          <p className="desk-muted">Chưa có phòng ban nào nhận cuộc gọi.</p>
        ) : (
          <ul className="contact-grid">
            {departments.map((department) => (
              <li key={department.id} className="contact-card">
                <div className="contact-card__head">
                  <strong>{department.name}</strong>
                  <Badge tone={department.open ? "green" : "neutral"} dot>{department.open ? "Đang trong giờ làm việc" : "Ngoài giờ"}</Badge>
                </div>
                {department.hotline && <span className="desk-muted">Hotline {department.hotline}</span>}
                <div className="contact-card__actions">
                  <Button size="sm" icon="phone" onClick={() => setCalling(department)}>
                    {department.open ? "Gọi ngay" : "Để lại lời nhắn"}
                  </Button>
                  <Button size="sm" variant="secondary" icon="clipboard" onClick={() => setWriting(department)}>
                    Gửi yêu cầu
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="callcenter-panel">
        <div className="callcenter-panel__head">
          <h2 className="callcenter-panel__title">
            <Icon name="clipboard" size={18} />
            <span>Phiếu hỗ trợ của tôi</span>
          </h2>
          {tickets && tickets.some((ticket) => ticket.status === "waiting") && <Badge tone="amber">Có phiếu chờ bạn phản hồi</Badge>}
        </div>
        {tickets === null ? (
          <p className="desk-muted">Đang tải…</p>
        ) : !tickets.length ? (
          <p className="desk-muted">Bạn chưa gửi yêu cầu nào. Yêu cầu từ cuộc gọi nhỡ, thư thoại hay nút “Cần hỗ trợ” trong khóa học cũng hiện ở đây.</p>
        ) : (
          <ul className="desk-recent" aria-label="Phiếu hỗ trợ của tôi">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <button type="button" className="contact-ticket" onClick={() => setOpenTicket(ticket.id)}>
                  <span className="desk-recent__who">
                    <strong>{ticket.subject}</strong>
                    <span>
                      {ticket.code} · {ticket.departmentName} · cập nhật {new Date(ticket.updatedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                    </span>
                  </span>
                  <Badge tone={STATUS[ticket.status].tone}>{STATUS[ticket.status].label}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {calling && <WebCallDialog department={calling} context="" onClose={() => setCalling(null)} />}
      {writing && (
        <RequestDialog
          department={writing}
          onClose={() => setWriting(null)}
          onCreated={(ticket) => {
            setWriting(null);
            notify("Đã gửi yêu cầu", `${ticket.code} — ${writing.name} sẽ phản hồi trong phiếu này.`);
            loadTickets();
            setOpenTicket(ticket.id);
          }}
        />
      )}
      {openTicket && <TicketDialog ticketId={openTicket} onClose={() => setOpenTicket(null)} onChanged={loadTickets} />}
    </div>
  );
}

function RequestDialog({ department, onClose, onCreated }: { department: CcContactDepartment; onClose: () => void; onCreated: (ticket: CcTicket) => void }) {
  const { accessToken } = useApp();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = () => {
    setBusy(true);
    setError("");
    callCenterApi<{ ticket: CcTicket }>(accessToken!, "my-tickets", "POST", { departmentId: department.id, subject: subject.trim(), description: description.trim() })
      .then((result) => onCreated(result.ticket), (failure) => setError(message(failure)))
      .finally(() => setBusy(false));
  };
  return (
    <Modal
      title="Gửi yêu cầu hỗ trợ"
      eyebrow={department.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Hủy</Button>
          <Button disabled={busy || !subject.trim()} onClick={submit} icon="check">Gửi yêu cầu</Button>
        </>
      }
    >
      <div className="desk-form">
        <Field label="Tiêu đề">
          <input value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} placeholder="Ví dụ: Xin xác nhận sinh viên" autoFocus />
        </Field>
        <Field label="Nội dung">
          <textarea rows={5} maxLength={8000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Mô tả yêu cầu, mã số sinh viên, thời gian thuận tiện để gọi lại…" />
        </Field>
        {error && <p role="alert" className="desk-warning">{error}</p>}
      </div>
    </Modal>
  );
}

function TicketDialog({ ticketId, onClose, onChanged }: { ticketId: string; onClose: () => void; onChanged: () => void }) {
  const { accessToken } = useApp();
  const { socket } = useSocket();
  const token = accessToken!;
  const [data, setData] = useState<{ ticket: CcTicket; events: CcTicketEvent[] } | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(
    () => void callCenterApi<{ ticket: CcTicket; events: CcTicketEvent[] }>(token, `my-tickets/${ticketId}`).then(setData, (failure) => setError(message(failure))),
    [token, ticketId],
  );
  useEffect(load, [load]);
  useEffect(() => {
    if (!socket) return;
    socket.on("callcenter_ticket", load);
    return () => void socket.off("callcenter_ticket", load);
  }, [socket, load]);
  const act = (path: string, body: object) => {
    setBusy(true);
    setError("");
    callCenterApi<{ ticket: CcTicket; events: CcTicketEvent[] }>(token, `my-tickets/${ticketId}/${path}`, "POST", body)
      .then((next) => {
        setData(next);
        setReply("");
        onChanged();
      }, (failure) => setError(message(failure)))
      .finally(() => setBusy(false));
  };
  const ticket = data?.ticket;
  const done = ticket?.status === "resolved" || ticket?.status === "closed";
  return (
    <Modal title={ticket?.subject ?? "Phiếu hỗ trợ"} eyebrow={ticket ? `${ticket.code} · ${ticket.departmentName}` : undefined} onClose={onClose}>
      {!ticket ? (
        <p className="desk-muted">{error || "Đang tải…"}</p>
      ) : (
        <div className="contact-thread">
          <div className="contact-thread__meta">
            <Badge tone={STATUS[ticket.status].tone}>{STATUS[ticket.status].label}</Badge>
            {ticket.assigneeName && <span className="desk-muted">Người xử lý: {ticket.assigneeName}</span>}
          </div>
          {ticket.description && <p className="desk-notes">{ticket.description}</p>}
          <ol className="contact-thread__events">
            {data!.events.map((event) => (
              <li key={event.id} className={event.kind === "status" ? "is-status" : ""}>
                <span className="desk-muted">
                  {new Date(event.createdAt).toLocaleString("vi-VN")} · {event.actorName ?? "Hệ thống"}
                </span>
                {event.kind === "status" ? (
                  <span>
                    Trạng thái: {event.fromStatus ? STATUS[event.fromStatus].label : "—"} → {event.toStatus ? STATUS[event.toStatus].label : "—"}
                  </span>
                ) : (
                  <p>{event.body}</p>
                )}
              </li>
            ))}
          </ol>
          {done ? (
            <div className="contact-rating">
              <span>{ticket.satisfaction ? "Cảm ơn bạn đã đánh giá:" : "Bạn hài lòng với cách giải quyết?"}</span>
              <div role="radiogroup" aria-label="Mức hài lòng">
                {[1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={score}
                    type="button"
                    role="radio"
                    aria-checked={ticket.satisfaction === score}
                    aria-label={`${score} sao`}
                    className={(ticket.satisfaction ?? 0) >= score ? "is-on" : ""}
                    disabled={busy}
                    onClick={() => act("rating", { score })}
                  >
                    <Icon name="star" size={20} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {ticket.status !== "closed" && (
            <div className="desk-form">
              <Field label={ticket.status === "waiting" ? "Phòng ban đang chờ bạn phản hồi" : "Trả lời"}>
                <textarea rows={3} maxLength={4000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Bổ sung thông tin cho phòng ban…" />
              </Field>
              <div className="desk-actions">
                <Button disabled={busy || !reply.trim()} icon="send" onClick={() => act("replies", { body: reply.trim() })}>Gửi trả lời</Button>
              </div>
            </div>
          )}
          {error && <p role="alert" className="desk-warning">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

/**
 * A browser call to one department: the API makes a temporary SIP endpoint that can only reach that
 * department's queue; it is removed when the call ends. `context` (LT1) is shown to the agent.
 */
export function WebCallDialog({ department, context, onClose }: { department: Pick<CcContactDepartment, "id" | "name">; context: string; onClose: () => void }) {
  const { accessToken } = useApp();
  const token = accessToken!;
  const [account, setAccount] = useState<CcWebCallAccount | null>(null);
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const started = useRef(false);
  const wasActive = useRef(false);
  const phone = useSoftphone(account, setError);

  useEffect(() => {
    let current: CcWebCallAccount | null = null;
    let closed = false;
    const release = (endpoint: string) => void callCenterApi(token, `web-calls/${endpoint}`, "DELETE").catch(() => undefined);
    callCenterApi<CcWebCallAccount>(token, "web-calls", "POST", { departmentId: department.id, context }).then(
      (next) => {
        // Closed before the endpoint arrived: give it back at once instead of leaving it to expire.
        if (closed) return release(next.number);
        current = next;
        setAccount(next);
      },
      (failure) => !closed && setError(message(failure)),
    );
    return () => {
      // The endpoint goes away with the dialog, whatever happened to the call.
      closed = true;
      if (current) release(current.number);
    };
  }, [token, department.id, context]);

  const { status, phase, call } = phone;
  useEffect(() => {
    if (status === "registered" && account && !started.current) {
      started.current = true;
      call(account.target);
    }
    if (status === "failed") setError("Không kết nối được tổng đài. Kiểm tra mạng rồi thử lại.");
  }, [status, account, call]);
  useEffect(() => {
    if (phase === "active") wasActive.current = true;
    if (phase !== "active") return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);

  const ended = started.current && phase === "none" && status === "registered";
  const label = error
    ? "Cuộc gọi không thực hiện được"
    : ended
      ? wasActive.current
        ? `Cuộc gọi đã kết thúc · ${clock(seconds)}`
        : "Cuộc gọi không kết nối được"
      : phase === "active"
        ? `Đã kết nối · ${clock(seconds)}`
        : !account || status !== "registered"
          ? "Đang chuẩn bị cuộc gọi…"
          : "Đang gọi…";

  return (
    <Modal
      title={`Gọi ${department.name}`}
      eyebrow="Cuộc gọi qua trình duyệt"
      onClose={() => {
        phone.hangup();
        onClose();
      }}
      footer={
        phase !== "none" ? (
          <>
            <Button variant="secondary" icon={phone.muted ? "mic-off" : "mic"} onClick={phone.toggleMute}>{phone.muted ? "Bật micro" : "Tắt micro"}</Button>
            <Button variant="danger" icon="phone" onClick={phone.hangup}>Kết thúc</Button>
          </>
        ) : (
          <Button onClick={onClose}>Đóng</Button>
        )
      }
    >
      <div className={`web-call ${phase === "active" ? "is-active" : ""}`} role="status" aria-live="polite">
        <span className="web-call__icon"><Icon name="headset" size={28} /></span>
        <strong>{label}</strong>
        <p className="desk-muted">
          {error ||
            (phase === "active"
              ? "Nếu đang nghe nhạc chờ, bạn đang trong hàng đợi — tổng đài viên sẽ nhận máy sớm nhất. Ngoài giờ làm việc, hãy để lại lời nhắn sau tiếng bíp."
              : "Trình duyệt sẽ hỏi quyền dùng micro.")}
        </p>
      </div>
    </Modal>
  );
}
