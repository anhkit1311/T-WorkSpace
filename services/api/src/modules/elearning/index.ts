import { elearningRoutes as buildRoutes } from "./controller/routes.js";
import { ElearningRepository } from "./repository/elearning-repository.js";
import { CourseService } from "./service/course-service.js";
import { LearningService } from "./service/learning-service.js";
import { LiveClassService } from "./service/live-service.js";
import { trainingRecording } from "../callcenter/index.js";
import { LessonMediaService } from "./service/media-service.js";

// Composition root of the e-learning module.

const log = (event: string, details: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level: event.endsWith("failed") ? "warn" : "info", event, ...details }));

const repo = new ElearningRepository();
const courses = new CourseService(repo);
const learning = new LearningService(repo, courses);
const live = new LiveClassService(repo, courses, log);
const media = new LessonMediaService(repo, courses, log, trainingRecording);

export const elearningRoutes = buildRoutes(courses, learning, live, media);

/** Background work: close finished live classes (EL-6/LT-2) and resume interrupted transcodes. */
export function startElearning() {
  void media.recover().catch((error) => log("lesson_media_recovery_failed", { message: String(error) }));
  const timer = setInterval(() => void live.closeFinished().catch((error) => log("live_class_pass_failed", { message: String(error) })), 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
