import "./env.js";

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const config = {
  mediaWorkers: readPositiveInteger("MEDIASOUP_WORKERS", 2),
  dbPoolMax: readPositiveInteger("DB_POOL_MAX", 10),
  fileQuotaBytes: readPositiveInteger("WORKSPACE_FILE_QUOTA_BYTES", 536870912),
  userFileQuotaBytes: readPositiveInteger("USER_FILE_QUOTA_BYTES", 134217728),
  meetingMaxUsers: readPositiveInteger("MEETING_MAX_USERS", 20),
  meetingMaxTabs: readPositiveInteger("MEETING_MAX_TABS_PER_USER", 2),
  meetingMaxSources: readPositiveInteger("MEETING_MAX_SOURCES_PER_PEER", 3),
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://workspace:workspace@localhost:5432/realtime_workspace",
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? "15m",
  refreshSessionDays: readPositiveInteger("REFRESH_SESSION_DAYS", 30),
  isProduction: process.env.NODE_ENV === "production",
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  requireGoogleOtp: process.env.REQUIRE_GOOGLE_OTP === "true",
  smtpHost: process.env.SMTP_HOST,
  smtpPort: readPositiveInteger("SMTP_PORT", 587),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  smtpFrom: process.env.SMTP_FROM ?? "CollabSpace <no-reply@collabspace.vn>",
  resendApiKey: process.env.RESEND_API_KEY,
  otpExpirationMinutes: readPositiveInteger("OTP_EXPIRATION_MINUTES", 10),
  otpMaxAttempts: readPositiveInteger("OTP_MAX_ATTEMPTS", 5),
  otpResendCooldownSeconds: readPositiveInteger("OTP_RESEND_COOLDOWN_SECONDS", 60),
  otpMaxResends: readPositiveInteger("OTP_MAX_RESENDS", 5),
};

export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}
