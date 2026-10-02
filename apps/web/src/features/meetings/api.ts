import { ApiError } from "../auth/api";
import type { MeetingScheduleItem } from "@doan/shared";

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
