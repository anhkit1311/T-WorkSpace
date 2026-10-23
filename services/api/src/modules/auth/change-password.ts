import { withTransaction } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";
import { hashPassword, verifyPassword } from "./password.js";

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
    return { message: "Đã đổi mật khẩu. Vui lòng đăng nhập lại." };
  });
}
