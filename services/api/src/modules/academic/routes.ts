import type { RouteContext } from "../../shared/http/context.js";
import { HttpError } from "../../shared/http/http-error.js";
import { getAuthUserId, readJson, sendJson } from "../../shared/http/utils.js";
import { limitRequest } from "../../shared/http/rate-limit.js";
import { query } from "../../infrastructure/database/db.js";
import * as organization from "./organization.js";
import * as terms from "./terms.js";
import * as topics from "./topics.js";
import * as groups from "./groups.js";
import * as projects from "./projects.js";
import * as evaluation from "./evaluation.js";
import { listNotifications, markNotificationsRead } from "./notifications.js";
import { termDashboard, exportCsv } from "./reports.js";

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
 * REST surface of the academic module. Every mutation is a POST/PATCH on a resource or a named
 * action ("/advance", "/decision"), which keeps business commands explicit and auditable.
 */
const routes: Route[] = [
  r("GET", "/me", (u) => organization.getAcademicProfile(u)),
  r("GET", "/units", (u) => organization.listUnits(u)),
  r("POST", "/units", (u, _m, b) => organization.createUnit(u, b), 201),
  r("POST", "/units/:id/departments", (u, m, b) => organization.createDepartment(u, m[1], b), 201),
  r("GET", "/units/:id/staff", (u, m) => organization.listStaff(u, m[1])),
  r("POST", "/units/:id/staff", (u, m, b) => organization.upsertStaff(u, m[1], b)),
  r("POST", "/roles", (u, _m, b) => organization.grantRole(u, b)),
  r("POST", "/units/:id/terms", (u, m, b) => terms.createTerm(u, m[1], b), 201),

  r("GET", "/terms", (u) => terms.listTerms(u)),
  r("GET", "/terms/:id", (u, m) => terms.getTerm(u, m[1])),
  r("PATCH", "/terms/:id", (u, m, b) => terms.updateTerm(u, m[1], b)),
  r("POST", "/terms/:id/advance", (u, m, b) => terms.advanceTerm(u, m[1], b)),
  r("POST", "/terms/:id/milestones", (u, m, b) => terms.createMilestone(u, m[1], b), 201),
  r("POST", "/terms/:id/rubric", (u, m, b) => terms.setRubric(u, m[1], b)),
  r("POST", "/terms/:id/quotas", (u, m, b) => terms.setSupervisorQuota(u, m[1], b)),
  r("GET", "/terms/:id/lecturers", (u, m) => terms.lecturerLoad(u, m[1])),
  r("GET", "/terms/:id/students", (u, m, _b, p) => terms.listEnrollments(u, m[1], p)),
  r("POST", "/terms/:id/students/import", (u, m, b) => terms.importEnrollments(u, m[1], b)),
  r("POST", "/terms/:id/students/:id/eligibility", (u, m, b) => terms.overrideEligibility(u, m[1], m[2], b)),
  r("GET", "/terms/:id/audit", (u, m, _b, p) => organization.listAudit(u, m[1], p)),
  r("GET", "/terms/:id/dashboard", (u, m) => termDashboard(u, m[1])),
  r("GET", "/terms/:id/at-risk", (u, m) => projects.atRiskProjects(u, m[1])),

  r("GET", "/terms/:id/topics", (u, m, _b, p) => topics.listTopics(u, m[1], p)),
  r("POST", "/terms/:id/topics", (u, m, b) => topics.createTopic(u, m[1], b), 201),
  r("GET", "/topics/:id", (u, m) => topics.getTopic(u, m[1])),
  r("PATCH", "/topics/:id", (u, m, b) => topics.updateTopic(u, m[1], b)),
  r("POST", "/topics/:id/decision", (u, m, b) => topics.decideTopic(u, m[1], b)),
  r("GET", "/topics/:id/similar", (u, m) => topics.topicSimilarity(u, m[1])),

  r("GET", "/terms/:id/my-group", (u, m) => groups.myGroup(u, m[1])),
  r("POST", "/terms/:id/groups", (u, m) => groups.createGroup(u, m[1]), 201),
  r("GET", "/groups/:id", (u, m) => groups.getGroup(u, m[1])),
  r("POST", "/groups/:id/invitations", (u, m, b) => groups.inviteMember(u, m[1], b)),
  r("POST", "/groups/:id/invitation-response", (u, m, b) => groups.respondInvitation(u, m[1], b)),
  r("POST", "/groups/:id/leave", (u, m, b) => groups.leaveGroup(u, m[1], b)),
  r("POST", "/groups/:id/preferences", (u, m, b) => groups.setPreferences(u, m[1], b)),
  r("GET", "/terms/:id/registrations/pending", (u, m) => groups.pendingRegistrations(u, m[1])),
  r("POST", "/registrations/:id/decision", (u, m, b) => groups.decideRegistration(u, m[1], b)),

  r("GET", "/terms/:id/projects", (u, m, _b, p) => projects.listProjects(u, m[1], p)),
  r("GET", "/projects/:id", (u, m) => projects.getProject(u, m[1])),
  r("GET", "/projects/:id/submissions", (u, m) => projects.listSubmissions(u, m[1])),
  r("POST", "/projects/:id/submissions", (u, m, b) => projects.submit(u, m[1], b), 201),
  r("POST", "/submissions/:id/review", (u, m, b) => projects.reviewSubmission(u, m[1], b)),
  r("GET", "/submissions/:id/verify", (u, m) => projects.verifySubmission(u, m[1])),
  r("GET", "/projects/:id/logs", (u, m) => projects.listLogs(u, m[1])),
  r("POST", "/projects/:id/logs", (u, m, b) => projects.createLog(u, m[1], b), 201),
  r("POST", "/logs/:id/confirm", (u, m, b) => projects.confirmLog(u, m[1], b)),
  r("POST", "/projects/:id/approve-defense", (u, m, b) => projects.approveDefense(u, m[1], b)),
  r("POST", "/projects/:id/office-action", (u, m, b) => projects.officeAction(u, m[1], b)),

  r("POST", "/projects/:id/reviewer", (u, m, b) => evaluation.assignReviewer(u, m[1], b)),
  r("POST", "/projects/:id/review", (u, m, b) => evaluation.submitReview(u, m[1], b)),
  r("GET", "/terms/:id/committees", (u, m) => evaluation.listCommittees(u, m[1])),
  r("POST", "/terms/:id/committees", (u, m, b) => evaluation.createCommittee(u, m[1], b), 201),
  r("POST", "/committees/:id/members", (u, m, b) => evaluation.setCommitteeMember(u, m[1], b)),
  r("POST", "/committees/:id/confirm", (u, m, b) => evaluation.confirmCommittee(u, m[1], b)),
  r("POST", "/projects/:id/defense", (u, m, b) => evaluation.scheduleDefense(u, m[1], b)),
  r("DELETE", "/projects/:id/defense", (u, m) => evaluation.unscheduleDefense(u, m[1])),
  r("POST", "/terms/:id/auto-schedule", (u, m, b) => evaluation.autoSchedule(u, m[1], b)),
  r("POST", "/projects/:id/defended", (u, m, b) => evaluation.markDefended(u, m[1], b)),
  r("GET", "/projects/:id/scores", (u, m) => evaluation.getScoreSheets(u, m[1])),
  r("POST", "/projects/:id/scores", (u, m, b) => evaluation.saveScoreSheet(u, m[1], b)),
  r("POST", "/projects/:id/finalize", (u, m, b) => evaluation.finalizeGrades(u, m[1], b)),
  r("POST", "/terms/:id/publish-grades", (u, m, b) => evaluation.publishGrades(u, m[1], b)),
  r("GET", "/terms/:id/ledger/verify", (u, m) => evaluation.verifyLedger(u, m[1])),
  r("POST", "/projects/:id/appeal", (u, m, b) => evaluation.fileAppeal(u, m[1], b), 201),
  r("POST", "/projects/:id/appeal/decision", (u, m, b) => evaluation.decideAppeal(u, m[1], b)),

  r("GET", "/notifications", (u, _m, _b, p) => listNotifications(u, p)),
  r("POST", "/notifications/read", (u, _m, b) => markNotificationsRead(u, b)),
];

export async function academicRoutes({ request, response, io, pathname, params }: RouteContext): Promise<void> {
  if (!pathname.startsWith("/api/academic/")) return;
  // CSV exports stream text instead of JSON.
  const csv = pathname.match(new RegExp(`^/api/academic/terms/${uuid}/export/(assignments|schedule|grades)\\.csv$`));
  if (csv && request.method === "GET") {
    const userId = await getAuthUserId(request);
    const { fileName, content } = await exportCsv(userId, csv[1], csv[2] as "assignments" | "schedule" | "grades");
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    response.setHeader("Cache-Control", "private, no-store");
    // BOM so spreadsheet tools read Vietnamese correctly.
    response.end("﻿" + content);
    return;
  }
  const file = pathname.match(new RegExp(`^/api/academic/submissions/${uuid}/file$`));
  if (file && request.method === "GET") {
    const submission = await projects.downloadSubmission(await getAuthUserId(request), file[1]);
    response.statusCode = 200;
    response.setHeader("Content-Type", submission.mimeType);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Content-SHA256", submission.sha256);
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(submission.fileName)}`);
    response.setHeader("Cache-Control", "private, no-store");
    response.end(submission.data);
    return;
  }
  const candidates = routes.filter((route) => route.pattern.test(pathname));
  if (!candidates.length) return;
  const route = candidates.find((candidate) => candidate.method === request.method);
  if (!route) throw new HttpError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
  const userId = await getAuthUserId(request);
  response.setHeader("Cache-Control", "no-store");
  if (route.method !== "GET") await limitRequest(request, `academic:${userId}`, 240, 60);
  const body = route.method === "GET" || route.method === "DELETE" ? {} : await readJson(request);
  const match = pathname.match(route.pattern)!;
  const since =
    route.method === "GET" ? null : (await query<{ t: Date }>(`SELECT clock_timestamp() AS t`)).rows[0].t;
  try {
    const result = await route.handler(userId, match, body, params);
    sendJson(response, route.status ?? 200, result ?? { ok: true });
    if (since) await pushNotifications(io, since);
  } catch (error) {
    // Domain errors may carry structured detail (blockers, per-row import errors) for the UI.
    if (error instanceof HttpError && ("blockers" in error || "details" in error)) {
      sendJson(response, error.statusCode, {
        error: { code: error.code, message: error.message, blockers: (error as { blockers?: unknown }).blockers, details: (error as { details?: unknown }).details },
      });
      return;
    }
    const pg = error as { code?: string };
    // Database guards (triggers, exclusion and unique constraints) are the last line of defence.
    if (pg.code === "23514") throw new HttpError(409, "RULE_VIOLATION", "Thao tác vi phạm ràng buộc nghiệp vụ của hệ thống.");
    if (pg.code === "23P01") throw new HttpError(409, "SCHEDULE_CONFLICT", "Trùng lịch bảo vệ.");
    if (pg.code === "23505") throw new HttpError(409, "DUPLICATE", "Dữ liệu bị trùng.");
    if (pg.code === "40P01") throw new HttpError(409, "RETRY", "Xung đột đồng thời, vui lòng thử lại.");
    throw error;
  }
}

/** Pushes the unread count to every user who received a notification during this request. */
async function pushNotifications(io: RouteContext["io"], since: Date) {
  const recipients = await query<{ user_id: string; unread: number }>(
    `SELECT n.user_id,(SELECT count(*)::int FROM academic_notifications u WHERE u.user_id=n.user_id AND u.read_at IS NULL) AS unread
     FROM academic_notifications n WHERE n.created_at>=$1 GROUP BY n.user_id`,
    [since],
  );
  for (const row of recipients.rows) io.to(`user:${row.user_id}`).emit("academic_notification", { unread: row.unread });
}
