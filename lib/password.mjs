import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { isPostgres, query, transaction } from "./db.mjs";
import { audit, fail } from "./domain.mjs";

export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");

export function hashPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 200
  )
    fail("Use uma senha com 12 a 200 caracteres.");
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}

export function verifyPassword(password, hash) {
  if (typeof password !== "string" || password.length > 200) return false;
  const [salt, key, extra] = String(hash || "").split(":");
  if (
    extra !== undefined ||
    !/^[a-f0-9]{32}$/i.test(salt || "") ||
    !/^[a-f0-9]{128}$/i.test(key || "")
  )
    return false;
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(Buffer.from(key, "hex"), actual);
}

export async function changePassword(
  userId,
  sessionToken,
  currentPassword,
  nextPassword,
) {
  if (
    typeof nextPassword !== "string" ||
    nextPassword.length < 12 ||
    nextPassword.length > 200
  )
    fail("Use uma nova senha com 12 a 200 caracteres.");
  if (typeof sessionToken !== "string" || !sessionToken)
    fail("Sua sessão expirou. Entre novamente.", 401);

  const result = await transaction(async () => {
    const sessionId = digest(sessionToken);
    const row = (
      await query(
        "SELECT u.password_hash FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=$1 AND s.id=$2 AND s.expires_at>$3 AND u.active=1" +
          (isPostgres() ? " FOR UPDATE OF u" : ""),
        [userId, sessionId, new Date().toISOString()],
      )
    )[0];
    if (!row) return { error: "Sua sessão expirou. Entre novamente.", status: 401 };

    const attemptId = digest("password-change:" + userId);
    const now = new Date().toISOString();
    const attempts = (
      await query("SELECT count,reset_at FROM login_attempts WHERE id=$1", [attemptId])
    )[0];
    if (attempts && attempts.reset_at > now && attempts.count >= 8)
      return { error: "Muitas tentativas. Aguarde 15 minutos.", status: 429 };
    if (!verifyPassword(currentPassword, row.password_hash)) {
      const count = attempts && attempts.reset_at > now ? attempts.count + 1 : 1;
      await query(
        "INSERT INTO login_attempts(id,count,reset_at) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET count=$2,reset_at=$3",
        [attemptId, count, new Date(Date.now() + 15 * 60 * 1000).toISOString()],
      );
      return { error: "A senha atual está incorreta.", status: 401 };
    }
    if (verifyPassword(nextPassword, row.password_hash))
      fail("Escolha uma senha diferente da atual.");

    await query("UPDATE users SET password_hash=$1 WHERE id=$2", [
      hashPassword(nextPassword),
      userId,
    ]);
    await query("DELETE FROM sessions WHERE user_id=$1 AND id<>$2", [
      userId,
      sessionId,
    ]);
    await query("DELETE FROM login_attempts WHERE id=$1", [attemptId]);
    await audit({ id: userId }, "users", userId, "senha alterada", null, null);
    return { ok: true };
  });
  if (result.error) fail(result.error, result.status);
  return result;
}
