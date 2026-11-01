import assert from "node:assert/strict";
import { test } from "node:test";
process.env.JWT_SECRET ??= "signed-link-secret-at-least-32-characters";
const { signLink, verifyLink } = await import("../../../dist/api/shared/http/signed-link.js");

test("Recording links: bound to path and user, refused once expired or altered", () => {
  const path = "/api/callcenter/calls/0f8fad5b-d9cb-469f-a165-70867728950e/recording";
  const { url, expiresAt } = signLink(path, "user-1", 60);
  assert.ok(Date.parse(expiresAt) > Date.now());
  const params = new URL(url, "http://x").searchParams;
  assert.equal(verifyLink(path, params), "user-1");
  assert.equal(verifyLink(path.replace("0f8f", "1f8f"), params), null, "another recording");
  const otherUser = new URLSearchParams(params);
  otherUser.set("u", "user-2");
  assert.equal(verifyLink(path, otherUser), null, "another user");
  const later = new URLSearchParams(params);
  later.set("e", String(Number(params.get("e")) + 3600));
  assert.equal(verifyLink(path, later), null, "a stretched expiry");
  const expired = new URL(signLink(path, "user-1", -1).url, "http://x").searchParams;
  assert.equal(verifyLink(path, expired), null, "expired");
  assert.equal(verifyLink(path, new URLSearchParams()), null);
});
