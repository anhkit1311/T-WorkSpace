import type { TermStatus } from "./api";

type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "violet";

export const termPhases: { id: TermStatus; label: string }[] = [
  { id: "draft", label: "Chuẩn bị" },
  { id: "registration", label: "Đăng ký đề tài" },
  { id: "execution", label: "Thực hiện" },
  { id: "review", label: "Phản biện" },
  { id: "defense", label: "Bảo vệ" },
  { id: "grading", label: "Tổng hợp điểm" },
  { id: "closed", label: "Đã đóng" },
];

export const termLabel = (status: string) => termPhases.find((phase) => phase.id === status)?.label ?? status;

const topicStatuses: Record<string, [string, Tone]> = {
  draft: ["Nháp", "neutral"],
  awaiting_supervisor: ["Chờ GV nhận", "amber"],
  submitted: ["Chờ duyệt", "blue"],
  revision_requested: ["Cần chỉnh sửa", "amber"],
  approved: ["Đã duyệt", "green"],
  rejected: ["Từ chối", "red"],
  closed: ["Đã đóng", "neutral"],
};
export const topicStatus = (status: string) => topicStatuses[status] ?? [status, "neutral"];

const projectStatuses: Record<string, [string, Tone]> = {
  proposal: ["Làm đề cương", "neutral"],
  in_progress: ["Đang thực hiện", "blue"],
  final_submitted: ["Đã nộp báo cáo", "violet"],
  defense_approved: ["GVHD đồng ý bảo vệ", "violet"],
  under_review: ["Đang phản biện", "amber"],
  review_passed: ["Đủ điều kiện bảo vệ", "green"],
  review_failed: ["Không đủ ĐK bảo vệ", "red"],
  scheduled: ["Đã xếp lịch", "blue"],
  defended: ["Đã bảo vệ", "violet"],
  graded: ["Đã chốt điểm", "green"],
  completed: ["Hoàn thành", "green"],
  failed: ["Không đạt", "red"],
  withdrawn: ["Đã rút", "neutral"],
  suspended: ["Đình chỉ", "red"],
};
export const projectStatus = (status: string) => projectStatuses[status] ?? [status, "neutral"];

export const projectFlow = ["proposal", "in_progress", "final_submitted", "defense_approved", "under_review", "review_passed", "scheduled", "defended", "graded", "completed"];

const registrationStatuses: Record<string, [string, Tone]> = {
  pending: ["Chờ GV duyệt", "amber"],
  accepted: ["Được nhận", "green"],
  rejected: ["Bị từ chối", "red"],
  withdrawn: ["Đã rút", "neutral"],
  expired: ["Hết hạn", "neutral"],
};
export const registrationStatus = (status: string) => registrationStatuses[status] ?? [status, "neutral"];

const submissionStatuses: Record<string, [string, Tone]> = {
  pending: ["Chờ nhận xét", "amber"],
  accepted: ["Được chấp nhận", "green"],
  revision_requested: ["Cần sửa", "red"],
  superseded: ["Đã thay thế", "neutral"],
};
export const submissionStatus = (status: string) => submissionStatuses[status] ?? [status, "neutral"];

export const rankLabel: Record<string, string> = { cn: "CN", ths: "ThS", ts: "TS", pgs: "PGS.TS", gs: "GS.TS" };
export const committeeRoleLabel: Record<string, string> = { chair: "Chủ tịch", secretary: "Thư ký", member: "Ủy viên" };
export const graderRoleLabel: Record<string, string> = { supervisor: "Giảng viên hướng dẫn", reviewer: "Phản biện", committee: "Hội đồng" };
export const milestoneKindLabel: Record<string, string> = { proposal: "Đề cương", progress: "Tiến độ", final: "Báo cáo cuối" };

export const formatDateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "—";
export const formatDate = (value: string | null | undefined) => (value ? new Date(value).toLocaleDateString("vi-VN") : "—");

/** Value for <input type="datetime-local"> in the viewer's own time zone. */
export const toLocalInput = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

/** "email, Họ tên" per line (comma, semicolon or a tab pasted from Excel); a header row is skipped. */
export function parseAccountLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [email, ...name] = line.split(/[\t,;]/);
      return { email: email.trim(), displayName: name.join(" ").trim() };
    })
    .filter((row) => row.email.toLowerCase() !== "email");
}
