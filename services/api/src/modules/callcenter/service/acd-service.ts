import { randomUUID } from "node:crypto";
import type { AgentState, CcCaller, CcCallOffer, CcLiveSnapshot, MonitorMode } from "@doan/shared";
import { HttpError } from "../../../shared/http/http-error.js";
import { canAgentChoose, canTransition } from "../domain/agent-state.js";
import { isOpen } from "../domain/business-hours.js";
import { CallQueues } from "../domain/call-queue.js";
import { strategies } from "../domain/distribution.js";
import { normalizePhone } from "../domain/extension.js";
import type {
  AcdStore,
  AgentRecord,
  CallCenterNotifier,
  Clock,
  DepartmentSettings,
  HotlineRoute,
  Pbx,
  PbxEvent,
} from "../domain/ports.js";

type Phase = "ivr" | "queued" | "offering" | "connected" | "voicemail" | "ended";

/** CC-10: the leg ringing (or talking to) the transfer target. */
interface Consult {
  channelId: string | null;
  extension: string;
  targetUserId: string | null;
  /** Blind: the agent has already left; attended: the agent talks to the target first. */
  blind: boolean;
  up: boolean;
}

/** CC-11: a supervisor's leg listening to, whispering into or barging into the call. */
interface Monitor {
  supervisorId: string;
  mode: MonitorMode;
  channelId: string;
  snoopId: string | null;
  bridgeId: string | null;
}

interface ActiveCall {
  /** In-memory key, stable for the whole conversation. */
  id: string;
  /** The cc_calls row currently being written; a transfer closes it and opens a linked one. */
  recordId: string;
  linkedId: string;
  direction: "inbound" | "internal";
  transfers: number;
  consult: Consult | null;
  monitors: Monitor[];
  channelId: string;
  hotline: HotlineRoute | null;
  department: DepartmentSettings | null;
  caller: CcCaller;
  phase: Phase;
  startedAt: number;
  enqueuedAt: number | null;
  ivrTries: number;
  /** BR-06: the recording notice was played. */
  noticed: boolean;
  playbackId: string | null;
  timer: unknown;
  agentUserId: string | null;
  agentChannelId: string | null;
  bridgeId: string | null;
  /** Name of the bridge recording, kept by the records that continue after a transfer (CC-7). */
  recording: string | null;
  voicemailName: string | null;
  callerGone: boolean;
  /** The agent put the caller on hold: out of the bridge, hearing music. */
  held: boolean;
  /** LT1: why the caller called, when they called from the web. */
  context: string;
}

/** A browser call session ("Liên hệ phòng ban"), looked up by its temporary endpoint. */
export interface WebCallSession {
  userId: string;
  departmentId: string;
  context: string;
  displayName: string;
  phone: string | null;
}

interface LiveAgent extends AgentRecord {
  departmentsSet: Set<string>;
  sinceMs: number;
  lastOfferedAt: number;
  /** BR-09: when the softphone was first seen unregistered; 0 while it is reachable. */
  lostSince: number;
  callId: string | null;
  wrapTimer: unknown;
}

/** IVR and voicemail prompts. shortcut: stock English prompts; record Vietnamese ones for the demo. */
export const prompts = {
  menuOption: (digit: string) => ["sound:vm-press", `sound:digits/${digit}`],
  hold: ["sound:pls-hold-while-try"],
  /** BR-06: said once, before the caller reaches anyone (the bridge recording starts on answer). */
  recordingNotice: ["sound:conf-now-recording"],
  voicemailIntro: ["sound:vm-intro"],
};

const IVR_DIGIT_TIMEOUT_MS = 6000;
const IVR_MAX_TRIES = 2;
const VOICEMAIL_MAX_SECONDS = 120;
const OFFLINE_AFTER_MS = 30_000;

/**
 * Automatic call distribution driven by PBX events (Facade over queues, agents and the PBX).
 * Runs in a single API process (advisory lock in the composition root); every event and agent
 * request is serialized through one work chain, so state is never touched concurrently.
 */
export class AcdService {
  private readonly calls = new Map<string, ActiveCall>();
  private readonly byChannel = new Map<string, string>();
  private readonly byPlayback = new Map<string, string>();
  private readonly agents = new Map<string, LiveAgent>();
  private readonly queues = new CallQueues();
  private work: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly pbx: Pbx,
    private readonly store: AcdStore,
    private readonly notifier: CallCenterNotifier,
    private readonly clock: Clock,
    private readonly log: (event: string, details?: Record<string, unknown>) => void = () => {},
    private readonly webSession: (endpoint: string) => Promise<WebCallSession | null> = async () => null,
  ) {}

  /** Runs `task` after everything queued before it; errors are logged, never thrown into the chain. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.work.then(task);
    this.work = result.catch((error: unknown) => {
      if (!(error instanceof HttpError))
        this.log("acd_error", { message: error instanceof Error ? error.message : String(error) });
    });
    return result;
  }

  /** Fire-and-forget work from timers; failures are already logged by the chain. */
  private run(task: () => Promise<unknown>): void {
    this.serial(task).catch(() => undefined);
  }

  handle(event: PbxEvent): Promise<void> {
    return this.serial(() => this.dispatchEvent(event)).catch(() => undefined);
  }

  /** Reloads members and extensions after an admin change, keeping live states. */
  refreshRoster(): Promise<void> {
    return this.serial(() => this.syncRoster());
  }

  private async syncRoster(): Promise<void> {
    const roster = await this.store.agentRoster();
    const seen = new Set<string>();
    for (const record of roster) {
      seen.add(record.userId);
      const live = this.agents.get(record.userId);
      if (live) {
        live.departments = record.departments;
        live.departmentsSet = new Set(record.departments);
        live.extension = record.extension;
        live.displayName = record.displayName;
      } else this.agents.set(record.userId, this.toLive(record));
    }
    for (const userId of [...this.agents.keys()])
      if (!seen.has(userId) && !this.agents.get(userId)!.callId) this.agents.delete(userId);
    for (const departmentId of this.queues.departments()) await this.distribute(departmentId);
  }

  /** The agent picked ready / not ready / offline on their screen. */
  requestState(userId: string, to: AgentState, reason = ""): Promise<void> {
    return this.serial(async () => {
      // Membership may have changed in another process (seed script, second API instance).
      if (!this.agents.has(userId)) await this.syncRoster();
      const agent = this.agents.get(userId);
      if (!agent) throw new HttpError(403, "NOT_AGENT", "Bạn chưa là tổng đài viên của phòng ban nào.");
      if (to === "ready" && !agent.extension)
        throw new HttpError(409, "NO_EXTENSION", "Bạn chưa được cấp máy lẻ.");
      if (!canAgentChoose(agent.state, to))
        throw new HttpError(409, "INVALID_AGENT_STATE", "Không thể đổi trạng thái khi đang có cuộc gọi.");
      this.clock.clearTimeout(agent.wrapTimer);
      await this.setAgentState(agent, to, to === "not_ready" ? reason : "");
      if (to === "ready") for (const departmentId of agent.departments) await this.distribute(departmentId);
    });
  }

  /** BR-09: an idle agent whose softphone stays unregistered for 30 s goes offline (never mid-call). */
  checkConnections(): Promise<void> {
    return this.serial(async () => {
      const now = this.clock.now();
      for (const agent of this.agents.values()) {
        const idle = (agent.state === "ready" || agent.state === "not_ready") && !agent.callId && agent.extension;
        // An ARI error says nothing about the phone: keep the agent rather than offline everyone.
        if (!idle || (await this.pbx.isExtensionOnline(agent.extension!).catch(() => true))) {
          agent.lostSince = 0;
          continue;
        }
        agent.lostSince ||= now;
        if (now - agent.lostSince < OFFLINE_AFTER_MS) continue;
        agent.lostSince = 0;
        await this.setAgentState(agent, "offline", "Mất kết nối quá 30 giây");
      }
    });
  }

  agentView(userId: string): { state: AgentState; reason: string; since: string | null; offer: CcCallOffer | null } | null {
    const agent = this.agents.get(userId);
    if (!agent) return null;
    const call = agent.callId ? this.calls.get(agent.callId) : undefined;
    return {
      state: agent.state,
      reason: agent.reason,
      since: agent.sinceMs ? new Date(agent.sinceMs).toISOString() : null,
      offer: call ? this.offer(call) : null,
    };
  }

  /** Q5: what Prometheus scrapes from the ACD leader. */
  metrics() {
    const agents: Record<string, number> = {};
    for (const agent of this.agents.values()) agents[agent.state] = (agents[agent.state] ?? 0) + 1;
    return { activeCalls: this.calls.size, queues: this.queues.sizes(this.clock.now()), agents };
  }

  snapshot(departmentId: string): CcLiveSnapshot {
    return {
      departmentId,
      waiting: this.queues.waiting(departmentId).map((queued) => {
        const call = this.calls.get(queued.callId)!;
        return {
          callId: queued.callId,
          callerNumber: call.caller.number,
          callerName: call.caller.displayName,
          waitingSince: new Date(queued.enqueuedAt).toISOString(),
        };
      }),
      agents: [...this.agents.values()]
        .filter((agent) => agent.departmentsSet.has(departmentId))
        .map((agent) => ({
          userId: agent.userId,
          displayName: agent.displayName,
          state: agent.state,
          reason: agent.reason,
          since: agent.sinceMs ? new Date(agent.sinceMs).toISOString() : null,
          extension: agent.extension,
          callId: agent.callId,
        })),
    };
  }

  // ---- transfer (CC-10) and supervision (CC-11) ----------------------------------------------

  /**
   * CC-10. To a department: blind, back through that department's queue. To an extension: blind
   * (the agent leaves at once) or attended (the agent talks to the receiver first, then completes).
   */
  transfer(userId: string, target: { departmentId?: string; extension?: string }, attended: boolean): Promise<void> {
    return this.serial(async () => {
      const { agent, call } = this.ownCall(userId);
      if (call.consult) throw new HttpError(409, "TRANSFER_IN_PROGRESS", "Đang có một yêu cầu chuyển máy.");
      const wasHeld = call.held;
      call.held = false; // a transfer keeps the caller on hold its own way
      if (target.departmentId) {
        if (attended) throw new HttpError(400, "INVALID_INPUT", "Chuyển sang phòng ban là chuyển thẳng qua hàng đợi.");
        const department = await this.store.department(target.departmentId);
        if (!department?.active) throw new HttpError(404, "NOT_FOUND", "Phòng ban không nhận cuộc gọi.");
        await this.releaseAgent(call, agent, false, department.name);
        // The agent's recording ends with their part; the next agent's bridge starts a new one.
        if (call.bridgeId) await this.pbx.destroyBridge(call.bridgeId).catch(() => undefined);
        call.bridgeId = null;
        call.department = department;
        await this.store.updateCall(call.recordId, { departmentId: department.id });
        await this.pbx.startMusicOnHold(call.channelId).catch(() => undefined);
        return this.requeue(call, false);
      }
      const extension = target.extension!;
      if (extension === agent.extension) throw new HttpError(400, "INVALID_INPUT", "Không thể chuyển cho chính mình.");
      const receiver = [...this.agents.values()].find((item) => item.extension === extension);
      if (receiver && receiver.state !== "ready") throw new HttpError(409, "TARGET_BUSY", `${receiver.displayName} đang bận.`);
      if (!(await this.pbx.isExtensionOnline(extension).catch(() => false)))
        throw new HttpError(409, "TARGET_OFFLINE", `Máy lẻ ${extension} chưa đăng ký.`);
      if (!wasHeld) await this.pbx.removeFromBridge(call.bridgeId!, call.channelId);
      await this.pbx.startMusicOnHold(call.channelId).catch(() => undefined);
      call.consult = { channelId: null, extension, targetUserId: receiver?.userId ?? null, blind: !attended, up: false };
      if (receiver) {
        receiver.callId = call.id;
        await this.setAgentState(receiver, "ringing", "Nhận cuộc gọi chuyển");
      }
      try {
        call.consult.channelId = await this.pbx.callExtension({
          extension,
          callerId: attended ? `"${agent.displayName.replace(/"/g, "")}" <${agent.extension}>` : this.callerId(call),
          callId: call.id,
          timeoutSeconds: 30,
          purpose: "consult",
        });
        this.byChannel.set(call.consult.channelId, call.id);
      } catch (error) {
        this.log("acd_transfer_failed", { callId: call.id, message: error instanceof Error ? error.message : String(error) });
        await this.onConsultEnded(call);
        throw new HttpError(502, "PBX_ERROR", `Không gọi được máy lẻ ${extension}.`);
      }
      if (attended) this.notifyAgent(agent);
      else await this.releaseAgent(call, agent, false, extension);
    });
  }

  /** The agent puts the caller on hold (out of the bridge, with music) or takes them back. */
  hold(userId: string, on: boolean): Promise<void> {
    return this.serial(async () => {
      const { agent, call } = this.ownCall(userId);
      if (call.consult) throw new HttpError(409, "TRANSFER_IN_PROGRESS", "Đang chuyển máy, người gọi đã được giữ máy.");
      if (call.held === on) return;
      if (on) {
        await this.pbx.removeFromBridge(call.bridgeId!, call.channelId);
        await this.pbx.startMusicOnHold(call.channelId).catch(() => undefined);
        call.held = true;
        this.notifyAgent(agent);
      } else await this.resumeWithAgent(call);
    });
  }

  /** Attended transfer: the receiver has answered and agreed; the caller is handed over. */
  completeTransfer(userId: string): Promise<void> {
    return this.serial(async () => {
      const { agent, call } = this.ownCall(userId);
      if (!call.consult?.up || call.consult.blind) throw new HttpError(409, "NO_TRANSFER", "Người nhận chưa nghe máy.");
      await this.releaseAgent(call, agent, false, call.consult.extension);
      await this.connectTarget(call);
    });
  }

  /** Attended transfer: the receiver declined; the caller comes back to the agent. */
  cancelTransfer(userId: string): Promise<void> {
    return this.serial(async () => {
      const { agent, call } = this.ownCall(userId);
      if (!call.consult || call.consult.blind) throw new HttpError(409, "NO_TRANSFER", "Không có yêu cầu chuyển máy.");
      await this.dropConsult(call, true);
      await this.resumeWithAgent(call);
      this.notifyAgent(agent);
    });
  }

  /** The department of a live call (for the supervisor permission check), or null when it ended. */
  departmentOfCall(callKey: string): string | null {
    return this.calls.get(callKey)?.department?.id ?? null;
  }

  /** CC-11: rings the supervisor's extension; once answered they listen, coach the agent or join in. */
  monitor(supervisorId: string, extension: string, callKey: string, mode: MonitorMode): Promise<void> {
    return this.serial(async () => {
      const call = this.calls.get(callKey);
      if (!call || call.phase !== "connected" || !call.agentChannelId || call.consult)
        throw new HttpError(409, "NO_ACTIVE_CALL", "Cuộc gọi không còn ở trạng thái đàm thoại.");
      if (call.agentUserId === supervisorId) throw new HttpError(409, "INVALID_INPUT", "Không thể giám sát cuộc gọi của chính mình.");
      if (call.monitors.some((item) => item.supervisorId === supervisorId))
        throw new HttpError(409, "ALREADY_MONITORING", "Bạn đang giám sát cuộc gọi này.");
      const self = this.agents.get(supervisorId);
      if (self && self.state !== "not_ready" && self.state !== "offline")
        throw new HttpError(409, "SUPERVISOR_BUSY", "Hãy chuyển sang Tạm nghỉ trước khi giám sát.");
      const channelId = await this.pbx.callExtension({
        extension,
        callerId: `"Giam sat ${mode}" <${extension}>`,
        callId: call.id,
        timeoutSeconds: 20,
        purpose: "monitor",
      });
      call.monitors.push({ supervisorId, mode, channelId, snoopId: null, bridgeId: null });
      this.byChannel.set(channelId, call.id);
    });
  }

  private ownCall(userId: string) {
    const agent = this.agents.get(userId);
    const call = agent?.callId ? this.calls.get(agent.callId) : undefined;
    if (!agent || !call || call.phase !== "connected" || call.agentUserId !== userId)
      throw new HttpError(409, "NO_ACTIVE_CALL", "Bạn không có cuộc gọi đang đàm thoại.");
    return { agent, call };
  }

  /**
   * The agent's part ends: their leg leaves, they wrap up, their CDR row closes as "transferred" and
   * the rest of the conversation is written to a new row linked to it.
   */
  private async releaseAgent(call: ActiveCall, agent: LiveAgent, legGone: boolean, transferTarget: string) {
    const leg = call.agentChannelId;
    call.agentChannelId = null;
    call.agentUserId = null;
    for (const monitor of [...call.monitors]) await this.endMonitor(call, monitor, true);
    if (leg) {
      this.byChannel.delete(leg);
      if (!legGone) await this.pbx.hangup(leg).catch(() => undefined);
    }
    if (agent.callId === call.id) agent.callId = null;
    await this.startWrapUp(agent, call.department!);
    await this.store.updateCall(call.recordId, { endedAt: new Date(this.clock.now()), outcome: "transferred" });
    const previous = call.recordId;
    call.recordId = randomUUID();
    call.transfers++;
    await this.store.createCall({
      id: call.recordId,
      linkedId: `${call.linkedId}:t${call.transfers}`,
      direction: call.direction,
      hotlineId: call.hotline?.id ?? null,
      callerNumber: call.caller.number,
      calleeNumber: transferTarget.slice(0, 32),
      callerUserId: call.caller.userId,
      transferredFrom: previous,
    });
    await this.store.updateCall(call.recordId, { departmentId: call.department!.id });
  }

  private async onConsultUp(call: ActiveCall): Promise<void> {
    const consult = call.consult!;
    consult.up = true;
    const receiver = consult.targetUserId ? this.agents.get(consult.targetUserId) : undefined;
    if (receiver) await this.setAgentState(receiver, "on_call", "");
    if (consult.blind) return this.connectTarget(call);
    await this.pbx.addToBridge(call.bridgeId!, [consult.channelId!]); // agent and receiver talk; caller on hold
    const agent = call.agentUserId ? this.agents.get(call.agentUserId) : undefined;
    if (agent) this.notifyAgent(agent);
  }

  /** The caller leaves hold and talks to the receiver, who now owns the call. */
  private async connectTarget(call: ActiveCall): Promise<void> {
    const consult = call.consult!;
    call.consult = null;
    await this.pbx.stopMusicOnHold(call.channelId).catch(() => undefined);
    await this.pbx.addToBridge(call.bridgeId!, consult.blind ? [call.channelId, consult.channelId!] : [call.channelId]);
    call.agentChannelId = consult.channelId;
    call.agentUserId = consult.targetUserId;
    await this.store.updateCall(call.recordId, {
      answeredAt: new Date(this.clock.now()),
      agentUserId: consult.targetUserId,
      recordingKey: call.recording ?? undefined, // the bridge recording carries on
    });
    const receiver = consult.targetUserId ? this.agents.get(consult.targetUserId) : undefined;
    if (receiver) this.notifyAgent(receiver);
    if (call.department) this.notifier.live(call.department.id);
  }

  private async onConsultEnded(call: ActiveCall): Promise<void> {
    await this.dropConsult(call, false);
    if (call.callerGone) return;
    if (call.agentChannelId) return this.resumeWithAgent(call); // attended: back to the agent
    // Blind: nobody took it, so the caller goes back to the head of the department's queue.
    if (call.bridgeId) await this.pbx.destroyBridge(call.bridgeId).catch(() => undefined);
    call.bridgeId = null;
    await this.requeue(call, true);
  }

  private async dropConsult(call: ActiveCall, hangup: boolean): Promise<void> {
    const consult = call.consult!;
    call.consult = null;
    if (consult.channelId) {
      this.byChannel.delete(consult.channelId);
      if (hangup) await this.pbx.hangup(consult.channelId).catch(() => undefined);
    }
    const receiver = consult.targetUserId ? this.agents.get(consult.targetUserId) : undefined;
    if (receiver?.callId !== call.id) return;
    receiver.callId = null;
    if (consult.up) await this.startWrapUp(receiver, call.department!);
    else await this.setAgentState(receiver, hangup ? "ready" : "not_ready", hangup ? "" : "Không nghe máy");
  }

  private async resumeWithAgent(call: ActiveCall): Promise<void> {
    call.held = false;
    await this.pbx.stopMusicOnHold(call.channelId).catch(() => undefined);
    await this.pbx.addToBridge(call.bridgeId!, [call.channelId]);
    const agent = call.agentUserId ? this.agents.get(call.agentUserId) : undefined;
    if (agent) this.notifyAgent(agent);
  }

  private async requeue(call: ActiveCall, front: boolean): Promise<void> {
    const department = call.department!;
    call.phase = "queued";
    call.enqueuedAt = this.clock.now();
    this.queues.enqueue({ callId: call.id, departmentId: department.id, enqueuedAt: call.enqueuedAt }, front);
    await this.store.updateCall(call.recordId, { queuedAt: new Date(call.enqueuedAt) });
    this.clock.clearTimeout(call.timer);
    call.timer = this.clock.setTimeout(() => this.run(() => this.onMaxWait(call.id)), department.maxWaitSeconds * 1000);
    this.notifier.live(department.id);
    await this.distribute(department.id);
  }

  private async onMonitorUp(call: ActiveCall, monitor: Monitor): Promise<void> {
    if (!call.agentChannelId || !call.bridgeId) return this.endMonitor(call, monitor, true);
    if (monitor.mode === "barge") return this.pbx.addToBridge(call.bridgeId, [monitor.channelId]);
    monitor.snoopId = await this.pbx.snoop(call.agentChannelId, { whisper: monitor.mode === "whisper", callId: call.id });
    monitor.bridgeId = await this.pbx.bridge([monitor.snoopId, monitor.channelId]);
  }

  private async endMonitor(call: ActiveCall, monitor: Monitor, hangup: boolean): Promise<void> {
    call.monitors = call.monitors.filter((item) => item !== monitor);
    this.byChannel.delete(monitor.channelId);
    if (hangup) await this.pbx.hangup(monitor.channelId).catch(() => undefined);
    if (monitor.snoopId) await this.pbx.hangup(monitor.snoopId).catch(() => undefined);
    if (monitor.bridgeId) await this.pbx.destroyBridge(monitor.bridgeId).catch(() => undefined);
  }

  private notifyAgent(agent: LiveAgent): void {
    const call = agent.callId ? this.calls.get(agent.callId) : undefined;
    this.notifier.agent(agent.userId, { state: agent.state, offer: call ? this.offer(call) : null });
  }

  private callerId(call: ActiveCall): string {
    return `"${(call.caller.displayName ?? call.caller.number).replace(/"/g, "")}" <${call.caller.number}>`;
  }


  // ---- events --------------------------------------------------------------------------------

  private async dispatchEvent(event: PbxEvent): Promise<void> {
    switch (event.type) {
      case "connected":
        return this.onConnected();
      case "call_started":
        if (event.args[0] === "inbound" || event.args[0] === "internal-test" || event.args[0] === "web") return this.onInbound(event);
        return; // our own agent legs ("agent", callId) are tracked when created
      case "dtmf":
        return this.onDigit(event.channelId, event.digit);
      case "playback_finished":
        return this.onPlaybackFinished(event.playbackId);
      case "channel_up":
        return this.onChannelUp(event.channelId);
      case "channel_ended":
        return this.onChannelEnded(event.channelId);
      case "recording_finished":
        return this.onRecordingDone(event.name, event.durationSeconds);
      case "recording_failed":
        return this.onRecordingDone(event.name, null);
    }
  }

  private async onConnected(): Promise<void> {
    const closed = await this.store.closeDanglingCalls();
    if (closed) this.log("acd_closed_dangling_calls", { closed });
    // Channels of calls that were live before the restart have no owner now: end them.
    const released = await this.pbx.releaseOrphans().catch(() => 0);
    if (released) this.log("acd_released_orphans", { released });
    for (const call of this.calls.values()) this.clock.clearTimeout(call.timer);
    this.calls.clear();
    this.byChannel.clear();
    this.byPlayback.clear();
    for (const departmentId of this.queues.departments())
      for (const queued of [...this.queues.waiting(departmentId)]) this.queues.remove(queued.callId);
    this.agents.clear();
    for (const record of await this.store.agentRoster()) {
      const agent = this.toLive(record);
      this.agents.set(agent.userId, agent);
      // A call attached before the restart is gone; the agent picks ready again.
      if (agent.state === "ringing" || agent.state === "on_call" || agent.state === "wrap_up")
        await this.setAgentState(agent, "offline", "Tổng đài vừa khởi động lại");
    }
  }

  private async onInbound(event: Extract<PbxEvent, { type: "call_started" }>): Promise<void> {
    // "Liên hệ phòng ban": a signed-in user calling from the browser; no IVR, straight to the department.
    const web = event.args[0] === "web" ? await this.webSession(event.args[1] ?? "").catch(() => null) : null;
    if (event.args[0] === "web" && !web) return void (await this.pbx.hangup(event.channelId).catch(() => undefined));
    const hotline = web ? null : await this.store.hotline(event.args[0] === "inbound" ? (event.args[1] ?? event.exten) : null);
    const callerNumber = web ? normalizePhone(web.phone ?? "") || "web" : normalizePhone(event.callerNumber || "") || "anonymous";
    const caller = await this.store.caller(callerNumber);
    if (web) Object.assign(caller, { userId: web.userId, displayName: web.displayName });
    else if (!caller.displayName && event.callerName) caller.displayName = event.callerName;
    const id = randomUUID();
    const call: ActiveCall = {
      id,
      recordId: id,
      linkedId: await this.pbx.linkedId(event.channelId).catch(() => event.channelId),
      direction: event.args[0] === "internal-test" ? "internal" : "inbound", // web calls come from outside the desk too
      transfers: 0,
      consult: null,
      monitors: [],
      channelId: event.channelId,
      hotline,
      department: null,
      caller,
      phase: "ivr",
      startedAt: this.clock.now(),
      enqueuedAt: null,
      ivrTries: 0,
      noticed: false,
      playbackId: null,
      timer: null,
      agentUserId: null,
      agentChannelId: null,
      bridgeId: null,
      recording: null,
      voicemailName: null,
      callerGone: false,
      held: false,
      context: web?.context ?? "",
    };
    this.calls.set(call.id, call);
    this.byChannel.set(call.channelId, call.id);
    await this.store.createCall({
      id: call.recordId,
      linkedId: call.linkedId,
      direction: call.direction,
      hotlineId: hotline?.id ?? null,
      callerNumber,
      calleeNumber: web ? "web" : (hotline?.number ?? event.exten),
      callerUserId: caller.userId,
    });
    await this.pbx.answer(call.channelId);
    if (web) return this.routeTo(call, web.departmentId);
    if (!hotline) return this.finish(call, "failed", true);
    if (hotline.options.length <= 1)
      return this.routeTo(call, hotline.options[0]?.departmentId ?? hotline.fallbackDepartmentId);
    return this.playMenu(call);
  }

  private withNotice(call: ActiveCall, media: string[]): string[] {
    if (call.noticed) return media;
    call.noticed = true;
    return [...prompts.recordingNotice, ...media];
  }

  private async playMenu(call: ActiveCall): Promise<void> {
    call.phase = "ivr";
    const media = call.hotline!.options.flatMap((option) => prompts.menuOption(option.digit));
    await this.playTo(call, this.withNotice(call, media));
  }

  private async onDigit(channelId: string, digit: string): Promise<void> {
    const call = this.callOf(channelId);
    if (!call || call.phase !== "ivr" || channelId !== call.channelId) return;
    const option = call.hotline?.options.find((item) => item.digit === digit);
    if (!option) return; // unknown keys are ignored; the timeout replays the menu
    this.clock.clearTimeout(call.timer);
    if (call.playbackId) await this.pbx.stopPlayback(call.playbackId).catch(() => undefined);
    await this.routeTo(call, option.departmentId);
  }

  private async onPlaybackFinished(playbackId: string): Promise<void> {
    const callId = this.byPlayback.get(playbackId);
    this.byPlayback.delete(playbackId);
    const call = callId ? this.calls.get(callId) : undefined;
    if (!call || call.playbackId !== playbackId) return;
    call.playbackId = null;
    if (call.phase === "ivr") {
      call.timer = this.clock.setTimeout(() => this.run(() => this.onIvrTimeout(call.id)), IVR_DIGIT_TIMEOUT_MS);
    } else if (call.phase === "queued") {
      await this.pbx.startMusicOnHold(call.channelId).catch(() => undefined);
    } else if (call.phase === "voicemail" && !call.callerGone) {
      call.voicemailName = `vm-${call.id}`;
      await this.pbx.recordVoicemail(call.channelId, call.voicemailName, VOICEMAIL_MAX_SECONDS);
    }
  }

  private async onIvrTimeout(callId: string): Promise<void> {
    const call = this.calls.get(callId);
    if (!call || call.phase !== "ivr") return;
    call.ivrTries++;
    if (call.ivrTries < IVR_MAX_TRIES) return this.playMenu(call);
    await this.routeTo(call, call.hotline?.fallbackDepartmentId ?? call.hotline?.options[0]?.departmentId ?? null);
  }

  private async routeTo(call: ActiveCall, departmentId: string | null): Promise<void> {
    const department = departmentId ? await this.store.department(departmentId) : null;
    if (!department || !department.active) return this.finish(call, "failed", true);
    call.department = department;
    await this.store.updateCall(call.recordId, { departmentId: department.id });
    if (!isOpen(department.hours, new Date(this.clock.now()))) return this.toVoicemail(call);
    call.phase = "queued";
    call.enqueuedAt = this.clock.now();
    this.queues.enqueue({ callId: call.id, departmentId: department.id, enqueuedAt: call.enqueuedAt });
    await this.store.updateCall(call.recordId, { queuedAt: new Date(call.enqueuedAt) });
    // Single-department hotlines and browser calls skip the menu, so the notice goes here.
    await this.playTo(call, this.withNotice(call, prompts.hold));
    call.timer = this.clock.setTimeout(
      () => this.run(() => this.onMaxWait(call.id)),
      department.maxWaitSeconds * 1000,
    );
    this.notifier.live(department.id);
    await this.distribute(department.id);
  }

  private async onMaxWait(callId: string): Promise<void> {
    const call = this.calls.get(callId);
    if (call?.phase === "queued") await this.toVoicemail(call);
  }

  private async toVoicemail(call: ActiveCall): Promise<void> {
    this.clock.clearTimeout(call.timer);
    if (this.queues.remove(call.id) && call.department) this.notifier.live(call.department.id);
    call.phase = "voicemail";
    await this.pbx.stopMusicOnHold(call.channelId).catch(() => undefined);
    await this.playTo(call, prompts.voicemailIntro);
  }

  // ---- distribution --------------------------------------------------------------------------

  private async distribute(departmentId: string): Promise<void> {
    for (;;) {
      const head = this.queues.peek(departmentId);
      if (!head) return;
      const call = this.calls.get(head.callId);
      if (!call?.department) {
        this.queues.remove(head.callId);
        continue;
      }
      const candidates = [...this.agents.values()].filter(
        (agent) => agent.state === "ready" && agent.extension && agent.departmentsSet.has(departmentId),
      );
      const chosen = strategies[call.department.strategy].pick(
        candidates.map((agent) => ({ userId: agent.userId, readySince: agent.sinceMs, lastOfferedAt: agent.lastOfferedAt })),
      );
      if (!chosen) return;
      await this.offerTo(call, this.agents.get(chosen.userId)!);
    }
  }

  private async offerTo(call: ActiveCall, agent: LiveAgent): Promise<void> {
    if (!(await this.pbx.isExtensionOnline(agent.extension!).catch(() => false))) {
      await this.setAgentState(agent, "not_ready", "Máy lẻ chưa đăng ký");
      return;
    }
    this.queues.remove(call.id);
    call.phase = "offering";
    call.agentUserId = agent.userId;
    agent.callId = call.id;
    agent.lastOfferedAt = this.clock.now();
    await this.setAgentState(agent, "ringing", "");
    try {
      call.agentChannelId = await this.pbx.callExtension({
        extension: agent.extension!,
        callerId: `"${(call.caller.displayName ?? call.caller.number).replace(/"/g, "")}" <${call.caller.number}>`,
        callId: call.id,
        timeoutSeconds: call.department!.ringSeconds,
      });
      this.byChannel.set(call.agentChannelId, call.id);
    } catch (error) {
      this.log("acd_offer_failed", { callId: call.id, message: error instanceof Error ? error.message : String(error) });
      await this.declined(call, agent, "Không gọi được máy lẻ");
    }
    this.notifier.live(call.department!.id);
  }

  /** The agent did not take the call: back to the head of the queue, agent paused (CC-5). */
  private async declined(call: ActiveCall, agent: LiveAgent, reason: string): Promise<void> {
    agent.callId = null;
    await this.setAgentState(agent, "not_ready", reason);
    if (call.agentChannelId) this.byChannel.delete(call.agentChannelId);
    call.agentChannelId = null;
    call.agentUserId = null;
    if (call.callerGone) return;
    call.phase = "queued";
    this.queues.enqueue(
      { callId: call.id, departmentId: call.department!.id, enqueuedAt: call.enqueuedAt ?? this.clock.now() },
      true,
    );
  }

  private async onChannelUp(channelId: string): Promise<void> {
    const call = this.callOf(channelId);
    if (call?.consult?.channelId === channelId) return this.onConsultUp(call);
    const monitor = call?.monitors.find((item) => item.channelId === channelId);
    if (call && monitor) return this.onMonitorUp(call, monitor);
    if (!call || call.phase !== "offering" || channelId !== call.agentChannelId) return;
    const agent = this.agents.get(call.agentUserId!)!;
    this.clock.clearTimeout(call.timer);
    if (call.playbackId) await this.pbx.stopPlayback(call.playbackId).catch(() => undefined);
    await this.pbx.stopMusicOnHold(call.channelId).catch(() => undefined);
    call.bridgeId = await this.pbx.bridge([call.channelId, channelId]);
    call.phase = "connected";
    await this.setAgentState(agent, "on_call", "");
    await this.store.updateCall(call.recordId, { answeredAt: new Date(this.clock.now()), agentUserId: agent.userId });
    const recording = `call-${call.recordId}`;
    call.recording = recording;
    // CC-7: every hotline call is recorded; a failed recording must not drop the conversation.
    await this.pbx
      .recordBridge(call.bridgeId, recording)
      .then(() => this.store.updateCall(call.recordId, { recordingKey: recording }))
      .catch((error: unknown) =>
        this.log("acd_record_failed", { callId: call.id, message: error instanceof Error ? error.message : String(error) }),
      );
    this.notifier.live(call.department!.id);
  }

  private async onChannelEnded(channelId: string): Promise<void> {
    const call = this.callOf(channelId);
    this.byChannel.delete(channelId);
    if (!call || call.phase === "ended") return;
    if (call.consult?.channelId === channelId) return this.onConsultEnded(call);
    const monitor = call.monitors.find((item) => item.channelId === channelId);
    if (monitor) return this.endMonitor(call, monitor, false);
    if (channelId === call.agentChannelId) {
      const agent = call.agentUserId ? this.agents.get(call.agentUserId) : undefined;
      if (call.phase === "offering" && agent) {
        await this.declined(call, agent, "Không nghe máy");
        await this.distribute(call.department!.id);
        this.notifier.live(call.department!.id);
      } else if (call.phase === "connected" && call.consult && agent) {
        // Hanging up mid-transfer hands the caller over (attended) or leaves the target ringing (blind).
        await this.releaseAgent(call, agent, true, call.consult.extension);
        if (call.consult.up) await this.connectTarget(call);
        else call.consult.blind = true;
      } else if (call.phase === "connected") {
        await this.pbx.hangup(call.channelId).catch(() => undefined); // agent hung up first
      }
      return;
    }
    if (channelId !== call.channelId) return;
    call.callerGone = true;
    // A blind transfer still ringing has no one on the line yet: the caller gave up waiting.
    if (call.phase === "connected") return this.finish(call, call.agentChannelId ? "answered" : "abandoned", false);
    if (call.phase === "voicemail" && call.voicemailName) return; // RecordingFinished closes it
    return this.finish(call, "abandoned", false);
  }

  private async onRecordingDone(name: string, durationSeconds: number | null): Promise<void> {
    const call = [...this.calls.values()].find((item) => item.voicemailName === name);
    if (!call) return;
    if (durationSeconds !== null && durationSeconds > 0)
      await this.store.saveVoicemail({
        callId: call.recordId,
        departmentId: call.department?.id ?? null,
        callerNumber: call.caller.number,
        callerUserId: call.caller.userId,
        durationSeconds,
        recordingKey: name,
      });
    await this.finish(call, durationSeconds ? "voicemail" : "abandoned", !call.callerGone);
  }

  // ---- helpers -------------------------------------------------------------------------------

  private async finish(call: ActiveCall, outcome: "answered" | "abandoned" | "voicemail" | "failed", hangup: boolean) {
    if (call.phase === "ended") return;
    const wasOffering = call.phase === "offering";
    call.phase = "ended";
    for (const monitor of [...call.monitors]) await this.endMonitor(call, monitor, true);
    if (call.consult) await this.dropConsult(call, true);
    this.clock.clearTimeout(call.timer);
    this.queues.remove(call.id);
    this.calls.delete(call.id);
    this.byChannel.delete(call.channelId);
    await this.store.updateCall(call.recordId, { endedAt: new Date(this.clock.now()), outcome });
    if (outcome === "abandoned" && call.department && call.enqueuedAt !== null)
      await this.store.missedCall({
        callId: call.recordId,
        departmentId: call.department.id,
        callerNumber: call.caller.number,
        callerUserId: call.caller.userId,
      });
    if (hangup) await this.pbx.hangup(call.channelId).catch(() => undefined);
    if (call.bridgeId) await this.pbx.destroyBridge(call.bridgeId).catch(() => undefined);
    const agent = call.agentUserId ? this.agents.get(call.agentUserId) : undefined;
    if (call.agentChannelId) {
      this.byChannel.delete(call.agentChannelId);
      await this.pbx.hangup(call.agentChannelId).catch(() => undefined);
    }
    if (agent && agent.callId === call.id) {
      agent.callId = null;
      if (wasOffering) await this.setAgentState(agent, "ready", "");
      else if (outcome === "answered") await this.startWrapUp(agent, call.department!);
    }
    if (call.department) {
      this.notifier.live(call.department.id);
      if (agent?.state === "ready") await this.distribute(call.department.id);
    }
  }

  private async startWrapUp(agent: LiveAgent, department: DepartmentSettings): Promise<void> {
    await this.setAgentState(agent, "wrap_up", "");
    const toReady = async () => {
      if (agent.state !== "wrap_up") return;
      await this.setAgentState(agent, "ready", "");
      for (const departmentId of agent.departments) await this.distribute(departmentId);
    };
    if (department.wrapUpSeconds === 0) return toReady();
    agent.wrapTimer = this.clock.setTimeout(() => this.run(toReady), department.wrapUpSeconds * 1000);
  }

  private async setAgentState(agent: LiveAgent, state: AgentState, reason: string): Promise<void> {
    if (agent.state !== state && !canTransition(agent.state, state))
      throw new Error(`Agent ${agent.userId}: ${agent.state} → ${state} is not allowed`);
    agent.state = state;
    agent.reason = reason;
    agent.sinceMs = this.clock.now();
    await this.store.recordAgentState(agent.userId, state, reason, agent.callId);
    const call = agent.callId ? this.calls.get(agent.callId) : undefined;
    this.notifier.agent(agent.userId, { state, offer: call ? this.offer(call) : null });
    for (const departmentId of agent.departments) this.notifier.live(departmentId);
  }

  private async playTo(call: ActiveCall, media: string[]): Promise<void> {
    const playbackId = await this.pbx.play(call.channelId, media);
    call.playbackId = playbackId;
    this.byPlayback.set(playbackId, call.id);
  }

  private callOf(channelId: string): ActiveCall | undefined {
    const callId = this.byChannel.get(channelId);
    return callId ? this.calls.get(callId) : undefined;
  }

  private offer(call: ActiveCall): CcCallOffer {
    return {
      callId: call.recordId,
      departmentId: call.department?.id ?? "",
      departmentName: call.department?.name ?? "",
      caller: call.caller,
      waitedSeconds: Math.round((this.clock.now() - (call.enqueuedAt ?? call.startedAt)) / 1000),
      transfer: call.consult
        ? { target: call.consult.extension, attended: !call.consult.blind, answered: call.consult.up }
        : null,
      held: call.held,
      context: call.context || null,
    };
  }

  private toLive(record: AgentRecord): LiveAgent {
    return {
      ...record,
      departmentsSet: new Set(record.departments),
      sinceMs: record.since?.getTime() ?? 0,
      lastOfferedAt: 0,
      lostSince: 0,
      callId: null,
      wrapTimer: null,
    };
  }
}
