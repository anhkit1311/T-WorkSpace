import type {
  ApiErrorResponse,
  AuthResponse,
  GoogleAuthInput,
  RegisterResponse,
  ResendOtpInput,
  ResendOtpResponse,
  VerifyOtpInput,
} from "@doan/shared";

export class ApiError extends Error {
  code: string;
  statusCode: number;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const API_BASE = import.meta.env.VITE_API_URL ?? "";

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as unknown as T;
  }

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

export async function loginApi(input: { email: string; password: string }): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  return handleResponse<AuthResponse>(response);
}

export async function requestPasswordResetApi(email: string): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/auth/password-reset/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return handleResponse<{ message: string }>(response);
}

export async function resetPasswordApi(input: {
  email: string;
  otp: string;
  password: string;
}): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/auth/password-reset/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<{ message: string }>(response);
}

export async function changePasswordApi(
  accessToken: string,
  input: { currentPassword: string; newPassword: string },
): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/auth/password/change`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    credentials: "include",
    body: JSON.stringify(input),
  });
  return handleResponse<{ message: string }>(response);
}

export async function verifyOtpApi(input: VerifyOtpInput): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  return handleResponse<AuthResponse>(response);
}

export async function resendOtpApi(input: ResendOtpInput): Promise<ResendOtpResponse> {
  const response = await fetch(`${API_BASE}/auth/resend-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  return handleResponse<ResendOtpResponse>(response);
}

export async function googleAuthApi(
  input: GoogleAuthInput,
): Promise<AuthResponse | RegisterResponse> {
  const response = await fetch(`${API_BASE}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  return handleResponse<AuthResponse | RegisterResponse>(response);
}

let refreshPending: Promise<AuthResponse> | null = null;
export function refreshSessionApi(): Promise<AuthResponse> {
  refreshPending ??= performRefresh().finally(() => {
    refreshPending = null;
  });
  return refreshPending;
}
async function performRefresh(): Promise<AuthResponse> {
  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  return handleResponse<AuthResponse>(response);
}

export async function logoutApi(): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  await handleResponse<void>(response);
}

