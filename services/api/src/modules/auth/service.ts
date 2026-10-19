import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { AuthResponse, AuthUser, GoogleAuthInput } from "@doan/shared";
import { config } from "../../config/config.js";
import { query, withTransaction } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";
import { findOrCreateGoogleUser, verifyGoogleAuth } from "./google.js";
import { resendOtp, verifyOtp } from "./otp.js";
import { verifyPassword } from "./password.js";
import {
  createAccessToken,
  createRefreshToken,
  hashRefreshToken,
  verifyAccessToken,
} from "./tokens.js";

type SessionMetadata = { ipAddress?: string; userAgent?: string };
type AuthResult = AuthResponse & { refreshToken: string };

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  password_hash: string | null;
  google_id?: string | null;
  auth_provider?: string;
  email_verified?: boolean;
  avatar_url?: string | null;
  bio?: string;
  cover_url?: string | null;
  contact_text?: string;
  status_text?: string;
  pronouns?: string;
  location?: string;
  interests?: string[];
  favorite_music?: string;
  profile_visibility?: "workspace" | "private";
  show_activity?: boolean;
  show_contact?: boolean;
  notifications_enabled?: boolean;
};

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "INVALID_EMAIL", "Email không hợp lệ.");
  const email = value.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "INVALID_EMAIL", "Email không hợp lệ.");
  }
  return email;
}

function validatePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new HttpError(400, "INVALID_PASSWORD", "Mật khẩu phải có từ 8 đến 128 ký tự.");
  }
  return value;
}

export function validateDisplayName(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_DISPLAY_NAME", "Tên hiển thị không hợp lệ.");
  }
  const displayName = value.trim();
  if (displayName.length < 2 || displayName.length > 80) {
    throw new HttpError(400, "INVALID_DISPLAY_NAME", "Tên hiển thị phải có từ 2 đến 80 ký tự.");
  }
  return displayName;
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? null,
    bio: row.bio ?? "",
    coverUrl: row.cover_url ?? null,
    contactText: row.contact_text ?? "",
    statusText: row.status_text ?? "",
    pronouns: row.pronouns ?? "",
    location: row.location ?? "",
    interests: row.interests ?? [],
    favoriteMusic: row.favorite_music ?? "",
    profileVisibility: row.profile_visibility ?? "workspace",
    showActivity: row.show_activity ?? true,
    showContact: row.show_contact ?? false,
    notificationsEnabled: row.notifications_enabled ?? true,
    authProvider: (row.auth_provider as "local" | "google") ?? "local",
    emailVerified: row.email_verified ?? false,
  };
}

async function createSession(
  client: PoolClient,
  userId: string,
  metadata: SessionMetadata,
): Promise<string> {
  const refreshToken = createRefreshToken();
  const expiresAt = new Date(Date.now() + config.refreshSessionDays * 24 * 60 * 60 * 1000);
  await client.query(
    `INSERT INTO refresh_sessions
      (id, user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      randomUUID(),
      userId,
      hashRefreshToken(refreshToken),
      expiresAt,
      metadata.userAgent?.slice(0, 500),
      metadata.ipAddress?.slice(0, 64),
    ],
  );
  return refreshToken;
}

async function createAuthResult(user: AuthUser, refreshToken: string): Promise<AuthResult> {
  return { user, accessToken: await createAccessToken(user.id), refreshToken };
}

export async function login(
  input: { email?: unknown; password?: unknown },
  metadata: SessionMetadata,
): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  const password = validatePassword(input.password);
  const result = await query<UserRow>(
    `SELECT id, email, display_name, password_hash, auth_provider, email_verified, avatar_url, bio, cover_url, contact_text, status_text, pronouns, location, interests, favorite_music, profile_visibility, show_activity, show_contact, notifications_enabled FROM users WHERE email = $1`,
    [email],
  );
  const user = result.rows[0];
  if (!user) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng.");
  }

  if (!user.password_hash && user.auth_provider === "google") {
    throw new HttpError(
      400,
      "USE_GOOGLE_LOGIN",
      "Tài khoản này được đăng ký bằng Google. Vui lòng chọn Đăng nhập với Google.",
    );
  }

  if (!user.email_verified) {
    throw new HttpError(
      403,
      "EMAIL_NOT_VERIFIED",
      "Tài khoản chưa được kích hoạt. Vui lòng xác thực mã OTP gửi về email của bạn.",
    );
  }

  if (!user.password_hash || !(await verifyPassword(password, user.password_hash))) {
    throw new HttpError(401, "INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng.");
  }

  const refreshToken = await withTransaction((client) => createSession(client, user.id, metadata));
  return createAuthResult(toAuthUser(user), refreshToken);
}

export async function verifyOtpAndLogin(
  input: { email?: unknown; otp?: unknown },
  metadata: SessionMetadata,
): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  if (typeof input.otp !== "string") {
    throw new HttpError(400, "INVALID_OTP", "Mã OTP không hợp lệ.");
  }

  await verifyOtp(email, input.otp);

  const result = await query<UserRow>(
    `SELECT id, email, display_name, password_hash, auth_provider, email_verified, avatar_url, bio, cover_url, contact_text, status_text, pronouns, location, interests, favorite_music, profile_visibility, show_activity, show_contact, notifications_enabled FROM users WHERE email = $1`,
    [email],
  );
  const user = result.rows[0];
  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "Người dùng không còn tồn tại.");
  }

  const refreshToken = await withTransaction((client) => createSession(client, user.id, metadata));
  return createAuthResult(toAuthUser(user), refreshToken);
}

export async function resendVerificationOtp(input: {
  email?: unknown;
}): Promise<{ success: boolean; message: string; cooldownSeconds: number }> {
  const email = normalizeEmail(input.email);
  return resendOtp(email);
}

export async function authenticateWithGoogle(
  input: GoogleAuthInput,
  metadata: SessionMetadata,
): Promise<AuthResult | { requireOtp: boolean; email: string; message: string }> {
  const googleData = await verifyGoogleAuth(input);
  const userRecord = await findOrCreateGoogleUser(googleData);

  if (userRecord.requireOtp) {
    return {
      requireOtp: true,
      email: userRecord.email,
      message: "Mã xác thực OTP đã được gửi về email Google của bạn.",
    };
  }

  const profile = await query<UserRow>(
    `SELECT id, email, display_name, password_hash, auth_provider, email_verified, avatar_url, bio, cover_url, contact_text, status_text, pronouns, location, interests, favorite_music, profile_visibility, show_activity, show_contact, notifications_enabled FROM users WHERE id = $1`,
    [userRecord.id],
  );
  const authUser = toAuthUser(profile.rows[0]);

  const refreshToken = await withTransaction((client) =>
    createSession(client, userRecord.id, metadata),
  );
  return createAuthResult(authUser, refreshToken);
}

export async function refreshSession(
  currentToken: string,
  metadata: SessionMetadata,
): Promise<AuthResult> {
  return withTransaction(async (client) => {
    const result = await client.query<UserRow>(
      `SELECT u.id, u.email, u.display_name, u.password_hash, u.auth_provider, u.email_verified, u.avatar_url, u.bio, u.cover_url, u.contact_text, u.status_text, u.pronouns, u.location, u.interests, u.favorite_music, u.profile_visibility, u.show_activity, u.show_contact, u.notifications_enabled
       FROM refresh_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
       FOR UPDATE OF s`,
      [hashRefreshToken(currentToken)],
    );
    const user = result.rows[0];
    if (!user) throw new HttpError(401, "INVALID_SESSION", "Phiên đăng nhập không hợp lệ.");

    await client.query(
      `UPDATE refresh_sessions SET revoked_at = now(), last_used_at = now() WHERE token_hash = $1`,
      [hashRefreshToken(currentToken)],
    );
    const refreshToken = await createSession(client, user.id, metadata);
    return createAuthResult(toAuthUser(user), refreshToken);
  });
}

export async function logout(currentToken: string | undefined): Promise<void> {
  if (!currentToken) return;
  await query(`UPDATE refresh_sessions SET revoked_at = now() WHERE token_hash = $1`, [
    hashRefreshToken(currentToken),
  ]);
}

export async function getCurrentUser(accessToken: string): Promise<AuthUser> {
  let userId: string;
  try {
    userId = await verifyAccessToken(accessToken);
  } catch {
    throw new HttpError(401, "INVALID_TOKEN", "Access token không hợp lệ hoặc đã hết hạn.");
  }
  const result = await query<UserRow>(
    `SELECT id, email, display_name, password_hash, auth_provider, email_verified, avatar_url, bio, cover_url, contact_text, status_text, pronouns, location, interests, favorite_music, profile_visibility, show_activity, show_contact, notifications_enabled FROM users WHERE id = $1`,
    [userId],
  );
  const user = result.rows[0];
  if (!user) throw new HttpError(401, "INVALID_TOKEN", "Người dùng không còn tồn tại.");
  return toAuthUser(user);
}
