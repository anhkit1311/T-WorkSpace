import type {
  AgentState,
  CcCaller,
  CcCallOffer,
  DistributionStrategyName,
  ExtensionTransport,
} from "@doan/shared";
import type { OpeningWindow } from "./business-hours.js";

/** PBX events the ACD reacts to, already translated from ARI by the adapter. */
export type PbxEvent =
  | { type: "connected" }
  | {
      type: "call_started";
      channelId: string;
      args: string[];
      callerNumber: string;
      callerName: string;
      exten: string;
    }
  | { type: "channel_up"; channelId: string }
  | { type: "channel_ended"; channelId: string }
  | { type: "dtmf"; channelId: string; digit: string }
  | { type: "playback_finished"; playbackId: string }
  | { type: "recording_finished"; name: string; durationSeconds: number }
  | { type: "recording_failed"; name: string };

/** Adapter boundary to Asterisk (ARI). The ACD never talks HTTP or SIP itself. */
export interface Pbx {
  answer(channelId: string): Promise<void>;
  hangup(channelId: string): Promise<void>;
  /** Plays the media list in order; resolves with the playback id. */
  play(channelId: string, media: string[]): Promise<string>;
  stopPlayback(playbackId: string): Promise<void>;
  startMusicOnHold(channelId: string): Promise<void>;
  stopMusicOnHold(channelId: string): Promise<void>;
  /** Rings an extension from inside the ARI app; resolves with the new channel id. */
  callExtension(input: {
    extension: string;
    callerId: string;
    callId: string;
    timeoutSeconds: number;
    /** Tag carried in the Stasis args: "agent" (default), "consult" (transfer) or "monitor" (supervisor). */
    purpose?: string;
  }): Promise<string>;
  bridge(channelIds: string[]): Promise<string>;
  addToBridge(bridgeId: string, channelIds: string[]): Promise<void>;
  removeFromBridge(bridgeId: string, channelId: string): Promise<void>;
  /** CC-11: a snoop channel on `channelId` (spy both ways; whisper "out" is heard by that channel's phone). */
  snoop(channelId: string, input: { whisper: boolean; callId: string }): Promise<string>;
  destroyBridge(bridgeId: string): Promise<void>;
  /** M1: a channel that streams the bridge audio as G.711 RTP to `host` ("ip:port") and plays what comes back. */
  externalMedia(host: string): Promise<{ channelId: string; address: string; port: number }>;
  recordBridge(bridgeId: string, name: string): Promise<void>;
  recordVoicemail(channelId: string, name: string, maxSeconds: number): Promise<void>;
  isExtensionOnline(extension: string): Promise<boolean>;
  linkedId(channelId: string): Promise<string>;
  /** Hangs up channels and destroys bridges a previous run of the app left behind; returns how many. */
  releaseOrphans(): Promise<number>;
  /** `context` overrides the dialplan entry (browser call sessions); otherwise extensions reach each other only. */
  pushExtension(input: { number: string; secret: string; transport: ExtensionTransport; callerName: string; context?: string }): Promise<void>;
  removeExtension(number: string): Promise<void>;
  /** BR-17: removes a stored recording (call or voicemail); a missing one is not an error. */
  deleteRecording(name: string): Promise<void>;
}

export interface HotlineRoute {
  id: string;
  number: string;
  fallbackDepartmentId: string | null;
  options: { digit: string; departmentId: string }[];
}

export interface DepartmentSettings {
  id: string;
  name: string;
  strategy: DistributionStrategyName;
  ringSeconds: number;
  maxWaitSeconds: number;
  wrapUpSeconds: number;
  active: boolean;
  hours: OpeningWindow[];
}

export interface AgentRecord {
  userId: string;
  displayName: string;
  /** Departments where the user is an agent (supervisors are not offered calls). */
  departments: string[];
  extension: string | null;
  state: AgentState;
  reason: string;
  since: Date | null;
}

export interface CallPatch {
  departmentId?: string | null;
  queuedAt?: Date;
  answeredAt?: Date;
  endedAt?: Date;
  outcome?: "answered" | "abandoned" | "missed" | "voicemail" | "failed" | "transferred";
  agentUserId?: string | null;
  recordingKey?: string;
}

/** Persistence the ACD needs (Repository pattern); the PostgreSQL implementation is in repository/. */
export interface AcdStore {
  /** The hotline that owns `number`; null asks for the first active hotline (internal test calls). */
  hotline(number: string | null): Promise<HotlineRoute | null>;
  department(id: string): Promise<DepartmentSettings | null>;
  caller(number: string): Promise<CcCaller>;
  createCall(input: {
    id: string;
    linkedId: string;
    direction: "inbound" | "internal";
    hotlineId: string | null;
    callerNumber: string;
    calleeNumber: string;
    callerUserId: string | null;
    /** CC-10: the record of the agent who transferred the call. */
    transferredFrom?: string | null;
  }): Promise<void>;
  updateCall(id: string, patch: CallPatch): Promise<void>;
  /** Stores the voicemail and opens (or extends) a follow-up ticket for the department (CC-8). */
  saveVoicemail(input: {
    callId: string;
    departmentId: string | null;
    callerNumber: string;
    callerUserId: string | null;
    durationSeconds: number;
    recordingKey: string;
  }): Promise<void>;
  /** A caller hung up while queued: opens (or extends) a call-back ticket (CC-8). */
  missedCall(input: { callId: string; departmentId: string; callerNumber: string; callerUserId: string | null }): Promise<void>;
  agentRoster(): Promise<AgentRecord[]>;
  recordAgentState(userId: string, state: AgentState, reason: string, callId: string | null): Promise<void>;
  /** Calls left open by a crash or restart: their channels are gone, so they end as failed. */
  closeDanglingCalls(): Promise<number>;
}

/** Observer side: who must hear about a change. Implemented with Socket.IO user rooms. */
export interface CallCenterNotifier {
  agent(userId: string, data: { state: AgentState; offer: CcCallOffer | null }): void;
  live(departmentId: string): void;
}

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
