import { createHmac, timingSafeEqual } from "node:crypto";
import { getJwtSecret } from "../../config/config.js";

/**
 * Spec "Quy tắc bảo vệ dữ liệu": recordings are fetched only through links that expire. A link is the
 * path plus the user it was issued to and its expiry, signed with a key derived from JWT_SECRET; the
 * route still checks that user's access when the link is used.
 */
const key = () => createHmac("sha256", getJwtSecret()).update("media-link").digest();
const signature = (path: string, userId: string, expires: number) =>
  createHmac("sha256", key()).update(`${path}\n${userId}\n${expires}`).digest("base64url");

export function signLink(path: string, userId: string, ttlSeconds: number) {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const query = new URLSearchParams({
    u: userId,
    e: String(expires),
    s: signature(path, userId, expires),
  });
  return { url: `${path}?${query}`, expiresAt: new Date(expires * 1000).toISOString() };
}

/** The user the link was issued to, or null when it is missing, forged or expired. */
export function verifyLink(path: string, params: URLSearchParams): string | null {
  const userId = params.get("u");
  const expires = Number(params.get("e"));
  const given = Buffer.from(params.get("s") ?? "");
  if (!userId || !Number.isInteger(expires) || expires < Date.now() / 1000) return null;
  const expected = Buffer.from(signature(path, userId, expires));
  return given.length === expected.length && timingSafeEqual(given, expected) ? userId : null;
}
