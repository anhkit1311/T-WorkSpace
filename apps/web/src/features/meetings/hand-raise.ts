import type { MeetingState } from "@doan/shared";

/** User ids of admitted participants whose hand is currently raised. */
export function raisedHandUserIds(state: MeetingState | null): Set<string> {
  return new Set(
    state?.participants
      .filter((participant) => participant.state === "admitted" && participant.raisedHand)
      .map((participant) => participant.userId) ?? [],
  );
}

/**
 * Toast title for a change of the local user's own hand, or null when nothing changed.
 * `undefined` means the state is not loaded yet (joining, reconnecting or after leaving),
 * so the first known value never produces a toast.
 */
export function handToastTitle(
  previous: boolean | undefined,
  next: boolean | undefined,
): string | null {
  if (previous === undefined || next === undefined || previous === next) return null;
  return next ? "Bạn đã giơ tay" : "Đã hạ tay";
}

/**
 * People who started waiting or raised a hand since the previous state, for the corner toasts.
 * The first state after joining is not compared, so joining never floods toasts.
 */
export function newAttention(
  previous: MeetingState | null,
  next: MeetingState | null,
  selfId: string | undefined,
): { waiting: MeetingState["participants"]; hands: MeetingState["participants"] } {
  if (!previous || !next || previous.id !== next.id) return { waiting: [], hands: [] };
  const before = new Map(previous.participants.map((p) => [p.userId, p]));
  const others = next.participants.filter((p) => p.userId !== selfId);
  return {
    waiting: others.filter((p) => p.state === "waiting" && before.get(p.userId)?.state !== "waiting"),
    hands: others.filter((p) => p.state === "admitted" && p.raisedHand && !before.get(p.userId)?.raisedHand),
  };
}
