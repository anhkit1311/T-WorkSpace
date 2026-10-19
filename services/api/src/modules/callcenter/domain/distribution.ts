import type { DistributionStrategyName } from "@doan/shared";

export interface AgentCandidate {
  userId: string;
  /** When the agent last became ready (epoch ms). */
  readySince: number;
  /** When the agent was last offered a call (epoch ms, 0 = never). */
  lastOfferedAt: number;
}

/** Strategy pattern: how the ACD picks one ready agent for the call at the head of a queue. */
export interface DistributionStrategy {
  pick(candidates: readonly AgentCandidate[]): AgentCandidate | null;
}

const by =
  (key: (candidate: AgentCandidate) => number): DistributionStrategy["pick"] =>
  (candidates) =>
    candidates.reduce<AgentCandidate | null>((best, candidate) => {
      if (!best) return candidate;
      const difference = key(candidate) - key(best);
      // Ties go to the smaller id so the choice is deterministic (and testable).
      return difference < 0 || (difference === 0 && candidate.userId < best.userId) ? candidate : best;
    }, null);

/** The agent who has been waiting longest since their last call. */
export const longestIdle: DistributionStrategy = { pick: by((candidate) => candidate.readySince) };

/** Agents take turns: the one offered a call least recently goes next. */
export const roundRobin: DistributionStrategy = { pick: by((candidate) => candidate.lastOfferedAt) };

export const strategies: Record<DistributionStrategyName, DistributionStrategy> = {
  longest_idle: longestIdle,
  round_robin: roundRobin,
};
