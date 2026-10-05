import assert from "node:assert/strict";
import test from "node:test";
import { LATEST_THRESHOLD, isAtLatest, jumpToLatestLabel } from "../src/features/chat/jump-latest.ts";

test("the latest page is the bottom of the live list, never a context window", () => {
  assert.equal(isAtLatest({ inContext: false, distanceFromBottom: 0 }), true);
  assert.equal(isAtLatest({ inContext: false, distanceFromBottom: LATEST_THRESHOLD }), true);
  assert.equal(isAtLatest({ inContext: false, distanceFromBottom: LATEST_THRESHOLD + 1 }), false);
  assert.equal(isAtLatest({ inContext: false, distanceFromBottom: 2400 }), false);
  // A search hit or pinned-message window is not the latest even at its own bottom.
  assert.equal(isAtLatest({ inContext: true, distanceFromBottom: 0 }), false);
  assert.equal(isAtLatest({ inContext: false, distanceFromBottom: 40, threshold: 20 }), false);
});

test("jump label announces how many messages arrived meanwhile", () => {
  assert.equal(jumpToLatestLabel(0), "Xuống tin mới nhất");
  assert.equal(jumpToLatestLabel(3), "Xuống tin mới nhất (3 tin mới)");
  assert.equal(jumpToLatestLabel(250), "Xuống tin mới nhất (99+ tin mới)");
});
