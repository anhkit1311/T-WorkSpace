import { ApiError } from "../auth/api";

export class AcademicError extends ApiError {
  blockers?: string[];
  details?: { row: number; message: string }[];
}

const base = () => `${import.meta.env.VITE_API_URL ?? ""}/api/academic/`;

/** Thin client for /api/academic; structured blockers and import errors survive into the UI. */
export async function academicApi<T>(token: string, path: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch(base() + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new AcademicError(response.status, data.error?.code ?? "REQUEST_FAILED", data.error?.message ?? "Không thể thực hiện yêu cầu.");
    error.blockers = data.error?.blockers;
    error.details = data.error?.details;
    throw error;
  }
  return data as T;
}

export async function downloadCsv(token: string, termId: string, kind: "assignments" | "schedule" | "grades") {
  const response = await fetch(`${base()}terms/${termId}/export/${kind}.csv`, { headers: { Authorization: `Bearer ${token}` }, credentials: "include" });
  if (!response.ok) throw new ApiError(response.status, "EXPORT_FAILED", "Không xuất được tệp.");
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download: /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? `${kind}.csv`,
  });
  link.click();
  URL.revokeObjectURL(url);
}

export async function uploadToChannel(token: string, channelId: string, file: File): Promise<{ id: string }> {
  const response = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/channels/${channelId}/attachments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) },
    credentials: "include",
    body: file,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error?.code ?? "UPLOAD_FAILED", data.error?.message ?? "Tải tệp thất bại.");
  return data.attachment;
}

// ---- shapes returned by the API ------------------------------------------------------

export type TermStatus = "draft" | "registration" | "execution" | "review" | "defense" | "grading" | "closed";

export interface AcademicProfile {
  systemAdmin: boolean;
  unitRoles: Record<string, ("unit_admin" | "unit_head")[]>;
  staff: { unitId: string; rank: string; active: boolean } | null;
  units: { id: string; code: string; name: string }[];
  enrollments: { termId: string; termCode: string; studentCode: string; eligible: boolean }[];
}

export interface TermSummary {
  id: string;
  code: string;
  name: string;
  status: TermStatus;
  unitId: string;
  unitCode: string;
  finalDueAt: string;
  projectCount: number;
}

export interface Milestone {
  id: string;
  code: string;
  name: string;
  kind: "proposal" | "progress" | "final";
  dueAt: string;
  required: boolean;
}

export interface TermDetail {
  id: string;
  unitId: string;
  code: string;
  name: string;
  status: TermStatus;
  registrationOpensAt: string;
  registrationClosesAt: string;
  finalDueAt: string;
  defenseStartsOn: string;
  defenseEndsOn: string;
  policy: {
    minCredits: number;
    minGpa: number;
    minGroupSize: number;
    maxGroupSize: number;
    maxPreferences: number;
    minSupervisionLogs: number;
    latePolicy: "reject" | "allow_flagged";
    weights: { supervisor: number; reviewer: number; committee: number };
    maxScoreDeviation: number;
    passScore: number;
    appealWindowDays: number;
    supervisorInCommittee: boolean;
  };
  gradesPublishedAt: string | null;
  version: number;
  milestones: Milestone[];
  rubric: { id: string; graderRole: "supervisor" | "reviewer" | "committee"; code: string; name: string; weight: number }[];
  nextPhase: TermStatus | null;
  blockers: string[];
  viewer: { admin: boolean; head: boolean; lecturer: boolean; student: boolean };
}

export interface Topic {
  id: string;
  code: string;
  title: string;
  summary: string;
  requirements: string;
  expectedOutcomes: string;
  keywords: string[];
  proposerKind: "lecturer" | "student";
  proposedBy: string;
  proposerName: string;
  supervisorId: string;
  supervisorName: string;
  supervisorRank: string;
  coSupervisorName: string | null;
  maxStudents: number;
  assignedStudents: number;
  pendingRegistrations: number;
  status: string;
  version: number;
  history?: { decision: string; note: string; fromStatus: string; toStatus: string; createdAt: string; actorName: string }[];
}

export interface Group {
  id: string;
  termId: string;
  leaderId: string;
  status: "forming" | "assigned" | "dissolved";
  version: number;
  projectId: string | null;
  projectCode: string | null;
  members: { studentId: string; displayName: string; studentCode: string; status: "active" | "invited" }[];
  registrations: { id: string; topicId: string; topicCode: string; topicTitle: string; supervisorName: string; rank: number; status: string; note: string }[];
}

export interface ProjectRow {
  id: string;
  code: string;
  status: string;
  studentCount: number;
  topicCode: string;
  topicTitle: string;
  supervisorName: string;
  reviewerName: string | null;
  recommendation: string | null;
  confirmedLogs: number;
  finalScore: number | null;
  letter: string | null;
  defenseAt: string | null;
  committeeCode: string | null;
}

export interface ProjectDetail {
  id: string;
  code: string;
  status: string;
  version: number;
  workspaceId: string | null;
  termId: string;
  termCode: string;
  topicCode: string;
  topicTitle: string;
  supervisorId: string;
  supervisorName: string;
  coSupervisorName: string | null;
  members: { studentId: string; studentCode: string; displayName: string; leader: boolean }[];
  milestones: (Milestone & { latestSubmissionId: string | null; latestVersion: number | null; latestReviewStatus: string | null; latestIsLate: boolean | null; latestSubmittedAt: string | null })[];
  supervision: { confirmed: number; total: number; last: string | null; required: number };
  events: { fromStatus: string | null; toStatus: string; note: string; createdAt: string; actorName: string | null }[];
  review: { reviewerId: string; reviewerName: string; dueAt: string; recommendation: string | null; submittedAt: string | null; comments: string | null; questions: string | null } | null;
  defense: { id: string; startsAt: string; endsAt: string; committeeId: string; committeeCode: string; committeeName: string; room: string } | null;
  result: { finalScore: number; letter: string; passed: boolean; publishedAt: string | null; adjustedByAppeal: boolean; supervisorScore: number; reviewerScore: number; committeeScore: number } | null;
  appeal: { id: string; status: string; reason: string; decisionNote: string | null; newScore: number | null; createdAt: string } | null;
  viewerRoles: { student: boolean; supervisor: boolean; reviewer: boolean; committee: boolean; admin: boolean; head: boolean };
}

export interface Submission {
  id: string;
  milestoneCode: string;
  milestoneName: string;
  versionNo: number;
  attachmentId: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  note: string;
  submittedAt: string;
  submittedBy: string;
  isLate: boolean;
  reviewStatus: string;
  feedback: string | null;
}

export interface SupervisionLog {
  id: string;
  heldAt: string;
  mode: "online" | "offline";
  content: string;
  nextActions: string;
  createdBy: string;
  supervisorConfirmedAt: string | null;
  studentConfirmedAt: string | null;
  studentConfirmedBy: string | null;
  version: number;
}

export interface Committee {
  id: string;
  code: string;
  name: string;
  room: string;
  status: "draft" | "confirmed" | "closed";
  version: number;
  members: { lecturerId: string; displayName: string; rank: string; role: "chair" | "secretary" | "member" }[];
  slots: { id: string; projectId: string; projectCode: string; topicTitle: string; status: string; startsAt: string; endsAt: string }[];
}

export interface Lecturer {
  lecturerId: string;
  displayName: string;
  staffCode: string;
  rank: string;
  quota: number;
  used: number;
  reviews: number;
}
