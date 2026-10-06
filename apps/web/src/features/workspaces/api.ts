import type {
  ChannelItem,
  GroupMemberItem,
  WorkspaceFileItem,
  WorkspaceOverviewSummary,
} from "@doan/shared";
import { ApiError } from "../auth/api";

export interface Administration {
  workspace: {
    id: string;
    name: string;
    description: string;
    archivedAt: string | null;
    ownerId: string;
  };
  channels: (ChannelItem & { memberIds: string[] })[];
  invitations: {
    id: string;
    email: string | null;
    expiresAt: string;
    status: "pending" | "accepted" | "expired" | "revoked";
  }[];
  audit: {
    id: string;
    action: string;
    actorName: string | null;
    createdAt: string;
    targetId: string | null;
  }[];
  usage: { bytes: string; files: number; quotaBytes: number };
  members?: GroupMemberItem[];
}

export async function governanceApi<T = { success: boolean }>(
  token: string,
  path: string,
  method = "GET",
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = await res.json();
  if (!res.ok)
    throw new ApiError(
      res.status,
      data.error?.code ?? "REQUEST_FAILED",
      data.error?.message ?? "Không thể thực hiện yêu cầu.",
    );
  return data as T;
}

export async function getWorkspaceOverviewApi(
  token: string,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<WorkspaceOverviewSummary> {
  return governanceApi<WorkspaceOverviewSummary>(
    token,
    `workspaces/${workspaceId}/overview`,
    "GET",
    undefined,
    signal,
  );
}

export async function getWorkspaceFilesApi(
  token: string,
  workspaceId: string,
  options?: { before?: string | null; limit?: number; signal?: AbortSignal },
): Promise<{ files: WorkspaceFileItem[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (options?.before) params.set("before", options.before);
  if (options?.limit) params.set("limit", String(options.limit));
  const query = params.toString();
  return governanceApi<{ files: WorkspaceFileItem[]; nextCursor: string | null }>(
    token,
    `workspaces/${workspaceId}/files${query ? `?${query}` : ""}`,
    "GET",
    undefined,
    options?.signal,
  );
}

