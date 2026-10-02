import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "../../../dist/api/modules/auth/password.js";
import {
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
  verifyAccessToken,
} from "../../../dist/api/modules/auth/tokens.js";
import { generateNumericOtp, hashOtp } from "../../../dist/api/modules/auth/otp.js";
import { hashPasswordResetOtp } from "../../../dist/api/modules/auth/password-reset.js";
import { sendOtpEmail } from "../../../dist/api/infrastructure/email/service.js";
import { config } from "../../../dist/api/config/config.js";

process.env.JWT_SECRET = "test-secret-with-at-least-thirty-two-characters";

test("passwords are salted, hashed and verified", async () => {
  const first = await hashPassword("ValidPass123!");
  const second = await hashPassword("ValidPass123!");

  assert.notEqual(first, second);
  assert.equal(await verifyPassword("ValidPass123!", first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
  assert.equal(await verifyPassword("ValidPass123!", "invalid"), false);
});

test("access tokens preserve the authenticated user id", async () => {
  const userId = "8ea0ed95-c77a-45fc-ac41-a16248e1d670";
  const token = await createAccessToken(userId);
  assert.equal(await verifyAccessToken(token), userId);
});

test("refresh tokens are random and only stored as hashes", () => {
  const first = createRefreshToken();
  const second = createRefreshToken();

  assert.notEqual(first, second);
  assert.match(hashRefreshToken(first), /^[a-f0-9]{64}$/);
  assert.notEqual(hashRefreshToken(first), first);
});

test("numeric OTPs are 6-digit strings and OTP hash is consistent", () => {
  const otp = generateNumericOtp(6);
  assert.equal(otp.length, 6);
  assert.match(otp, /^\d{6}$/);

  const hash1 = hashOtp("user@example.com", "123456");
  const hash2 = hashOtp("USER@EXAMPLE.COM ", "123456");
  const hash3 = hashOtp("user@example.com", "654321");

  assert.equal(hash1, hash2);
  assert.notEqual(hash1, hash3);
  assert.match(hash1, /^[a-f0-9]{64}$/);
});

test("password reset OTP is isolated from account verification OTP", () => {
  const email = "user@example.com";
  const otp = "123456";
  assert.equal(hashPasswordResetOtp(email, otp), hashPasswordResetOtp(email, otp));
  assert.notEqual(hashPasswordResetOtp(email, otp), hashOtp(email, otp));
});

test("OTP delivery fails closed when no email provider is configured", async () => {
  const original = { resendApiKey: config.resendApiKey, smtpHost: config.smtpHost };
  config.resendApiKey = undefined;
  config.smtpHost = undefined;
  try {
    await assert.rejects(
      sendOtpEmail({ to: "user@example.test", otp: "123456", displayName: "Tester" }),
      /OTP email delivery failed/,
    );
  } finally {
    config.resendApiKey = original.resendApiKey;
    config.smtpHost = original.smtpHost;
  }
});
