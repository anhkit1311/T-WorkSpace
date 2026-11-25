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
import { Button, PageFallback, PageHeader } from "../../shared/ui/Primitives";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { ApiError } from "../auth/api";
import { callCenterApi, recordingUrl } from "./api";
import { KpiPanel } from "./KpiPanel";
import { CallLessonDialog, CallTranscriptDialog, QaPanel, QaReviewDialog, qaTone } from "./QaPanel";
import { TicketsPanel } from "./TicketsPanel";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  CARD,
  CHIP,
  CTL,
  CTL_ON,
  DOT,
  H2,
  ICON_BTN,
  LED,
  MUTED,
  PILL,
  PILL_ON,
  STAT,
  TEXT,
  TINT,
} from "./ui";
import { TransferPanel } from "./TransferPanel";
import { VoicemailInbox } from "./VoicemailInbox";
import { ContactCenter } from "./ContactCenter";
import { CallerProfile } from "./CallerProfile";
import { DeskDialer } from "./DeskDialer";
import { type PhoneStatus } from "./useSoftphone";
import { useGlobalSoftphone } from "../../app/providers/SoftphoneContext";
import { STATE_LABEL, STATE_TONE } from "./agent-state";
import { cn } from "../../shared/lib/utils";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";

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
    subnav.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    const view = TAB_VIEW[key];
    if (view && view !== route.view) navigate({ view });
  };
  const ringing = useGlobalSoftphone().phase === "incoming";
  useEffect(() => {
    // "Trả lời" lives on the desk and the global call strip hides on this page: bring the desk up,
    // except for a monitor leg the supervisor just asked for (answered on its own, board stays).
    if (ringing && hasDesk && activeTab !== "desk" && Date.now() >= autoAnswerUntil)
      openTab("desk");
    // Only on a new incoming call: openTab and the tab are read as they are at that moment.
  }, [ringing]);
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
      <div className="tw grid min-w-0 gap-4 px-[var(--shell-gutter)] pt-3.5 pb-8 text-sm text-foreground max-md:px-3">
        <div
          className={cn(CARD, "justify-items-center px-5 py-10 text-center text-muted-foreground")}
          role="alert"
        >
          <Icon name="warning" size={28} />
          <p className="text-muted-foreground!">{loadError}</p>
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
  if (!me) return <PageFallback label="Đang tải tổng đài…" />;

  // Everyone else (students, lecturers without a desk): contact a department and follow their requests.
  if (!member && !me.isAdmin && !me.extension)
    return (
      <div className="tw grid min-w-0 gap-4 px-[var(--shell-gutter)] pt-3.5 pb-8 text-sm text-foreground max-md:px-3">
        <PageHeader
          title="Tổng đài"
          meta="Liên hệ và hỗ trợ: gọi từ trình duyệt, không cần máy lẻ"
        />
        <ContactCenter />
      </div>
    );

  // A personal extension without a department: one phone page, no agent tabs.
  if (!member && !me.isAdmin)
    return (
      <div className="tw grid min-w-0 gap-4 px-[var(--shell-gutter)] pt-3.5 pb-8 text-sm text-foreground max-md:px-3">
        <PageHeader title="Tổng đài" meta="Máy lẻ cá nhân: gọi nội bộ và liên hệ phòng ban" />
        <AgentDesk
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
      <nav
        ref={subnav}
        className="tw flex shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b bg-background px-6 text-sm max-md:px-3"
        aria-label="Tổng đài"
      >
        {tabs.map((item) => {
          const active = item.key === activeTab;
          return (
            <button
              key={item.key}
              type="button"
              className={cn(
                "-mb-px flex cursor-pointer items-center gap-[7px] border-b-2 border-transparent px-3 py-[11px] font-medium whitespace-nowrap text-muted-foreground hover:text-foreground",
                active && "border-foreground font-semibold text-foreground",
              )}
              aria-current={active ? "page" : undefined}
              onClick={() => openTab(item.key)}
            >
              <Icon name={item.icon} size={15} strokeWidth={active ? 2.1 : 1.8} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="tw grid min-w-0 gap-4 px-[var(--shell-gutter)] pt-3.5 pb-8 text-sm text-foreground max-md:px-3">
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
          <Suspense fallback={<div className={cn(CARD, MUTED)}>Đang tải…</div>}>
            <CallCenterAdmin api={api} fail={fail} notify={notify} onChanged={loadMe} />
          </Suspense>
        )}
      </div>
    </>
  );
}

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

function AgentDesk({
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
    <div className="grid min-w-0 gap-4">
      <section
        className="tw flex flex-wrap items-center gap-x-3.5 gap-y-2.5 text-sm text-foreground"
        aria-label="Trạng thái nhận cuộc gọi"
      >
        {isAgent && (
          <div
            className="flex rounded-[9px] bg-secondary p-[3px]"
            role="group"
            aria-label="Trạng thái trực"
          >
            {(["ready", "not_ready", "offline"] as const).map((state) => (
              <button
                key={state}
                type="button"
                className={cn(
                  "flex cursor-pointer items-center gap-[7px] rounded-[7px] px-3 py-1.5 text-[13px] font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60",
                  me.state === state && "bg-card font-semibold text-foreground shadow-sm",
                )}
                aria-pressed={me.state === state}
                disabled={
                  busy || inCall || !me.extension || (state === "ready" && me.training.length > 0)
                }
                aria-expanded={state === "not_ready" ? pausing : undefined}
                onClick={() =>
                  state === "not_ready" ? setPausing((open) => !open) : choose(state)
                }
              >
                <span className={cn(LED, DOT[STATE_TONE[state]])} aria-hidden="true" />
                {STATE_LABEL[state]}
              </button>
            ))}
          </div>
        )}
        <span className={cn(CHIP, TINT[phoneTone])}>
          <span className={cn(LED, DOT[phoneTone])} aria-hidden="true" />
          Máy lẻ {me.extension?.number ?? "—"} · {phoneLabel}
        </span>
        {departments && <span className={MUTED}>{departments}</span>}
        {isAgent && (
          <dl className="ml-auto flex gap-[22px] max-md:ml-0">
            <div>
              <dd className={STAT}>{mine === null ? "—" : talked.length}</dd>
              <dt className="text-xs text-muted-foreground">Đã nghe hôm nay</dt>
            </div>
            <div>
              <dd className={STAT}>
                {talked.length ? clock(Math.round(talkSeconds / talked.length)) : "—"}
              </dd>
              <dt className="text-xs text-muted-foreground">Đàm thoại TB</dt>
            </div>
            <div>
              <dd className={STAT}>{me.stateSince ? clock(seconds(me.stateSince, null)) : "—"}</dd>
              <dt className="text-xs text-muted-foreground">{STATE_LABEL[me.state]}</dt>
            </div>
          </dl>
        )}
      </section>
      {pausing && (
        <div
          className="tw flex flex-wrap items-center gap-1.5 text-sm"
          role="group"
          aria-label="Lý do tạm nghỉ"
        >
          <span className={MUTED}>Lý do tạm nghỉ:</span>
          {PAUSE_REASONS.map((reason) => (
            <button
              key={reason}
              type="button"
              className={PILL}
              disabled={busy}
              onClick={() => choose("not_ready", reason)}
            >
              {reason}
            </button>
          ))}
        </div>
      )}
      {!me.extension && (
        <p className={cn("tw rounded-lg px-3 py-2 text-[13px]", TINT.amber)}>
          Bạn chưa được cấp máy lẻ, chưa thể nhận cuộc gọi.
        </p>
      )}
      {isAgent && me.training.length > 0 && <TrainingRequired training={me.training} />}

      <div
        className={cn(
          "grid min-w-0 items-start gap-4 min-[900px]:grid-cols-[320px_minmax(0,1fr)]",
          offer && "min-[1250px]:grid-cols-[320px_minmax(0,1fr)_320px]",
        )}
      >
        {/* Left: dial pad and directory, the agent's own recent calls, voicemail. */}
        <div className="grid min-w-0 gap-4">
          <DeskDialer hotlineCall={hotlineCall} />
          {isAgent && (
            <section className={CARD}>
              <div className="flex items-center gap-2">
                <h2 className={H2}>Cuộc gọi gần đây</h2>
                {talked.length > 0 && (
                  <span className={cn(MUTED, "ml-auto tabular-nums")}>
                    Hôm nay {clock(talkSeconds)}
                  </span>
                )}
              </div>
              {mine === null ? (
                <p className={MUTED}>Đang tải cuộc gọi gần đây…</p>
              ) : !mine.length ? (
                <p className={MUTED}>Bạn chưa nhận cuộc gọi nào.</p>
              ) : (
                <ul className="list-none" aria-label="Cuộc gọi gần đây của tôi">
                  {mine.slice(0, 6).map((call) => (
                    <li
                      key={call.id}
                      className="flex items-center gap-2.5 rounded-[7px] px-1 py-[7px] hover:bg-secondary"
                    >
                      <span
                        className={cn(
                          LED,
                          DOT[call.outcome ? (OUTCOME_TONE[call.outcome] ?? "neutral") : "red"],
                        )}
                        role="img"
                        aria-label={call.outcome ? OUTCOME_LABEL[call.outcome] : "Đang diễn ra"}
                        title={call.outcome ? OUTCOME_LABEL[call.outcome] : "Đang diễn ra"}
                      />
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-[13.5px] font-medium">
                          {call.callerName ?? call.callerNumber}
                        </strong>
                        <span className="block truncate text-xs text-muted-foreground">
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
                      <button
                        type="button"
                        className={ICON_BTN}
                        disabled={!canDial || !dialable(call.callerNumber)}
                        aria-label="Gọi lại"
                        title={
                          !dialable(call.callerNumber)
                            ? "Người gọi từ trình duyệt, không có số để gọi lại"
                            : canDial
                              ? `Gọi lại ${call.callerNumber}`
                              : "Máy lẻ chưa sẵn sàng để gọi"
                        }
                        onClick={() => phone.call(call.callerNumber)}
                      >
                        <Icon name="phone" size={15} />
                      </button>
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

        {/* Centre: the call itself, then transferring and filing it. */}
        <div className="grid min-w-0 gap-4">
          <section
            className={cn(
              CARD,
              "justify-items-center gap-4 p-[22px] text-center",
              phone.phase !== "none" && "border-emerald-500/50",
            )}
            aria-label="Cuộc gọi hiện tại"
          >
            {phone.phase !== "none" ? (
              <>
                <div className="flex flex-wrap justify-center gap-1.5">
                  <span className={cn(CHIP, TINT[phone.phase === "active" ? "green" : "red"])}>
                    <span
                      className={cn(LED, DOT[phone.phase === "active" ? "green" : "red"])}
                      aria-hidden="true"
                    />
                    {phone.phase === "incoming"
                      ? "Cuộc gọi đến"
                      : phone.phase === "outgoing"
                        ? "Đang gọi"
                        : "Đang đàm thoại"}
                  </span>
                  {offer && (
                    <span className={cn(CHIP, "bg-secondary text-muted-foreground")}>
                      {offer.departmentName} · đã chờ {offer.waitedSeconds}s
                    </span>
                  )}
                  {held && (
                    <span className={cn(CHIP, TINT.amber)}>
                      Đang giữ máy · người gọi nghe nhạc chờ
                    </span>
                  )}
                </div>
                <UserAvatar name={callerName} className="size-[72px] text-2xl" />
                <div>
                  <h2 className="text-xl font-bold">{callerName}</h2>
                  {callerNumber && callerNumber !== callerName && (
                    <p className={MUTED}>{callerNumber}</p>
                  )}
                </div>
                {callSince !== null && (
                  <strong
                    className="text-[28px] leading-none font-bold tracking-wide tabular-nums"
                    aria-label="Thời lượng"
                  >
                    {clock(Math.floor((Date.now() - callSince) / 1000))}
                  </strong>
                )}
                {phone.phase === "incoming" ? (
                  <div className="flex flex-wrap justify-center gap-2.5">
                    <button
                      type="button"
                      className={cn(CTL, "bg-emerald-600 text-white hover:text-white")}
                      onClick={phone.answer}
                      title="Alt+A"
                    >
                      <Icon name="phone" size={20} />
                      Trả lời
                    </button>
                    <button
                      type="button"
                      className={cn(CTL, "bg-red-500 text-white hover:text-white")}
                      onClick={phone.hangup}
                    >
                      <Icon name="phone-off" size={20} />
                      Từ chối
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap justify-center gap-2.5">
                    <button
                      type="button"
                      className={cn(CTL, phone.muted && CTL_ON)}
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
                        className={cn(CTL, held && CTL_ON)}
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
                      className={cn(CTL, "bg-red-500 text-white hover:text-white")}
                      onClick={phone.hangup}
                      title="Alt+H"
                    >
                      <Icon name="phone-off" size={20} />
                      Kết thúc
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <span
                  className={cn(
                    "grid size-14 place-items-center rounded-full",
                    TINT[wrapUp && !inCall ? "blue" : isAgent ? STATE_TONE[me.state] : "blue"],
                  )}
                  aria-hidden="true"
                >
                  <Icon
                    name={
                      wrapUp && !inCall
                        ? "clipboard"
                        : isAgent && me.state === "not_ready"
                          ? "pause"
                          : "headset"
                    }
                    size={24}
                  />
                </span>
                {wrapUp && !inCall ? (
                  <div className="grid gap-1">
                    <h2 className="text-base font-semibold">
                      Lưu kết quả trước khi nhận cuộc gọi mới
                    </h2>
                    <p className={MUTED}>
                      Cuộc gọi với {wrapUp.caller.displayName ?? wrapUp.caller.number} đã kết thúc.
                      Chọn kết quả và ghi chú ở bên dưới.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-1">
                    <h2 className="text-base font-semibold">{idleTitle}</h2>
                    <p className={cn(MUTED, "max-w-[520px]")}>{idleText}</p>
                    {me.stateReason && <p className={MUTED}>{me.stateReason}</p>}
                  </div>
                )}
              </>
            )}
          </section>

          {offer && me.state === "on_call" && (
            <TransferPanel offer={offer} api={api} fail={fail} onChange={onChange} />
          )}

          {wrapUp && !inCall && (
            <section className={cn(CARD, "tw-form")} aria-label="Ghi chú sau cuộc gọi">
              <div className="flex items-center gap-2">
                <h2 className={H2}>Ghi chú sau cuộc gọi</h2>
                <span className={cn(CHIP, TINT.blue, "ml-auto")}>
                  {wrapUp.caller.displayName ?? wrapUp.caller.number}
                </span>
              </div>
              {/* BR-07: a hotline call is always filed with a result code. */}
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kết quả cuộc gọi">
                {dispositions
                  .filter((item) => !item.departmentId || item.departmentId === wrapUp.departmentId)
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={cn(PILL, dispositionId === item.id && PILL_ON)}
                      aria-pressed={dispositionId === item.id}
                      onClick={() => setDispositionId(dispositionId === item.id ? "" : item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
              </div>
              <textarea
                aria-label="Ghi chú"
                rows={3}
                maxLength={4000}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Nội dung người gọi trình bày, việc cần làm tiếp…"
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                {wrapUp.caller.userId && (
                  <VideoInviteButton callId={wrapUp.callId} api={api} fail={fail} />
                )}
                {!dispositionId && (
                  <span className={cn(MUTED, "mr-auto")}>Chọn kết quả cuộc gọi để lưu.</span>
                )}
                <button
                  type="button"
                  className={BTN_GHOST}
                  disabled={!dispositionId}
                  onClick={() => void saveWrapUp(true)}
                >
                  <Icon name="clipboard" size={15} />
                  Lưu và tạo phiếu
                </button>
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={!dispositionId}
                  onClick={() => void saveWrapUp(false)}
                >
                  <Icon name="check" size={15} />
                  Lưu ghi nhận
                </button>
              </div>
            </section>
          )}

          <p className="tw text-xs text-muted-foreground [&_kbd]:rounded [&_kbd]:border [&_kbd]:bg-secondary [&_kbd]:px-1 [&_kbd]:font-[inherit]">
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

        {/* Right: who is calling, only while a hotline call is on the desk. */}
        {offer && (
          <section
            className="grid min-w-0 gap-2.5 rounded-[10px] border border-solid border-border bg-card p-3.5 text-sm text-foreground max-[1249px]:col-span-full"
            aria-label="Người gọi"
          >
            <div className="tw flex items-center gap-2">
              <h2 className={H2}>Người gọi</h2>
              <span className={cn(CHIP, TINT.blue, "ml-auto")}>{offer.departmentName}</span>
            </div>
            <div className="tw flex items-center gap-2.5">
              <UserAvatar name={offer.caller.displayName ?? "?"} className="size-10" />
              <div className="min-w-0">
                <b className="block truncate font-semibold">
                  {offer.caller.displayName ?? "Số chưa xác định"}
                </b>
                <span className="block truncate text-xs text-muted-foreground">
                  {numberLabel(offer.caller.number)}
                  {offer.caller.email ? ` · ${offer.caller.email}` : ""}
                </span>
              </div>
            </div>
            <p className={cn("tw", MUTED)}>
              {offer.caller.recentCalls} cuộc gọi trong 30 ngày
              {!offer.caller.userId && " · Chưa liên kết tài khoản"}
            </p>
            {offer.context && (
              <p className="tw flex items-start gap-1.5 rounded-lg bg-secondary px-2.5 py-2 text-[13px]">
                <Icon name="book" size={14} className="mt-0.5 shrink-0" /> {offer.context}
              </p>
            )}
            <CallerProfile api={api} callId={offer.callId} outcomeLabel={OUTCOME_LABEL} />
            {me.state === "on_call" && offer.caller.userId && (
              <VideoInviteButton callId={offer.callId} api={api} fail={fail} />
            )}
          </section>
        )}
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
    <div
      ref={board}
      className="grid min-w-0 gap-4 bg-background [&:fullscreen]:overflow-y-auto [&:fullscreen]:p-6"
    >
      <div className="tw flex flex-wrap items-center gap-2.5 text-sm text-foreground">
        <h1 className="text-xl font-bold">Giám sát tổng đài</h1>
        <span className={cn(CHIP, TINT.red)}>
          <span className={cn(LED, DOT.red, "motion-safe:animate-pulse")} aria-hidden="true" />
          Trực tiếp ·{" "}
          {new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <div className="tw-form ml-auto flex flex-wrap items-center gap-2">
          {options.length > 1 && (
            <select
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
          <button
            type="button"
            className={BTN_GHOST}
            onClick={() =>
              (document.fullscreenElement
                ? document.exitFullscreen()
                : board.current?.requestFullscreen()
              )?.catch(() => undefined)
            }
          >
            <Icon name="maximize" size={15} />
            Wallboard toàn màn hình
          </button>
        </div>
      </div>
      {!departmentId ? (
        <p className={cn(CARD, MUTED)}>Chưa có phòng ban nào để giám sát.</p>
      ) : (
        <>
          <section
            className="tw grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3 text-foreground"
            aria-label="Chỉ số trực tiếp"
          >
            {kpis.map((item) => (
              <div key={item.label} className="grid gap-0.5 rounded-[10px] border bg-card p-3.5">
                <small className="text-[12.5px] text-muted-foreground">{item.label}</small>
                <strong
                  className={cn(
                    "text-[26px] leading-tight font-bold tabular-nums",
                    item.tone && TEXT[item.tone],
                  )}
                >
                  {item.value}
                </strong>
                {item.note && <span className="text-xs text-muted-foreground">{item.note}</span>}
              </div>
            ))}
          </section>
          <div className="grid min-w-0 items-start gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
            <section
              className="tw grid min-w-0 gap-2.5 text-sm text-foreground"
              aria-label="Tổng đài viên"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <h2 className={H2}>Tổng đài viên</h2>
                <span className={MUTED}>
                  {department} · {agents.length} người · {waiting.length} đang chờ
                </span>
                <ul
                  className="ml-auto flex list-none flex-wrap gap-3 text-xs text-muted-foreground"
                  aria-label="Chú thích trạng thái"
                >
                  {LEGEND.map(([tone, label]) => (
                    <li key={tone} className="flex items-center gap-1.5">
                      <span className={cn(LED, DOT[tone])} aria-hidden="true" />
                      {label}
                    </li>
                  ))}
                </ul>
              </div>
              {!snapshot ? (
                <p className={cn(CARD, MUTED)}>Đang tải…</p>
              ) : !agents.length ? (
                <p className={cn(CARD, MUTED)}>Phòng ban chưa có tổng đài viên.</p>
              ) : (
                <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5">
                  {agents.map((agent) => (
                    <li
                      key={agent.userId}
                      className={cn(
                        "grid grid-cols-[minmax(0,1fr)] gap-2 rounded-[10px] border bg-card p-3",
                        agent.state === "on_call" && "border-red-500/40",
                        agent.state === "offline" && "opacity-70",
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <UserAvatar name={agent.displayName} className="size-9" />
                        <div className="min-w-0 flex-1">
                          <strong className="block truncate font-semibold">
                            {agent.displayName}
                          </strong>
                          <span className="block truncate text-xs text-muted-foreground">
                            Máy lẻ {agent.extension ?? "—"}
                          </span>
                        </div>
                        <span
                          className={cn(LED, DOT[STATE_TONE[agent.state]])}
                          aria-hidden="true"
                        />
                      </div>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="min-w-0 truncate">
                          {STATE_LABEL[agent.state]}
                          {agent.reason ? ` · ${agent.reason}` : ""}
                        </span>
                        {agent.since && (
                          <time className="ml-auto font-semibold text-foreground tabular-nums">
                            {clock(seconds(agent.since, null))}
                          </time>
                        )}
                      </p>
                      {agent.state === "on_call" && agent.callId && onMonitor && (
                        <div
                          className="flex gap-[5px]"
                          role="group"
                          aria-label={`Giám sát cuộc gọi của ${agent.displayName}`}
                        >
                          {MONITOR.map((item) => (
                            <button
                              key={item.mode}
                              type="button"
                              className="h-7 flex-1 cursor-pointer rounded-md border text-xs font-medium hover:bg-secondary"
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
            <section className={CARD} aria-label="Hàng đợi">
              <div className="flex items-center gap-2">
                <h2 className={H2}>Hàng đợi</h2>
                <span className={cn(CHIP, TINT[queueTone || "neutral"], "ml-auto")}>
                  {waiting.length} đang chờ
                </span>
              </div>
              {!waiting.length ? (
                <p className={MUTED}>Không có cuộc gọi nào đang chờ.</p>
              ) : (
                <ul className="list-none">
                  {waiting.map((call) => {
                    const waited = seconds(call.waitingSince, null);
                    return (
                      <li
                        key={call.callId}
                        className="flex items-center gap-2.5 border-t py-[9px] first:border-t-0"
                      >
                        <span className={cn(LED, DOT[waitTone(waited)])} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <strong className="block truncate font-medium">
                            {call.callerName ?? numberLabel(call.callerNumber)}
                          </strong>
                          {call.callerName && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {numberLabel(call.callerNumber)}
                            </span>
                          )}
                        </div>
                        <time className={cn("font-semibold tabular-nums", TEXT[waitTone(waited)])}>
                          {clock(waited)}
                        </time>
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
    <button
      type="button"
      className={BTN_GHOST}
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
      <Icon name="video" size={15} />
      Mời họp video
    </button>
  );
}

/** LT-4: the required course comes before taking calls; the button opens it in Khóa học. */
function TrainingRequired({ training }: { training: CcAgentProfile["training"] }) {
  const { navigate } = useApp();
  return (
    <div className={cn(CARD, TINT.amber, "border-amber-500/30")} role="status">
      <strong className="flex items-center gap-2 font-semibold">
        <Icon name="book" size={16} /> Hoàn thành khóa đào tạo bắt buộc để bật “Sẵn sàng”
      </strong>
      {training.map((course) => (
        <div key={course.courseId} className="flex flex-wrap items-center gap-3 text-foreground">
          <span className="min-w-0 flex-1 truncate">
            {course.code} — {course.title}
          </span>
          <span className="h-1.5 w-32 overflow-hidden rounded-full bg-card" aria-hidden="true">
            <span className="block h-full bg-primary" style={{ width: `${course.percent}%` }} />
          </span>
          <span className="w-10 text-right tabular-nums">{course.percent}%</span>
          <button
            type="button"
            className={BTN_GHOST}
            onClick={() => navigate({ view: "elearning", query: course.courseId })}
          >
            Vào học
          </button>
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
    <div className="grid min-w-0 gap-4">
      <div className="tw flex flex-wrap items-end gap-x-4 gap-y-2.5 text-sm text-foreground">
        <div className="grid gap-0.5">
          <h1 className="text-xl font-bold">Lịch sử cuộc gọi</h1>
          <p className={MUTED}>
            {calls === null ? (
              "Đang tải…"
            ) : (
              <>
                {scoped.length} cuộc ·{" "}
                <b className={cn("font-semibold", TEXT.green)}>{countOf("answered")} đã nghe</b> ·{" "}
                <b className={cn("font-semibold", TEXT.amber)}>{countOf("abandoned")} bỏ máy</b> ·{" "}
                <b className={cn("font-semibold", TEXT.red)}>{countOf("missed")} nhỡ</b> ·{" "}
                <b className={cn("font-semibold", TEXT.blue)}>{countOf("voicemail")} thư thoại</b>
              </>
            )}
          </p>
        </div>
        <label className="ml-auto flex h-[34px] w-[320px] items-center gap-2 rounded-full bg-secondary px-3 text-muted-foreground max-md:ml-0 max-md:w-full">
          <Icon name="search" size={15} />
          <input
            type="search"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none"
            aria-label="Tìm cuộc gọi"
            placeholder="Tìm người gọi, số, tổng đài viên, ghi chú…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      <div
        className="tw tw-form flex flex-wrap items-center gap-1.5 text-sm text-foreground"
        role="toolbar"
        aria-label="Bộ lọc cuộc gọi"
      >
        <div className="mr-1.5 flex rounded-[9px] bg-secondary p-[3px]">
          {PERIODS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cn(
                "cursor-pointer rounded-[7px] px-3 py-[5px] text-[13px] font-medium text-muted-foreground",
                period === item.key && "bg-card font-semibold text-foreground shadow-sm",
              )}
              aria-pressed={period === item.key}
              onClick={() => setPeriod(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {OUTCOME_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className={cn(PILL, "inline-flex items-center gap-1.5", outcome === key && PILL_ON)}
            aria-pressed={outcome === key}
            onClick={() => setOutcome(outcome === key ? "" : key)}
          >
            <span
              className={cn(LED, DOT[key === "open" ? "red" : OUTCOME_TONE[key]])}
              aria-hidden="true"
            />
            {key === "open" ? "Đang diễn ra" : OUTCOME_LABEL[key]}
            <small className="tabular-nums opacity-70">{countOf(key)}</small>
          </button>
        ))}
        <button
          type="button"
          className={cn(PILL, "inline-flex items-center gap-1.5", recorded && PILL_ON)}
          aria-pressed={recorded}
          onClick={() => setRecorded(!recorded)}
        >
          <Icon name="play" size={12} />
          Có ghi âm
        </button>
        {departments.length > 1 && (
          <select
            className="ml-1.5"
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

      <div
        className={cn(
          "grid min-w-0 items-start gap-4",
          selected && "min-[1100px]:grid-cols-[minmax(0,1fr)_360px]",
        )}
      >
        <section className="tw min-w-0 text-sm text-foreground" aria-label="Danh sách cuộc gọi">
          {calls === null ? (
            <p className={cn(CARD, MUTED)}>Đang tải cuộc gọi…</p>
          ) : !shown.length ? (
            <p className={cn(CARD, MUTED)}>
              {calls.length ? "Không có cuộc gọi khớp bộ lọc." : "Chưa có cuộc gọi nào."}
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.label}>
                <h3 className="flex gap-2 px-0.5 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase first:pt-0">
                  <span>{group.label}</span>
                  <span className="font-medium normal-case">· {group.calls.length} cuộc</span>
                </h3>
                <ul className="list-none">
                  {group.calls.map((call) => {
                    const [arrow, way] = DIRECTION[call.direction];
                    const result = call.outcome ? OUTCOME_LABEL[call.outcome] : "Đang diễn ra";
                    const active = call.id === selectedId;
                    return (
                      <li
                        key={call.id}
                        className={cn(
                          "flex items-center gap-1 rounded-md border-b pr-1.5 hover:bg-secondary",
                          active && "bg-[var(--tint-blue-bg)] hover:bg-[var(--tint-blue-bg)]",
                        )}
                      >
                        <button
                          type="button"
                          className="grid min-w-0 flex-1 cursor-pointer grid-cols-[8px_44px_18px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_56px] items-center gap-3 px-1.5 py-2.5 text-left max-md:grid-cols-[8px_44px_minmax(0,1fr)_56px]"
                          aria-pressed={active}
                          onClick={() => setSelectedId(active ? null : call.id)}
                        >
                          <span
                            className={cn(
                              LED,
                              DOT[call.outcome ? (OUTCOME_TONE[call.outcome] ?? "neutral") : "red"],
                            )}
                            role="img"
                            aria-label={result}
                            title={result}
                          />
                          <time className="text-muted-foreground tabular-nums">
                            {new Date(call.startedAt).toLocaleTimeString("vi-VN", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </time>
                          <span
                            className="text-center text-muted-foreground max-md:hidden"
                            role="img"
                            aria-label={way}
                            title={way}
                          >
                            {arrow}
                          </span>
                          <span
                            className={cn(
                              "truncate font-semibold",
                              !call.callerName && "tabular-nums",
                            )}
                          >
                            {call.callerName ?? numberLabel(call.callerNumber)}
                          </span>
                          <span className="truncate max-md:hidden">
                            {call.agentName ?? "—"}
                            {call.departmentName && (
                              <small className="text-muted-foreground">
                                {" "}
                                · {call.departmentName}
                              </small>
                            )}
                          </span>
                          <span className="truncate text-muted-foreground max-md:hidden">
                            {labelOf(call.dispositionId) || call.notes || result}
                          </span>
                          <span className="text-right tabular-nums">
                            {call.answeredAt ? clock(seconds(call.answeredAt, call.endedAt)) : "—"}
                          </span>
                        </button>
                        {call.hasRecording ? (
                          <button
                            type="button"
                            className={cn(
                              ICON_BTN,
                              "size-7 rounded-full",
                              playing?.id === call.id && "bg-foreground text-background",
                            )}
                            aria-label={`Nghe ghi âm cuộc gọi lúc ${new Date(call.startedAt).toLocaleString("vi-VN")}`}
                            onClick={() => play(call)}
                          >
                            <Icon name="play" size={12} />
                          </button>
                        ) : (
                          <span className="size-7 shrink-0" />
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
          <aside
            className={cn(CARD, "gap-3 p-4 min-[1100px]:sticky min-[1100px]:top-2")}
            aria-label="Chi tiết cuộc gọi"
          >
            <div className="flex items-start gap-2.5">
              <UserAvatar name={selected.callerName ?? selected.callerNumber} className="size-10" />
              <div className="grid min-w-0 flex-1 gap-1">
                <h2 className="truncate text-base font-semibold">
                  {selected.callerName ?? numberLabel(selected.callerNumber)}
                </h2>
                <span
                  className={cn(
                    CHIP,
                    "justify-self-start",
                    TINT[selected.outcome ? (OUTCOME_TONE[selected.outcome] ?? "neutral") : "red"],
                  )}
                >
                  {selected.outcome ? OUTCOME_LABEL[selected.outcome] : "Đang diễn ra"} ·{" "}
                  {DIRECTION[selected.direction][1]}
                </span>
              </div>
              <button
                type="button"
                className={ICON_BTN}
                aria-label="Đóng chi tiết cuộc gọi"
                onClick={() => setSelectedId(null)}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
            <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[13.5px] [&_dd]:font-medium [&_dt]:text-muted-foreground">
              {selected.callerName && (
                <>
                  <dt>Số gọi</dt>
                  <dd>{numberLabel(selected.callerNumber)}</dd>
                </>
              )}
              <dt>Thời gian</dt>
              <dd>{new Date(selected.startedAt).toLocaleString("vi-VN")}</dd>
              <dt>Tổng đài viên</dt>
              <dd>
                {selected.agentName ?? "—"}
                {selected.departmentName && ` · ${selected.departmentName}`}
              </dd>
              {selected.queuedAt && (
                <>
                  <dt>Chờ trong hàng đợi</dt>
                  <dd className="tabular-nums">
                    {clock(seconds(selected.queuedAt, selected.answeredAt ?? selected.endedAt))}
                  </dd>
                </>
              )}
              <dt>Đàm thoại</dt>
              <dd className="tabular-nums">
                {selected.answeredAt ? clock(seconds(selected.answeredAt, selected.endedAt)) : "—"}
              </dd>
              <dt>Kết quả ghi nhận</dt>
              <dd>{labelOf(selected.dispositionId) || "Chưa ghi nhận"}</dd>
              {review && (
                <>
                  <dt>Chất lượng</dt>
                  <dd>
                    <span className={cn(CHIP, TINT[qaTone(review.percent)])}>
                      {review.percent}%
                    </span>
                    {review.reviewerName && ` · ${review.reviewerName}`}
                  </dd>
                </>
              )}
              {selected.transcriptStatus === "processing" && (
                <>
                  <dt>Lời thoại</dt>
                  <dd>Đang chép lời…</dd>
                </>
              )}
            </dl>
            <div className="flex items-center gap-2.5 rounded-lg bg-secondary px-3 py-2.5 text-[13px]">
              {playing?.id === selected.id ? (
                <audio src={playing.url} controls autoPlay className="h-9 w-full" />
              ) : selected.hasRecording ? (
                <button type="button" className={BTN_GHOST} onClick={() => play(selected)}>
                  <Icon name="play" size={14} />
                  Nghe ghi âm
                </button>
              ) : (
                <span className="text-muted-foreground">Không có ghi âm</span>
              )}
            </div>
            <div className="grid gap-1">
              <h3 className={H2}>Ghi chú</h3>
              <p className={cn(MUTED, "whitespace-pre-wrap")}>
                {selected.notes || "Không có ghi chú."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {dialable(selected.callerNumber) && (
                <button
                  type="button"
                  className={BTN_PRIMARY}
                  disabled={!canCall}
                  title={
                    canCall ? `Gọi lại ${selected.callerNumber}` : "Máy lẻ chưa sẵn sàng để gọi"
                  }
                  onClick={() => phone.call(selected.callerNumber)}
                >
                  <Icon name="phone" size={14} />
                  Gọi lại
                </button>
              )}
              {selected.transcriptStatus === "ready" && (
                <button type="button" className={BTN_GHOST} onClick={() => setReading(selected)}>
                  <Icon name="file" size={14} />
                  Lời thoại
                </button>
              )}
              {canScore(selected) && (
                <button type="button" className={BTN_GHOST} onClick={() => setScoring(selected)}>
                  <Icon name="star" size={14} />
                  {reviews.has(selected.id) ? "Chấm lại" : "Chấm điểm"}
                </button>
              )}
              {selected.hasRecording && selected.endedAt && supervises(selected) && (
                <button
                  type="button"
                  className={cn(BTN_GHOST, "w-full")}
                  onClick={() => setTeaching(selected)}
                >
                  <Icon name="book" size={14} />
                  Làm bài học từ cuộc gọi này
                </button>
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
