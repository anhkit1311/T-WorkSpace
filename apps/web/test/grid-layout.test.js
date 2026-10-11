import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestGridLayout,
  layerForTile,
  pageSizeFor,
  paginate,
} from "../src/features/meetings/grid-layout.ts";

test("grid picks the column count with the largest 16:9 tile", () => {
  assert.equal(bestGridLayout(1, 1600, 700).columns, 1);
  assert.equal(bestGridLayout(2, 1600, 700).columns, 2);
  assert.equal(bestGridLayout(4, 1600, 700).columns, 2);
  assert.equal(bestGridLayout(6, 1600, 700).columns, 3);
  assert.equal(bestGridLayout(9, 1600, 700).columns, 3);
  // In a squarer area, stacking two tiles yields the larger tile (611px vs 594px).
  assert.equal(bestGridLayout(2, 1200, 700).columns, 1);
  // Tall, narrow container stacks tiles vertically.
  assert.equal(bestGridLayout(3, 400, 1200).columns, 1);
  const layout = bestGridLayout(4, 1212, 700, 12);
  assert.ok(Math.abs(layout.tileWidth / layout.tileHeight - 16 / 9) < 1e-9);
  assert.ok(layout.tileWidth * 2 + 12 <= 1212 + 1e-9);
  assert.ok(layout.tileHeight * 2 + 12 <= 700 + 1e-9);
});

test("pagination clamps the page and sizes pages by viewport", () => {
  assert.equal(pageSizeFor(375), 4);
  assert.equal(pageSizeFor(900), 6);
  assert.equal(pageSizeFor(1440), 9);
  const items = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(paginate(items, 4, 0), { page: 0, pageCount: 3, items: [0, 1, 2, 3] });
  assert.deepEqual(paginate(items, 4, 2).items, [8, 9]);
  assert.equal(paginate(items, 4, 7).page, 2);
  assert.equal(paginate([], 4, 3).pageCount, 1);
});

test("simulcast layer follows rendered tile size in device pixels", () => {
  assert.equal(layerForTile(0), null);
  assert.equal(layerForTile(200), 0);
  assert.equal(layerForTile(340), 1);
  assert.equal(layerForTile(340, 2), 2);
  assert.equal(layerForTile(800), 2);
});
