import type {
  AnnouncementPublisher,
  CreateAnnouncementInput,
  PortalAnnouncement,
  UpdateAnnouncementInput,
} from "@doan/shared";
import { ApiError } from "../auth/api";

const base = () => `${import.meta.env.VITE_API_URL ?? ""}/api/announcements`;

async function request<T>(
  token: string,
  path: string,
  method = "GET",
  body?: object,
): Promise<T> {
  const url = path ? `${base()}${path.startsWith("/") ? "" : "/"}${path}` : base();
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      response.status,
      data.error?.code ?? "REQUEST_FAILED",
      data.error?.message ?? "Không thể thực hiện yêu cầu.",
    );
  }
  return data as T;
}

export async function getAnnouncementsApi(
  token: string,
  category?: string,
): Promise<{ items: PortalAnnouncement[]; canPublish: boolean; role: string }> {
  const query = category && category !== "all" ? `?category=${category}` : "";
  return request<{ items: PortalAnnouncement[]; canPublish: boolean; role: string }>(
    token,
    query,
  );
}

export async function createAnnouncementApi(
  token: string,
  input: CreateAnnouncementInput,
): Promise<{ item: PortalAnnouncement }> {
  return request<{ item: PortalAnnouncement }>(token, "", "POST", input);
}

export async function updateAnnouncementApi(
  token: string,
  id: string,
  input: UpdateAnnouncementInput,
): Promise<{ item: PortalAnnouncement }> {
  return request<{ item: PortalAnnouncement }>(token, `/${id}`, "PATCH", input);
}

export async function deleteAnnouncementApi(
  token: string,
  id: string,
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(token, `/${id}`, "DELETE");
}

export async function getPublishersApi(
  token: string,
): Promise<{ publishers: AnnouncementPublisher[]; canManage: boolean }> {
  return request<{ publishers: AnnouncementPublisher[]; canManage: boolean }>(
    token,
    "/publishers",
  );
}

export async function grantPublisherApi(
  token: string,
  email: string,
): Promise<{ success: boolean; userId: string; displayName: string }> {
  return request<{ success: boolean; userId: string; displayName: string }>(
    token,
    "/publishers",
    "POST",
    { email },
  );
}

export async function revokePublisherApi(
  token: string,
  userId: string,
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(token, `/publishers/${userId}`, "DELETE");
}
