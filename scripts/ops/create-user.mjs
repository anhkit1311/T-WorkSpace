// Creates a verified account without the e-mail OTP step (demo servers without SMTP/Resend).
// There is no self sign-up, so this is also how the first system administrator is made:
//   node scripts/ops/create-user.mjs admin@tdtu.edu.vn "Quản trị hệ thống" --admin
// Inside the API container:
//   docker compose ... cp scripts/ops/create-user.mjs api:/app/scripts/ops/create-user.mjs
//   docker compose ... exec api node scripts/ops/create-user.mjs demo1@example.com "Demo 1"
// A random password is generated and printed once; it is never stored in plain text.
// With --admin an existing account keeps its password and only gains the system_admin role.
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "../../dist/api/infrastructure/database/db.js";
import { hashPassword } from "../../dist/api/modules/auth/password.js";

const args = process.argv.slice(2);
const admin = args.includes("--admin");
const [email, displayName] = args.filter((arg) => arg !== "--admin");
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !displayName) {
  console.error('Usage: node scripts/ops/create-user.mjs <email> "<display name>" [--admin]');
  process.exit(1);
}
const password = randomBytes(9).toString("base64url");
try {
  const result = await pool.query(
    `INSERT INTO users(id, email, password_hash, display_name, email_verified)
     VALUES ($1, lower($2), $3, $4, true) ON CONFLICT ((lower(email))) DO NOTHING RETURNING id`,
    [randomUUID(), email, await hashPassword(password), displayName],
  );
  if (result.rowCount) console.log(`Created ${email} (${displayName}). Password: ${password}`);
  else if (!admin) {
    console.error(`An account with ${email} already exists; nothing was changed.`);
    process.exitCode = 1;
  } else console.log(`${email} already exists; its password is unchanged.`);
  if (admin) {
    await pool.query(
      `INSERT INTO academic_role_grants(id, user_id, role)
       SELECT $1, id, 'system_admin' FROM users WHERE lower(email) = lower($2) ON CONFLICT DO NOTHING`,
      [randomUUID(), email],
    );
    console.log(`${email} is a system administrator (Đồ án → Tài khoản & phân quyền).`);
  }
} finally {
  await pool.end();
}
