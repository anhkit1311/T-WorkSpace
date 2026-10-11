import assert from "node:assert/strict";
import test from "node:test";
import { hostActionToast } from "../src/features/meetings/host-action-toast.ts";

test("host actions on a participant confirm with the participant's name", () => {
  assert.equal(hostActionToast("mute", "An"), "Đã tắt mic của An");
  assert.equal(hostActionToast("kick", "An"), "Đã loại An khỏi phiên");
  assert.equal(hostActionToast("cohost", "An", true), "Đã đặt An làm co-host");
  assert.equal(hostActionToast("cohost", "An", false), "Đã bỏ co-host của An");
  assert.equal(hostActionToast("transfer", "An"), "Đã chuyển quyền host cho An");
});

test("room-level actions and unknown targets add no toast", () => {
  for (const action of ["hand", "waiting", "lock", "admit", "end"])
    assert.equal(hostActionToast(action, "An", true), null);
  assert.equal(hostActionToast("mute", undefined), null);
});
