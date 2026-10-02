import { createHmac, timingSafeEqual } from "node:crypto";
import { config, getJwtSecret } from "../../config/config.js";
import { query, withTransaction } from "../../infrastructure/database/db.js";
import { sendOtpEmail } from "../../infrastructure/email/service.js";
import { HttpError } from "../../shared/http/http-error.js";
import { generateNumericOtp } from "./otp.js";
import { hashPassword, verifyPassword } from "./password.js";

const response = { message: "Nếu email thuộc tài khoản dùng mật khẩu, mã đặt lại đã được gửi." };

function normalizeEmail(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  )
    throw new HttpError(400, "INVALID_EMAIL", "Email không hợp lệ.");
  return value.trim().toLowerCase();
}

export function hashPasswordResetOtp(email: string, otp: string): string {
  return createHmac("sha256", getJwtSecret())
    .update(`password-reset:${email}:${otp}`)
    .digest("hex");
}

export async function requestPasswordReset(input: { email?: unknown }): Promise<typeof response> {
  const email = normalizeEmail(input.email);
  const result = await query<{ display_name: string }>(
    `SELECT display_name FROM users WHERE email=$1 AND password_hash IS NOT NULL AND email_verified=true`,
    [email],
  );
  if (!result.rowCount) return response;

  const otp = generateNumericOtp();
  const otpHash = hashPasswordResetOtp(email, otp);
  const saved = await query(
    `INSERT INTO password_resets(email, otp_hash, expires_at, attempt_count, sent_at)
     VALUES ($1,$2,now() + ($3::integer * interval '1 minute'),0,now())
     ON CONFLICT(email) DO UPDATE SET otp_hash=EXCLUDED.otp_hash,
       expires_at=EXCLUDED.expires_at, attempt_count=0, sent_at=now()
     WHERE password_resets.sent_at < now() - ($4::integer * interval '1 second')
     RETURNING email`,
    [email, otpHash, config.otpExpirationMinutes, config.otpResendCooldownSeconds],
  );
  if (!saved.rowCount) return response;
  try {
    await sendOtpEmail({
      to: email,
      otp,
      displayName: result.rows[0].display_name,
      purpose: "password-reset",
    });
  } catch {
    await query(`DELETE FROM password_resets WHERE email=$1 AND otp_hash=$2`, [email, otpHash]);
    throw new HttpError(503, "EMAIL_UNAVAILABLE", "Chưa thể gửi email. Vui lòng thử lại sau.");
  }
  return response;
}

export async function resetPassword(input: {
  email?: unknown;
  otp?: unknown;
  password?: unknown;
}): Promise<{ message: string }> {
  const email = normalizeEmail(input.email);
  if (typeof input.otp !== "string" || !/^\d{6}$/.test(input.otp))
    throw new HttpError(400, "INVALID_OTP", "Mã xác thực phải gồm 6 chữ số.");
  const otp = input.otp;
  if (
    typeof input.password !== "string" ||
    input.password.length < 8 ||
    input.password.length > 128
  )
    throw new HttpError(400, "INVALID_PASSWORD", "Mật khẩu phải có từ 8 đến 128 ký tự.");

  const passwordHash = await hashPassword(input.password);
  return withTransaction(async (client) => {
    const result = await client.query<{
      otp_hash: string;
      expires_at: Date;
      attempt_count: number;
    }>(
      `SELECT otp_hash, expires_at, attempt_count FROM password_resets WHERE email=$1 FOR UPDATE`,
      [email],
    );
    const record = result.rows[0];
    if (!record || new Date(record.expires_at).getTime() <= Date.now())
      throw new HttpError(
        400,
        "OTP_EXPIRED",
        "Mã không tồn tại hoặc đã hết hạn. Hãy yêu cầu mã mới.",
      );
    if (record.attempt_count >= config.otpMaxAttempts)
      throw new HttpError(
        429,
        "OTP_MAX_ATTEMPTS",
        "Bạn đã nhập sai mã quá số lần cho phép. Hãy yêu cầu mã mới.",
      );
    const expected = Buffer.from(record.otp_hash, "hex");
    const candidate = Buffer.from(hashPasswordResetOtp(email, otp), "hex");
    if (expected.length !== candidate.length || !timingSafeEqual(expected, candidate)) {
      await client.query(
        `UPDATE password_resets SET attempt_count=attempt_count+1 WHERE email=$1`,
        [email],
      );
      return { message: "INVALID_OTP" };
    }
    await client.query(`UPDATE users SET password_hash=$1, updated_at=now() WHERE email=$2`, [
      passwordHash,
      email,
    ]);
    await client.query(
      `UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=(SELECT id FROM users WHERE email=$1) AND revoked_at IS NULL`,
      [email],
    );
    await client.query(`DELETE FROM password_resets WHERE email=$1`, [email]);
    return { message: "Mật khẩu đã được cập nhật. Hãy đăng nhập bằng mật khẩu mới." };
  }).then((result) => {
    if (result.message === "INVALID_OTP")
      throw new HttpError(400, "INVALID_OTP", "Mã xác thực không đúng.");
    return result;
  });
}

export async function changePassword(
  userId: string,
  input: { currentPassword?: unknown; newPassword?: unknown },
): Promise<{ message: string }> {
  if (typeof input.currentPassword !== "string" || !input.currentPassword)
    throw new HttpError(400, "INVALID_PASSWORD", "Vui lòng nhập mật khẩu hiện tại.");
  if (
    typeof input.newPassword !== "string" ||
    input.newPassword.length < 8 ||
    input.newPassword.length > 128
  )
    throw new HttpError(400, "INVALID_PASSWORD", "Mật khẩu mới phải có từ 8 đến 128 ký tự.");
  if (input.currentPassword === input.newPassword)
    throw new HttpError(400, "PASSWORD_UNCHANGED", "Mật khẩu mới phải khác mật khẩu hiện tại.");
  return withTransaction(async (client) => {
    const user = await client.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM users WHERE id=$1 FOR UPDATE`,
      [userId],
    );
    if (!user.rowCount || !user.rows[0].password_hash)
      throw new HttpError(400, "PASSWORD_UNAVAILABLE", "Tài khoản này không dùng mật khẩu.");
    if (!(await verifyPassword(input.currentPassword as string, user.rows[0].password_hash)))
      throw new HttpError(401, "INVALID_CREDENTIALS", "Mật khẩu hiện tại không đúng.");
    const passwordHash = await hashPassword(input.newPassword as string);
    await client.query(`UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2`, [
      passwordHash,
      userId,
    ]);
    await client.query(
      `UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL`,
      [userId],
    );
    await client.query(
      `DELETE FROM password_resets WHERE email=(SELECT email FROM users WHERE id=$1)`,
      [userId],
    );
    return { message: "Đã đổi mật khẩu. Vui lòng đăng nhập lại." };
  });
}
