import { ApiError } from "../auth/api";
import type { MeetingNotes, MeetingOutcomes, MeetingScheduleItem, TaskItem } from "@doan/shared";

export type MeetingHistoryItem = {
  id: string;
  roomId: string;
  name: string;
  joinedAt: string;
  leftAt: string | null;
};

export async function getMeetingHistoryApi(accessToken: string): Promise<MeetingHistoryItem[]> {
  const response = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/meetings/history`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: "include",
  });
  const data = await response.json();
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.error?.code ?? "UNKNOWN_ERROR",
      data.error?.message ?? "Không tải được lịch sử cuộc họp.",
    );
  }
  return data.meetings;
}

export type MeetingScheduleInput = {
  roomId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  agenda?: string[];
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
