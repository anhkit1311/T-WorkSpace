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

/**
 * Recordings are served only through a one-minute signed link (spec: links that expire). The link is
 * asked for with the token, then the audio is fetched through it and played from an object URL.
 */
async function signedAudio(token: string, path: string, failure: string): Promise<string> {
  const fail = async (response: Response) => {
    const data = await response.json().catch(() => ({}));
    return new ApiError(response.status, data.error?.code ?? "RECORDING_FAILED", data.error?.message ?? failure);
  };
  const link = await fetch(`${base()}${path}/link`, { headers: { Authorization: `Bearer ${token}` }, credentials: "include" });
  if (!link.ok) throw await fail(link);
  const { url } = (await link.json()) as { url: string };
  const response = await fetch(`${import.meta.env.VITE_API_URL ?? ""}${url}`, { credentials: "include" });
  if (!response.ok) throw await fail(response);
  return URL.createObjectURL(await response.blob());
}

export const recordingUrl = (token: string, callId: string) => signedAudio(token, `calls/${callId}/recording`, "Không tải được ghi âm.");

/** Downloads an export (.xlsx, or .csv with the BOM the API adds). */
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

export const voicemailUrl = (token: string, voicemailId: string) =>
  signedAudio(token, `voicemails/${voicemailId}/recording`, "Không tải được thư thoại.");
