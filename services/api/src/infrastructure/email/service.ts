import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../../config/config.js";

interface SendOtpEmailOptions {
  to: string;
  otp: string;
  displayName: string;
  purpose?: "verification" | "password-reset";
}

let smtpTransporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (smtpTransporter) return smtpTransporter;

  if (config.smtpHost) {
    smtpTransporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      ...(config.smtpUser && config.smtpPass
        ? { auth: { user: config.smtpUser, pass: config.smtpPass } }
        : {}),
    });
    return smtpTransporter;
  }

  return null;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

export async function sendWorkspaceInvitation(to: string, link: string): Promise<void> {
  const subject = "[nexo] Lời mời tham gia nhóm làm việc";
  const textBody = `Bạn được mời tham gia nhóm làm việc trên nexo. Đăng nhập hoặc đăng ký bằng email này rồi mở liên kết để nhận lời mời:\n${link}\nLời mời hết hạn sau 7 ngày. Nếu bạn không muốn tham gia, hãy bỏ qua email này.`;
  const html = `<p>Bạn được mời tham gia nhóm trên nexo.</p><p><a href="${escapeHtml(link)}">Mở lời mời</a></p><p>Đăng nhập hoặc đăng ký bằng email này. Liên kết có hiệu lực 7 ngày.</p>`;
  if (config.resendApiKey) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: config.smtpFrom, to: [to], subject, html, text: textBody }),
    });
    if (response.ok) return;
  }
  const transporter = getTransporter();
  if (transporter) {
    await transporter.sendMail({ from: config.smtpFrom, to, subject, html, text: textBody });
    return;
  }
  throw new Error("Invitation email delivery unavailable");
}

export async function sendOtpEmail({
  to,
  otp,
  displayName,
  purpose = "verification",
}: SendOtpEmailOptions): Promise<void> {
  const resetting = purpose === "password-reset";
  const subject = `[nexo] ${otp} là mã ${resetting ? "đặt lại mật khẩu" : "xác thực tài khoản"} của bạn`;
  const textBody = `Xin chào ${displayName},\n\nMã ${resetting ? "đặt lại mật khẩu" : "xác thực OTP"} của bạn là: ${otp}\n\nMã này có hiệu lực trong ${config.otpExpirationMinutes} phút. Vui lòng không chia sẻ mã này cho bất kỳ ai. Nếu bạn không yêu cầu, hãy bỏ qua email này.\n\nTrân trọng,\nĐội ngũ nexo`;

  const htmlBody = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f7; margin: 0; padding: 24px; color: #1e293b; }
    .card { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 4px 16px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .logo { font-family: Georgia, serif; font-size: 28px; font-weight: 500; color: #0f172a; margin-bottom: 24px; display: flex; align-items: center; gap: 8px; }

    h2 { font-size: 22px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px; }
    p { font-size: 15px; line-height: 1.6; color: #475569; margin: 8px 0; }
    .otp-box { background: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0; }
    .otp-code { font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #1d4ed8; font-family: monospace; }
    .expiry { font-size: 13px; color: #64748b; margin-top: 8px; }
    .footer { margin-top: 28px; padding-top: 20px; border-top: 1px solid #f1f5f9; font-size: 13px; color: #94a3b8; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">nexo</div>
    <h2>${resetting ? "Đặt lại mật khẩu" : "Xác thực tài khoản của bạn"}</h2>
    <p>Xin chào <strong>${escapeHtml(displayName)}</strong>,</p>
    <p>${resetting ? "Dùng mã dưới đây để đặt lại mật khẩu nexo của bạn:" : "Cảm ơn bạn đã đăng ký tài khoản trên nền tảng không gian làm việc cộng tác nexo. Vui lòng sử dụng mã xác thực OTP bên dưới để kích hoạt tài khoản:"}</p>
    <div class="otp-box">
      <div class="otp-code">${otp}</div>
      <div class="expiry">Mã có hiệu lực trong vòng ${config.otpExpirationMinutes} phút</div>
    </div>
    <p>Nếu bạn không thực hiện đăng ký tài khoản này, vui lòng bỏ qua email.</p>
    <div class="footer">
      Email này được gửi tự động từ hệ thống nexo. Vui lòng không trả lời trực tiếp email này.
    </div>
  </div>
</body>
</html>
  `;

  // Production never exposes OTPs in logs or claims success without delivery.
  if (config.resendApiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${config.resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: config.smtpFrom,
          to: [to],
          subject,
          html: htmlBody,
          text: textBody,
        }),
      });

      if (res.ok) {
        console.log(`[EMAIL SERVICE] Đã gửi OTP thành công qua Resend API tới ${to}`);
        return;
      }
      console.warn(`[EMAIL SERVICE] Resend failed with status ${res.status}`);
    } catch (err) {
      console.warn("[EMAIL SERVICE] Resend request failed", err);
    }
  }

  // 2. Thử gửi qua SMTP Transporter (Gmail hoặc Custom SMTP) nếu có
  const transporter = getTransporter();
  if (transporter) {
    try {
      await transporter.sendMail({
        from: config.smtpFrom,
        to,
        subject,
        text: textBody,
        html: htmlBody,
      });
      console.log(`[EMAIL SERVICE] Đã gửi OTP thành công qua SMTP tới ${to}`);
      return;
    } catch (err) {
      console.warn("[EMAIL SERVICE] Lỗi gửi qua SMTP:", err);
    }
  }

  throw new Error("OTP email delivery failed; configure RESEND_API_KEY or SMTP_HOST");
}
