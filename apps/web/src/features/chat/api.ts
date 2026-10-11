import type {
  ApiErrorResponse,
  ChannelItem,
  ChatMessageItem,
  GroupMemberItem,
  GlobalMessageSearchItem,
  MemberProfile,
  WorkspaceItem,
} from "@doan/shared";
import { ApiError } from "../auth/api";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

async function handleResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type");
  const isJson = contentType && contentType.includes("application/json");
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    const errorData = data as ApiErrorResponse | null;
    const code = errorData?.error?.code ?? "UNKNOWN_ERROR";
    const message = errorData?.error?.message ?? `Yêu cầu thất bại (${response.status})`;
    throw new ApiError(response.status, code, message);
  }

  return data as T;
}

export async function getWorkspacesApi(accessToken: string): Promise<WorkspaceItem[]> {
  const response = await fetch(`${API_BASE}/api/workspaces`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    credentials: "include",
  });
  const data = await handleResponse<{ workspaces: WorkspaceItem[] }>(response);
  return data.workspaces;
}

export async function searchMessagesApi(
  accessToken: string,
  query: string,
  signal?: AbortSignal,
  filters?: Record<string, string>,
): Promise<GlobalMessageSearchItem[]> {
  const params = new URLSearchParams({ q: query });
  for (const [key, value] of Object.entries(filters ?? {})) if (value) params.set(key, value);
  const response = await fetch(`${API_BASE}/api/search/messages?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: "include",
    signal,
  });
  const data = await handleResponse<{ messages: GlobalMessageSearchItem[] }>(response);
  return data.messages;
}

export async function getChannelsApi(
  accessToken: string,
  workspaceId: string,
): Promise<ChannelItem[]> {
  const response = await fetch(`${API_BASE}/api/workspaces/${workspaceId}/channels`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    credentials: "include",
  });
  const data = await handleResponse<{ channels: ChannelItem[] }>(response);
  return data.channels;
}

export async function getMessagesApi(
  accessToken: string,
  channelId: string,
  limit?: number,
  before?: string,
  search?: string,
  after?: string,
): Promise<ChatMessageItem[]> {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (before) params.set("before", before);
  if (search) params.set("search", search);
  if (after) params.set("after", after);
  const queryStr = params.toString();
  const url = `${API_BASE}/api/channels/${channelId}/messages${queryStr ? `?${queryStr}` : ""}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    credentials: "include",
  });
  const data = await handleResponse<{ messages: ChatMessageItem[] }>(response);
  return data.messages;
}

export async function setChannelPreferenceApi(
  accessToken: string,
  channelId: string,
  input: { pinned?: boolean; muted?: boolean; markRead?: boolean },
): Promise<{ pinned: boolean; muted: boolean }> {
  const response = await fetch(`${API_BASE}/api/channels/${channelId}/preferences`, {
    method: "POST",
    credentials: "include",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await handleResponse<{ preference: { pinned: boolean; muted: boolean } }>(response);
  return data.preference;
}

/**
 * The API exposes pin/bookmark as toggles (POST /api/messages/:id/pin|bookmark); callers pass the
 * flag they want to flip. Pinning is limited to workspace owners/admins by the server.
 */
export async function setMessagePreferenceApi(
  accessToken: string,
  messageId: string,
  input: { pinned: boolean } | { bookmarked: boolean },
): Promise<void> {
  const action = "pinned" in input ? "pin" : "bookmark";
  const response = await fetch(`${API_BASE}/api/messages/${messageId}/${action}`, {
    method: "POST",
    credentials: "include",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  await handleResponse<{ success: boolean }>(response);
}

export async function uploadAttachmentApi(
  accessToken: string,
  channelId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<NonNullable<ChatMessageItem["attachment"]>> {
  const response = await new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/channels/${channelId}/attachments`);
    xhr.withCredentials = true;
    xhr.timeout = 30000;
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error("Mất kết nối khi tải tệp. Hãy thử lại."));
    xhr.ontimeout = () => reject(new Error("Tải tệp quá thời gian. Hãy thử lại."));
    xhr.onabort = () => reject(new Error("Đã hủy tải tệp."));
    xhr.onload = () => {
      onProgress?.(100);
      resolve(
        new Response(xhr.responseText, {
          status: xhr.status,
          headers: { "Content-Type": xhr.getResponseHeader("Content-Type") ?? "application/json" },
        }),
      );
    };
    onProgress?.(0);
    xhr.send(file);
  });
  return (
    await handleResponse<{ attachment: NonNullable<ChatMessageItem["attachment"]> }>(response)
  ).attachment;
}

export async function getAttachmentBlobApi(
  accessToken: string,
  attachmentId: string,
): Promise<Blob> {
  const response = await fetch(`${API_BASE}/api/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: "include",
  });
  if (!response.ok) throw new Error("Không tải được tệp đính kèm.");
  return response.blob();
}

export async function getMemberProfileApi(
  accessToken: string,
  userId: string,
): Promise<MemberProfile> {
  const response = await fetch(`${API_BASE}/api/users/${userId}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    credentials: "include",
  });
  const data = await handleResponse<{ profile: MemberProfile }>(response);
  return data.profile;
}

export async function createWorkspaceApi(
  accessToken: string,
  name: string,
): Promise<WorkspaceItem> {
  const response = await fetch(`${API_BASE}/api/workspaces`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  const data = await handleResponse<{ workspace: WorkspaceItem }>(response);
  return data.workspace;
}

export async function getWorkspaceMembersApi(
  accessToken: string,
  workspaceId: string,
): Promise<GroupMemberItem[]> {
  const response = await fetch(`${API_BASE}/api/workspaces/${workspaceId}/members`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    credentials: "include",
  });
  const data = await handleResponse<{ members: GroupMemberItem[] }>(response);
  return data.members;
}

export async function rejectMemberApi(
  accessToken: string,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/workspaces/${workspaceId}/members/reject`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    credentials: "include",
    body: JSON.stringify({ userId }),
  });
  await handleResponse<{ ok: boolean }>(response);
}
