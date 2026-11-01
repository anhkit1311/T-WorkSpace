import { ApiError } from "../auth/api";
import type { CouncilSetupInput, CouncilView, MeetingAttendance, MeetingCalendar, MeetingInviteInput, MeetingNotes, MeetingOutcomes, MeetingRecordings, MeetingScheduleItem, TaskItem } from "@doan/shared";

export type MeetingScheduleInput = {
  roomId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  agenda?: string[];
  waitingRoom?: boolean;
  autoRecord?: boolean;
  muteOnJoin?: boolean;
  invite?: MeetingInviteInput;
};

async function scheduleRequest<T>(
  accessToken: string,
  path: string,
  method = "GET",
  body?: MeetingScheduleInput,
): Promise<T> {
  const response = await fetch(
    `${import.meta.env.VITE_API_URL ?? ""}/api/meetings/schedules${path}`,
    {
      method,
      credentials: "include",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.error?.code ?? "UNKNOWN_ERROR",
      data.error?.message ?? "Không thể xử lý lịch họp.",
    );
  return data as T;
}

/** Schedules and sessions (with who took part) that overlap [from, to); at most 42 days. */
export async function getMeetingCalendarApi(accessToken: string, from: Date, to: Date): Promise<MeetingCalendar> {
  const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
  const response = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/meetings/calendar?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: "include",
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(response.status, data.error?.code ?? "UNKNOWN_ERROR", data.error?.message ?? "Không tải được lịch họp.");
  return data as MeetingCalendar;
}

export async function getMeetingSchedulesApi(accessToken: string): Promise<MeetingScheduleItem[]> {
  const data = await scheduleRequest<{ schedules: MeetingScheduleItem[] }>(accessToken, "");
  return data.schedules;
}

export async function saveMeetingScheduleApi(
  accessToken: string,
  input: MeetingScheduleInput,
  id?: string,
): Promise<MeetingScheduleItem> {
  const data = await scheduleRequest<{ schedule: MeetingScheduleItem }>(
    accessToken,
    id ? `/${id}` : "",
    id ? "PATCH" : "POST",
    input,
  );
  return data.schedule;
}

export async function cancelMeetingScheduleApi(accessToken: string, id: string): Promise<void> {
  await scheduleRequest<{ ok: true }>(accessToken, `/${id}`, "DELETE");
}

async function outcomeRequest<T>(
  accessToken: string,
  sessionId: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    `${import.meta.env.VITE_API_URL ?? ""}/api/meetings/sessions/${sessionId}/${path}`,
    {
      method,
      credentials: "include",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.error?.code ?? "UNKNOWN_ERROR",
      data.error?.message ?? "Không thể cập nhật kết quả cuộc họp.",
    );
  return data as T;
}

export async function getMeetingOutcomesApi(accessToken: string, sessionId: string) {
  return (await outcomeRequest<{ outcomes: MeetingOutcomes }>(accessToken, sessionId, "outcomes"))
    .outcomes;
}

export async function saveMeetingNotesApi(
  accessToken: string,
  sessionId: string,
  content: string,
  baseVersion: number,
) {
  return (
    await outcomeRequest<{ notes: MeetingNotes }>(accessToken, sessionId, "notes", "PATCH", {
      content,
      baseVersion,
    })
  ).notes;
}

export async function addAgendaItemApi(accessToken: string, sessionId: string, label: string) {
  await outcomeRequest(accessToken, sessionId, "agenda", "POST", { label });
}

export async function updateAgendaItemApi(
  accessToken: string,
  sessionId: string,
  itemId: string,
  changes: { done?: boolean; label?: string },
) {
  await outcomeRequest(accessToken, sessionId, `agenda/${itemId}`, "PATCH", changes);
}

export async function deleteAgendaItemApi(accessToken: string, sessionId: string, itemId: string) {
  await outcomeRequest(accessToken, sessionId, `agenda/${itemId}`, "DELETE");
}

export async function setOutcomeChannelApi(
  accessToken: string,
  sessionId: string,
  channelId: string,
) {
  await outcomeRequest(accessToken, sessionId, "outcome-channel", "PATCH", { channelId });
}

export async function createMeetingTaskApi(
  accessToken: string,
  sessionId: string,
  input: { clientTaskId: string; title: string; assigneeId: string | null; dueAt: string | null },
) {
  return (await outcomeRequest<{ task: TaskItem }>(accessToken, sessionId, "tasks", "POST", input))
    .task;
}

export async function getMeetingAttendanceApi(accessToken: string, sessionId: string) {
  return (await outcomeRequest<{ attendance: MeetingAttendance }>(accessToken, sessionId, "attendance"))
    .attendance;
}

/** MT-2: the register as CSV; Excel opens it directly thanks to the BOM the API adds. */
export const downloadMeetingAttendanceApi = (accessToken: string, sessionId: string, fileName: string) =>
  downloadCsv(accessToken, `sessions/${sessionId}/attendance.xlsx`, fileName);

async function downloadCsv(accessToken: string, path: string, fileName: string) {
  const response = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/meetings/${path}`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error?.code ?? "EXPORT_FAILED", data.error?.message ?? "Không xuất được tệp.");
  }
  const url = URL.createObjectURL(await response.blob());
  // Content-Disposition is not exposed cross-origin, so the page names the file itself.
  Object.assign(document.createElement("a"), { href: url, download: fileName }).click();
  URL.revokeObjectURL(url);
}

const recordingsBase = () => `${import.meta.env.VITE_API_URL ?? ""}/api/meetings`;

async function meetingsRequest<T>(accessToken: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${recordingsBase()}/${path}`, {
    method,
    credentials: "include",
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(response.status, data.error?.code ?? "UNKNOWN_ERROR", data.error?.message ?? "Không thực hiện được thao tác.");
  return data as T;
}

export const getMeetingRecordingsApi = (accessToken: string, sessionId: string) =>
  meetingsRequest<MeetingRecordings>(accessToken, `sessions/${sessionId}/recordings`);
export const startMeetingRecordingApi = (accessToken: string, sessionId: string) =>
  meetingsRequest<{ id: string }>(accessToken, `sessions/${sessionId}/recordings`, "POST");
export const stopMeetingRecordingApi = (accessToken: string, recordingId: string) =>
  meetingsRequest<{ ok: true }>(accessToken, `recordings/${recordingId}/stop`, "POST");
export const shareMeetingRecordingApi = (accessToken: string, recordingId: string, shared: boolean) =>
  meetingsRequest<{ ok: true }>(accessToken, `recordings/${recordingId}`, "PATCH", { shared });
export const requestRecordingTranscriptApi = (accessToken: string, recordingId: string) =>
  meetingsRequest<{ transcriptStatus: "processing" }>(accessToken, `recordings/${recordingId}/transcript`, "POST");
/** A five-minute signed playlist link (spec: recordings only through links that expire). */
export const meetingRecordingLinkApi = async (accessToken: string, recordingId: string) =>
  `${import.meta.env.VITE_API_URL ?? ""}${(await meetingsRequest<{ url: string }>(accessToken, `recordings/${recordingId}/link`)).url}`;

/** M1: number and 6-digit code to join this room from a phone (internal extension). */
export async function getDialInApi(accessToken: string, roomId: string): Promise<{ number: string; code: string }> {
  const response = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/meetings/rooms/${roomId}/dial-in`, {
    credentials: "include",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.error?.code ?? "UNKNOWN_ERROR", data.error?.message ?? "Không lấy được mã gọi vào.");
  return data;
}

// NV-MT3 họp hội đồng
export const getSessionCouncilApi = async (accessToken: string, sessionId: string) =>
  (await meetingsRequest<{ council: CouncilView | null }>(accessToken, `sessions/${sessionId}/council`)).council;
export const getCouncilApi = async (accessToken: string, scheduleId: string) =>
  (await meetingsRequest<{ council: CouncilView | null }>(accessToken, `schedules/${scheduleId}/council`)).council;
export const saveCouncilApi = (accessToken: string, scheduleId: string, input: CouncilSetupInput) =>
  meetingsRequest(accessToken, `schedules/${scheduleId}/council`, "PATCH", input);
export const setCouncilMemberAbsentApi = (accessToken: string, scheduleId: string, userId: string, absent: boolean) =>
  meetingsRequest(accessToken, `schedules/${scheduleId}/council/members/${userId}`, "PATCH", { absent });
export const startPresenterApi = (accessToken: string, presenterId: string) =>
  meetingsRequest(accessToken, `council/presenters/${presenterId}/start`, "POST");
export const submitCouncilSheetApi = (
  accessToken: string,
  presenterId: string,
  input: { scores: Record<string, number>; comment: string },
) => meetingsRequest(accessToken, `council/presenters/${presenterId}/sheet`, "PATCH", input);
export const finalizePresenterApi = (accessToken: string, presenterId: string, conclusion: string) =>
  meetingsRequest(accessToken, `council/presenters/${presenterId}/finalize`, "POST", { conclusion });
export const downloadCouncilApi = (accessToken: string, scheduleId: string) =>
  downloadCsv(accessToken, `schedules/${scheduleId}/council.xlsx`, "bang-diem-hoi-dong.xlsx");
