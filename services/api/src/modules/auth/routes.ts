import type { RouteContext } from "../../shared/http/context.js";
import { refreshCookieName } from "../../shared/http/utils.js";
import {
  getAuthUserId,
  readJson,
  requestMetadata,
  readCookies,
  setRefreshCookie,
  clearRefreshCookie,
  sendAuthResponse,
  sendJson,
} from "../../shared/http/utils.js";
import {
  getCurrentUser,
  login,
  logout,
  refreshSession,
  resendVerificationOtp,
  verifyOtpAndLogin,
} from "./service.js";
import { changePassword } from "./change-password.js";
import { HttpError } from "../../shared/http/http-error.js";
import { limitRequest } from "../../shared/http/rate-limit.js";
export async function authRoutes({ request, response, pathname }: RouteContext): Promise<void> {
  if (request.method === "POST" && pathname === "/auth/verify-otp") {
    await limitRequest(request, "verify-otp", 15, 600);
    const body = await readJson(request);
    const result = await verifyOtpAndLogin(body, requestMetadata(request));
    setRefreshCookie(response, result.refreshToken);
    sendAuthResponse(response, 200, result);
    return;
  }

  if (request.method === "POST" && pathname === "/auth/resend-otp") {
    await limitRequest(request, "resend-otp", 5, 3600);
    const body = await readJson(request);
    const result = await resendVerificationOtp(body);
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && pathname === "/auth/login") {
    await limitRequest(request, "login", 10, 600);
    const body = await readJson(request);
    const result = await login(body, requestMetadata(request));
    setRefreshCookie(response, result.refreshToken);
    sendAuthResponse(response, 200, result);
    return;
  }

  if (request.method === "POST" && pathname === "/auth/password/change") {
    await limitRequest(request, "password-change", 10, 600);
    const userId = await getAuthUserId(request);
    sendJson(response, 200, await changePassword(userId, await readJson(request)));
    return;
  }

  if (request.method === "POST" && pathname === "/auth/refresh") {
    const refreshToken = readCookies(request)[refreshCookieName];
    if (!refreshToken)
      throw new HttpError(401, "MISSING_SESSION", "Không tìm thấy phiên đăng nhập.");
    const result = await refreshSession(refreshToken, requestMetadata(request));
    setRefreshCookie(response, result.refreshToken);
    sendAuthResponse(response, 200, result);
    return;
  }

  if (request.method === "POST" && pathname === "/auth/logout") {
    await logout(readCookies(request)[refreshCookieName]);
    clearRefreshCookie(response);
    response.statusCode = 204;
    response.end();
    return;
  }

  if (request.method === "GET" && pathname === "/auth/me") {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      throw new HttpError(401, "MISSING_TOKEN", "Thiếu access token.");
    }
    const user = await getCurrentUser(authorization.slice("Bearer ".length));
    response.setHeader("Cache-Control", "no-store");
    sendJson(response, 200, { user });
    return;
  }
}
