import {
  lazy,
  Suspense,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import type { ViewId } from "../../app/types";
import { useSocket } from "../../app/providers/SocketContext";
import { Badge, Button, Field, PageHeader } from "../../shared/ui/Primitives";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { ApiError } from "../auth/api";
import { callCenterApi, recordingUrl } from "./api";
import { KpiPanel } from "./KpiPanel";
import { CallLessonDialog, CallTranscriptDialog, QaPanel, QaReviewDialog, qaTone } from "./QaPanel";
import { TicketsPanel } from "./TicketsPanel";
import { TransferPanel } from "./TransferPanel";
import { VoicemailInbox } from "./VoicemailInbox";
import { ContactCenter } from "./ContactCenter";
import { CallerProfile } from "./CallerProfile";
import { DeskDialer } from "./DeskDialer";
import { type PhoneStatus } from "./useSoftphone";
import { useGlobalSoftphone } from "../../app/providers/SoftphoneContext";
import { STATE_LABEL, STATE_TONE } from "./agent-state";
import "./call-center.css";
import "./agent-desk.css";

const CallCenterAdmin = lazy(() =>
  import("./CallCenterAdmin").then((m) => ({ default: m.CallCenterAdmin })),
);

/** NV-CC2: why an agent pauses (same list as the API). */
const PAUSE_REASONS = ["Ăn trưa", "Họp", "Khác"] as const;

const OUTCOME_LABEL: Record<string, string> = {
  answered: "Đã nghe",
  abandoned: "Bỏ máy",
  missed: "Nhỡ",
  voicemail: "Thư thoại",
  callback: "Hẹn gọi lại",
  busy: "Bận",
  failed: "Lỗi",
  transferred: "Đã chuyển",
};
const OUTCOME_TONE: Record<string, string> = {
  answered: "green",
  transferred: "green",
  abandoned: "amber",
  busy: "amber",
  missed: "red",
  failed: "red",
  voicemail: "blue",
  callback: "blue",
};
const DIRECTION: Record<CcCallRecord["direction"], [string, string]> = {
  inbound: ["↙", "Gọi đến"],
  outbound: ["↗", "Gọi đi"],
  internal: ["⇄", "Nội bộ"],
};

type Tab = "desk" | "history" | "tickets" | "quality" | "live" | "admin" | "contact";
/** Tabs with their own address; the others switch inside the page. */
const TAB_VIEW: Partial<Record<Tab, ViewId>> = {
  desk: "call-center",
  history: "call-directory",
  live: "call-monitoring",
};
const seconds = (from: string, to: string | null) =>
  Math.max(0, Math.round((Date.parse(to ?? new Date().toISOString()) - Date.parse(from)) / 1000));
/** Browser calls ("Liên hệ phòng ban") carry no phone number; the caller is known by account. */
const numberLabel = (number: string) => (number === "web" ? "Gọi từ trình duyệt" : number);
const dialable = (number: string) => /^[0-9*#]{3,15}$/.test(number);
const pad = (value: number) => String(value).padStart(2, "0");
const clock = (total: number) =>
  total >= 86400
    ? `${Math.floor(total / 86400)} ngày`
    : total >= 3600
      ? `${Math.floor(total / 3600)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`
      : `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
/** Queue thresholds of the wallboard: under 30 s fine, under 60 s watch, then late. */
const waitTone = (waited: number) => (waited >= 60 ? "red" : waited >= 30 ? "amber" : "green");

export function CallCenterWorkspace({ initialTab = "desk" }: { initialTab?: Tab }) {
  const { accessToken, notify, route, navigate } = useApp();
  const { socket } = useSocket();
  const [me, setMe] = useState<CcAgentProfile | null>(null);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<Tab>(initialTab);
  // Back/forward between the routed tabs arrives as a new initialTab.
  useEffect(() => setTab(initialTab), [initialTab]);
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
    <T,>(path: string, method?: string, body?: object) =>
      callCenterApi<T>(accessToken!, path, method, body),
    [accessToken],
  );
  // notify changes identity on every render; a stable fail keeps effects (and the SIP registration) from restarting.
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const fail = useCallback(
    (error: unknown) =>
      notifyRef.current(
        "Tổng đài",
        error instanceof ApiError ? error.message : "Không thể thực hiện yêu cầu.",
        "warning",
      ),
    [],
  );

  const loadMe = useCallback(() => {
    if (!accessToken) return;
    api<CcAgentProfile>("me").then(setMe, (error) =>
      setLoadError(error instanceof ApiError ? error.message : "Không tải được tổng đài."),
    );
  }, [accessToken, api]);
  useEffect(loadMe, [loadMe]);

  useEffect(() => {
    if (!socket) return;
    const onAgent = (data: { state: AgentState; offer: CcCallOffer | null }) =>
      setMe(
        (current) =>
          current && {
            ...current,
            state: data.state,
            currentCall: data.offer,
            stateSince: new Date().toISOString(),
          },
      );
    socket.on("callcenter_agent", onAgent);
    return () => void socket.off("callcenter_agent", onAgent);
  }, [socket]);

  const supervised = useMemo(
    () => me?.departments.filter((department) => department.role === "supervisor") ?? [],
    [me],
  );
  const isAgent = Boolean(me?.departments.some((department) => department.role === "agent"));
  // Supervisors with an extension get the softphone too: CC-11 monitoring rings it.
  const hasDesk = isAgent || Boolean(me?.extension);
  const member = Boolean(me?.departments.length);
  const canMonitor = Boolean(supervised.length || me?.isAdmin);
  const tabs: { key: Tab; label: string; icon: IconName }[] = [
    ...(hasDesk ? [{ key: "desk" as const, label: "Bàn làm việc", icon: "headset" as const }] : []),
    ...(member || me?.isAdmin
      ? [{ key: "history" as const, label: "Lịch sử cuộc gọi", icon: "phone-call" as const }]
      : []),
    // Tickets are content: a system admin sees them only with a role in a department.
    ...(member
      ? [{ key: "tickets" as const, label: "Phiếu yêu cầu", icon: "clipboard" as const }]
      : []),
    ...(member || me?.isAdmin
      ? [{ key: "quality" as const, label: "Chất lượng", icon: "star" as const }]
      : []),
    ...(canMonitor ? [{ key: "live" as const, label: "Giám sát", icon: "activity" as const }] : []),
    ...(me?.isAdmin
      ? [{ key: "admin" as const, label: "Cấu hình", icon: "settings" as const }]
      : []),
    { key: "contact", label: "Hỗ trợ của tôi", icon: "help-circle" },
  ];
  const activeTab = tabs.some((item) => item.key === tab) ? tab : tabs[0].key;
  const subnav = useRef<HTMLElement>(null);
  const openTab = (key: Tab) => {
    setTab(key);
    subnav.current?.scrollIntoView({ block: "start" });
    const view = TAB_VIEW[key];
    if (view && view !== route.view) navigate({ view });
  };
  const onMonitor = me?.extension
    ? (callId: string, mode: MonitorMode) =>
        api(`live-calls/${callId}/monitor`, "POST", { mode }).then(() => {
          // The supervisor's own extension rings for this; it is answered automatically.
          setAutoAnswerUntil(Date.now() + 20_000);
          notify(
            "Giám sát cuộc gọi",
            `Máy lẻ ${me.extension!.number} đang kết nối vào cuộc gọi…`,
            "info",
          );
        }, fail)
    : null;

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
  if (!me)
    return (
      <div className="page-suspense-fallback" role="status" aria-label="Đang tải tổng đài…">
        <div className="page-suspense-line is-title" />
        <div className="page-suspense-line is-body" />
        <div className="page-suspense-card" />
      </div>
    );

  // Everyone else (students, lecturers without a desk): contact a department and follow their requests.
  if (!member && !me.isAdmin && !me.extension)
    return (
      <div className="callcenter-page">
        <PageHeader
          className="cc-pagehead"
          title="Tổng đài"
          meta="Liên hệ và hỗ trợ: gọi từ trình duyệt, không cần máy lẻ"
        />
        <ContactCenter />
      </div>
    );

  // A personal extension without a department: one phone page, no agent tabs.
  if (!member && !me.isAdmin)
    return (
      <div className="callcenter-page">
        <PageHeader
          className="cc-pagehead"
          title="Tổng đài"
          meta="Máy lẻ cá nhân: gọi nội bộ và liên hệ phòng ban"
        />
        <AgentDesk
          personal
          me={me}
          isAgent={false}
          canMonitor={false}
          api={api}
          fail={fail}
          onChange={setMe}
          dialRequest={dialRequest}
          onPhoneStatus={setPhoneStatus}
          autoAnswerUntil={0}
          token={accessToken!}
        >
          <ContactCenter />
        </AgentDesk>
      </div>
    );

  return (
    <>
      <nav ref={subnav} className="tdtu-subnav cc-subnav" aria-label="Tổng đài">
        <div className="tdtu-subnav__inner">
          {tabs.map((item) => {
            const active = item.key === activeTab;
            return (
              <button
                key={item.key}
                type="button"
                className={`tdtu-subnav__item ${active ? "is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => openTab(item.key)}
              >
                <Icon name={item.icon} size={15} strokeWidth={active ? 2.1 : 1.8} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
      <div className="callcenter-page">
        {/* Always mounted: the softphone registration and an unfinished wrap-up survive tab switches. */}
        {hasDesk && (
          <div hidden={activeTab !== "desk"}>
            <AgentDesk
              me={me}
              isAgent={isAgent}
              canMonitor={canMonitor}
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
              openTab("desk");
            }}
          />
        )}
        {activeTab === "live" && (
          <LiveBoard
            departments={me.isAdmin ? null : supervised}
            api={api}
            fail={fail}
            token={accessToken!}
            onMonitor={onMonitor}
          />
        )}
        {/* Kept mounted like the desk: a browser call to a department survives switching tabs. */}
        <div hidden={activeTab !== "contact"}>
          <ContactCenter />
        </div>
        {activeTab === "history" && (
          <CallHistory me={me} api={api} fail={fail} token={accessToken!} />
        )}
        {activeTab === "quality" && <QaPanel me={me} api={api} fail={fail} />}
        {activeTab === "admin" && (
          <Suspense fallback={<div className="callcenter-panel">Đang tải…</div>}>
            <CallCenterAdmin api={api} fail={fail} notify={notify} onChanged={loadMe} />
          </Suspense>
        )}
      </div>
    </>
  );
}

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

function AgentDesk({
  personal = false,
  children,
  me,
  isAgent,
  canMonitor,
  api,
  fail,
  onChange,
  dialRequest,
  onPhoneStatus,
  autoAnswerUntil,
  token,
}: {
  personal?: boolean;
  children?: ReactNode;
  token: string;
  me: CcAgentProfile;
  isAgent: boolean;
  canMonitor: boolean;
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
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<CcCallRecord[] | null>(null);
  const [, tick] = useState(0);
  // UI-1: the softphone lives above the pages, so leaving this screen keeps the call.
  const phone = useGlobalSoftphone();

  useEffect(() => {
    // Only agents wrap up calls; for an extension-only account the endpoint answers 403.
    if (isAgent) api<CcDisposition[]>("dispositions").then(setDispositions, fail);
  }, [api, fail, isAgent]);
  useEffect(() => {
    if (!isAgent) return;
    // Reloaded on every state change, so a finished call shows up in "today" as soon as the agent is free.
    api<CcCallRecord[]>("calls?limit=100").then(
      (calls) => setMine(calls.filter((call) => call.agentUserId === me.userId)),
      () => setMine([]),
    );
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
  const [callSince, setCallSince] = useState<number | null>(null);
  useEffect(() => setCallSince(phone.phase === "active" ? Date.now() : null), [phone.phase]);
  const choose = (state: AgentState, reason?: string) => {
    setBusy(true);
    setPausing(false);
    api<CcAgentProfile>("me/state", "POST", { state, ...(reason ? { reason } : {}) })
      .then(onChange, fail)
      .finally(() => setBusy(false));
  };
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  const canChoose =
    isAgent && Boolean(me.extension) && !busy && me.state !== "ringing" && me.state !== "on_call";
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
          subject:
            `${label ?? "Yêu cầu"} – ${wrapUp.caller.displayName ?? wrapUp.caller.number}`.slice(
              0,
              200,
            ),
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
  const talkSeconds = talked.reduce(
    (sum, call) => sum + seconds(call.answeredAt!, call.endedAt),
    0,
  );
  const canDial = phone.status === "registered" && phone.phase === "none" && !inCall;
  // A hotline call is held by the ACD (the caller leaves the bridge and hears music); a direct call by SIP.
  const hotlineCall = Boolean(offer && me.state === "on_call");
  const held = hotlineCall ? Boolean(offer?.held) : phone.held;
  const [holding, setHolding] = useState(false);
  const toggleHold = () => {
    if (!hotlineCall) return phone.toggleHold();
    setHolding(true);
    api<CcAgentProfile>("me/hold", "POST", { on: !held })
      .then(onChange, fail)
      .finally(() => setHolding(false));
  };
  const phoneLabel = {
    off: "Chưa kết nối",
    registering: "Đang đăng ký…",
    registered: "Đã đăng ký",
    failed: "Đăng ký thất bại",
  }[phone.status];
  const phoneTone = { off: "neutral", registering: "amber", registered: "green", failed: "red" }[
    phone.status
  ];
  const departments = me.departments
    .map((department) => department.name)
    .filter((name, index, all) => all.indexOf(name) === index)
    .join(" · ");

  const callerName =
    offer?.caller.displayName ?? (phone.peer || offer?.caller.number || "Số chưa xác định");
  const callerNumber = offer ? numberLabel(offer.caller.number) : phone.peer;
  const idleTitle = !isAgent
    ? "Máy lẻ dùng để gọi nội bộ"
    : me.state === "ready"
      ? "Bạn đang sẵn sàng nhận cuộc gọi"
      : me.state === "not_ready"
        ? "Bạn đang tạm nghỉ"
        : "Bạn đang ngoại tuyến";
  const idleText = !isAgent
    ? canMonitor
      ? "Cuộc gọi giám sát bạn chọn ở tab Giám sát sẽ đổ chuông tại đây. Gọi nội bộ bằng khung Gọi nhanh."
      : "Gọi máy lẻ nội bộ bằng khung Gọi nhanh hoặc danh bạ; cuộc gọi đến đổ chuông tại đây."
    : me.state === "ready"
      ? "Cuộc gọi tiếp theo trong hàng đợi sẽ đổ chuông ngay tại đây, kèm hồ sơ người gọi."
      : me.state === "not_ready"
        ? "Hàng đợi chuyển cuộc gọi cho người khác trong phòng ban cho tới khi bạn sẵn sàng lại."
        : "Chọn “Sẵn sàng” để nhận cuộc gọi từ hàng đợi.";

  return (
    <div className={`cc-console ${personal ? "cc-console--personal" : ""}`}>
      <section className="cc-statebar" aria-label="Trạng thái nhận cuộc gọi">
        {isAgent && (
          <div className="cc-states" role="group" aria-label="Trạng thái trực">
            {(["ready", "not_ready", "offline"] as const).map((state) => (
              <button
                key={state}
                type="button"
                className={`cc-state tone-${STATE_TONE[state]} ${me.state === state ? "is-active" : ""}`}
                aria-pressed={me.state === state}
                disabled={
                  busy || inCall || !me.extension || (state === "ready" && me.training.length > 0)
                }
                aria-expanded={state === "not_ready" ? pausing : undefined}
                onClick={() =>
                  state === "not_ready" ? setPausing((open) => !open) : choose(state)
                }
              >
                <span className="cc-led" aria-hidden="true" />
                {STATE_LABEL[state]}
              </button>
            ))}
          </div>
        )}
        <p className="cc-statebar__ext">
          <span>
            Máy lẻ <b>{me.extension?.number ?? "—"}</b>
          </span>
          <span className={`tone-${phoneTone}`}>
            <span className="cc-led" aria-hidden="true" />
            {phoneLabel}
          </span>
          {departments && <span className="cc-statebar__units">{departments}</span>}
        </p>
        {isAgent && (
          <dl className="cc-statebar__stats">
            <div>
              <dt>Đã nghe hôm nay</dt>
              <dd>{mine === null ? "—" : talked.length}</dd>
            </div>
            <div>
              <dt>Đàm thoại TB</dt>
              <dd>{talked.length ? clock(Math.round(talkSeconds / talked.length)) : "—"}</dd>
            </div>
            <div>
              <dt>{STATE_LABEL[me.state]}</dt>
              <dd className={`tone-${STATE_TONE[me.state]}`}>
                {me.stateSince ? clock(seconds(me.stateSince, null)) : "—"}
              </dd>
            </div>
          </dl>
        )}
      </section>
      {pausing && (
        <div className="desk-pause" role="group" aria-label="Lý do tạm nghỉ">
          <span className="desk-muted">Lý do tạm nghỉ:</span>
          {PAUSE_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              className="desk-monitor"
              disabled={busy}
              onClick={() => choose("not_ready", reason)}
            >
              {reason}
            </button>
          ))}
        </div>
      )}
      {!me.extension && (
        <p className="desk-warning">Bạn chưa được cấp máy lẻ, chưa thể nhận cuộc gọi.</p>
      )}
      {isAgent && me.training.length > 0 && <TrainingRequired training={me.training} />}

      <div className="cc-console__grid">
        {/* Left: the agent's own recent calls and voicemail. */}
        <div className="cc-console__col cc-console__col--mine">
          {isAgent && (
            <section className="callcenter-panel">
              <div className="callcenter-panel__head">
                <h2 className="callcenter-panel__title">Cuộc gọi gần đây</h2>
                {talked.length > 0 && (
                  <span className="cc-count">Hôm nay {clock(talkSeconds)}</span>
                )}
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
                        <span>
                          {new Date(call.startedAt).toLocaleString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                            day: "2-digit",
                            month: "2-digit",
                          })}{" "}
                          · {call.departmentName ?? "—"}
                          {call.answeredAt
                            ? ` · ${clock(seconds(call.answeredAt, call.endedAt))}`
                            : ""}
                        </span>
                      </div>
                      {call.outcome ? (
                        <Badge tone={call.outcome === "answered" ? "green" : "amber"}>
                          {OUTCOME_LABEL[call.outcome]}
                        </Badge>
                      ) : (
                        <Badge tone="red">Đang diễn ra</Badge>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="phone"
                        disabled={!canDial || !dialable(call.callerNumber)}
                        title={
                          !dialable(call.callerNumber)
                            ? "Người gọi từ trình duyệt, không có số để gọi lại"
                            : canDial
                              ? `Gọi lại ${call.callerNumber}`
                              : "Máy lẻ chưa sẵn sàng để gọi"
                        }
                        onClick={() => phone.call(call.callerNumber)}
                      >
                        <span className="sr-only">Gọi lại</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {me.extension && (
            <VoicemailInbox
              api={api}
              token={token}
              fail={fail}
              onCall={canDial ? (number) => phone.call(number) : null}
            />
          )}
        </div>

        {/* Centre: the call itself on the dark panel, then filing it and who is calling. */}
        <div className="cc-console__col cc-console__col--call">
          <section className={`cc-call is-${phone.phase}`} aria-label="Cuộc gọi hiện tại">
            {phone.phase !== "none" ? (
              <>
                <div className="cc-call__top">
                  <div className="cc-call__id">
                    <div className="cc-call__chips">
                      <span className="cc-chip tone-red">
                        <span className="cc-led" aria-hidden="true" />
                        {phone.phase === "incoming"
                          ? "Cuộc gọi đến"
                          : phone.phase === "outgoing"
                            ? "Đang gọi"
                            : "Đang đàm thoại"}
                      </span>
                      {offer && (
                        <span className="cc-chip">
                          {offer.departmentName} · đã chờ {offer.waitedSeconds}s
                        </span>
                      )}
                      {held && (
                        <span className="cc-chip tone-amber">
                          Đang giữ máy · người gọi nghe nhạc chờ
                        </span>
                      )}
                    </div>
                    <h2 className="cc-call__name">{callerName}</h2>
                    {callerNumber && callerNumber !== callerName && (
                      <p className="cc-call__number">{callerNumber}</p>
                    )}
                  </div>
                  {callSince !== null && (
                    <div className="cc-call__timer">
                      <small>Thời lượng</small>
                      <strong>{clock(Math.floor((Date.now() - callSince) / 1000))}</strong>
                    </div>
                  )}
                </div>
                {phone.phase === "incoming" ? (
                  <div className="cc-call__controls">
                    <button
                      type="button"
                      className="cc-ctl is-answer"
                      onClick={phone.answer}
                      title="Alt+A"
                    >
                      <Icon name="phone" size={20} />
                      Trả lời
                    </button>
                    <button type="button" className="cc-ctl" onClick={phone.hangup}>
                      <Icon name="phone-off" size={20} />
                      Từ chối
                    </button>
                  </div>
                ) : (
                  <div className="cc-call__controls">
                    <button
                      type="button"
                      className={`cc-ctl ${phone.muted ? "is-alert" : ""}`}
                      aria-pressed={phone.muted}
                      onClick={phone.toggleMute}
                      title="Alt+M"
                    >
                      <Icon name={phone.muted ? "mic-off" : "mic"} size={20} />
                      {phone.muted ? "Bật micro" : "Tắt micro"}
                    </button>
                    {phone.phase === "active" && (
                      <button
                        type="button"
                        className={`cc-ctl ${held ? "is-warn" : ""}`}
                        aria-pressed={held}
                        disabled={holding || Boolean(offer?.transfer)}
                        onClick={toggleHold}
                      >
                        <Icon name={held ? "play" : "pause"} size={20} />
                        {held ? "Tiếp tục" : "Giữ máy"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="cc-ctl is-end"
                      onClick={phone.hangup}
                      title="Alt+H"
                    >
                      <Icon name="phone-off" size={20} />
                      Kết thúc
                    </button>
                  </div>
                )}
              </>
            ) : wrapUp && !inCall ? (
              <div className="cc-call__idle">
                <span className="cc-call__icon tone-blue" aria-hidden="true">
                  <Icon name="clipboard" size={24} />
                </span>
                <div>
                  <h2>Lưu kết quả trước khi nhận cuộc gọi mới</h2>
                  <p>
                    Cuộc gọi với {wrapUp.caller.displayName ?? wrapUp.caller.number} đã kết thúc.
                    Chọn kết quả và ghi chú ở bên dưới.
                  </p>
                </div>
              </div>
            ) : (
              <div className="cc-call__idle">
                <span
                  className={`cc-call__icon tone-${isAgent ? STATE_TONE[me.state] : "blue"}`}
                  aria-hidden="true"
                >
                  <Icon
                    name={isAgent && me.state === "not_ready" ? "pause" : "headset"}
                    size={24}
                  />
                </span>
                <div>
                  <h2>{idleTitle}</h2>
                  <p>{idleText}</p>
                  {me.stateReason && <p>{me.stateReason}</p>}
                </div>
              </div>
            )}
          </section>

          {offer && me.state === "on_call" && (
            <TransferPanel offer={offer} api={api} fail={fail} onChange={onChange} />
          )}

          {wrapUp && !inCall && (
            <section className="callcenter-panel" aria-label="Ghi chú sau cuộc gọi">
              <div className="callcenter-panel__head">
                <h2 className="callcenter-panel__title">Ghi chú sau cuộc gọi</h2>
                <Badge tone="blue">{wrapUp.caller.displayName ?? wrapUp.caller.number}</Badge>
              </div>
              <div className="desk-form">
                <Field label="Kết quả cuộc gọi">
                  <select
                    aria-label="Kết quả cuộc gọi"
                    value={dispositionId}
                    onChange={(event) => setDispositionId(event.target.value)}
                  >
                    <option value="">— Chọn kết quả —</option>
                    {dispositions
                      .filter(
                        (item) => !item.departmentId || item.departmentId === wrapUp.departmentId,
                      )
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Ghi chú">
                  <textarea
                    aria-label="Ghi chú"
                    rows={4}
                    maxLength={4000}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Nội dung người gọi trình bày, việc cần làm tiếp…"
                  />
                </Field>
                <div className="desk-actions">
                  {wrapUp.caller.userId && (
                    <VideoInviteButton callId={wrapUp.callId} api={api} fail={fail} />
                  )}
                  {/* BR-07: a hotline call is always filed with a result code. */}
                  {!dispositionId && (
                    <span className="desk-muted">Chọn kết quả cuộc gọi để lưu.</span>
                  )}
                  <Button
                    variant="secondary"
                    disabled={!dispositionId}
                    onClick={() => void saveWrapUp(true)}
                    icon="clipboard"
                  >
                    Lưu và tạo phiếu
                  </Button>
                  <Button
                    disabled={!dispositionId}
                    onClick={() => void saveWrapUp(false)}
                    icon="check"
                  >
                    Lưu ghi nhận
                  </Button>
                </div>
              </div>
            </section>
          )}

          {offer && (
            <section className="callcenter-panel" aria-label="Người gọi">
              <div className="callcenter-panel__head">
                <h2 className="callcenter-panel__title">Người gọi</h2>
                <Badge tone="blue">{offer.departmentName}</Badge>
              </div>
              <div className="desk-caller">
                <div className="desk-caller__name">
                  {offer.caller.displayName ?? "Số chưa xác định"}
                </div>
                <div className="desk-caller__meta">
                  <span>{numberLabel(offer.caller.number)}</span>
                  {offer.caller.email && <span>{offer.caller.email}</span>}
                </div>
                <div className="desk-caller__facts">
                  <span>{offer.caller.recentCalls} cuộc gọi trong 30 ngày</span>
                  {!offer.caller.userId && <span>Chưa liên kết tài khoản</span>}
                </div>
                {offer.context && (
                  <p className="desk-context">
                    <Icon name="book" size={14} /> {offer.context}
                  </p>
                )}
                <CallerProfile api={api} callId={offer.callId} outcomeLabel={OUTCOME_LABEL} />
                {me.state === "on_call" && offer.caller.userId && (
                  <VideoInviteButton callId={offer.callId} api={api} fail={fail} />
                )}
              </div>
            </section>
          )}

          <p className="desk-shortcuts">
            Phím tắt: <kbd>Alt</kbd>+<kbd>A</kbd> trả lời · <kbd>Alt</kbd>+<kbd>H</kbd> kết thúc ·{" "}
            <kbd>Alt</kbd>+<kbd>M</kbd> micro
            {isAgent && (
              <>
                {" "}
                · <kbd>Alt</kbd>+<kbd>R</kbd> sẵn sàng · <kbd>Alt</kbd>+<kbd>P</kbd> tạm nghỉ
              </>
            )}
          </p>
        </div>

        {/* Right: dial an extension, the school's directory with busy lamps. */}
        <div className="cc-console__col cc-console__col--dial">
          <DeskDialer hotlineCall={hotlineCall} />
        </div>
      </div>
      {children}
    </div>
  );
}

const MONITOR: { mode: MonitorMode; label: string; title: string }[] = [
  { mode: "listen", label: "Nghe", title: "Nghe cuộc gọi, hai bên không nghe thấy bạn" },
  { mode: "whisper", label: "Nhắc", title: "Chỉ tổng đài viên nghe thấy bạn" },
  { mode: "barge", label: "Tham gia", title: "Tham gia cuộc gọi ba bên" },
];
const LEGEND: [string, string][] = [
  ["green", "Sẵn sàng"],
  ["red", "Đổ chuông / đàm thoại"],
  ["amber", "Tạm nghỉ"],
  ["blue", "Hoàn tất cuộc gọi"],
  ["neutral", "Ngoại tuyến"],
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

  // A snapshot of another department (just switched) is not shown as this one's.
  const snapshot = live?.departmentId === departmentId ? live : null;
  const agents = snapshot?.agents ?? [];
  const waiting = snapshot?.waiting ?? [];
  const count = (...states: AgentState[]) =>
    agents.filter((agent) => states.includes(agent.state)).length;
  const longestWait = Math.max(0, ...waiting.map((call) => seconds(call.waitingSince, null)));
  const queueTone = waiting.length ? waitTone(longestWait) : "";
  const kpis: { label: string; value: string | number; note?: string; tone?: string }[] = [
    {
      label: "Đang chờ",
      value: waiting.length,
      note: waiting.length
        ? `${waiting.filter((call) => seconds(call.waitingSince, null) >= 60).length} cuộc quá 60 giây`
        : "hàng đợi trống",
      tone: queueTone,
    },
    {
      label: "Chờ lâu nhất",
      value: clock(longestWait),
      note: "ngưỡng 30 / 60 giây",
      tone: queueTone,
    },
    {
      label: "Đổ chuông / đàm thoại",
      value: count("ringing", "on_call"),
      note: `trên ${agents.length} tổng đài viên`,
    },
    {
      label: "Sẵn sàng",
      value: count("ready"),
      tone: count("ready") ? "green" : waiting.length ? "red" : "",
    },
    { label: "Tạm nghỉ · hoàn tất", value: count("not_ready", "wrap_up") },
    { label: "Ngoại tuyến", value: count("offline") },
  ];
  const department = options.find((item) => item.id === departmentId)?.name ?? "";
  return (
    <div ref={board} className="cc-wall">
      <div className="cc-pagehead">
        <div>
          <p className="cc-eyebrow">
            <span className="cc-led tone-red is-pulse" aria-hidden="true" />
            Trực tiếp ·{" "}
            {new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
          </p>
          <h1 className="cc-pagehead__title">Giám sát tổng đài</h1>
        </div>
        {options.length > 1 && (
          <select
            className="cc-select"
            aria-label="Phòng ban"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        <Button
          variant="secondary"
          icon="maximize"
          onClick={() =>
            (document.fullscreenElement
              ? document.exitFullscreen()
              : board.current?.requestFullscreen()
            )?.catch(() => undefined)
          }
        >
          Wallboard toàn màn hình
        </Button>
      </div>
      {!departmentId ? (
        <p className="callcenter-panel desk-muted">Chưa có phòng ban nào để giám sát.</p>
      ) : (
        <>
          <section className="cc-kpis" aria-label="Chỉ số trực tiếp">
            {kpis.map((item) => (
              <div key={item.label} className={`cc-kpi ${item.tone ? `tone-${item.tone}` : ""}`}>
                <small>{item.label}</small>
                <strong>{item.value}</strong>
                {item.note && <span>{item.note}</span>}
              </div>
            ))}
          </section>
          <div className="cc-wall__grid">
            <section className="cc-rack" aria-label="Tổng đài viên">
              <div className="cc-rack__head">
                <h2>Tổng đài viên</h2>
                <ul className="cc-legend" aria-label="Chú thích trạng thái">
                  {LEGEND.map(([tone, label]) => (
                    <li key={tone} className={`tone-${tone}`}>
                      <span className="cc-led" aria-hidden="true" />
                      {label}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="cc-rack__group">
                {department} · {agents.length} người · {waiting.length} đang chờ
              </p>
              {!snapshot ? (
                <p className="cc-rack__empty">Đang tải…</p>
              ) : !agents.length ? (
                <p className="cc-rack__empty">Phòng ban chưa có tổng đài viên.</p>
              ) : (
                <ul className="cc-units">
                  {agents.map((agent) => (
                    <li key={agent.userId} className={`cc-unit tone-${STATE_TONE[agent.state]}`}>
                      <span className="cc-led" aria-hidden="true" />
                      <div className="cc-unit__who">
                        <strong>{agent.displayName}</strong>
                        <span>
                          {agent.extension ?? "—"} · {STATE_LABEL[agent.state]}
                          {agent.reason ? ` · ${agent.reason}` : ""}
                        </span>
                      </div>
                      {agent.since && (
                        <time className="cc-unit__time">{clock(seconds(agent.since, null))}</time>
                      )}
                      {agent.state === "on_call" && agent.callId && onMonitor && (
                        <div
                          className="cc-unit__monitor"
                          role="group"
                          aria-label={`Giám sát cuộc gọi của ${agent.displayName}`}
                        >
                          {MONITOR.map((item) => (
                            <button
                              key={item.mode}
                              type="button"
                              title={item.title}
                              onClick={() => onMonitor(agent.callId!, item.mode)}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="callcenter-panel cc-queue" aria-label="Hàng đợi">
              <div className="callcenter-panel__head">
                <h2 className="callcenter-panel__title">Hàng đợi</h2>
                <span className={`cc-count ${queueTone ? `tone-${queueTone}` : ""}`}>
                  {waiting.length} đang chờ
                </span>
              </div>
              {!waiting.length ? (
                <p className="desk-muted">Không có cuộc gọi nào đang chờ.</p>
              ) : (
                <ul className="cc-queue__list">
                  {waiting.map((call) => {
                    const waited = seconds(call.waitingSince, null);
                    return (
                      <li key={call.callId} className={`tone-${waitTone(waited)}`}>
                        <span className="cc-led" aria-hidden="true" />
                        <div>
                          <strong>{call.callerName ?? numberLabel(call.callerNumber)}</strong>
                          {call.callerName && <span>{numberLabel(call.callerNumber)}</span>}
                        </div>
                        <time>{clock(waited)}</time>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
          <KpiPanel
            departmentId={departmentId}
            api={api}
            fail={fail}
            token={token}
            refreshKey={refreshKey}
          />
        </>
      )}
    </div>
  );
}

/**
 * M2: invite the (identified) caller to a private video room. It opens in a new tab so this page,
 * and with it the softphone and the phone call, keep running.
 */
function VideoInviteButton({
  callId,
  api,
  fail,
}: {
  callId: string;
  api: Api;
  fail: (error: unknown) => void;
}) {
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
            notify(
              "Đã mời người gọi vào họp video",
              "Người gọi nhận lời mời trên ứng dụng; phòng họp mở ở tab mới.",
              "success",
            );
            window.open(
              appRouteUrl({
                view: "meetings",
                workspaceId: room.workspaceId,
                channelId: room.roomId,
              }),
              "_blank",
              "noopener",
            );
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
      <strong>
        <Icon name="book" size={16} /> Hoàn thành khóa đào tạo bắt buộc để bật “Sẵn sàng”
      </strong>
      {training.map((course) => (
        <div key={course.courseId} className="desk-training__row">
          <span>
            {course.code} — {course.title}
          </span>
          <span className="desk-training__bar" aria-hidden="true">
            <span style={{ width: `${course.percent}%` }} />
          </span>
          <span>{course.percent}%</span>
          <Button
            size="sm"
            variant="secondary"
            type="button"
            onClick={() => navigate({ view: "elearning", query: course.courseId })}
          >
            Vào học
          </Button>
        </div>
      ))}
    </div>
  );
}

const PERIODS = [
  { key: "today", label: "Hôm nay", days: 1 },
  { key: "7d", label: "7 ngày", days: 7 },
  { key: "30d", label: "30 ngày", days: 30 },
  { key: "all", label: "Tất cả", days: 0 },
] as const;
const OUTCOME_FILTERS = ["answered", "abandoned", "missed", "voicemail", "open"] as const;
const DAY = 86_400_000;
const dayLabel = (iso: string) => {
  const date = new Date(iso);
  const start = new Date(iso).setHours(0, 0, 0, 0);
  const today = new Date().setHours(0, 0, 0, 0);
  const short = date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  if (start === today) return `Hôm nay · ${short}`;
  if (start === today - DAY) return `Hôm qua · ${short}`;
  return date.toLocaleDateString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

function CallHistory({
  me,
  api,
  fail,
  token,
}: {
  me: CcAgentProfile;
  api: Api;
  fail: (error: unknown) => void;
  token: string;
}) {
  const phone = useGlobalSoftphone();
  const [calls, setCalls] = useState<CcCallRecord[] | null>(null);
  const [dispositions, setDispositions] = useState<CcDisposition[]>([]);
  const [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  const [reviews, setReviews] = useState<Map<string, CcQaReview>>(new Map());
  const [scoring, setScoring] = useState<CcCallRecord | null>(null);
  const [teaching, setTeaching] = useState<CcCallRecord | null>(null);
  const [reading, setReading] = useState<CcCallRecord | null>(null);
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState("");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("all");
  const [departmentId, setDepartmentId] = useState("");
  const [recorded, setRecorded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    api<CcCallRecord[]>("calls?limit=200").then(setCalls, fail);
    api<CcDisposition[]>("dispositions").then(setDispositions, fail);
    api<CcQaReview[]>("qa-reviews").then(
      (list) => setReviews(new Map(list.map((review) => [review.callId, review]))),
      fail,
    );
  }, [api, fail]);
  // V7: supervisors of the department score answered, finished calls of other people.
  const canScore = (call: CcCallRecord) =>
    Boolean(
      call.answeredAt &&
      call.endedAt &&
      call.departmentId &&
      call.agentUserId &&
      call.agentUserId !== me.userId,
    ) && supervises(call);
  const supervises = (call: CcCallRecord) =>
    me.isAdmin ||
    me.departments.some(
      (department) => department.id === call.departmentId && department.role === "supervisor",
    );
  useEffect(() => () => void (playing && URL.revokeObjectURL(playing.url)), [playing]);

  const play = (call: CcCallRecord) => {
    setSelectedId(call.id);
    if (playing?.id !== call.id)
      recordingUrl(token, call.id).then((url) => setPlaying({ id: call.id, url }), fail);
  };
  const labelOf = (id: string | null) => dispositions.find((item) => item.id === id)?.label ?? "";
  const days = PERIODS.find((item) => item.key === period)!.days;
  const since = days ? new Date().setHours(0, 0, 0, 0) - (days - 1) * DAY : 0;
  // Counts follow the period and department; the outcome, recording and text filters only narrow the list.
  const scoped =
    calls?.filter(
      (call) =>
        Date.parse(call.startedAt) >= since &&
        (!departmentId || call.departmentId === departmentId),
    ) ?? [];
  const countOf = (key: string) =>
    scoped.filter((call) => (key === "open" ? !call.outcome : call.outcome === key)).length;
  const needle = query.trim().toLowerCase();
  const shown = scoped.filter(
    (call) =>
      (!outcome || (outcome === "open" ? !call.outcome : call.outcome === outcome)) &&
      (!recorded || call.hasRecording) &&
      (!needle ||
        [call.callerName, call.callerNumber, call.agentName, call.departmentName, call.notes].some(
          (value) => value?.toLowerCase().includes(needle),
        )),
  );
  const departments = [
    ...new Map(
      (calls ?? [])
        .filter((call) => call.departmentId)
        .map((call) => [call.departmentId!, call.departmentName ?? "—"]),
    ).entries(),
  ];
  const groups: { label: string; calls: CcCallRecord[] }[] = [];
  for (const call of shown) {
    const label = dayLabel(call.startedAt);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.calls.push(call);
    else groups.push({ label, calls: [call] });
  }
  const selected = calls?.find((call) => call.id === selectedId) ?? null;
  const review = selected ? reviews.get(selected.id) : undefined;
  const canCall = phone.status === "registered" && phone.phase === "none";

  return (
    <div className="cc-history">
      <div className="cc-pagehead">
        <div>
          <h1 className="cc-pagehead__title">Lịch sử cuộc gọi</h1>
          <p className="cc-summary">
            {calls === null ? (
              "Đang tải…"
            ) : (
              <>
                {scoped.length} cuộc · <b className="tone-green">{countOf("answered")} đã nghe</b> ·{" "}
                <b className="tone-amber">{countOf("abandoned")} bỏ máy</b> ·{" "}
                <b className="tone-red">{countOf("missed")} nhỡ</b> ·{" "}
                <b className="tone-blue">{countOf("voicemail")} thư thoại</b>
              </>
            )}
          </p>
        </div>
        <label className="cc-search cc-search--wide">
          <Icon name="search" size={15} />
          <input
            type="search"
            aria-label="Tìm cuộc gọi"
            placeholder="Tìm người gọi, số, tổng đài viên, ghi chú…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      <div className="cc-chips" role="toolbar" aria-label="Bộ lọc cuộc gọi">
        {PERIODS.map((item) => (
          <button
            key={item.key}
            type="button"
            className="cc-chip-btn"
            aria-pressed={period === item.key}
            onClick={() => setPeriod(item.key)}
          >
            {item.label}
          </button>
        ))}
        <span className="cc-chips__sep" aria-hidden="true" />
        {OUTCOME_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className="cc-chip-btn"
            aria-pressed={outcome === key}
            onClick={() => setOutcome(outcome === key ? "" : key)}
          >
            <span
              className={`cc-led tone-${key === "open" ? "red" : OUTCOME_TONE[key]}`}
              aria-hidden="true"
            />
            {key === "open" ? "Đang diễn ra" : OUTCOME_LABEL[key]}
            <small>{countOf(key)}</small>
          </button>
        ))}
        <span className="cc-chips__sep" aria-hidden="true" />
        <button
          type="button"
          className="cc-chip-btn"
          aria-pressed={recorded}
          onClick={() => setRecorded(!recorded)}
        >
          <Icon name="play" size={12} />
          Có ghi âm
        </button>
        {departments.length > 1 && (
          <select
            className="cc-select"
            aria-label="Lọc theo phòng ban"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">Mọi phòng ban</option>
            {departments.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className={`cc-history__grid ${selected ? "has-drawer" : ""}`}>
        <section className="cc-calls" aria-label="Danh sách cuộc gọi">
          {calls === null ? (
            <p className="desk-muted cc-calls__empty">Đang tải cuộc gọi…</p>
          ) : !shown.length ? (
            <p className="desk-muted cc-calls__empty">
              {calls.length ? "Không có cuộc gọi khớp bộ lọc." : "Chưa có cuộc gọi nào."}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="cc-day">
                <h3 className="cc-day__head">
                  <span>{group.label}</span>
                  <span>{group.calls.length} cuộc</span>
                </h3>
                <ul>
                  {group.calls.map((call) => {
                    const [arrow, way] = DIRECTION[call.direction];
                    const result = call.outcome ? OUTCOME_LABEL[call.outcome] : "Đang diễn ra";
                    return (
                      <li
                        key={call.id}
                        className={`cc-row ${call.id === selectedId ? "is-selected" : ""}`}
                      >
                        <button
                          type="button"
                          className="cc-row__main"
                          aria-pressed={call.id === selectedId}
                          onClick={() => setSelectedId(call.id === selectedId ? null : call.id)}
                        >
                          <span
                            className={`cc-led tone-${call.outcome ? OUTCOME_TONE[call.outcome] : "red"}`}
                            role="img"
                            aria-label={result}
                            title={result}
                          />
                          <time className="cc-row__time">
                            {new Date(call.startedAt).toLocaleTimeString("vi-VN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                          <span className="cc-row__dir" role="img" aria-label={way} title={way}>
                            {arrow}
                          </span>
                          <span className={`cc-row__caller ${call.callerName ? "" : "is-number"}`}>
                            {call.callerName ?? numberLabel(call.callerNumber)}
                          </span>
                          <span className="cc-row__agent">
                            {call.agentName ?? "—"}
                            {call.departmentName && <small> · {call.departmentName}</small>}
                          </span>
                          <span className="cc-row__cat">
                            {labelOf(call.dispositionId) || call.notes || result}
                          </span>
                          <span className="cc-row__dur">
                            {call.answeredAt ? clock(seconds(call.answeredAt, call.endedAt)) : "—"}
                          </span>
                        </button>
                        {call.hasRecording ? (
                          <button
                            type="button"
                            className={`cc-round ${playing?.id === call.id ? "is-on" : ""}`}
                            aria-label={`Nghe ghi âm cuộc gọi lúc ${new Date(call.startedAt).toLocaleString("vi-VN")}`}
                            onClick={() => play(call)}
                          >
                            <Icon name="play" size={12} />
                          </button>
                        ) : (
                          <span />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </section>

        {selected && (
          <aside className="cc-drawer" aria-label="Chi tiết cuộc gọi">
            <div className="cc-drawer__head">
              <div className="cc-drawer__id">
                <span
                  className={`cc-chip tone-${selected.outcome ? OUTCOME_TONE[selected.outcome] : "red"}`}
                >
                  <span className="cc-led" aria-hidden="true" />
                  {selected.outcome ? OUTCOME_LABEL[selected.outcome] : "Đang diễn ra"} ·{" "}
                  {DIRECTION[selected.direction][1]}
                </span>
                <h2>{selected.callerName ?? numberLabel(selected.callerNumber)}</h2>
                <p>
                  {[
                    selected.callerName && numberLabel(selected.callerNumber),
                    selected.agentName,
                    selected.departmentName,
                    new Date(selected.startedAt).toLocaleString("vi-VN"),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <button
                type="button"
                className="cc-icon-btn"
                aria-label="Đóng chi tiết cuộc gọi"
                onClick={() => setSelectedId(null)}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            <div className="cc-drawer__audio">
              {playing?.id === selected.id ? (
                <audio src={playing.url} controls autoPlay />
              ) : selected.hasRecording ? (
                <Button size="sm" variant="secondary" icon="play" onClick={() => play(selected)}>
                  Nghe ghi âm
                </Button>
              ) : (
                <span>Không có ghi âm</span>
              )}
              <strong>
                {selected.answeredAt ? clock(seconds(selected.answeredAt, selected.endedAt)) : "—"}
              </strong>
            </div>
            <dl className="cc-drawer__facts">
              <div>
                <dt>Kết quả ghi nhận</dt>
                <dd>{labelOf(selected.dispositionId) || "Chưa ghi nhận"}</dd>
              </div>
              <div>
                <dt>Ghi chú</dt>
                <dd className="cc-drawer__notes">{selected.notes || "Không có ghi chú."}</dd>
              </div>
              {selected.queuedAt && (
                <div>
                  <dt>Chờ trong hàng đợi</dt>
                  <dd>
                    {clock(seconds(selected.queuedAt, selected.answeredAt ?? selected.endedAt))}
                  </dd>
                </div>
              )}
              {review && (
                <div>
                  <dt>Chất lượng</dt>
                  <dd>
                    <Badge tone={qaTone(review.percent)}>{review.percent}%</Badge>
                    {review.reviewerName && ` · ${review.reviewerName}`}
                  </dd>
                </div>
              )}
              {selected.transcriptStatus === "processing" && (
                <div>
                  <dt>Lời thoại</dt>
                  <dd>Đang chép lời…</dd>
                </div>
              )}
            </dl>
            <div className="cc-drawer__actions">
              {dialable(selected.callerNumber) && (
                <Button
                  icon="phone"
                  disabled={!canCall}
                  title={
                    canCall ? `Gọi lại ${selected.callerNumber}` : "Máy lẻ chưa sẵn sàng để gọi"
                  }
                  onClick={() => phone.call(selected.callerNumber)}
                >
                  Gọi lại
                </Button>
              )}
              {selected.transcriptStatus === "ready" && (
                <Button variant="secondary" icon="file" onClick={() => setReading(selected)}>
                  Lời thoại
                </Button>
              )}
              {canScore(selected) && (
                <Button variant="secondary" icon="star" onClick={() => setScoring(selected)}>
                  {reviews.has(selected.id) ? "Chấm lại" : "Chấm điểm"}
                </Button>
              )}
              {selected.hasRecording && selected.endedAt && supervises(selected) && (
                <Button
                  variant="secondary"
                  icon="book"
                  className="cc-drawer__lesson"
                  onClick={() => setTeaching(selected)}
                >
                  Làm bài học từ cuộc gọi này
                </Button>
              )}
            </div>
          </aside>
        )}
      </div>
      {reading && (
        <CallTranscriptDialog
          call={{
            id: reading.id,
            title: `${reading.agentName ?? ""} · ${reading.callerName ?? reading.callerNumber}`,
          }}
          api={api}
          onClose={() => setReading(null)}
          labelOf={labelOf}
          onApply={async (summary, dispositionId) => {
            // Notes someone already wrote are kept; the summary only fills an empty field.
            const change = {
              dispositionId: dispositionId ?? reading.dispositionId,
              notes: reading.notes || summary,
            };
            await api(`calls/${reading.id}`, "PATCH", change);
            setCalls(
              (list) =>
                list?.map((item) => (item.id === reading.id ? { ...item, ...change } : item)) ??
                null,
            );
          }}
        />
      )}
      {teaching && (
        <CallLessonDialog
          call={{
            id: teaching.id,
            title: `${teaching.agentName ?? teaching.callerNumber} · ${new Date(teaching.startedAt).toLocaleDateString("vi-VN")}`,
          }}
          onClose={() => setTeaching(null)}
        />
      )}
      {scoring && (
        <QaReviewDialog
          call={{
            id: scoring.id,
            departmentId: scoring.departmentId!,
            title: `${scoring.agentName ?? ""} · ${scoring.callerName ?? scoring.callerNumber}`,
          }}
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
