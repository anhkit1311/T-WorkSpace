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
