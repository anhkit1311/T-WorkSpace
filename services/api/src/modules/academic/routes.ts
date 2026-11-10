import type { RouteContext } from "../../shared/http/context.js";
import { HttpError } from "../../shared/http/http-error.js";
import { getAuthUserId, readJson, sendJson } from "../../shared/http/utils.js";
import { limitRequest } from "../../shared/http/rate-limit.js";
import * as organization from "./organization.js";
import { listActivity } from "./activity.js";
import { unitReport } from "./reports.js";
import { provisionStaffPhones, releasePhones } from "../callcenter/index.js";

type Body = Record<string, unknown>;
type Handler = (
  userId: string,
  match: string[],
  body: Body,
  params: URLSearchParams,
) => Promise<unknown>;
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
  r("PATCH", "/units/:id", (u, m, b) => organization.updateUnit(u, m[1], b)),
  r("DELETE", "/units/:id", (u, m) => organization.deleteUnit(u, m[1])),
  r("POST", "/units/:id/departments", (u, m, b) => organization.createDepartment(u, m[1], b), 201),
  r("GET", "/units/:id/staff", (u, m) => organization.listStaff(u, m[1])),
  r("GET", "/units/:id/next-codes", (u, m, _b, p) => organization.previewCodes(u, m[1], p)),
  r("POST", "/units/:id/staff", (u, m, b) => enrollAccount(u, m[1], b)),
  r("POST", "/roles", (u, _m, b) => organization.grantRole(u, b)),
  r("POST", "/accounts", (u, _m, b) => createStaffAccounts(u, b), 201),
  r("DELETE", "/accounts/:id", (u, m) => deleteAccount(u, m[1])),
  r("POST", "/accounts/:id/password", (u, m, b) => organization.resetPassword(u, m[1], b)),
  r("POST", "/accounts/:id/code", (u, m, b) => organization.setUserCode(u, m[1], b)),
  r("POST", "/accounts/:id/unit", (u, m, b) => organization.setUserUnit(u, m[1], b)),
  r("GET", "/access", (u, _m, _b, p) => organization.listAccess(u, p)),
  r("GET", "/directory", (u) => organization.listDirectory(u)),
  r("GET", "/activity", (u, _m, _b, p) => listActivity(u, p)),
  r("GET", "/reports", (u, _m, _b, p) => unitReport(u, p)),
];

/**
 * Every account created for a unit also gets a máy lẻ in its range; lecturers and staff also join its
 * switchboard as agents. The accounts are already saved, so a PBX problem or a full range only leaves
 * the phone column empty and says so.
 */
async function issuePhones(userId: string, unitId: string, kind: string, created: string[]) {
  if (!created.length) return { phones: new Map<string, string>(), phoneWarning: null };
  try {
    const phones = await provisionStaffPhones(userId, unitId, created, kind !== "student");
    const missing = created.length - created.filter((id) => phones.has(id)).length;
    return {
      phones,
      phoneWarning: missing
        ? `${missing} tài khoản chưa có máy lẻ: dải máy lẻ của đơn vị đã hết số hoặc đơn vị chưa có tổng đài (mở Sửa đơn vị ở tab Khoa & Phòng ban rồi Lưu để tạo dải).`
        : null,
    };
  } catch (error) {
    return {
      phones: new Map<string, string>(),
      phoneWarning: `Đã tạo tài khoản nhưng chưa cấp được máy lẻ: ${(error as Error).message}`,
    };
  }
}

async function createStaffAccounts(userId: string, body: Body) {
  const { unitId, kind, accounts } = await organization.createAccounts(userId, body);
  const created = accounts.flatMap((row) => (row.userId ? [row.userId] : []));
  const { phones, phoneWarning } = await issuePhones(userId, unitId, kind, created);
  return {
    phoneWarning,
    accounts: accounts.map(({ userId: id, ...row }) => ({
      ...row,
      extension: (id && phones.get(id)) || null,
    })),
  };
}

/** One account created in / moved to a unit; one without a máy lẻ gets it, as above. */
async function enrollAccount(userId: string, unitId: string, body: Body) {
  const { phoneless, ...account } = await organization.enrollAccount(userId, unitId, body);
  const { phones, phoneWarning } = await issuePhones(
    userId,
    unitId,
    account.kind,
    phoneless ? [account.userId] : [],
  );
  return { ...account, extension: phones.get(account.userId) ?? null, phoneWarning };
}

/** The account is gone either way; a PBX problem only leaves its máy lẻ unassigned instead of freed. */
async function deleteAccount(userId: string, targetId: string) {
  const { deleted, extensionIds } = await organization.deleteAccount(userId, targetId);
  await releasePhones(extensionIds).catch(() => undefined);
  return { deleted };
}

export async function academicRoutes({
  request,
  response,
  pathname,
  params,
}: RouteContext): Promise<void> {
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
    if (pg.code === "23514")
      throw new HttpError(
        409,
        "RULE_VIOLATION",
        "Thao tác vi phạm ràng buộc nghiệp vụ của hệ thống.",
      );
    if (pg.code === "23505") throw new HttpError(409, "DUPLICATE", "Dữ liệu bị trùng.");
    if (pg.code === "40P01")
      throw new HttpError(409, "RETRY", "Xung đột đồng thời, vui lòng thử lại.");
    throw error;
  }
}
