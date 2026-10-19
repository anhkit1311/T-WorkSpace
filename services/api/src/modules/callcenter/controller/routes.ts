import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import type { RouteContext } from "../../../shared/http/context.js";
import { HttpError } from "../../../shared/http/http-error.js";
import { limitRequest } from "../../../shared/http/rate-limit.js";
import { getAuthUserId, readJson, sendJson } from "../../../shared/http/utils.js";
import type { CallCenterAdminService } from "../service/admin-service.js";
import type { CallCenterAgentService } from "../service/agent-service.js";
import type { CallCenterQaService } from "../service/qa-service.js";
import type { CallCenterReportService } from "../service/report-service.js";
import type { CallCenterTicketService } from "../service/ticket-service.js";
import type { CallCenterVoipService } from "../service/voip-service.js";
import type { Body } from "../service/input.js";

type Handler = (userId: string, match: string[], body: Body, params: URLSearchParams) => Promise<unknown>;
interface Route {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  pattern: RegExp;
  handler: Handler;
  status: number;
}

const uuid = "([0-9a-fA-F-]{36})";
const r = (method: Route["method"], path: string, handler: Handler, status = 200): Route => ({
  method,
  pattern: new RegExp(`^/api/callcenter${path.replaceAll(":id", uuid)}$`),
  handler,
  status,
});

/** REST controller of the call center: maps HTTP onto the services, nothing more. */
export function callCenterRoutes(
  admin: CallCenterAdminService,
  agents: CallCenterAgentService,
  tickets: CallCenterTicketService,
  reports: CallCenterReportService,
  qa: CallCenterQaService,
  voip: CallCenterVoipService,
) {
  const routes: Route[] = [
    r("GET", "/me", (u) => agents.me(u)),
    r("POST", "/me/state", (u, _m, b) => agents.setState(u, b)),
    r("GET", "/me/sip", (u) => agents.sipAccount(u)),
    r("GET", "/me/caller", (u) => agents.callerProfile(u)),
    r("POST", "/me/transfer", (u, _m, b) => agents.transfer(u, b)),
    r("POST", "/me/transfer/complete", (u) => agents.finishTransfer(u, true)),
    r("POST", "/me/transfer/cancel", (u) => agents.finishTransfer(u, false)),
    r("POST", "/me/hold", (u, _m, b) => agents.hold(u, b)),
    r("GET", "/me/voicemails", (u) => voip.voicemails(u)),
    r("DELETE", "/me/voicemails/:id", (u, m) => voip.deleteVoicemail(u, m[1])),

    // Every signed-in user: call or write to a department, follow their own tickets.
    r("GET", "/contacts", () => voip.contacts()),
    r("POST", "/web-calls", (u, _m, b) => voip.startWebCall(u, b), 201),
    r("DELETE", "/web-calls/(web[0-9a-f]{12})", (u, m) => voip.endWebCall(u, m[1])),
    r("GET", "/my-tickets", (u) => voip.myTickets(u)),
    r("POST", "/my-tickets", (u, _m, b) => voip.createMyTicket(u, b), 201),
    r("GET", "/my-tickets/:id", (u, m) => voip.myTicket(u, m[1])),
    r("POST", "/my-tickets/:id/replies", (u, m, b) => voip.reply(u, m[1], b), 201),
    r("POST", "/my-tickets/:id/rating", (u, m, b) => voip.rate(u, m[1], b)),
    r("GET", "/transfer-directory", (u) => agents.directory(u)),
    r("POST", "/live-calls/:id/monitor", (u, m, b) => agents.monitor(u, m[1], b)),

    r("GET", "/departments", (u) => admin.listDepartments(u)),
    r("POST", "/departments", (u, _m, b) => admin.createDepartment(u, b), 201),
    r("PATCH", "/departments/:id", (u, m, b) => admin.updateDepartment(u, m[1], b)),
    r("POST", "/departments/:id/hours", (u, m, b) => admin.setHours(u, m[1], b)),
    r("POST", "/departments/:id/members", (u, m, b) => admin.addMember(u, m[1], b)),
    r("DELETE", "/departments/:id/members/:id", (u, m, _b, p) => admin.removeMember(u, m[1], m[2], p.get("role") ?? "")),
    r("GET", "/departments/:id/live", (u, m) => agents.live(u, m[1])),
    r("GET", "/departments/:id/kpi", (u, m, _b, p) => reports.kpi(u, m[1], p)),

    r("GET", "/extensions", (u) => admin.listExtensions(u)),
    r("POST", "/extensions", (u, _m, b) => admin.createExtension(u, b), 201),
    r("PATCH", "/extensions/:id", (u, m, b) => admin.updateExtension(u, m[1], b)),
    r("POST", "/extensions/:id/reset-secret", (u, m) => admin.resetSecret(u, m[1])),
    r("DELETE", "/extensions/:id", (u, m) => admin.deleteExtension(u, m[1])),

    r("GET", "/hotlines", (u) => admin.listHotlines(u)),
    r("POST", "/hotlines", (u, _m, b) => admin.saveHotline(u, null, b), 201),
    r("PATCH", "/hotlines/:id", (u, m, b) => admin.saveHotline(u, m[1], b)),

    r("GET", "/dispositions", (u) => admin.listDispositions(u)),
    r("POST", "/dispositions", (u, _m, b) => admin.createDisposition(u, b), 201),

    r("GET", "/calls", (u, _m, _b, p) => agents.calls(u, p)),
    r("PATCH", "/calls/:id", (u, m, b) => agents.wrapUp(u, m[1], b)),
    r("POST", "/calls/:id/video", (u, m) => agents.videoRoom(u, m[1])),
    r("GET", "/calls/:id/transcript", (u, m) => agents.transcript(u, m[1])),

    r("GET", "/training-courses", (u) => admin.trainingCourses(u)),
    r("GET", "/departments/:id/qa-criteria", (u, m) => qa.criteria(u, m[1])),
    r("POST", "/departments/:id/qa-criteria", (u, m, b) => qa.saveCriteria(u, m[1], b)),
    r("GET", "/qa-reviews", (u, _m, _b, p) => qa.reviews(u, p)),
    r("GET", "/calls/:id/qa", async (u, m) => ({ review: await qa.review(u, m[1]) })),
    r("POST", "/calls/:id/qa", (u, m, b) => qa.saveReview(u, m[1], b)),

    r("GET", "/tickets", (u, _m, _b, p) => tickets.list(u, p)),
    r("POST", "/tickets", (u, _m, b) => tickets.create(u, b), 201),
    r("GET", "/tickets/:id", (u, m) => tickets.get(u, m[1])),
    r("PATCH", "/tickets/:id", (u, m, b) => tickets.update(u, m[1], b)),
    r("POST", "/tickets/:id/events", (u, m, b) => tickets.addEvent(u, m[1], b), 201),
  ];

  const stream = async (response: RouteContext["response"], audio: Response) => {
    response.statusCode = 200;
    response.setHeader("Content-Type", audio.headers.get("content-type") ?? "audio/wav");
    response.setHeader("Cache-Control", "private, no-store");
    // shortcut: no Range support, so the browser cannot seek before the file is loaded; add it if recordings get long.
    await pipeline(Readable.fromWeb(audio.body as ReadableStream), response);
  };

  return async function routesHandler({ request, response, pathname, params }: RouteContext): Promise<void> {
    if (!pathname.startsWith("/api/callcenter/")) return;
    const audio = pathname.match(new RegExp(`^/api/callcenter/(calls|voicemails)/${uuid}/recording$`));
    if (audio && request.method === "GET") {
      const userId = await getAuthUserId(request);
      await stream(
        response,
        audio[1] === "calls"
          ? await agents.recording(userId, audio[2])
          : ((await voip.voicemailRecording(userId, audio[2])) ?? (await tickets.voicemailRecording(userId, audio[2]))),
      );
      return;
    }
    const csv = pathname.match(new RegExp(`^/api/callcenter/departments/${uuid}/calls\\.csv$`));
    if (csv && request.method === "GET") {
      const { fileName, content } = await reports.exportCsv(await getAuthUserId(request), csv[1], params);
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/csv; charset=utf-8");
      response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      response.setHeader("Cache-Control", "private, no-store");
      response.end("﻿" + content); // BOM so Excel reads Vietnamese correctly
      return;
    }
    const candidates = routes.filter((route) => route.pattern.test(pathname));
    if (!candidates.length) return;
    const route = candidates.find((candidate) => candidate.method === request.method);
    if (!route) throw new HttpError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
    const userId = await getAuthUserId(request);
    response.setHeader("Cache-Control", "no-store");
    if (route.method !== "GET") await limitRequest(request, `callcenter:${userId}`, 240, 60);
    const body = route.method === "GET" || route.method === "DELETE" ? {} : await readJson(request);
    try {
      sendJson(response, route.status, (await route.handler(userId, pathname.match(route.pattern)!, body, params)) ?? { ok: true });
    } catch (error) {
      const pg = error as { code?: string };
      if (pg.code === "23505") throw new HttpError(409, "DUPLICATE", "Dữ liệu bị trùng (mã, số máy lẻ hoặc số đường dây).");
      if (pg.code === "23503") throw new HttpError(400, "INVALID_REFERENCE", "Dữ liệu tham chiếu không tồn tại hoặc đang được dùng.");
      if (pg.code === "23514") throw new HttpError(409, "RULE_VIOLATION", "Thao tác vi phạm ràng buộc nghiệp vụ.");
      throw error;
    }
  };
}
