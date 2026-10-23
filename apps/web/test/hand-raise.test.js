import assert from "node:assert/strict";
import test from "node:test";
import { handToastTitle, newAttention, raisedHandUserIds } from "../src/features/meetings/hand-raise.ts";

const participant = (userId, raisedHand, state = "admitted") => ({
  userId,
  displayName: userId,
  role: "member",
  state,
  raisedHand,
  connections: 1,
});

test("raised hands are keyed by user id and only count admitted participants", () => {
  const ids = raisedHandUserIds({
    participants: [
      participant("a", true),
      participant("b", false),
      participant("c", true, "waiting"),
      participant("d", true, "kicked"),
    ],
  });
  assert.deepEqual([...ids], ["a"]);
  assert.equal(raisedHandUserIds(null).size, 0);
});

test("hand toast fires only on a real change of the local hand", () => {
  assert.equal(handToastTitle(false, true), "Bạn đã giơ tay");
  assert.equal(handToastTitle(true, false), "Đã hạ tay");
  assert.equal(handToastTitle(true, true), null);
  assert.equal(handToastTitle(false, false), null);
  // First state after joining or reconnecting, and leaving the call, stay silent.
  assert.equal(handToastTitle(undefined, true), null);
  assert.equal(handToastTitle(undefined, false), null);
  assert.equal(handToastTitle(true, undefined), null);
});

test("toasts only for people who just started waiting or just raised a hand", () => {
  const state = (...participants) => ({ id: "s1", participants });
  const before = state(participant("me", false), participant("a", false), participant("w", false, "waiting"));
  const after = state(
    participant("me", true),
    participant("a", true),
    participant("w", false, "waiting"),
    participant("n", false, "waiting"),
  );
  const { waiting, hands } = newAttention(before, after, "me");
  assert.deepEqual(waiting.map((p) => p.userId), ["n"]);
  assert.deepEqual(hands.map((p) => p.userId), ["a"]);
  assert.deepEqual(newAttention(null, after, "me"), { waiting: [], hands: [] });
  assert.deepEqual(newAttention({ ...before, id: "old" }, after, "me"), { waiting: [], hands: [] });
});
