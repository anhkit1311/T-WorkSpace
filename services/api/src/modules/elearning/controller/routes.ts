import { pipeline } from "node:stream/promises";
import type { RouteContext } from "../../../shared/http/context.js";
import { HttpError } from "../../../shared/http/http-error.js";
import { limitRequest } from "../../../shared/http/rate-limit.js";
import { openMediaPath } from "../../../infrastructure/media-storage.js";
import { getAuthUserId, readJson, sendJson } from "../../../shared/http/utils.js";
import type { Body } from "../../callcenter/service/input.js";
import type { CourseService } from "../service/course-service.js";
import type { LearningService } from "../service/learning-service.js";
import type { LiveClassService } from "../service/live-service.js";
import type { LessonMediaService } from "../service/media-service.js";

type Handler = (userId: string, match: string[], body: Body) => Promise<unknown>;
interface Route {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  pattern: RegExp;
  handler: Handler;
  status: number;
}

const uuid = "([0-9a-fA-F-]{36})";
const r = (method: Route["method"], path: string, handler: Handler, status = 200): Route => ({
  method,
  pattern: new RegExp(`^/api/elearning${path.replaceAll(":id", uuid)}$`),
  handler,
  status,
});

/** REST controller of e-learning: maps HTTP onto the services, nothing more. */
export function elearningRoutes(courses: CourseService, learning: LearningService, live: LiveClassService, media: LessonMediaService) {
  const routes: Route[] = [
    r("GET", "/units", (u) => courses.units(u)),
    r("GET", "/courses", (u) => courses.list(u)),
    r("POST", "/courses", (u, _m, b) => courses.create(u, b), 201),
    r("GET", "/courses/:id", (u, m) => courses.detail(u, m[1])),
    r("PATCH", "/courses/:id", (u, m, b) => courses.update(u, m[1], b)),
    r("POST", "/courses/:id/instructors", (u, m, b) => courses.setInstructor(u, m[1], b, true)),
    r("DELETE", "/courses/:id/instructors/:id", (u, m) => courses.setInstructor(u, m[1], { userId: m[2] }, false)),
    r("POST", "/courses/:id/chapters", (u, m, b) => courses.addChapter(u, m[1], b), 201),
    r("PATCH", "/chapters/:id", (u, m, b) => courses.updateChapter(u, m[1], b)),
    r("DELETE", "/chapters/:id", (u, m) => courses.deleteChapter(u, m[1])),
    r("POST", "/chapters/:id/lessons", (u, m, b) => courses.addLesson(u, m[1], b), 201),
    r("POST", "/chapters/:id/live", (u, m, b) => live.create(u, m[1], b), 201),
    r("POST", "/chapters/:id/call-lessons", (u, m, b) => media.importCallRecording(u, m[1], b), 201),
    r("GET", "/lessons/:id", (u, m) => learning.lesson(u, m[1])),
    r("PATCH", "/lessons/:id", (u, m, b) => courses.updateLesson(u, m[1], b)),
    r("DELETE", "/lessons/:id", (u, m) => courses.deleteLesson(u, m[1])),
    r("POST", "/lessons/:id/transcript", (u, m) => media.requestTranscript(u, m[1]), 202),
    r("POST", "/lessons/:id/complete", (u, m) => learning.complete(u, m[1])),
    r("POST", "/lessons/:id/attempts", (u, m) => learning.startQuiz(u, m[1]), 201),
    r("GET", "/attempts/:id", (u, m) => learning.attempt(u, m[1])),
    r("POST", "/attempts/:id/submit", (u, m, b) => learning.submitQuiz(u, m[1], b)),
    r("PATCH", "/attempts/:id/answers", (u, m, b) => learning.saveAnswers(u, m[1], b)),
    r("GET", "/lessons/:id/attendance", (u, m) => live.attendance(u, m[1])),
    r("POST", "/lessons/:id/close", (u, m) => live.close(u, m[1])),
    r("POST", "/lessons/:id/support", (u, m, b) => learning.requestSupport(u, m[1], b), 201),
    r("POST", "/courses/:id/enroll", (u, m) => courses.enrollSelf(u, m[1])),
    r("POST", "/courses/:id/assignments", (u, m, b) => courses.assign(u, m[1], b)),
    r("DELETE", "/courses/:id/learners/:id", (u, m) => courses.unenroll(u, m[1], m[2])),
    r("GET", "/courses/:id/questions", (u, m) => courses.questions(u, m[1])),
    r("POST", "/courses/:id/questions", (u, m, b) => courses.saveQuestion(u, m[1], null, b), 201),
    r("PATCH", "/questions/:id", (u, m, b) => courses.saveQuestion(u, null, m[1], b)),
    r("DELETE", "/questions/:id", (u, m) => courses.deleteQuestion(u, m[1])),
    r("GET", "/courses/:id/progress", (u, m) => courses.progress(u, m[1])),
    r("GET", "/courses/:id/certificate", (u, m) => courses.certificate(u, m[1])),
    r("POST", "/courses/:id/discussion", (u, m) => courses.discussion(u, m[1])),
  ];

  return async function routesHandler({ request, response, pathname }: RouteContext): Promise<void> {
    if (!pathname.startsWith("/api/elearning/")) return;
    // EL-8: certificate lookup is public (the QR code on a printed certificate), rate-limited per IP.
    const verify = pathname.match(/^\/api\/elearning\/verify\/([A-Za-z0-9-]{1,32})$/);
    if (verify && request.method === "GET") {
      await limitRequest(request, "certificate-verify", 60, 60);
      sendJson(response, 200, await courses.verifyCertificate(verify[1]));
      return;
    }
    const upload = pathname.match(new RegExp(`^/api/elearning/lessons/${uuid}/file$`));
    if (upload && request.method === "POST") {
      const userId = await getAuthUserId(request);
      await limitRequest(request, `elearning-upload:${userId}`, 20, 600);
      sendJson(response, 200, await media.upload(userId, upload[1], request));
      return;
    }
    const file = pathname.match(new RegExp(`^/api/elearning/lessons/${uuid}/files/([A-Za-z0-9_.-]+)$`));
    if (file && request.method === "GET") {
      const found = await media.file(await getAuthUserId(request), file[1], file[2]);
      const stored = await openMediaPath(found.file);
      if (!stored) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy tệp.");
      response.writeHead(200, { "Content-Type": found.type, "Content-Length": stored.size, "Cache-Control": "private, max-age=3600" });
      await pipeline(stored.stream, response);
      return;
    }
    const csv = pathname.match(new RegExp(`^/api/elearning/courses/${uuid}/progress\\.csv$`));
    if (csv && request.method === "GET") {
      const content = await courses.progressCsv(await getAuthUserId(request), csv[1]);
      response.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "private, no-store" });
      response.end("﻿" + content); // BOM so Excel reads Vietnamese correctly
      return;
    }
    const candidates = routes.filter((route) => route.pattern.test(pathname));
    if (!candidates.length) return;
    const route = candidates.find((candidate) => candidate.method === request.method);
    if (!route) throw new HttpError(405, "METHOD_NOT_ALLOWED", "Phương thức không được hỗ trợ.");
    const userId = await getAuthUserId(request);
    response.setHeader("Cache-Control", "no-store");
    if (route.method !== "GET") await limitRequest(request, `elearning:${userId}`, 300, 60);
    const body = route.method === "GET" || route.method === "DELETE" ? {} : await readJson(request);
    try {
      sendJson(response, route.status, (await route.handler(userId, pathname.match(route.pattern)!, body)) ?? { ok: true });
    } catch (error) {
      const pg = error as { code?: string };
      if (pg.code === "23505") throw new HttpError(409, "DUPLICATE", "Dữ liệu bị trùng (ví dụ mã khóa học).");
      if (pg.code === "23503") throw new HttpError(400, "INVALID_REFERENCE", "Dữ liệu tham chiếu không tồn tại hoặc đang được dùng.");
      if (pg.code === "23514") throw new HttpError(400, "RULE_VIOLATION", "Dữ liệu vi phạm ràng buộc.");
      throw error;
    }
  };
}
