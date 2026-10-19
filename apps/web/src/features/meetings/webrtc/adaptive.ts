import type { QosMetrics } from "@doan/shared";

/** Highest simulcast layer the network allows us to receive; null means audio only. */
export type NetworkCap = 0 | 1 | 2 | null;

export interface AdaptiveState {
  cap: NetworkCap;
  /** Consecutive samples per condition; reset on every cap change so each step waits for fresh evidence. */
  bad: number;
  severe: number;
  good: number;
}

export const INITIAL_ADAPTIVE: AdaptiveState = { cap: 2, bad: 0, severe: 0, good: 0 };

// Two bad samples (~5 s) to step down, four good ones (~10 s) to step up: drop fast, recover slowly.
const DOWN_AFTER = 2;
const UP_AFTER = 4;

const isSevere = (s: QosMetrics) => (s.packetLoss ?? 0) >= 15 || (s.rtt ?? 0) >= 1000;
const isBad = (s: QosMetrics) => (s.packetLoss ?? 0) >= 5 || (s.rtt ?? 0) >= 400;
const isGood = (s: QosMetrics) => (s.packetLoss ?? 0) < 2 && (s.rtt ?? 0) < 250;

const DOWN: Record<string, NetworkCap> = { 2: 1, 1: 0, 0: 0, null: null };
const UP: Record<string, NetworkCap> = { null: 0, 0: 1, 1: 2, 2: 2 };

/** Feed one QoS sample; returns the next state (same object when nothing changed). */
export function adaptToQos(state: AdaptiveState, sample: QosMetrics): AdaptiveState {
  const severe = isSevere(sample) ? state.severe + 1 : 0;
  const bad = isBad(sample) ? state.bad + 1 : 0;
  const good = isGood(sample) ? state.good + 1 : 0;
  let cap = state.cap;
  if (severe >= DOWN_AFTER) cap = null;
  else if (bad >= DOWN_AFTER) cap = DOWN[String(cap)];
  else if (good >= UP_AFTER) cap = UP[String(cap)];
  if (cap !== state.cap) return { cap, bad: 0, severe: 0, good: 0 };
  if (severe === state.severe && bad === state.bad && good === state.good) return state;
  return { cap, bad, severe, good };
}

/** Apply the network cap to the layer the grid asks for (null = paused). */
export const cappedLayer = (demand: number | null, cap: NetworkCap) =>
  demand === null || cap === null ? null : Math.min(demand, cap);
