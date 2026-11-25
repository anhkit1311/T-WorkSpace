import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CcContactDepartment,
  CcTicket,
  CcTicketEvent,
  CcWebCallAccount,
  TicketStatus,
} from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { Button, Modal } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { cn } from "../../shared/lib/utils";
import { ApiError } from "../auth/api";
import { callCenterApi } from "./api";
import { useSoftphone } from "./useSoftphone";
import { BTN_GHOST, BTN_PRIMARY, CHIP, DOT, LED, MUTED, PANEL, PANEL_HEAD, TINT } from "./ui";
import { SEG, SEG_BTN } from "../admin/ui";

const STATUS: Record<
  TicketStatus,
  { label: string; tone: "neutral" | "blue" | "amber" | "green" | "violet" }
> = {
  open: { label: "Mới", tone: "blue" },
  in_progress: { label: "Đang xử lý", tone: "violet" },
  waiting: { label: "Chờ bạn phản hồi", tone: "amber" },
  resolved: { label: "Đã giải quyết", tone: "green" },
  closed: { label: "Đã đóng", tone: "neutral" },
};

const WARNING =
  "rounded-lg bg-[var(--tint-amber-bg)] px-3 py-2 text-[13px] text-[var(--tint-amber-fg)]";
const SM = "h-[30px]! px-2.5 text-[12.5px]";

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const message = (error: unknown) =>
  error instanceof ApiError || error instanceof Error
    ? error.message
    : "Không thể thực hiện yêu cầu.";

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
  const [showDone, setShowDone] = useState(false);

  const loadTickets = useCallback(
    () =>
      void callCenterApi<CcTicket[]>(token, "my-tickets").then(setTickets, () => setTickets([])),
    [token],
  );
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

  const isDone = (ticket: CcTicket) => ticket.status === "resolved" || ticket.status === "closed";
  const doneCount = tickets?.filter(isDone).length ?? 0;
  const openCount = (tickets?.length ?? 0) - doneCount;
  const waiting = tickets?.filter((ticket) => ticket.status === "waiting").length ?? 0;
  const shown = tickets?.filter((ticket) => isDone(ticket) === showDone) ?? [];
  const openDepartments = departments?.filter((department) => department.open).length ?? 0;

  return (
    <div className="tw grid min-w-0 gap-4 text-sm text-foreground">
      <section className="grid gap-3" aria-labelledby="contact-departments-title">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Phòng ban nhận cuộc gọi</p>
            <h2 id="contact-departments-title" className="text-xl font-bold tracking-tight">
              Bạn cần liên hệ ai?
            </h2>
          </div>
          {departments && departments.length > 0 && (
            <span className={cn(CHIP, TINT.green, "ml-auto")}>
              <i className={cn(LED, DOT.green)} aria-hidden="true" />
              {openDepartments} / {departments.length} đang mở
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className={WARNING}>
            {error}
          </p>
        )}
        {departments === null ? (
          <p className={MUTED}>Đang tải danh sách phòng ban…</p>
        ) : !departments.length ? (
          <p className={MUTED}>Chưa có phòng ban nào nhận cuộc gọi.</p>
        ) : (
          <ul className="grid list-none gap-3 lg:grid-cols-2 min-[1300px]:grid-cols-4">
            {departments.map((department) => (
              <li
                key={department.id}
                className="grid min-w-0 content-between gap-3 rounded-[10px] border bg-card p-3.5"
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-lg",
                      TINT[department.open ? "blue" : "neutral"],
                    )}
                  >
                    <Icon name="building" size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate font-semibold">{department.name}</strong>
                    <small className="block text-xs text-muted-foreground">
                      {department.open ? "Đang trong giờ làm việc" : "Ngoài giờ"}
                      {department.hotline && ` · Hotline ${department.hotline}`}
                    </small>
                  </span>
                  <i
                    className={cn(LED, "mt-1.5", DOT[department.open ? "green" : "neutral"])}
                    aria-hidden="true"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={cn(department.open ? BTN_PRIMARY : BTN_GHOST, SM)}
                    onClick={() => setCalling(department)}
                  >
                    <Icon name="phone" size={14} />
                    {department.open ? "Gọi ngay" : "Để lại lời nhắn"}
                  </button>
                  <button
                    type="button"
                    className={cn(BTN_GHOST, SM)}
                    onClick={() => setWriting(department)}
                  >
                    Gửi yêu cầu
                  </button>
                </div>
              </li>
            ))}
            <li className="grid content-center rounded-[10px] border border-dashed p-3.5 text-[13px] text-muted-foreground">
              Gọi bằng micro của máy tính. Ngoài giờ làm việc, cuộc gọi chuyển vào hộp thư thoại và
              tạo phiếu hỗ trợ cho bạn.
            </li>
          </ul>
        )}
      </section>

      <section className={PANEL} aria-labelledby="contact-tickets-title">
        <div className={PANEL_HEAD}>
          <h2 id="contact-tickets-title" className="text-[15px] font-semibold">
            Phiếu hỗ trợ của tôi
          </h2>
          {waiting > 0 && (
            <span className={cn(CHIP, "px-2 py-0.5", TINT.amber)}>{waiting} chờ bạn phản hồi</span>
          )}
          {!!tickets?.length && (
            <div className={cn(SEG, "ml-auto")} role="group" aria-label="Lọc phiếu">
              <button
                type="button"
                className={SEG_BTN}
                aria-pressed={!showDone}
                onClick={() => setShowDone(false)}
              >
                Đang mở <small className="text-muted-foreground">{openCount}</small>
              </button>
              <button
                type="button"
                className={SEG_BTN}
                aria-pressed={showDone}
                onClick={() => setShowDone(true)}
              >
                Đã xong <small className="text-muted-foreground">{doneCount}</small>
              </button>
            </div>
          )}
        </div>
        {tickets === null ? (
          <p className={cn(MUTED, "px-4 py-6 text-center")}>Đang tải…</p>
        ) : !tickets.length ? (
          <p className={cn(MUTED, "px-4 py-6 text-center")}>Bạn chưa gửi yêu cầu nào.</p>
        ) : !shown.length ? (
          <p className={cn(MUTED, "px-4 py-6 text-center")}>
            {showDone ? "Chưa có phiếu nào đã xong." : "Không có phiếu nào đang mở."}
          </p>
        ) : (
          <ul className="list-none" aria-label="Phiếu hỗ trợ của tôi">
            {shown.map((ticket) => (
              <li key={ticket.id} className="border-b last:border-b-0">
                <button
                  type="button"
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-secondary",
                    ticket.status === "waiting" && "bg-[var(--tint-amber-bg)]/40",
                  )}
                  onClick={() => setOpenTicket(ticket.id)}
                >
                  <i
                    className={cn(LED, DOT[STATUS[ticket.status].tone] ?? DOT.blue)}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate font-semibold">{ticket.subject}</strong>
                    <small className="block truncate text-xs text-muted-foreground">
                      {ticket.code} · {ticket.departmentName} · cập nhật{" "}
                      {new Date(ticket.updatedAt).toLocaleString("vi-VN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        day: "2-digit",
                        month: "2-digit",
                      })}
                    </small>
                  </span>
                  {ticket.status === "waiting" ? (
                    <span className={cn(BTN_PRIMARY, SM)}>Phản hồi</span>
                  ) : (
                    <span className={cn(CHIP, "px-2 py-0.5", TINT[STATUS[ticket.status].tone])}>
                      {STATUS[ticket.status].label}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t bg-background px-4 py-2.5 text-xs text-muted-foreground">
          Yêu cầu từ cuộc gọi nhỡ, thư thoại hay nút “Cần hỗ trợ” trong khóa học cũng hiện ở đây.
        </p>
      </section>

      {calling && (
        <WebCallDialog department={calling} context="" onClose={() => setCalling(null)} />
      )}
      {writing && (
        <RequestDialog
          department={writing}
          onClose={() => setWriting(null)}
          onCreated={(ticket) => {
            setWriting(null);
            notify(
              "Đã gửi yêu cầu",
              `${ticket.code} — ${writing.name} sẽ phản hồi trong phiếu này.`,
            );
            loadTickets();
            setOpenTicket(ticket.id);
          }}
        />
      )}
      {openTicket && (
        <TicketDialog
          ticketId={openTicket}
          onClose={() => setOpenTicket(null)}
          onChanged={loadTickets}
        />
      )}
    </div>
  );
}

function RequestDialog({
  department,
  onClose,
  onCreated,
}: {
  department: CcContactDepartment;
  onClose: () => void;
  onCreated: (ticket: CcTicket) => void;
}) {
  const { accessToken } = useApp();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = () => {
    setBusy(true);
    setError("");
    callCenterApi<{ ticket: CcTicket }>(accessToken!, "my-tickets", "POST", {
      departmentId: department.id,
      subject: subject.trim(),
      description: description.trim(),
    })
      .then(
        (result) => onCreated(result.ticket),
        (failure) => setError(message(failure)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <Modal
      title="Gửi yêu cầu hỗ trợ"
      eyebrow={department.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button disabled={busy || !subject.trim()} onClick={submit} icon="check">
            Gửi yêu cầu
          </Button>
        </>
      }
    >
      <div className="tw tw-form grid gap-3 text-sm text-foreground">
        <label>
          Tiêu đề
          <input
            value={subject}
            maxLength={200}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Ví dụ: Xin xác nhận sinh viên"
            autoFocus
          />
        </label>
        <label>
          Nội dung
          <textarea
            rows={5}
            maxLength={8000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Mô tả yêu cầu, mã số sinh viên, thời gian thuận tiện để gọi lại…"
          />
        </label>
        {error && (
          <p role="alert" className={WARNING}>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function TicketDialog({
  ticketId,
  onClose,
  onChanged,
}: {
  ticketId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { accessToken } = useApp();
  const { socket } = useSocket();
  const token = accessToken!;
  const [data, setData] = useState<{ ticket: CcTicket; events: CcTicketEvent[] } | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      void callCenterApi<{ ticket: CcTicket; events: CcTicketEvent[] }>(
        token,
        `my-tickets/${ticketId}`,
      ).then(setData, (failure) => setError(message(failure))),
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
    callCenterApi<{ ticket: CcTicket; events: CcTicketEvent[] }>(
      token,
      `my-tickets/${ticketId}/${path}`,
      "POST",
      body,
    )
      .then(
        (next) => {
          setData(next);
          setReply("");
          onChanged();
        },
        (failure) => setError(message(failure)),
      )
      .finally(() => setBusy(false));
  };
  const ticket = data?.ticket;
  const done = ticket?.status === "resolved" || ticket?.status === "closed";
  return (
    <Modal
      title={ticket?.subject ?? "Phiếu hỗ trợ"}
      eyebrow={ticket ? `${ticket.code} · ${ticket.departmentName}` : undefined}
      onClose={onClose}
    >
      {!ticket ? (
        <p className={MUTED}>{error || "Đang tải…"}</p>
      ) : (
        <div className="tw tw-form grid gap-3.5 text-sm text-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn(CHIP, "px-2 py-0.5", TINT[STATUS[ticket.status].tone])}>
              {STATUS[ticket.status].label}
            </span>
            {ticket.assigneeName && (
              <span className={MUTED}>Người xử lý: {ticket.assigneeName}</span>
            )}
          </div>
          {ticket.description && (
            <p className="rounded-lg bg-secondary px-3 py-2.5 whitespace-pre-wrap">
              {ticket.description}
            </p>
          )}
          <ol className="grid max-h-[40vh] list-none gap-2.5 overflow-y-auto border-l-2 pl-3.5">
            {data!.events.map((event) => (
              <li key={event.id} className="grid gap-0.5">
                <span className="text-xs text-muted-foreground">
                  {new Date(event.createdAt).toLocaleString("vi-VN")} ·{" "}
                  {event.actorName ?? "Hệ thống"}
                </span>
                {event.kind === "status" ? (
                  <span className="text-[13px] text-muted-foreground">
                    Trạng thái: {event.fromStatus ? STATUS[event.fromStatus].label : "—"} →{" "}
                    {event.toStatus ? STATUS[event.toStatus].label : "—"}
                  </span>
                ) : (
                  <p className="whitespace-pre-wrap">{event.body}</p>
                )}
              </li>
            ))}
          </ol>
          {done ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary px-3 py-2.5">
              <span className="font-medium">
                {ticket.satisfaction
                  ? "Cảm ơn bạn đã đánh giá:"
                  : "Bạn hài lòng với cách giải quyết?"}
              </span>
              <div role="radiogroup" aria-label="Mức hài lòng" className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={score}
                    type="button"
                    role="radio"
                    aria-checked={ticket.satisfaction === score}
                    aria-label={`${score} sao`}
                    className={cn(
                      "grid size-8 cursor-pointer place-items-center rounded-md hover:bg-card disabled:cursor-not-allowed",
                      (ticket.satisfaction ?? 0) >= score
                        ? "text-amber-500 [&_svg]:fill-current"
                        : "text-muted-foreground",
                    )}
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
            <div className="grid gap-2">
              <label>
                {ticket.status === "waiting" ? "Phòng ban đang chờ bạn phản hồi" : "Trả lời"}
                <textarea
                  rows={3}
                  maxLength={4000}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder="Bổ sung thông tin cho phòng ban…"
                />
              </label>
              <button
                type="button"
                className={cn(BTN_PRIMARY, "justify-self-end")}
                disabled={busy || !reply.trim()}
                onClick={() => act("replies", { body: reply.trim() })}
              >
                <Icon name="send" size={15} />
                Gửi trả lời
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className={WARNING}>
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * A browser call to one department: the API makes a temporary SIP endpoint that can only reach that
 * department's queue; it is removed when the call ends. `context` (LT1) is shown to the agent.
 */
export function WebCallDialog({
  department,
  context,
  onClose,
}: {
  department: Pick<CcContactDepartment, "id" | "name">;
  context: string;
  onClose: () => void;
}) {
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
    const release = (endpoint: string) =>
      void callCenterApi(token, `web-calls/${endpoint}`, "DELETE").catch(() => undefined);
    callCenterApi<CcWebCallAccount>(token, "web-calls", "POST", {
      departmentId: department.id,
      context,
    }).then(
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
            <Button
              variant="secondary"
              icon={phone.muted ? "mic-off" : "mic"}
              onClick={phone.toggleMute}
            >
              {phone.muted ? "Bật micro" : "Tắt micro"}
            </Button>
            <Button variant="danger" icon="phone" onClick={phone.hangup}>
              Kết thúc
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Đóng</Button>
        )
      }
    >
      <div
        className="tw grid justify-items-center gap-2.5 py-3 text-center text-sm text-foreground"
        role="status"
        aria-live="polite"
      >
        <span
          className={cn(
            "grid size-16 place-items-center rounded-full",
            TINT[error ? "red" : phase === "active" ? "green" : "blue"],
            phase !== "active" && !error && !ended && "animate-pulse",
          )}
        >
          <Icon name="headset" size={28} />
        </span>
        <strong className="text-base font-semibold">{label}</strong>
        <p className={cn(MUTED, "max-w-[360px]")}>
          {error ||
            (phase === "active"
              ? "Nếu đang nghe nhạc chờ, bạn đang trong hàng đợi — tổng đài viên sẽ nhận máy sớm nhất. Ngoài giờ làm việc, hãy để lại lời nhắn sau tiếng bíp."
              : "Trình duyệt sẽ hỏi quyền dùng micro.")}
        </p>
      </div>
    </Modal>
  );
}
