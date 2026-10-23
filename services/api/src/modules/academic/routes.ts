import type { RouteContext } from "../../shared/http/context.js";
import { HttpError } from "../../shared/http/http-error.js";
import { getAuthUserId, readJson, sendJson } from "../../shared/http/utils.js";
import { limitRequest } from "../../shared/http/rate-limit.js";
import * as organization from "./organization.js";

type Body = Record<string, unknown>;
type Handler = (userId: string, match: string[], body: Body, params: URLSearchParams) => Promise<unknown>;
interface Route {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  pattern: RegExp;
  handler: Handler;
  status?: number;
}

const uuid = "([0-9a-fA-F-]{36})";
const r = (method: Route["method"], path: string, handler: Handler, status = 200): Route => ({
  method,
  pattern: new RegExp(`^/api/academic${path.replaceAll(":id", uuid)}$`),
  handler,
  status,
});

/**
 * Organisation and access: faculties, departments, lecturers, accounts and role grants. E-learning
 * (who may teach a course) and the call center (who administers it) read these.
 */
const routes: Route[] = [
  r("GET", "/me", (u) => organization.getAcademicProfile(u)),
  r("GET", "/units", (u) => organization.listUnits(u)),
  r("POST", "/units", (u, _m, b) => organization.createUnit(u, b), 201),
  r("POST", "/units/:id/departments", (u, m, b) => organization.createDepartment(u, m[1], b), 201),
  r("GET", "/units/:id/staff", (u, m) => organization.listStaff(u, m[1])),
  r("POST", "/units/:id/staff", (u, m, b) => organization.upsertStaff(u, m[1], b)),
  r("POST", "/roles", (u, _m, b) => organization.grantRole(u, b)),
  r("POST", "/accounts", (u, _m, b) => organization.createAccounts(u, b), 201),
  r("POST", "/accounts/:id/password", (u, m, b) => organization.resetPassword(u, m[1], b)),
  r("GET", "/access", (u, _m, _b, p) => organization.listAccess(u, p)),
];

export async function academicRoutes({ request, response, pathname, params }: RouteContext): Promise<void> {
  if (!pathname.startsWith("/api/academic/")) return;
  const candidates = routes.filter((route) => route.pattern.test(pathname));
  if (!candidates.length) return;
  const route = candidates.find((candidate) => candidate.method === request.method);
  if (!route) throw new HttpError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
  const userId = await getAuthUserId(request);
  response.setHeader("Cache-Control", "no-store");
  if (route.method !== "GET") await limitRequest(request, `academic:${userId}`, 240, 60);
  const body = route.method === "GET" || route.method === "DELETE" ? {} : await readJson(request);
  const match = pathname.match(route.pattern)!;
  try {
    const result = await route.handler(userId, match, body, params);
    sendJson(response, route.status ?? 200, result ?? { ok: true });
  } catch (error) {
    const pg = error as { code?: string };
    // Database guards (checks, unique constraints) are the last line of defence.
    if (pg.code === "23514") throw new HttpError(409, "RULE_VIOLATION", "Thao tác vi phạm ràng buộc nghiệp vụ của hệ thống.");
    if (pg.code === "23505") throw new HttpError(409, "DUPLICATE", "Dữ liệu bị trùng.");
    if (pg.code === "40P01") throw new HttpError(409, "RETRY", "Xung đột đồng thời, vui lòng thử lại.");
    throw error;
  }
}
