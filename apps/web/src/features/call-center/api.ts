import { ApiError } from "../auth/api";

const base = () => `${import.meta.env.VITE_API_URL ?? ""}/api/callcenter/`;

/** Thin client for /api/callcenter. */
export async function callCenterApi<T>(token: string, path: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch(base() + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    credentials: "include",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(response.status, data.error?.code ?? "REQUEST_FAILED", data.error?.message ?? "Không thể thực hiện yêu cầu.");
  return data as T;
}

/** Recordings need the bearer token, so they are fetched as a blob and played from an object URL. */
export async function recordingUrl(token: string, callId: string): Promise<string> {
  const response = await fetch(`${base()}calls/${callId}/recording`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error?.code ?? "RECORDING_FAILED", data.error?.message ?? "Không tải được ghi âm.");
  }
  return URL.createObjectURL(await response.blob());
}

/** Downloads a CSV export (Excel opens it directly thanks to the BOM the API adds). */
export async function downloadCsv(token: string, path: string, fileName: string) {
  const response = await fetch(base() + path, { headers: { Authorization: `Bearer ${token}` }, credentials: "include" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error?.code ?? "EXPORT_FAILED", data.error?.message ?? "Không xuất được tệp.");
  }
  const url = URL.createObjectURL(await response.blob());
  // Content-Disposition is not exposed cross-origin, so the page names the file itself.
  const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
  link.click();
  URL.revokeObjectURL(url);
}

export async function voicemailUrl(token: string, voicemailId: string): Promise<string> {
  const response = await fetch(`${base()}voicemails/${voicemailId}/recording`, { headers: { Authorization: `Bearer ${token}` }, credentials: "include" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error?.code ?? "RECORDING_FAILED", data.error?.message ?? "Không tải được thư thoại.");
  }
  return URL.createObjectURL(await response.blob());
}
