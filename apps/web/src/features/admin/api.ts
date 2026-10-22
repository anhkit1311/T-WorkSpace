import { ApiError } from "../auth/api";

const base = () => `${import.meta.env.VITE_API_URL ?? ""}/api/academic/`;

/** Thin client for /api/academic (faculties, lecturers, accounts, role grants). */
export async function academicApi<T>(token: string, path: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch(base() + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error?.code ?? "REQUEST_FAILED", data.error?.message ?? "Không thể thực hiện yêu cầu.");
  return data as T;
}

export interface AcademicProfile {
  systemAdmin: boolean;
  unitRoles: Record<string, ("unit_admin" | "unit_head")[]>;
  staff: { unitId: string; rank: string; active: boolean } | null;
  units: { id: string; code: string; name: string }[];
}

export const rankLabel: Record<string, string> = { cn: "CN", ths: "ThS", ts: "TS", pgs: "PGS.TS", gs: "GS.TS" };
