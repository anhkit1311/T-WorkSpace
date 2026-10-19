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
  // Keep a configured/verified sender address; only normalize the old brand's display name.
  smtpFrom: (process.env.SMTP_FROM ?? "nexo <no-reply@collabspace.vn>").replace(
    /^Colla[bp]Space(?=\s*<)/i,
    "nexo",
  ),
  resendApiKey: process.env.RESEND_API_KEY,
  otpExpirationMinutes: readPositiveInteger("OTP_EXPIRATION_MINUTES", 10),
  otpMaxAttempts: readPositiveInteger("OTP_MAX_ATTEMPTS", 5),
  otpResendCooldownSeconds: readPositiveInteger("OTP_RESEND_COOLDOWN_SECONDS", 60),
  otpMaxResends: readPositiveInteger("OTP_MAX_RESENDS", 5),
  // MT-1 / EL-3: FFmpeg for recordings and video lessons. FFMPEG_COMMAND may be a prefix such as
  // "docker exec -i -w /work nexo-ffmpeg ffmpeg"; FFmpeg always runs with cwd = mediaDir and
  // relative paths, so the same arguments work inside a container that mounts mediaDir at /work.
  ffmpegCommand: process.env.FFMPEG_COMMAND ?? "ffmpeg",
  mediaDir: process.env.MEDIA_DIR ?? "data/media",
  recordingRtpMinPort: readPositiveInteger("RECORDING_RTP_MIN_PORT", 30000),
  recordingRtpMaxPort: readPositiveInteger("RECORDING_RTP_MAX_PORT", 30199),
  // M1 phone dial-in: how FFmpeg reaches the SFU, and how Asterisk reaches FFmpeg (dev, in
  // containers: host.docker.internal and the "ffmpeg" service; one host in production).
  phoneSfuHost: process.env.PHONE_SFU_HOST ?? "127.0.0.1",
  phoneMediaHost: process.env.PHONE_MEDIA_HOST ?? "127.0.0.1",
  meetingDialInNumber: process.env.MEETING_DIALIN_NUMBER ?? "7000",
  // M3: OpenAI-compatible speech-to-text (/v1/audio/transcriptions); empty turns captions off.
  transcribeUrl: process.env.TRANSCRIBE_URL ?? "",
  transcribeApiKey: process.env.TRANSCRIBE_API_KEY ?? "",
  transcribeModel: process.env.TRANSCRIBE_MODEL ?? "whisper-1",
  transcribeLanguage: process.env.TRANSCRIBE_LANGUAGE ?? "vi",
};

export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }
  return new TextEncoder().encode(secret);
}
