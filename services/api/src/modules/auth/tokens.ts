import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { config, getJwtSecret } from "../../config/config.js";

const issuer = "realtime-workspace-api";
const audience = "realtime-workspace-web";

export async function createAccessToken(userId: string): Promise<string> {
  return new SignJWT({ tokenType: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(config.accessTokenTtl)
    .sign(getJwtSecret());
}

export async function verifyAccessToken(token: string): Promise<string> {
  const { payload } = await jwtVerify(token, getJwtSecret(), { issuer, audience });
  if (payload.tokenType !== "access" || !payload.sub) throw new Error("Invalid access token");
  return payload.sub;
}

export function createRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
