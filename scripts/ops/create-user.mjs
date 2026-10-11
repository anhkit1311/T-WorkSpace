// Creates a verified account without the e-mail OTP step (demo servers without SMTP/Resend).
// Usage inside the API container:
//   docker compose ... cp scripts/ops/create-user.mjs api:/app/scripts/ops/create-user.mjs
//   docker compose ... exec api node scripts/ops/create-user.mjs demo1@example.com "Demo 1"
// A random password is generated and printed once; it is never stored in plain text.
import { randomBytes, randomUUID } from "node:crypto";
import { pool } from "../../dist/api/infrastructure/database/db.js";
import { hashPassword } from "../../dist/api/modules/auth/password.js";

const [email, displayName] = process.argv.slice(2);
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !displayName) {
  console.error('Usage: node scripts/ops/create-user.mjs <email> "<display name>"');
  process.exit(1);
}
const password = randomBytes(9).toString("base64url");
try {
  const result = await pool.query(
    `INSERT INTO users(id, email, password_hash, display_name, email_verified)
     VALUES ($1, lower($2), $3, $4, true) ON CONFLICT ((lower(email))) DO NOTHING RETURNING id`,
    [randomUUID(), email, await hashPassword(password), displayName],
  );
  if (!result.rowCount) {
    console.error(`An account with ${email} already exists; nothing was changed.`);
    process.exitCode = 1;
  } else console.log(`Created ${email} (${displayName}). Password: ${password}`);
} finally {
  await pool.end();
}
