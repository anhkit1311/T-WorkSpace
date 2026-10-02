import { randomUUID } from "node:crypto";
import type { GoogleAuthInput } from "@doan/shared";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { config } from "../../config/config.js";
import { withTransaction } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";
import { createAndSendOtp } from "./otp.js";

interface GoogleTokenInfo extends JWTPayload {
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  picture?: string;
}

interface GoogleUserPayload {
  googleId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  emailVerified: boolean;
}

const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), {
  cooldownDuration: 300_000,
  timeoutDuration: 10_000,
});

async function verifyGoogleIdToken(token: string): Promise<GoogleTokenInfo> {
  if (!config.googleClientId) {
    throw new HttpError(503, "GOOGLE_NOT_CONFIGURED", "Đăng nhập Google chưa được cấu hình.");
  }
  try {
    const { payload } = await jwtVerify(token, googleJwks, {
      audience: config.googleClientId,
      issuer: ["accounts.google.com", "https://accounts.google.com"],
    });
    return payload as GoogleTokenInfo;
  } catch {
    throw new HttpError(
      401,
      "INVALID_GOOGLE_TOKEN",
      "Phiên đăng nhập Google không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.",
    );
  }
}

export async function verifyGoogleAuth(input: GoogleAuthInput): Promise<GoogleUserPayload> {
  let payload: GoogleTokenInfo | null = null;

  const token = input.credential || input.idToken;

  if (token) {
    payload = await verifyGoogleIdToken(token);
  }
  // 2. Nếu client gửi Authorization Code
  else if (input.code) {
    if (!config.googleClientId || !config.googleClientSecret) {
      throw new HttpError(
        500,
        "GOOGLE_NOT_CONFIGURED",
        "Máy chủ chưa được cấu hình GOOGLE_CLIENT_ID hoặc GOOGLE_CLIENT_SECRET.",
      );
    }
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: input.redirectUri || "postmessage",
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      console.warn(`[GOOGLE AUTH] Token exchange failed with status ${tokenRes.status}`);
      throw new HttpError(
        401,
        "INVALID_GOOGLE_CODE",
        "Không thể xác thực mã Google authorization code.",
      );
    }

    const tokenData = (await tokenRes.json()) as { id_token?: string };
    if (!tokenData.id_token) {
      throw new HttpError(401, "MISSING_ID_TOKEN", "Google không trả về id_token.");
    }

    payload = await verifyGoogleIdToken(tokenData.id_token);
  } else {
    throw new HttpError(400, "MISSING_GOOGLE_CREDENTIAL", "Vui lòng cung cấp mã xác thực Google.");
  }

  if (!payload || !payload.sub || !payload.email) {
    throw new HttpError(
      401,
      "INVALID_GOOGLE_PAYLOAD",
      "Dữ liệu người dùng từ Google không hợp lệ.",
    );
  }

  const isVerified = payload.email_verified === "true" || payload.email_verified === true;
  if (!isVerified) {
    throw new HttpError(
      403,
      "GOOGLE_EMAIL_NOT_VERIFIED",
      "Google chưa xác minh địa chỉ email của tài khoản này.",
    );
  }

  return {
    googleId: payload.sub,
    email: payload.email.trim().toLowerCase(),
    displayName: payload.name || payload.email.split("@")[0],
    avatarUrl: payload.picture,
    emailVerified: isVerified,
  };
}

interface GoogleAuthUserRecord {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  authProvider: string;
  emailVerified: boolean;
  requireOtp: boolean;
}

export async function findOrCreateGoogleUser(
  googleData: GoogleUserPayload,
): Promise<GoogleAuthUserRecord> {
  const { googleId, email, displayName, avatarUrl, emailVerified } = googleData;
  const resolvedDisplayName = (displayName?.trim() || email.split("@")[0] || "Người dùng").slice(
    0,
    80,
  );

  return withTransaction(async (client) => {
    // 1. Tìm user đã liên kết google_id trước đó
    const byGoogleId = await client.query<{
      id: string;
      email: string;
      display_name: string;
      avatar_url: string | null;
      auth_provider: string;
      email_verified: boolean;
    }>(
      `SELECT id, email, display_name, avatar_url, auth_provider, email_verified
       FROM users WHERE google_id = $1`,
      [googleId],
    );

    if (byGoogleId.rows[0]) {
      const u = byGoogleId.rows[0];
      // Cập nhật avatar nếu có
      if (avatarUrl && avatarUrl !== u.avatar_url) {
        await client.query(`UPDATE users SET avatar_url = $1, updated_at = now() WHERE id = $2`, [
          avatarUrl,
          u.id,
        ]);
      }

      if (config.requireGoogleOtp && !u.email_verified) {
        await createAndSendOtp(u.email, u.display_name);
        return {
          id: u.id,
          email: u.email,
          displayName: u.display_name,
          avatarUrl: avatarUrl || u.avatar_url,
          authProvider: u.auth_provider,
          emailVerified: false,
          requireOtp: true,
        };
      }

      return {
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        avatarUrl: avatarUrl || u.avatar_url,
        authProvider: u.auth_provider,
        emailVerified: true,
        requireOtp: false,
      };
    }

    // 2. Tìm user theo email đã tồn tại (liên kết tài khoản)
    const byEmail = await client.query<{
      id: string;
      email: string;
      display_name: string;
      avatar_url: string | null;
      auth_provider: string;
      email_verified: boolean;
    }>(
      `SELECT id, email, display_name, avatar_url, auth_provider, email_verified
       FROM users WHERE email = $1`,
      [email],
    );

    if (byEmail.rows[0]) {
      const u = byEmail.rows[0];
      // Liên kết google_id và kích hoạt email nếu Google đã xác minh
      await client.query(
        `UPDATE users
         SET google_id = $1,
             email_verified = CASE WHEN $2 THEN true ELSE email_verified END,
             avatar_url = COALESCE(avatar_url, $3),
             updated_at = now()
         WHERE id = $4`,
        [googleId, emailVerified, avatarUrl, u.id],
      );

      if (config.requireGoogleOtp && !emailVerified) {
        await createAndSendOtp(u.email, u.display_name);
        return {
          id: u.id,
          email: u.email,
          displayName: u.display_name,
          avatarUrl: avatarUrl || u.avatar_url,
          authProvider: u.auth_provider,
          emailVerified: false,
          requireOtp: true,
        };
      }

      return {
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        avatarUrl: avatarUrl || u.avatar_url,
        authProvider: u.auth_provider,
        emailVerified: true,
        requireOtp: false,
      };
    }

    // 3. Người dùng hoàn toàn mới -> Tự động tạo tài khoản
    const newUserId = randomUUID();
    await client.query(
      `INSERT INTO users (id, email, password_hash, display_name, google_id, auth_provider, email_verified, avatar_url)
       VALUES ($1, $2, NULL, $3, $4, 'google', $5, $6)`,
      [
        newUserId,
        email,
        resolvedDisplayName,
        googleId,
        emailVerified && !config.requireGoogleOtp,
        avatarUrl,
      ],
    );

    if (config.requireGoogleOtp && !emailVerified) {
      await createAndSendOtp(email, resolvedDisplayName);
      return {
        id: newUserId,
        email,
        displayName: resolvedDisplayName,
        avatarUrl: avatarUrl || null,
        authProvider: "google",
        emailVerified: false,
        requireOtp: true,
      };
    }

    return {
      id: newUserId,
      email,
      displayName: resolvedDisplayName,
      avatarUrl: avatarUrl || null,
      authProvider: "google",
      emailVerified: true,
      requireOtp: false,
    };
  });
}
