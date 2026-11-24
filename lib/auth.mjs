import { canonicalRole } from "./access.mjs";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { query, transaction } from "./db.mjs";
import { digest, hashPassword, verifyPassword } from "./password.mjs";
export { digest, hashPassword, verifyPassword } from "./password.mjs";
export async function currentUser() {
  const token = (await cookies()).get("wg_session")?.value;
  if (!token) return null;
  const rows = await query(
    "SELECT u.id,u.name,u.email,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.id=$1 AND s.expires_at>$2 AND u.active=1",
    [digest(token), new Date().toISOString()],
  );
  return rows[0] ? { ...rows[0], role: canonicalRole(rows[0].role) } : null;
}
export async function requireUser() {
  const user = await currentUser();
  if (!user)
    throw Object.assign(new Error("Entre para acessar o CRM."), {
      status: 401,
    });
  return user;
}
export function checkOrigin(request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_URL || new URL(request.url).origin;
  const deploymentOrigins = [
    process.env.VERCEL_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]
    .filter(Boolean)
    .map((host) => "https://" + host);
  const local =
    !process.env.VERCEL &&
    process.env.NODE_ENV === "development" &&
    origin &&
    ["localhost", "127.0.0.1"].includes(new URL(origin).hostname) &&
    new URL(origin).port === new URL(request.url).port;
  if (
    !origin ||
    (!local &&
      origin !== new URL(expected).origin &&
      !deploymentOrigins.includes(origin))
  )
    throw Object.assign(new Error("Origem da solicitação não autorizada."), {
      status: 403,
    });
}
export async function establishSession(user) {
  const token = randomBytes(32).toString("hex"),
    expires = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,$3)", [
    digest(token),
    user.id,
    expires.toISOString(),
  ]);
  (await cookies()).set("wg_session", token, {
    httpOnly: true,
    secure: !!process.env.VERCEL,
    sameSite: "strict",
    path: "/",
    expires,
  });
  return { id: user.id, name: user.name, role: canonicalRole(user.role), email: user.email };
}
export async function logout() {
  const jar = await cookies();
  const token = jar.get("wg_session")?.value;
  if (token) await query("DELETE FROM sessions WHERE id=$1", [digest(token)]);
  jar.delete("wg_session");
}
export { createUser } from "./user-registration.mjs";
export async function login(email, password) {
  const key = digest((email || "").toLowerCase());
  const now = new Date().toISOString();
  const user = await transaction(async () => {
    let attempts = (
      await query("SELECT * FROM login_attempts WHERE id=$1", [key])
    )[0];
    if (attempts && attempts.reset_at > now && attempts.count >= 8)
      throw Object.assign(new Error("Muitas tentativas. Aguarde 15 minutos."), {
        status: 429,
      });
    const row = (
      await query("SELECT * FROM users WHERE email=$1 AND active=1", [
        (email || "").toLowerCase().trim(),
      ])
    )[0];
    if (row && verifyPassword(password, row.password_hash)) {
      await query("DELETE FROM login_attempts WHERE id=$1", [key]);
      return row;
    }
    const count = attempts && attempts.reset_at > now ? attempts.count + 1 : 1;
    await query(
      "INSERT INTO login_attempts(id,count,reset_at) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET count=$2,reset_at=$3",
      [key, count, new Date(Date.now() + 15 * 60 * 1000).toISOString()],
    );
    return null;
  });
  if (!user)
    throw Object.assign(new Error("E-mail ou senha incorretos."), {
      status: 401,
    });
  return establishSession(user);
}

