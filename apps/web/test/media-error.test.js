import assert from "node:assert/strict";
import test from "node:test";
import {
  isScreenPickerCancel,
  mapMediaError,
  mediaErrorTitle,
} from "../src/features/meetings/webrtc/local-media.ts";

const domError = (name, message = "Permission denied") => new DOMException(message, name);

test("media errors map to Vietnamese guidance by error name", () => {
  const blocked = mapMediaError(domError("NotAllowedError"));
  assert.match(blocked, /ổ khóa/);
  assert.equal(mapMediaError(domError("PermissionDeniedError")), blocked);
  assert.equal(mapMediaError(domError("NotFoundError")), "Không tìm thấy thiết bị.");
  assert.equal(mapMediaError(domError("DevicesNotFoundError")), "Không tìm thấy thiết bị.");
  assert.equal(
    mapMediaError(domError("NotReadableError")),
    "Thiết bị đang được ứng dụng khác sử dụng.",
  );
  assert.equal(
    mapMediaError(domError("TrackStartError")),
    "Thiết bị đang được ứng dụng khác sử dụng.",
  );
  assert.equal(
    mapMediaError(domError("OverconstrainedError")),
    "Thiết bị đã chọn không còn khả dụng.",
  );
  const fallback = mapMediaError(new Error("produce() failed"));
  assert.doesNotMatch(fallback, /produce|failed|Permission/);
  assert.equal(mapMediaError("boom"), fallback);
});

test("titles name the device and the direction", () => {
  assert.equal(mediaErrorTitle("mic"), "Không bật được micro");
  assert.equal(mediaErrorTitle("webcam"), "Không bật được camera");
  assert.equal(mediaErrorTitle("mic", false), "Không tắt được micro");
  assert.equal(mediaErrorTitle("screen"), "Không chia sẻ được màn hình");
});

test("closing the screen picker is not an error, an OS block is", () => {
  assert.equal(isScreenPickerCancel(domError("NotAllowedError")), true);
  assert.equal(isScreenPickerCancel(domError("AbortError", "aborted")), true);
  assert.equal(isScreenPickerCancel(domError("NotAllowedError", "Permission denied by system")), false);
  assert.equal(isScreenPickerCancel(domError("NotReadableError")), false);
  assert.equal(isScreenPickerCancel(null), false);
});
