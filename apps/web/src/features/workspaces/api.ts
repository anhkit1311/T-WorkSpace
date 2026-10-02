import type { ChannelItem, GroupMemberItem } from "@doan/shared";
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
): Promise<T> {
  const res = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/api/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
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
