import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveGoogleAvatar } from "../../../dist/api/modules/auth/google.js";

const google = "https://lh3.googleusercontent.com/a/new-photo=s96-c";
const oldGoogle = "https://lh3.googleusercontent.com/a/old-photo=s96-c";
const uploaded = "data:image/png;base64,iVBORw0KGgo=";

test("Google sign-in keeps an avatar the user uploaded", () => {
  assert.equal(resolveGoogleAvatar(uploaded, google), uploaded);
  assert.equal(resolveGoogleAvatar("https://example.com/me.png", google), "https://example.com/me.png");
});

test("Google sign-in fills or refreshes only Google-provided avatars", () => {
  assert.equal(resolveGoogleAvatar(null, google), google);
  assert.equal(resolveGoogleAvatar(oldGoogle, google), google);
  assert.equal(resolveGoogleAvatar(uploaded, undefined), uploaded);
  assert.equal(resolveGoogleAvatar(null, null), null);
});
