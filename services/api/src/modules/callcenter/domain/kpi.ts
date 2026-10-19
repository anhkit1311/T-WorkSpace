import { localTime } from "./business-hours.js";

export interface KpiCall {
  agentUserId: string | null;
  agentName: string | null;
  startedAt: Date;
  queuedAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  outcome: string | null;
}

const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const seconds = (from: Date, to: Date) => Math.max(0, (to.getTime() - from.getTime()) / 1000);
const round = (value: number | null, digits = 1) => (value === null ? null : Number(value.toFixed(digits)));

/**
 * CC-9 contact-center KPIs over the calls a department received (only calls that reached its queue
 * count as offered; calls closed in the IVR never reached an agent).
 * - ASA: queue entry → answer, answered calls only.
 * - AHT: talk time + average wrap-up time of the department's agents.
 * - Abandon rate: abandoned / offered.
 * - Service level: answered within `thresholdSeconds` / (answered + abandoned) — voicemails left
 *   after hours or after the maximum wait are neither.
 */
export function kpiSummary(calls: KpiCall[], wrapUpSeconds: number[], thresholdSeconds: number) {
  const offered = calls.filter((call) => call.queuedAt);
  const answered = offered.filter((call) => call.outcome === "answered" && call.answeredAt);
  const abandoned = offered.filter((call) => call.outcome === "abandoned");
  const waits = answered.map((call) => seconds(call.queuedAt!, call.answeredAt!));
  const talks = answered.filter((call) => call.endedAt).map((call) => seconds(call.answeredAt!, call.endedAt!));
  const talk = average(talks);
  const answeredFast = waits.filter((wait) => wait <= thresholdSeconds).length;

  const agents = new Map<string, { userId: string; displayName: string; answered: number; talkSeconds: number }>();
  for (const call of answered) {
    if (!call.agentUserId) continue;
    const row = agents.get(call.agentUserId) ?? { userId: call.agentUserId, displayName: call.agentName ?? "", answered: 0, talkSeconds: 0 };
    row.answered++;
    if (call.endedAt) row.talkSeconds += seconds(call.answeredAt!, call.endedAt);
    agents.set(call.agentUserId, row);
  }

  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, offered: 0, answered: 0 }));
  for (const call of offered) {
    const hour = Math.floor(localTime(call.startedAt).minute / 60);
    hourly[hour].offered++;
    if (call.outcome === "answered") hourly[hour].answered++;
  }

  return {
    offered: offered.length,
    answered: answered.length,
    abandoned: abandoned.length,
    voicemail: offered.filter((call) => call.outcome === "voicemail").length,
    asa: round(average(waits)),
    aht: talk === null ? null : round(talk + (average(wrapUpSeconds) ?? 0)),
    abandonRate: offered.length ? round(abandoned.length / offered.length, 4) : null,
    serviceLevel: answered.length + abandoned.length ? round(answeredFast / (answered.length + abandoned.length), 4) : null,
    agents: [...agents.values()]
      .map((row) => ({ ...row, talkSeconds: Math.round(row.talkSeconds), averageTalk: round(row.talkSeconds / row.answered) }))
      .sort((a, b) => b.answered - a.answered),
    hourly: hourly.filter((row) => row.offered),
  };
}

/** Start and end instants of a local (Asia/Ho_Chi_Minh) day range, inclusive of `to`. */
export function periodBounds(from: string, to: string) {
  const start = new Date(`${from}T00:00:00+07:00`);
  const end = new Date(`${to}T00:00:00+07:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}
