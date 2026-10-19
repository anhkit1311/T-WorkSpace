// Call center (VoIP) contracts shared by the API and the web app.

export type AgentState = "offline" | "ready" | "not_ready" | "ringing" | "on_call" | "wrap_up";
export type CallCenterRole = "agent" | "supervisor";
export type DistributionStrategyName = "longest_idle" | "round_robin";
export type ExtensionTransport = "webrtc" | "sip";
export type CallOutcome =
  | "answered"
  | "abandoned"
  | "missed"
  | "voicemail"
  | "busy"
  | "failed"
  | "transferred";

export interface CcDepartment {
  id: string;
  code: string;
  name: string;
  extensionFrom: number;
  extensionTo: number;
  strategy: DistributionStrategyName;
  ringSeconds: number;
  maxWaitSeconds: number;
  wrapUpSeconds: number;
  active: boolean;
  /** LT-4: agents must finish this course before going Ready. */
  trainingCourseId: string | null;
  /** E2: a QA review under qaThreshold (%) assigns this course to the agent. */
  coachingCourseId: string | null;
  qaThreshold: number;
  hours: { weekday: number; opens: string; closes: string }[];
  members: { userId: string; displayName: string; email: string; role: CallCenterRole }[];
}

export interface CcExtension {
  id: string;
  number: string;
  departmentId: string;
  userId: string | null;
  userName: string | null;
  label: string;
  transport: ExtensionTransport;
  active: boolean;
  syncedAt: string | null;
  /** BR-20: may dial numbers outside the school through the SIP trunk. */
  canCallOut: boolean;
}

export interface CcHotline {
  id: string;
  number: string;
  name: string;
  trunk: string;
  fallbackDepartmentId: string | null;
  active: boolean;
  options: { digit: string; departmentId: string }[];
}

export interface CcDisposition {
  id: string;
  departmentId: string | null;
  code: string;
  label: string;
}

export interface CcCaller {
  number: string;
  userId: string | null;
  displayName: string | null;
  email: string | null;
  recentCalls: number;
}

/** NV-CC1: what the desk shows about the caller on the line. */
export interface CcCallerProfile {
  /** From the caller's latest thesis enrollment, when they are a student. */
  student: { code: string; className: string; faculty: string } | null;
  tickets: { id: string; code: string; subject: string; status: TicketStatus; updatedAt: string }[];
  courses: { code: string; title: string; completed: boolean }[];
  calls: { startedAt: string; outcome: CallOutcome | null; departmentName: string | null; agentName: string | null; notes: string }[];
}

export interface CcCallRecord {
  id: string;
  direction: "inbound" | "outbound" | "internal";
  departmentId: string | null;
  departmentName: string | null;
  callerNumber: string;
  callerName: string | null;
  agentUserId: string | null;
  agentName: string | null;
  startedAt: string;
  queuedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  outcome: CallOutcome | null;
  dispositionId: string | null;
  notes: string;
  hasRecording: boolean;
}

/** What an agent's screen needs: who they are in the call center and their softphone account. */
export interface CcAgentProfile {
  userId: string;
  isAdmin: boolean;
  departments: { id: string; name: string; role: CallCenterRole }[];
  state: AgentState;
  stateReason: string;
  stateSince: string | null;
  extension: { number: string; transport: ExtensionTransport } | null;
  currentCall: CcCallOffer | null;
  /** LT-4: required courses not finished yet; while non-empty the agent cannot go Ready. */
  training: { courseId: string; code: string; title: string; percent: number }[];
}

export interface CcSipAccount {
  number: string;
  secret: string;
  wsUrl: string;
  domain: string;
}

/** Sent to an agent when a hotline call is ringing their extension. */
export interface CcCallOffer {
  callId: string;
  departmentId: string;
  departmentName: string;
  caller: CcCaller;
  waitedSeconds: number;
  /** CC-10: a transfer the agent started and has not finished. */
  transfer: { target: string; attended: boolean; answered: boolean } | null;
  /** The agent put the caller on hold (music plays to the caller). */
  held?: boolean;
  /** LT1: what the caller was doing when they called from the web (course, lesson, progress). */
  context?: string | null;
}

export type MonitorMode = "listen" | "whisper" | "barge";

/** Who an agent can transfer to: departments (back through their queue) or extensions. */
export interface CcTransferDirectory {
  departments: { id: string; name: string }[];
  extensions: { number: string; name: string; departmentName: string; state: AgentState | null; userId: string | null }[];
}

export interface CcLiveSnapshot {
  departmentId: string;
  waiting: { callId: string; callerNumber: string; callerName: string | null; waitingSince: string }[];
  agents: {
    userId: string;
    displayName: string;
    state: AgentState;
    reason: string;
    since: string | null;
    extension: string | null;
    callId: string | null;
  }[];
}

export type TicketStatus = "open" | "in_progress" | "waiting" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketSource = "call" | "missed_call" | "voicemail" | "manual" | "elearning";

export interface CcTicket {
  id: string;
  /** Display code, e.g. TK-000123. */
  code: string;
  departmentId: string;
  departmentName: string;
  source: TicketSource;
  callId: string | null;
  voicemailId: string | null;
  callerNumber: string | null;
  callerName: string | null;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** NV-CC3: 1–5 stars from the requester once resolved. */
  satisfaction?: number | null;
}

export interface CcTicketEvent {
  id: string;
  kind: "comment" | "status" | "assign" | "callback";
  actorName: string | null;
  body: string;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus | null;
  createdAt: string;
}

/** CC-9 report for one department and period. Times are in seconds, rates in 0..1. */
export interface CcKpiReport {
  departmentId: string;
  from: string;
  to: string;
  serviceLevelSeconds: number;
  offered: number;
  answered: number;
  abandoned: number;
  voicemail: number;
  /** Average speed of answer: queue entry to agent pickup. */
  asa: number | null;
  /** Average handle time: talk time plus the agent's wrap-up time. */
  aht: number | null;
  abandonRate: number | null;
  serviceLevel: number | null;
  agents: { userId: string; displayName: string; answered: number; talkSeconds: number; averageTalk: number | null }[];
  hourly: { hour: number; offered: number; answered: number }[];
}

/** V7: one line of a department's QA scorecard; scored 0..10 and weighted. */
export interface CcQaCriterion {
  id: string;
  label: string;
  weight: number;
}

export interface CcQaReview {
  id: string;
  callId: string;
  departmentId: string;
  agentId: string;
  agentName: string;
  reviewerName: string | null;
  callStartedAt: string;
  callerNumber: string;
  items: (CcQaCriterion & { score: number })[];
  percent: number;
  comment: string;
  /** E2: the coaching course was assigned because of this review. */
  coachingAssigned: boolean;
  createdAt: string;
}

/** NV-CC5: a message left on someone's own extension. */
export interface CcPersonalVoicemail {
  id: string;
  callerNumber: string;
  callerName: string | null;
  durationSeconds: number;
  receivedAt: string;
  listened: boolean;
}

/** "Liên hệ phòng ban": a temporary browser phone that can only call one department's queue. */
export interface CcWebCallAccount extends CcSipAccount {
  /** What the browser dials; the PBX routes it straight to the department queue. */
  target: string;
  departmentName: string;
  expiresAt: string;
}

/** A department a user can contact from the web (call or ticket). */
export interface CcContactDepartment {
  id: string;
  name: string;
  hotline: string | null;
  open: boolean;
}
