import type {
  CourseAssignmentResult,
  CourseCertificate,
  CourseDetail,
  CourseProgressReport,
  CourseQuestion,
  CourseSummary,
  LessonDetail,
  LiveAttendanceRow,
  QuizAttempt,
} from "@doan/shared";
import { ApiError } from "../auth/api";

const base = () => `${import.meta.env.VITE_API_URL ?? ""}/api/elearning/`;

async function request<T>(token: string, path: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch(base() + path, {
    method,
    credentials: "include",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error?.code ?? "REQUEST_FAILED", data.error?.message ?? "Không thực hiện được yêu cầu.");
  return data as T;
}

export const coursesApi = {
  units: (t: string) => request<{ id: string; code: string; name: string }[]>(t, "units"),
  list: (t: string) => request<CourseSummary[]>(t, "courses"),
  create: (t: string, body: object) => request<CourseDetail>(t, "courses", "POST", body),
  detail: (t: string, id: string) => request<CourseDetail>(t, `courses/${id}`),
  update: (t: string, id: string, body: object) => request<CourseDetail>(t, `courses/${id}`, "PATCH", body),
  addInstructor: (t: string, id: string, email: string) => request<CourseDetail>(t, `courses/${id}/instructors`, "POST", { email }),
  addChapter: (t: string, id: string, title: string) => request<CourseDetail>(t, `courses/${id}/chapters`, "POST", { title }),
  updateChapter: (t: string, id: string, body: object) => request<CourseDetail>(t, `chapters/${id}`, "PATCH", body),
  deleteChapter: (t: string, id: string) => request<CourseDetail>(t, `chapters/${id}`, "DELETE"),
  addLesson: (t: string, chapterId: string, body: object) => request<{ id: string }>(t, `chapters/${chapterId}/lessons`, "POST", body),
  importCall: (t: string, chapterId: string, body: { callId: string; title: string; consent: boolean }) =>
    request<{ id: string }>(t, `chapters/${chapterId}/call-lessons`, "POST", body),
  addLive: (t: string, chapterId: string, body: object) => request<{ id: string }>(t, `chapters/${chapterId}/live`, "POST", body),
  lesson: (t: string, id: string) => request<LessonDetail>(t, `lessons/${id}`),
  updateLesson: (t: string, id: string, body: object) => request<{ ok: true }>(t, `lessons/${id}`, "PATCH", body),
  deleteLesson: (t: string, id: string) => request<{ ok: true }>(t, `lessons/${id}`, "DELETE"),
  complete: (t: string, id: string) => request<{ ok: true }>(t, `lessons/${id}/complete`, "POST"),
  watch: (t: string, id: string, body: { from: number; to: number; position: number }) =>
    request<{ watchedSeconds: number; positionSeconds: number; completed: boolean }>(t, `lessons/${id}/watch`, "POST", body),
  transcript: (t: string, id: string) => request<{ transcriptStatus: "processing" }>(t, `lessons/${id}/transcript`, "POST"),
  startQuiz: (t: string, lessonId: string) => request<QuizAttempt>(t, `lessons/${lessonId}/attempts`, "POST"),
  submitQuiz: (t: string, attemptId: string, answers: Record<string, (string | boolean)[]>) =>
    request<QuizAttempt>(t, `attempts/${attemptId}/submit`, "POST", { answers }),
  saveAnswers: (t: string, attemptId: string, answers: Record<string, (string | boolean)[]>) =>
    request<{ savedAt: string }>(t, `attempts/${attemptId}/answers`, "PATCH", { answers }),
  attendance: (t: string, lessonId: string) => request<LiveAttendanceRow[]>(t, `lessons/${lessonId}/attendance`),
  closeLive: (t: string, lessonId: string) => request<{ learners: number; attended: number; replays: number }>(t, `lessons/${lessonId}/close`, "POST"),
  support: (t: string, lessonId: string, message: string) =>
    request<{ ticketNumber: string; hotline: string | null; departmentId: string; context: string }>(t, `lessons/${lessonId}/support`, "POST", { message }),
  enroll: (t: string, id: string) => request<CourseDetail>(t, `courses/${id}/enroll`, "POST"),
  assign: (t: string, id: string, body: object) => request<CourseAssignmentResult>(t, `courses/${id}/assignments`, "POST", body),
  unenroll: (t: string, id: string, userId: string) => request<{ ok: true }>(t, `courses/${id}/learners/${userId}`, "DELETE"),
  questions: (t: string, id: string) => request<CourseQuestion[]>(t, `courses/${id}/questions`),
  saveQuestion: (t: string, courseId: string, questionId: string | null, body: object) =>
    questionId
      ? request<{ id: string }>(t, `questions/${questionId}`, "PATCH", body)
      : request<{ id: string }>(t, `courses/${courseId}/questions`, "POST", body),
  deleteQuestion: (t: string, id: string) => request<{ ok: true }>(t, `questions/${id}`, "DELETE"),
  progress: (t: string, id: string) => request<CourseProgressReport>(t, `courses/${id}/progress`),
  certificate: (t: string, id: string) => request<CourseCertificate>(t, `courses/${id}/certificate`),
  discussion: (t: string, id: string) => request<{ workspaceId: string; channelId: string | null; roomId: string | null }>(t, `courses/${id}/discussion`, "POST"),
  /** Public: no token needed. */
  verify: (code: string) => request<CourseCertificate>("", `verify/${encodeURIComponent(code)}`),
};

export const lessonFileUrl = (lessonId: string, name: string) => `${base()}lessons/${lessonId}/files/${name}`;

/** Uploads a lesson file with progress (fetch cannot report upload progress). */
export function uploadLessonFile(token: string, lessonId: string, file: File, onProgress: (percent: number) => void) {
  return new Promise<{ status: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${base()}lessons/${lessonId}/file`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onload = () => {
      const data = (() => {
        try {
          return JSON.parse(xhr.responseText);
        } catch {
          return {};
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data.error?.code ?? "UPLOAD_FAILED", data.error?.message ?? "Tải lên thất bại."));
    };
    xhr.onerror = () => reject(new ApiError(0, "NETWORK", "Mất kết nối khi tải lên."));
    xhr.send(file);
  });
}

/** Opens an authenticated file (PDF document) in a new tab. */
export async function openLessonFile(token: string, lessonId: string, name: string) {
  const response = await fetch(lessonFileUrl(lessonId, name), { headers: { Authorization: `Bearer ${token}` }, credentials: "include" });
  if (!response.ok) throw new ApiError(response.status, "FILE_FAILED", "Không mở được tệp.");
  const url = URL.createObjectURL(await response.blob());
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Downloads the progress table as CSV (Excel). */
export async function downloadProgressCsv(token: string, courseId: string, fileName: string) {
  const response = await fetch(`${base()}courses/${courseId}/progress.csv`, { headers: { Authorization: `Bearer ${token}` }, credentials: "include" });
  if (!response.ok) throw new ApiError(response.status, "EXPORT_FAILED", "Không xuất được tệp.");
  const url = URL.createObjectURL(await response.blob());
  Object.assign(document.createElement("a"), { href: url, download: fileName }).click();
  URL.revokeObjectURL(url);
}
