import { test } from "node:test";
import assert from "node:assert/strict";
import { initialsOf } from "../src/shared/lib/initials.ts";

test("initials: first and last word, skipping words that start with a symbol", () => {
  assert.equal(initialsOf("Nguyễn Văn An"), "NA");
  assert.equal(initialsOf("Phòng Giáo vụ khoa CNTT"), "PC");
  assert.equal(initialsOf("Lê Minh Tuấn (test)"), "LT");
  assert.equal(initialsOf("Phạm Thu Trang - Giáo vụ"), "PV");
  assert.equal(initialsOf("an"), "A");
  assert.equal(initialsOf("  "), "");
});
