import type { AgentState } from "@doan/shared";

/**
 * Agent state machine (State pattern as a transition table). The ACD drives ringing/on_call/wrap_up;
 * the agent only picks ready, not_ready or offline, and only when no call is attached.
 */
const transitions: Record<AgentState, readonly AgentState[]> = {
  offline: ["ready", "not_ready"],
  ready: ["not_ready", "offline", "ringing"],
  not_ready: ["ready", "offline"],
  ringing: ["on_call", "ready", "not_ready", "offline"],
  on_call: ["wrap_up", "offline"],
  wrap_up: ["ready", "not_ready", "offline"],
};

const agentChoices: readonly AgentState[] = ["ready", "not_ready", "offline"];

export function canTransition(from: AgentState, to: AgentState): boolean {
  return transitions[from].includes(to);
}

/** Whether the agent may switch to `to` themselves from `from` (a call in progress blocks it). */
export function canAgentChoose(from: AgentState, to: AgentState): boolean {
  return agentChoices.includes(to) && from !== "ringing" && from !== "on_call" && canTransition(from, to);
}

export const isAgentState = (value: unknown): value is AgentState =>
  typeof value === "string" && value in transitions;
