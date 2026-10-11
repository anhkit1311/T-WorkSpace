import assert from "node:assert/strict";
import test from "node:test";
import { callDropMessage } from "../src/features/meetings/call-drop.ts";

test("a dropped call explains why in Vietnamese and how to get back", () => {
  assert.match(callDropMessage("io server disconnect"), /Máy chủ đã ngắt kết nối/);
  assert.match(callDropMessage("replaced"), /làm mới/);
  assert.equal(callDropMessage("io client disconnect"), callDropMessage("replaced"));
  for (const reason of ["transport close", "ping timeout", "transport error", "anything"])
    assert.match(callDropMessage(reason), /Mất kết nối mạng/);
  for (const reason of ["io server disconnect", "replaced", "ping timeout"])
    assert.match(callDropMessage(reason), /Vào lại phòng để tiếp tục\.$/);
});
