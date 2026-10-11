/** Server error codes that describe one input; everything else (network, rate limit,
 * unavailable email, unknown account) belongs in the form-level banner. */
const FIELD_BY_CODE: Record<string, "otp" | "password"> = {
  INVALID_OTP: "otp",
  OTP_EXPIRED: "otp",
  INVALID_PASSWORD: "password",
};

export function authErrorField(error: unknown): "otp" | "password" | "general" {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  return FIELD_BY_CODE[code] ?? "general";
}
