import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { config, getJwtSecret } from "../../config/config.js";
import { query } from "../../infrastructure/database/db.js";
import { sendOtpEmail } from "../../infrastructure/email/service.js";
import { HttpError } from "../../shared/http/http-error.js";

export function generateNumericOtp(digits = 6): string {
  const min = Math.pow(10, digits - 1);
  const max = Math.pow(10, digits);
  return randomInt(min, max).toString();
}

export function hashOtp(email: string, otp: string): string {
  return createHmac("sha256", getJwtSecret())
    .update(`${email.trim().toLowerCase()}:${otp.trim()}`)
    .digest("hex");
}

interface OtpRow {
  id: string;
  email: string;
  otp_hash: string;
  expires_at: Date;
  attempt_count: number;
  resend_count: number;
  last_sent_at: Date;
}

export async function createAndSendOtp(email: string, displayName: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const otp = generateNumericOtp(6);
  const otpHash = hashOtp(normalizedEmail, otp);
  const expiresAt = new Date(Date.now() + config.otpExpirationMinutes * 60 * 1000);

  await query(
    `INSERT INTO email_otps (id, email, otp_hash, expires_at, attempt_count, resend_count, last_sent_at)
     VALUES ($1, $2, $3, $4, 0, 0, now())
     ON CONFLICT (email) DO UPDATE SET
       otp_hash = EXCLUDED.otp_hash,
       expires_at = EXCLUDED.expires_at,
       attempt_count = 0,
       resend_count = CASE WHEN email_otps.last_sent_at > now() - interval '1 hour' THEN email_otps.resend_count + 1 ELSE 1 END,
       last_sent_at = now()`,
    [randomUUID(), normalizedEmail, otpHash, expiresAt],
  );

  await sendOtpEmail({ to: normalizedEmail, otp, displayName });
}

export async function resendOtp(
  email: string,
): Promise<{ success: boolean; message: string; cooldownSeconds: number }> {
  const normalizedEmail = email.trim().toLowerCase();

  // Kiểm tra tài khoản có tồn tại không
  const userResult = await query<{ id: string; display_name: string; email_verified: boolean }>(
    `SELECT id, display_name, email_verified FROM users WHERE email = $1`,
    [normalizedEmail],
  );
  const user = userResult.rows[0];
  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "Không tìm thấy người dùng với email này.");
  }

  if (user.email_verified) {
    throw new HttpError(
      400,
      "ALREADY_VERIFIED",
      "Tài khoản này đã được kích hoạt. Bạn có thể đăng nhập ngay.",
    );
  }

  // Kiểm tra hạn mức và cooldown
  const otpResult = await query<OtpRow>(`SELECT * FROM email_otps WHERE email = $1`, [
    normalizedEmail,
  ]);
  const existingOtp = otpResult.rows[0];

  if (existingOtp) {
    const timeSinceLastSent = (Date.now() - new Date(existingOtp.last_sent_at).getTime()) / 1000;
    if (timeSinceLastSent < config.otpResendCooldownSeconds) {
      const waitSeconds = Math.ceil(config.otpResendCooldownSeconds - timeSinceLastSent);
      throw new HttpError(
        429,
        "OTP_COOLDOWN",
        `Vui lòng đợi ${waitSeconds} giây trước khi yêu cầu gửi lại mã mới.`,
      );
    }

    if (existingOtp.resend_count >= config.otpMaxResends) {
      const isWithinHour = Date.now() - new Date(existingOtp.last_sent_at).getTime() < 3600 * 1000;
      if (isWithinHour) {
        throw new HttpError(
          429,
          "OTP_MAX_RESENDS",
          "Bạn đã yêu cầu gửi lại mã quá số lần cho phép. Vui lòng thử lại sau 1 giờ.",
        );
      }
    }
  }

  await createAndSendOtp(normalizedEmail, user.display_name);

  return {
    success: true,
    message: "Mã xác thực OTP mới đã được gửi đến email của bạn.",
    cooldownSeconds: config.otpResendCooldownSeconds,
  };
}

export async function verifyOtp(email: string, otp: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const cleanedOtp = otp.trim();

  if (!cleanedOtp || cleanedOtp.length !== 6 || !/^\d{6}$/.test(cleanedOtp)) {
    throw new HttpError(400, "INVALID_OTP", "Mã OTP phải gồm 6 chữ số.");
  }

  const result = await query<OtpRow>(`SELECT * FROM email_otps WHERE email = $1`, [
    normalizedEmail,
  ]);
  const record = result.rows[0];

  if (!record) {
    throw new HttpError(
      400,
      "INVALID_OTP",
      "Không tìm thấy yêu cầu xác thực hoặc mã đã được sử dụng.",
    );
  }

  if (record.attempt_count >= config.otpMaxAttempts) {
    throw new HttpError(
      429,
      "OTP_MAX_ATTEMPTS",
      "Bạn đã nhập sai mã quá 5 lần. Vui lòng bấm gửi lại mã OTP mới.",
    );
  }

  if (new Date() > new Date(record.expires_at)) {
    throw new HttpError(400, "OTP_EXPIRED", "Mã OTP đã hết hạn. Vui lòng bấm gửi lại mã mới.");
  }

  const candidateHash = hashOtp(normalizedEmail, cleanedOtp);
  const isMatch = timingSafeEqual(
    Buffer.from(candidateHash, "hex"),
    Buffer.from(record.otp_hash, "hex"),
  );

  if (!isMatch) {
    const nextAttempts = record.attempt_count + 1;
    await query(`UPDATE email_otps SET attempt_count = $1 WHERE email = $2`, [
      nextAttempts,
      normalizedEmail,
    ]);
    const remaining = config.otpMaxAttempts - nextAttempts;
    throw new HttpError(
      400,
      "INVALID_OTP",
      `Mã OTP không chính xác. Bạn còn ${Math.max(0, remaining)} lần thử.`,
    );
  }

  // Khớp OTP: kích hoạt tài khoản người dùng và xóa record OTP
  await query(`DELETE FROM email_otps WHERE email = $1`, [normalizedEmail]);
  await query(`UPDATE users SET email_verified = true, updated_at = now() WHERE email = $1`, [
    normalizedEmail,
  ]);
}
