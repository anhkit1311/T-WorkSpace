import assert from "node:assert/strict";
import test from "node:test";
import { authErrorField } from "../src/features/auth/auth-error-field.ts";

const apiError = (code) => Object.assign(new Error("x"), { code, statusCode: 400 });

test("code errors belong to the OTP field, password errors to the password field", () => {
  assert.equal(authErrorField(apiError("INVALID_OTP")), "otp");
  assert.equal(authErrorField(apiError("OTP_EXPIRED")), "otp");
  assert.equal(authErrorField(apiError("INVALID_PASSWORD")), "password");
});

test("network, rate limit and unknown errors go to the single banner", () => {
  assert.equal(authErrorField(apiError("RATE_LIMITED")), "general");
  assert.equal(authErrorField(apiError("EMAIL_UNAVAILABLE")), "general");
  assert.equal(authErrorField(new TypeError("Failed to fetch")), "general");
  assert.equal(authErrorField(null), "general");
  assert.equal(authErrorField("boom"), "general");
});
