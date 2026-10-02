import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiErrorResponse, AuthResponse } from "@doan/shared";
import { config } from "../../config/config.js";
import { verifyAccessToken } from "../../modules/auth/tokens.js";
import { HttpError } from "./http-error.js";
export const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
export const refreshCookieName = "workspace_refresh";
export async function getAuthUserId(request: IncomingMessage): Promise<string> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    throw new HttpError(401, "MISSING_TOKEN", "Thiếu access token.");
  }
  try {
    return await verifyAccessToken(authorization.slice("Bearer ".length));
  } catch {
    throw new HttpError(401, "INVALID_TOKEN", "Phiên đăng nhập đã hết hạn hoặc không hợp lệ.");
  }
}

export async function readJson(
  request: IncomingMessage,
  maxBytes = 1_000_000,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new HttpError(413, "BODY_TOO_LARGE", "Dữ liệu gửi lên quá lớn.");
    chunks.push(buffer);
  }

  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Nội dung JSON không hợp lệ.");
  }
}

export async function readBinary(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new HttpError(413, "FILE_TOO_LARGE", "Tệp tối đa 8 MB.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function requestMetadata(request: IncomingMessage): {
  ipAddress?: string;
  userAgent?: string;
} {
  return { ipAddress: request.socket.remoteAddress, userAgent: request.headers["user-agent"] };
}

export function readCookies(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return separator < 0 ? [part, ""] : [part.slice(0, separator), part.slice(separator + 1)];
      }),
  );
}

export function setRefreshCookie(response: ServerResponse, token: string): void {
  const maxAge = config.refreshSessionDays * 24 * 60 * 60;
  response.setHeader(
    "Set-Cookie",
    `${refreshCookieName}=${encodeURIComponent(token)}; HttpOnly; Path=/auth; SameSite=Lax; Max-Age=${maxAge}${config.isProduction ? "; Secure" : ""}`,
  );
}

export function clearRefreshCookie(response: ServerResponse): void {
  response.setHeader(
    "Set-Cookie",
    `${refreshCookieName}=; HttpOnly; Path=/auth; SameSite=Lax; Max-Age=0${config.isProduction ? "; Secure" : ""}`,
  );
}

export function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", webOrigin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-File-Name");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.setHeader("Vary", "Origin");
}

export function sendAuthResponse(
  response: ServerResponse,
  statusCode: number,
  result: AuthResponse & { refreshToken: string },
): void {
  response.setHeader("Cache-Control", "no-store");
  sendJson(response, statusCode, { user: result.user, accessToken: result.accessToken });
}

export function sendError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
): void {
  const body: ApiErrorResponse = { error: { code, message } };
  sendJson(response, statusCode, body);
}

export function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}
