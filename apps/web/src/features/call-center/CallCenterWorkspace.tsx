import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MonitorMode,
  AgentState,
  CcAgentProfile,
  CcCallOffer,
  CcCallRecord,
  CcDisposition,
  CcLiveSnapshot,
  CcQaReview,
} from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { appRouteUrl } from "../../app/navigation";
import { useSocket } from "../../app/providers/SocketContext";
import { Badge, Button, Field, FilterPills, KpiStatCard } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { ApiError } from "../auth/api";
import { callCenterApi, recordingUrl } from "./api";
import { KpiPanel } from "./KpiPanel";
import { CallLessonDialog, CallTranscriptDialog, QaPanel, QaReviewDialog, qaTone } from "./QaPanel";
import { TicketsPanel } from "./TicketsPanel";
import { TransferPanel } from "./TransferPanel";
import { VoicemailInbox } from "./VoicemailInbox";
import { ContactCenter } from "./ContactCenter";
import { CallerProfile } from "./CallerProfile";
import { type PhoneStatus } from "./useSoftphone";
import { useGlobalSoftphone } from "../../app/providers/SoftphoneContext";
import "./call-center.css";
import "./agent-desk.css";

const CallCenterAdmin = lazy(() => import("./CallCenterAdmin").then((m) => ({ default: m.CallCenterAdmin })));

const STATE_LABEL: Record<AgentState, string> = {
  offline: "Ngoại tuyến",
  ready: "Sẵn sàng",
  not_ready: "Tạm nghỉ",
  ringing: "Đang đổ chuông",
  on_call: "Đang đàm thoại",
  wrap_up: "Hoàn tất cuộc gọi",
};
const STATE_TONE: Record<AgentState, "neutral" | "green" | "amber" | "blue" | "violet" | "red"> = {
  offline: "neutral",
  ready: "green",
  not_ready: "amber",
  ringing: "blue",
  on_call: "violet",
  wrap_up: "blue",
};
/** NV-CC2: why an agent pauses (same list as the API). */
const PAUSE_REASONS = ["Ăn trưa", "Họp", "Khác"] as const;

const OUTCOME_LABEL: Record<string, string> = {
  answered: "Đã nghe",
  abandoned: "Bỏ máy",
  missed: "Nhỡ",
  voicemail: "Thư thoại",
  busy: "Bận",
  failed: "Lỗi",
  transferred: "Đã chuyển",
};

type Tab = "desk" | "tickets" | "live" | "history" | "quality" | "admin" | "contact";
const seconds = (from: string, to: string | null) => Math.max(0, Math.round((Date.parse(to ?? new Date().toISOString()) - Date.parse(from)) / 1000));
/** Browser calls ("Liên hệ phòng ban") carry no phone number; the caller is known by account. */
const numberLabel = (number: string) => (number === "web" ? "Gọi từ trình duyệt" : number);
const dialable = (number: string) => /^[0-9*#]{3,15}$/.test(number);
const pad = (value: number) => String(value).padStart(2, "0");
const clock = (total: number) =>
  total >= 3600 ? `${Math.floor(total / 3600)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}` : `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;

export function CallCenterWorkspace({ initialTab = "desk" }: { initialTab?: Tab }) {
  const { accessToken, notify, route, navigate } = useApp();
  const { socket } = useSocket();
  const [me, setMe] = useState<CcAgentProfile | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>(initialTab);
  const [dialRequest, setDialRequest] = useState<{ number: string } | null>(null);
  const [phoneStatus, setPhoneStatus] = useState<PhoneStatus>("off");
  const [autoAnswerUntil, setAutoAnswerUntil] = useState(0);
  useEffect(() => {
    // "Gọi" in a direct conversation opens the switchboard with ?q=<extension>: dial once, when the phone is up.
    if (phoneStatus !== "registered" || !/^[0-9]{3,6}$/.test(route.query ?? "")) return;
    setDialRequest({ number: route.query! });
    navigate({ view: "call-center" }, true);
  }, [phoneStatus, route.query]);
  const api = useCallback(
    <T,>(path: string, method?: string, body?: object) => callCenterApi<T>(accessToken!, path, method, body),
    [accessToken],
  );
  // notify changes identity on every render; a stable fail keeps effects (and the SIP registration) from restarting.
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const fail = useCallback(
    (error: unknown) => notifyRef.current("Tổng đài", error instanceof ApiError ? error.message : "Không thể thực hiện yêu cầu.", "warning"),
    [],
  );

  const loadMe = useCallback(() => {
    if (!accessToken) return;
    api<CcAgentProfile>("me").then(setMe, (error) => setLoadError(error instanceof ApiError ? error.message : "Không tải được tổng đài."));
  }, [accessToken, api]);
  useEffect(loadMe, [loadMe]);

  useEffect(() => {
    if (!socket) return;
    const onAgent = (data: { state: AgentState; offer: CcCallOffer | null }) =>
      setMe((current) => current && { ...current, state: data.state, currentCall: data.offer, stateSince: new Date().toISOString() });
    socket.on("callcenter_agent", onAgent);
    return () => void socket.off("callcenter_agent", onAgent);
  }, [socket]);

  const supervised = useMemo(() => me?.departments.filter((department) => department.role === "supervisor") ?? [], [me]);
  const isAgent = Boolean(me?.departments.some((department) => department.role === "agent"));
  // Supervisors with an extension get the softphone too: CC-11 monitoring rings it.
  const hasDesk = isAgent || Boolean(me?.extension);
  const tabs = [
    ...(hasDesk ? [{ key: "desk", label: "Bàn làm việc" }] : []),
    ...(me?.departments.length || me?.isAdmin ? [{ key: "tickets", label: "Phiếu yêu cầu" }] : []),
    ...(supervised.length || me?.isAdmin ? [{ key: "live", label: "Giám sát" }] : []),
    ...(me?.departments.length || me?.isAdmin ? [{ key: "history", label: "Lịch sử cuộc gọi" }] : []),
    ...(me?.departments.length || me?.isAdmin ? [{ key: "quality", label: "Chất lượng" }] : []),
    ...(me?.isAdmin ? [{ key: "admin", label: "Cấu hình tổng đài" }] : []),
    { key: "contact", label: "Hỗ trợ của tôi" },
  ];
  const activeTab = tabs.some((item) => item.key === tab) ? tab : (tabs[0].key as Tab);

  if (loadError)
    return (
      <div className="callcenter-page">
        <div className="callcenter-panel desk-empty" role="alert">
          <Icon name="warning" size={28} />
          <p>{loadError}</p>
          <Button
            icon="refresh"
            onClick={() => {
              setLoadError("");
              loadMe();
            }}
          >
            Thử lại
          </Button>
        </div>
      </div>
    );
  if (!me) return <div className="callcenter-page"><div className="callcenter-panel">Đang tải tổng đài…</div></div>;
  // Everyone else (students, lecturers without a desk): contact a department and follow their requests.
  if (!me.departments.length && !me.isAdmin && !me.extension)
    return (
      <div className="callcenter-page">
        <div className="callcenter-header">
          <div>
            <h1 className="callcenter-header__title">Liên hệ & hỗ trợ</h1>
            <p className="callcenter-header__subtitle">Gọi hoặc gửi yêu cầu tới các phòng ban của trường, theo dõi phiếu hỗ trợ của bạn.</p>
          </div>
        </div>
        <ContactCenter />
      </div>
    );

  return (
    <div className="callcenter-page">
      <div className="callcenter-header">
        <div>
          <h1 className="callcenter-header__title">Tổng đài TDTU</h1>
          <p className="callcenter-header__subtitle">
            {me.departments.map((department) => department.name).filter((name, index, all) => all.indexOf(name) === index).join(" · ") || "Quản trị hệ thống"}
          </p>
        </div>
        {isAgent && <Badge tone={STATE_TONE[me.state]} dot>{STATE_LABEL[me.state]}</Badge>}
      </div>
      <FilterPills options={tabs} activeKey={activeTab} onChange={(key) => setTab(key as Tab)} className="desk-tabs" />
      {/* Always mounted: the softphone registration and an unfinished wrap-up survive tab switches. */}
      {hasDesk && (
        <div hidden={activeTab !== "desk"}>
          <AgentDesk
            me={me}
            isAgent={isAgent}
            api={api}
            fail={fail}
            onChange={setMe}
            dialRequest={dialRequest}
            onPhoneStatus={setPhoneStatus}
            autoAnswerUntil={autoAnswerUntil}
            token={accessToken!}
          />
        </div>
      )}
      {activeTab === "tickets" && (
        <TicketsPanel
          api={api}
          fail={fail}
          token={accessToken!}
          canCall={phoneStatus === "registered"}
          onCallBack={(number) => {
            setDialRequest({ number });
            setTab("desk");
          }}
        />
      )}
      {activeTab === "live" && (
        <LiveBoard
          departments={me.isAdmin ? null : supervised}
          api={api}
          fail={fail}
          token={accessToken!}
          onMonitor={
            me.extension
              ? (callId, mode) =>
                  api(`live-calls/${callId}/monitor`, "POST", { mode }).then(() => {
                    // The supervisor's own extension rings for this; it is answered automatically.
                    setAutoAnswerUntil(Date.now() + 20_000);
                    notify("Giám sát cuộc gọi", `Máy lẻ ${me.extension!.number} đang kết nối vào cuộc gọi…`, "info");
                  }, fail)
              : null
          }
        />
      )}
      {/* Kept mounted like the desk: a browser call to a department survives switching tabs. */}
      <div hidden={activeTab !== "contact"}>
        <ContactCenter />
      </div>
      {activeTab === "history" && <CallHistory me={me} api={api} fail={fail} token={accessToken!} />}
      {activeTab === "quality" && <QaPanel me={me} api={api} fail={fail} />}
      {activeTab === "admin" && (
        <Suspense fallback={<div className="callcenter-panel">Đang tải…</div>}>
          <CallCenterAdmin api={api} fail={fail} notify={notify} onChanged={loadMe} />
        </Suspense>
      )}
    </div>
  );
}

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

function AgentDesk({
  me,
  isAgent,
  api,
  fail,
  onChange,
  dialRequest,
  onPhoneStatus,
  autoAnswerUntil,
  token,
}: {
  token: string;
  me: CcAgentProfile;
  isAgent: boolean;
  autoAnswerUntil: number;
  api: Api;
  fail: (error: unknown) => void;
  onChange: (me: CcAgentProfile) => void;
  dialRequest: { number: string } | null;
  onPhoneStatus: (status: PhoneStatus) => void;
}) {
  const [dispositions, setDispositions] = useState<CcDisposition[]>([]);
  const [wrapUp, setWrapUp] = useState<CcCallOffer | null>(null);
  const [notes, setNotes] = useState("");
  const [dispositionId, setDispositionId] = useState("");
  const [dial, setDial] = useState("");
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<CcCallRecord[] | null>(null);
  const [, tick] = useState(0);
  // UI-1: the softphone lives above the pages, so leaving this screen keeps the call.
  const phone = useGlobalSoftphone();

  useEffect(() => {
    api<CcDisposition[]>("dispositions").then(setDispositions, fail);
  }, [api, fail]);
  useEffect(() => {
    if (!isAgent) return;
    // Reloaded on every state change, so a finished call shows up in "today" as soon as the agent is free.
    api<CcCallRecord[]>("calls?limit=100").then((calls) => setMine(calls.filter((call) => call.agentUserId === me.userId)), () => setMine([]));
  }, [api, isAgent, me.userId, me.state]);
  const { refresh } = phone;
  useEffect(refresh, [refresh, me.extension?.number]);
  useEffect(() => onPhoneStatus(phone.status), [onPhoneStatus, phone.status]);
  const { answer } = phone;
  useEffect(() => {
    if (phone.phase === "incoming" && Date.now() < autoAnswerUntil) answer(); // monitor leg the supervisor asked for
    // Only phase and the deadline: answer is recreated on every render.
  }, [phone.phase, autoAnswerUntil]);
  const { call: dialOut } = phone;
  useEffect(() => {
    if (dialRequest) dialOut(dialRequest.number); // call-back from a ticket (CC-8)
    // Only dialRequest: dial once per request object, not each time the phone object re-renders.
  }, [dialRequest]);
  useEffect(() => {
    // Kept after hang-up so the agent can file the call; only calls they actually took.
    if (me.currentCall && me.state === "on_call") setWrapUp(me.currentCall);
  }, [me.currentCall, me.state]);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const [pausing, setPausing] = useState(false);
  const choose = (state: AgentState, reason?: string) => {
    setBusy(true);
    setPausing(false);
    api<CcAgentProfile>("me/state", "POST", { state, ...(reason ? { reason } : {}) }).then(onChange, fail).finally(() => setBusy(false));
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  const canChoose = isAgent && Boolean(me.extension) && !busy && me.state !== "ringing" && me.state !== "on_call";
  useEffect(() => {
    // Desk shortcuts: Alt+R ready, Alt+P pause (answer/hang up/mute are global, in SoftphoneProvider).
    if (!canChoose) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      const state = key === "r" && !me.training.length ? "ready" : key === "p" ? "not_ready" : null;
      if (!state || state === me.state) return;
      event.preventDefault();
      chooseRef.current(state, state === "not_ready" ? "Khác" : undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canChoose, me.state, me.training.length]);
  const saveWrapUp = async (withTicket: boolean) => {
    if (!wrapUp) return;
    try {
      await api(`calls/${wrapUp.callId}`, "PATCH", { dispositionId: dispositionId || null, notes });
      if (withTicket) {
        // CC-8: a request that cannot be closed on the phone becomes a follow-up ticket for the department.
        const label = dispositions.find((item) => item.id === dispositionId)?.label;
        await api("tickets", "POST", {
          departmentId: wrapUp.departmentId,
          callId: wrapUp.callId,
          subject: `${label ?? "Yêu cầu"} – ${wrapUp.caller.displayName ?? wrapUp.caller.number}`.slice(0, 200),
          description: notes,
        });
      }
      setWrapUp(null);
      setNotes("");
      setDispositionId("");
    } catch (error) {
      fail(error);
    }
  };
  const offer = me.currentCall;
  const inCall = me.state === "ringing" || me.state === "on_call";
  const dayStart = new Date().setHours(0, 0, 0, 0);
  const today = mine?.filter((call) => Date.parse(call.startedAt) >= dayStart) ?? [];
  const talked = today.filter((call) => call.answeredAt);
  const talkSeconds = talked.reduce((sum, call) => sum + seconds(call.answeredAt!, call.endedAt), 0);
  const canDial = phone.status === "registered" && phone.phase === "none" && !inCall;
  // A hotline call is held by the ACD (the caller leaves the bridge and hears music); a direct call by SIP.
  const hotlineCall = Boolean(offer && me.state === "on_call");
  const held = hotlineCall ? Boolean(offer?.held) : phone.held;
  const [holding, setHolding] = useState(false);
  const toggleHold = () => {
    if (!hotlineCall) return phone.toggleHold();
    setHolding(true);
    api<CcAgentProfile>("me/hold", "POST", { on: !held }).then(onChange, fail).finally(() => setHolding(false));
  };
  const press = (key: string) => (phone.phase === "active" ? phone.sendDigit(key) : setDial((value) => (value + key).slice(0, 15)));
  const phoneLabel = { off: "Chưa kết nối", registering: "Đang đăng ký…", registered: "Đã đăng ký", failed: "Đăng ký thất bại" }[phone.status];

  return (
    <div className="callcenter-main-grid desk-grid">
      <div className="callcenter-left-column">
        <div className="callcenter-panel">
          <div className="callcenter-panel__head">
            <h2 className="callcenter-panel__title"><Icon name="phone-call" size={18} /><span>Cuộc gọi hiện tại</span></h2>
          </div>
          {offer ? (
            <div className="desk-caller">
              <div className="desk-caller__name">{offer.caller.displayName ?? "Số chưa xác định"}</div>
              <div className="desk-caller__meta">
                <span>{numberLabel(offer.caller.number)}</span>
                {offer.caller.email && <span>{offer.caller.email}</span>}
                <Badge tone="blue">{offer.departmentName}</Badge>
              </div>
              <div className="desk-caller__facts">
                <span>Đã chờ {offer.waitedSeconds}s</span>
                <span>{offer.caller.recentCalls} cuộc gọi trong 30 ngày</span>
                {!offer.caller.userId && <span>Chưa liên kết tài khoản</span>}
              </div>
              {offer.context && <p className="desk-context"><Icon name="book" size={14} /> {offer.context}</p>}
              {offer.held && <Badge tone="amber" dot>Đang giữ máy · người gọi nghe nhạc chờ</Badge>}
              <CallerProfile api={api} callId={offer.callId} outcomeLabel={OUTCOME_LABEL} />
              {me.state === "on_call" && <TransferPanel offer={offer} api={api} fail={fail} onChange={onChange} />}
              {me.state === "on_call" && offer.caller.userId && <VideoInviteButton callId={offer.callId} api={api} fail={fail} />}
            </div>
          ) : (
            <p className="desk-muted">
              {!isAgent
                ? "Máy lẻ này dùng để giám sát cuộc gọi và gọi nội bộ."
                : me.state === "ready"
                  ? "Đang chờ cuộc gọi từ hàng đợi…"
                  : "Chọn “Sẵn sàng” để nhận cuộc gọi từ hàng đợi."}
            </p>
          )}
        </div>

        {wrapUp && !inCall && (
          <div className="callcenter-panel">
            <div className="callcenter-panel__head">
              <h2 className="callcenter-panel__title"><Icon name="clipboard" size={18} /><span>Ghi nhận cuộc gọi · {wrapUp.caller.displayName ?? wrapUp.caller.number}</span></h2>
            </div>
            <div className="desk-form">
              <Field label="Kết quả cuộc gọi">
                <select aria-label="Kết quả cuộc gọi" value={dispositionId} onChange={(event) => setDispositionId(event.target.value)}>
                  <option value="">— Chọn kết quả —</option>
                  {dispositions
                    .filter((item) => !item.departmentId || item.departmentId === wrapUp.departmentId)
                    .map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </Field>
              <Field label="Ghi chú">
                <textarea aria-label="Ghi chú" rows={3} maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Nội dung người gọi trình bày, việc cần làm tiếp…" />
              </Field>
              <div className="desk-actions">
                {wrapUp.caller.userId && <VideoInviteButton callId={wrapUp.callId} api={api} fail={fail} />}
                {/* BR-07: a hotline call is always filed with a result code. */}
                {!dispositionId && <span className="desk-muted">Chọn kết quả cuộc gọi để lưu.</span>}
                <Button variant="secondary" disabled={!dispositionId} onClick={() => void saveWrapUp(true)} icon="clipboard">Lưu và tạo phiếu</Button>
                <Button disabled={!dispositionId} onClick={() => void saveWrapUp(false)} icon="check">Lưu ghi nhận</Button>
              </div>
            </div>
          </div>
        )}

        {isAgent && (
          <div className="callcenter-panel">
            <div className="callcenter-panel__head">
              <h2 className="callcenter-panel__title"><Icon name="calendar" size={18} /><span>Hôm nay của tôi</span></h2>
            </div>
            <div className="desk-today">
              <div><strong>{talked.length}</strong><span>cuộc đã nghe</span></div>
              <div><strong>{clock(talkSeconds)}</strong><span>tổng đàm thoại</span></div>
              <div><strong>{talked.length ? clock(Math.round(talkSeconds / talked.length)) : "—"}</strong><span>trung bình mỗi cuộc</span></div>
            </div>
            {mine === null ? (
              <p className="desk-muted">Đang tải cuộc gọi gần đây…</p>
            ) : !mine.length ? (
              <p className="desk-muted">Bạn chưa nhận cuộc gọi nào.</p>
            ) : (
              <ul className="desk-recent" aria-label="Cuộc gọi gần đây của tôi">
                {mine.slice(0, 6).map((call) => (
                  <li key={call.id}>
                    <div className="desk-recent__who">
                      <strong>{call.callerName ?? call.callerNumber}</strong>
                      <span>{new Date(call.startedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })} · {call.departmentName ?? "—"}{call.answeredAt ? ` · ${clock(seconds(call.answeredAt, call.endedAt))}` : ""}</span>
                    </div>
                    {call.outcome ? <Badge tone={call.outcome === "answered" ? "green" : "amber"}>{OUTCOME_LABEL[call.outcome]}</Badge> : <Badge tone="violet">Đang diễn ra</Badge>}
                    <Button size="sm" variant="ghost" icon="phone" disabled={!canDial || !dialable(call.callerNumber)} title={!dialable(call.callerNumber) ? "Người gọi từ trình duyệt, không có số để gọi lại" : canDial ? `Gọi lại ${call.callerNumber}` : "Máy lẻ chưa sẵn sàng để gọi"} onClick={() => phone.call(call.callerNumber)}>
                      Gọi lại
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {me.extension && <VoicemailInbox api={api} token={token} fail={fail} onCall={canDial ? (number) => phone.call(number) : null} />}
      </div>

      <div className="softphone-card">
        <div className="softphone-status-wrap">
          <span className="desk-muted">Máy lẻ {me.extension?.number ?? "—"} · {phoneLabel}</span>
        </div>
        {!me.extension && <p className="desk-warning">Bạn chưa được cấp máy lẻ, chưa thể nhận cuộc gọi.</p>}
        {isAgent && me.training.length > 0 && <TrainingRequired training={me.training} />}
        {isAgent && (
          <div className="desk-states" role="group" aria-label="Trạng thái trực">
            {(["ready", "not_ready", "offline"] as const).map((state) => (
              <button
                key={state}
                type="button"
                className={`desk-state ${me.state === state ? "is-active" : ""}`}
                disabled={busy || inCall || !me.extension || (state === "ready" && me.training.length > 0)}
                aria-expanded={state === "not_ready" ? pausing : undefined}
                onClick={() => (state === "not_ready" ? setPausing((open) => !open) : choose(state))}
              >
                {STATE_LABEL[state]}
              </button>
            ))}
          </div>
        )}
        {pausing && (
          <div className="desk-pause" role="group" aria-label="Lý do tạm nghỉ">
            <span className="desk-muted">Lý do:</span>
            {PAUSE_REASONS.map((reason) => (
              <button key={reason} type="button" className="desk-monitor" disabled={busy} onClick={() => choose("not_ready", reason)}>
                {reason}
              </button>
            ))}
          </div>
        )}
        {me.stateReason && <p className="desk-muted">{me.stateReason}</p>}
        <p className="desk-shortcuts">
          Phím tắt: <kbd>Alt</kbd>+<kbd>A</kbd> trả lời · <kbd>Alt</kbd>+<kbd>H</kbd> kết thúc · <kbd>Alt</kbd>+<kbd>M</kbd> micro
          {isAgent && <> · <kbd>Alt</kbd>+<kbd>R</kbd> sẵn sàng · <kbd>Alt</kbd>+<kbd>P</kbd> tạm nghỉ</>}
        </p>
        <div className="softphone-timer-box">
          <div className="softphone-timer-digits">{me.stateSince ? clock(seconds(me.stateSince, null)) : "00:00"}</div>
          <div className="softphone-timer-status">
            {phone.phase === "incoming" ? `Cuộc gọi đến: ${phone.peer}` : phone.phase === "active" ? `Đang đàm thoại: ${phone.peer}` : STATE_LABEL[me.state]}
          </div>
        </div>
        <div className="softphone-actions-row">
          {phone.phase === "incoming" && (
            <button type="button" className="softphone-call-btn btn-start" onClick={phone.answer}>
              <Icon name="phone" size={17} /><span>Trả lời</span>
            </button>
          )}
          {phone.phase !== "none" && (
            <>
              <button type="button" className="softphone-call-btn btn-hangup" onClick={phone.hangup}>
                <Icon name="phone" size={17} /><span>Kết thúc</span>
              </button>
              <button type="button" className="softphone-feature-btn" onClick={phone.toggleMute}>
                <Icon name={phone.muted ? "mic-off" : "mic"} size={16} /><span>{phone.muted ? "Bật micro" : "Tắt micro"}</span>
              </button>
              {phone.phase === "active" && (
                <button
                  type="button"
                  className="softphone-feature-btn"
                  aria-pressed={held}
                  disabled={holding || Boolean(offer?.transfer)}
                  onClick={toggleHold}
                >
                  <Icon name={held ? "play" : "pause"} size={16} /><span>{held ? "Tiếp tục" : "Giữ máy"}</span>
                </button>
              )}
            </>
          )}
          {phone.phase === "none" && (
            <form
              className="softphone-input-row"
              onSubmit={(event) => {
                event.preventDefault();
                if (/^[0-9*#]{3,15}$/.test(dial)) phone.call(dial);
              }}
            >
              <input className="softphone-dial-input" aria-label="Số cần gọi" value={dial} onChange={(event) => setDial(event.target.value.replace(/[^0-9*#]/g, "").slice(0, 15))} placeholder="Số máy lẻ hoặc số điện thoại" inputMode="tel" disabled={phone.status !== "registered" || inCall} />
              <Button size="sm" type="submit" icon="phone" disabled={phone.status !== "registered" || inCall || !dial}>Gọi</Button>
            </form>
          )}
        </div>
        {(phone.phase === "active" || (phone.phase === "none" && phone.status === "registered" && !inCall)) && (
          <div className="softphone-keypad-grid" role="group" aria-label={phone.phase === "active" ? "Bàn phím DTMF" : "Bàn phím số"}>
            {KEYPAD.map(([key, sub]) => (
              <button key={key} type="button" className="softphone-key-btn" onClick={() => press(key)} aria-label={key}>
                <span className="softphone-key-num">{key}</span>
                {sub && <span className="softphone-key-sub">{sub}</span>}
              </button>
            ))}
            {phone.phase === "none" && dial && (
              <button type="button" className="softphone-key-btn softphone-key-btn--wide" onClick={() => setDial((value) => value.slice(0, -1))} aria-label="Xóa một số">
                <Icon name="chevron-left" size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const KEYPAD = [["1", ""], ["2", "ABC"], ["3", "DEF"], ["4", "GHI"], ["5", "JKL"], ["6", "MNO"], ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"], ["*", ""], ["0", "+"], ["#", ""]] as const;

const MONITOR: { mode: MonitorMode; label: string; title: string }[] = [
  { mode: "listen", label: "Nghe", title: "Nghe cuộc gọi, hai bên không nghe thấy bạn" },
  { mode: "whisper", label: "Nhắc", title: "Chỉ tổng đài viên nghe thấy bạn" },
  { mode: "barge", label: "Tham gia", title: "Tham gia cuộc gọi ba bên" },
];

function LiveBoard({
  departments,
  api,
  fail,
  token,
  onMonitor,
}: {
  onMonitor: ((callId: string, mode: MonitorMode) => void) | null;
  departments: { id: string; name: string }[] | null;
  api: Api;
  fail: (error: unknown) => void;
  token: string;
}) {
  const { socket } = useSocket();
  const [options, setOptions] = useState(departments ?? []);
  const [departmentId, setDepartmentId] = useState(departments?.[0]?.id ?? "");
  const [live, setLive] = useState<CcLiveSnapshot | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const board = useRef<HTMLDivElement>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    if (departments) return;
    api<{ id: string; name: string }[]>("departments").then((list) => {
      setOptions(list);
      setDepartmentId((current) => current || list[0]?.id || "");
    }, fail);
  }, [api, departments, fail]);
  const load = useCallback(() => {
    if (departmentId) api<CcLiveSnapshot>(`departments/${departmentId}/live`).then(setLive, fail);
  }, [api, departmentId, fail]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!socket) return;
    const onLive = (data: { departmentId: string }) => {
      if (data.departmentId !== departmentId) return;
      load();
      setRefreshKey((value) => value + 1);
    };
    socket.on("callcenter_live", onLive);
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => {
      socket.off("callcenter_live", onLive);
      window.clearInterval(timer);
    };
  }, [departmentId, load, socket]);

  const count = (state: AgentState) => live?.agents.filter((agent) => agent.state === state).length ?? 0;
  const longestWait = Math.max(0, ...(live?.waiting.map((call) => seconds(call.waitingSince, null)) ?? []));
  return (
    <div ref={board} className="desk-wallboard">
      <div className="desk-toolbar">
        {options.length > 1 ? (
          <FilterPills options={options.map((item) => ({ key: item.id, label: item.name }))} activeKey={departmentId} onChange={setDepartmentId} />
        ) : <span />}
        <time className="desk-wallboard__clock">{new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</time>
        <Button
          size="sm"
          variant="ghost"
          icon="monitor"
          onClick={() => (document.fullscreenElement ? document.exitFullscreen() : board.current?.requestFullscreen())?.catch(() => undefined)}
        >
          Wallboard toàn màn hình
        </Button>
      </div>
      <div className="callcenter-kpi-grid">
        <KpiStatCard icon="clock" tone="amber" value={live?.waiting.length ?? 0} label="Cuộc gọi đang chờ" />
        <KpiStatCard icon="users" tone="green" value={count("ready")} label="Tổng đài viên sẵn sàng" />
        <KpiStatCard icon="headset" tone="purple" value={count("on_call") + count("ringing")} label="Đang đổ chuông / đàm thoại" />
        <KpiStatCard
          icon="clock"
          tone={longestWait >= 60 ? "red" : "blue"}
          value={clock(longestWait)}
          label="Chờ lâu nhất"
          className={longestWait >= 60 ? "is-late" : ""}
        />
      </div>
      <div className="callcenter-main-grid desk-live-grid">
        <div className="callcenter-panel">
          <div className="callcenter-panel__head">
            <h2 className="callcenter-panel__title"><Icon name="clock" size={18} /><span>Hàng đợi</span></h2>
          </div>
          {!live?.waiting.length ? <p className="desk-muted">Không có cuộc gọi nào đang chờ.</p> : live.waiting.map((call) => (
            <div key={call.callId} className="call-item-card">
              <div className="call-item-info">
                <div className="call-item-caller">{call.callerName ?? call.callerNumber}</div>
                <div className="call-item-meta"><span>{numberLabel(call.callerNumber)}</span><span>·</span><span className="desk-wait">Chờ {clock(seconds(call.waitingSince, null))}</span></div>
              </div>
            </div>
          ))}
        </div>
        <div className="callcenter-panel">
          <div className="callcenter-panel__head">
            <h2 className="callcenter-panel__title"><Icon name="users" size={18} /><span>Tổng đài viên</span></h2>
          </div>
          {!live?.agents.length ? <p className="desk-muted">Phòng ban chưa có tổng đài viên.</p> : live.agents.map((agent) => (
            <div key={agent.userId} className="call-item-card">
              <div className="call-item-info">
                <div className="call-item-caller">{agent.displayName}</div>
                <div className="call-item-meta">
                  <span>Máy lẻ {agent.extension ?? "—"}</span>
                  {agent.reason && <><span>·</span><span>{agent.reason}</span></>}
                </div>
              </div>
              <div className="desk-agent-state">
                <Badge tone={STATE_TONE[agent.state]} dot>{STATE_LABEL[agent.state]}</Badge>
                {agent.since && <span className="desk-muted">{clock(seconds(agent.since, null))}</span>}
                {agent.state === "on_call" && agent.callId && onMonitor && (
                  <div className="call-supervisor-actions">
                    {MONITOR.map((item) => (
                      <button key={item.mode} type="button" className="desk-monitor" title={item.title} onClick={() => onMonitor(agent.callId!, item.mode)}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {departmentId && <KpiPanel departmentId={departmentId} api={api} fail={fail} token={token} refreshKey={refreshKey} />}
    </div>
  );
}

/**
 * M2: invite the (identified) caller to a private video room. It opens in a new tab so this page,
 * and with it the softphone and the phone call, keep running.
 */
function VideoInviteButton({ callId, api, fail }: { callId: string; api: Api; fail: (error: unknown) => void }) {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      icon="video"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        api<{ workspaceId: string; roomId: string }>(`calls/${callId}/video`, "POST")
          .then((room) => {
            notify("Đã mời người gọi vào họp video", "Người gọi nhận lời mời trên ứng dụng; phòng họp mở ở tab mới.", "success");
            window.open(appRouteUrl({ view: "meetings", workspaceId: room.workspaceId, channelId: room.roomId }), "_blank", "noopener");
          }, fail)
          .finally(() => setBusy(false));
      }}
    >
      Mời họp video
    </Button>
  );
}

/** LT-4: the required course comes before taking calls; the button opens it in Khóa học. */
function TrainingRequired({ training }: { training: CcAgentProfile["training"] }) {
  const { navigate } = useApp();
  return (
    <div className="desk-training" role="status">
      <strong><Icon name="book" size={16} /> Hoàn thành khóa đào tạo bắt buộc để bật “Sẵn sàng”</strong>
      {training.map((course) => (
        <div key={course.courseId} className="desk-training__row">
          <span>{course.code} — {course.title}</span>
          <span className="desk-training__bar" aria-hidden="true"><span style={{ width: `${course.percent}%` }} /></span>
          <span>{course.percent}%</span>
          <Button size="sm" variant="secondary" type="button" onClick={() => navigate({ view: "elearning", query: course.courseId })}>Vào học</Button>
        </div>
      ))}
    </div>
  );
}

function CallHistory({ me, api, fail, token }: { me: CcAgentProfile; api: Api; fail: (error: unknown) => void; token: string }) {
  const [calls, setCalls] = useState<CcCallRecord[] | null>(null);
  const [dispositions, setDispositions] = useState<CcDisposition[]>([]);
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [reviews, setReviews] = useState<Map<string, CcQaReview>>(new Map());
  const [scoring, setScoring] = useState<CcCallRecord | null>(null);
  const [teaching, setTeaching] = useState<CcCallRecord | null>(null);
  const [reading, setReading] = useState<CcCallRecord | null>(null);
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("");

  useEffect(() => {
    api<CcCallRecord[]>("calls?limit=100").then(setCalls, fail);
    api<CcDisposition[]>("dispositions").then(setDispositions, fail);
    api<CcQaReview[]>("qa-reviews").then((list) => setReviews(new Map(list.map((review) => [review.callId, review]))), fail);
  }, [api, fail]);
  // V7: supervisors of the department score answered, finished calls of other people.
  const canScore = (call: CcCallRecord) =>
    Boolean(call.answeredAt && call.endedAt && call.departmentId && call.agentUserId && call.agentUserId !== me.userId) &&
    supervises(call);
  const supervises = (call: CcCallRecord) =>
    me.isAdmin || me.departments.some((department) => department.id === call.departmentId && department.role === "supervisor");
  useEffect(() => () => void (playing && URL.revokeObjectURL(playing.url)), [playing]);

  const play = (call: CcCallRecord) => recordingUrl(token, call.id).then((url) => setPlaying({ id: call.id, url }), fail);
  const labelOf = (id: string | null) => dispositions.find((item) => item.id === id)?.label ?? "";
  const needle = query.trim().toLowerCase();
  const shown = calls?.filter(
    (call) =>
      (!outcome || (outcome === "open" ? !call.outcome : call.outcome === outcome)) &&
      (!needle || [call.callerName, call.callerNumber, call.agentName, call.departmentName, call.notes].some((value) => value?.toLowerCase().includes(needle))),
  );
  return (
    <div className="cdr-table-card">
      <div className="cdr-toolbar">
        <input type="search" aria-label="Tìm cuộc gọi" placeholder="Tìm theo người gọi, số, tổng đài viên, ghi chú…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Lọc theo kết quả" value={outcome} onChange={(event) => setOutcome(event.target.value)}>
          <option value="">Mọi kết quả</option>
          <option value="open">Đang diễn ra</option>
          {Object.entries(OUTCOME_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <span className="desk-muted">{shown ? `${shown.length}/${calls!.length} cuộc gọi` : "Đang tải…"}</span>
      </div>
      <div className="cdr-table-wrapper">
        <table className="cdr-table">
          <thead>
            <tr><th>Thời điểm</th><th>Người gọi</th><th>Phòng ban</th><th>Tổng đài viên</th><th>Kết quả</th><th>Thời lượng</th><th>Ghi nhận</th><th>Ghi âm</th><th>Chất lượng</th></tr>
          </thead>
          <tbody>
            {shown?.map((call) => (
              <tr key={call.id}>
                <td>{new Date(call.startedAt).toLocaleString("vi-VN")}</td>
                <td>{call.callerName ?? call.callerNumber}{call.callerName && <div className="desk-muted">{numberLabel(call.callerNumber)}</div>}</td>
                <td>{call.departmentName ?? "—"}</td>
                <td>{call.agentName ?? "—"}</td>
                <td>{call.outcome ? <Badge tone={call.outcome === "answered" ? "green" : call.outcome === "voicemail" ? "blue" : "amber"}>{OUTCOME_LABEL[call.outcome]}</Badge> : <Badge tone="violet">Đang diễn ra</Badge>}</td>
                <td>{call.answeredAt ? clock(seconds(call.answeredAt, call.endedAt)) : "—"}</td>
                <td>{labelOf(call.dispositionId)}{call.notes && <div className="desk-muted desk-notes">{call.notes}</div>}</td>
                <td>
                  {playing?.id === call.id ? <audio src={playing.url} controls autoPlay /> : call.hasRecording ? (
                    <Button size="sm" variant="ghost" icon="play" onClick={() => play(call)}>Nghe</Button>
                  ) : "—"}
                  {call.transcriptStatus === "ready" && <Button size="sm" variant="ghost" icon="file" onClick={() => setReading(call)}>Lời thoại</Button>}
                  {call.transcriptStatus === "processing" && <div className="desk-muted">Đang chép lời…</div>}
                </td>
                <td className="cdr-actions">
                  {reviews.get(call.id) && <Badge tone={qaTone(reviews.get(call.id)!.percent)}>{reviews.get(call.id)!.percent}%</Badge>}
                  {canScore(call) && (
                    <Button size="sm" variant="ghost" icon="star" onClick={() => setScoring(call)}>{reviews.has(call.id) ? "Chấm lại" : "Chấm điểm"}</Button>
                  )}
                  {call.hasRecording && call.endedAt && supervises(call) && (
                    <Button size="sm" variant="ghost" icon="book" onClick={() => setTeaching(call)}>Làm bài học</Button>
                  )}
                  {!reviews.has(call.id) && !canScore(call) && !(call.hasRecording && call.endedAt && supervises(call)) && "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown && !shown.length && <p className="desk-muted desk-empty-row">{calls!.length ? "Không có cuộc gọi khớp bộ lọc." : "Chưa có cuộc gọi nào."}</p>}
      </div>
      {reading && (
        <CallTranscriptDialog
          call={{ id: reading.id, title: `${reading.agentName ?? ""} · ${reading.callerName ?? reading.callerNumber}` }}
          api={api}
          onClose={() => setReading(null)}
        />
      )}
      {teaching && (
        <CallLessonDialog
          call={{ id: teaching.id, title: `${teaching.agentName ?? teaching.callerNumber} · ${new Date(teaching.startedAt).toLocaleDateString("vi-VN")}` }}
          onClose={() => setTeaching(null)}
        />
      )}
      {scoring && (
        <QaReviewDialog
          call={{ id: scoring.id, departmentId: scoring.departmentId!, title: `${scoring.agentName ?? ""} · ${scoring.callerName ?? scoring.callerNumber}` }}
          api={api}
          fail={fail}
          onClose={() => setScoring(null)}
          onSaved={(review) => {
            setReviews((current) => new Map(current).set(review.callId, review));
            setScoring(null);
          }}
        />
      )}
    </div>
  );
}
