import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyLayerPolicy,
  isLayerPolicy,
  spotlightDelay,
  QUIET_AFTER_MS,
} from "../src/features/meetings/speaker-policy.ts";

const now = 100_000;

test("visible policy keeps the tile-size layers untouched", () => {
  const base = { a: 2, b: 0, c: null };
  assert.deepEqual(applyLayerPolicy(base, "visible", "b", {}, now), base);
});

test("speaker policy gives the full layer to the speaker only and keeps off-page paused", () => {
  assert.deepEqual(applyLayerPolicy({ a: 1, b: 1, c: null }, "speaker", "b", {}, now), {
    a: 0,
    b: 2,
    c: null,
  });
});

test("combined policy raises a small speaker tile to the middle layer", () => {
  assert.deepEqual(applyLayerPolicy({ a: 0, b: 0 }, "combined", "a", {}, now), { a: 1, b: 0 });
  assert.deepEqual(applyLayerPolicy({ a: 2 }, "combined", "a", {}, now).a, 2);
});

test("combined policy lowers quiet tiles only in crowded grids", () => {
  const base = Object.fromEntries(["a", "b", "c", "d", "e", "f", "g"].map((id) => [id, 1]));
  const spoke = { b: now - 1_000, c: now - QUIET_AFTER_MS - 1 };
  const crowded = applyLayerPolicy(base, "combined", "a", spoke, now);
  assert.equal(crowded.a, 1, "speaker keeps its layer");
  assert.equal(crowded.b, 1, "recent speaker keeps its layer");
  assert.equal(crowded.c, 0, "quiet tile drops one layer");
  assert.equal(crowded.g, 0, "never-spoken tile drops one layer");
  const small = applyLayerPolicy({ b: 1, c: 1 }, "combined", null, {}, now);
  assert.deepEqual(small, { b: 1, c: 1 });
});

test("spotlight switches immediately when empty and waits out the hold otherwise", () => {
  assert.equal(spotlightDelay(null, "a", 0, now), 0);
  assert.equal(spotlightDelay("a", "a", 0, now), null);
  assert.equal(spotlightDelay("a", null, 0, now), null);
  assert.equal(spotlightDelay("a", "b", now - 500, now), 1_500);
  assert.equal(spotlightDelay("a", "b", now - 5_000, now), 0);
});

test("policy names are validated", () => {
  assert.equal(isLayerPolicy("combined"), true);
  assert.equal(isLayerPolicy("lastN"), false);
});
