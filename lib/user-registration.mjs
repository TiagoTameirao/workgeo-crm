import { randomUUID } from "node:crypto";
import { query } from "./db.mjs";
import { internalRoles as roles, canonicalRole } from "./access.mjs";
import { hashPassword } from "./password.mjs";
export async function createUser(data) {
  if (
    typeof data?.name !== "string" || !data.name.trim() || data.name.trim().length > 200 || typeof data.email !== "string" || data.email.length > 200 ||
    !/^\S+@\S+\.\S+$/.test(data.email || "") ||
    !roles.includes(canonicalRole(data.role))
  )
    throw Object.assign(new Error("Informe nome, e-mail e perfil válidos."), {
      status: 400,
    });
  const user = {
    id: randomUUID(),
    name: data.name.trim(),
    email: data.email.toLowerCase().trim(),
    role: canonicalRole(data.role),
  };
  if ((await query("SELECT id FROM users WHERE email=$1", [user.email])).length) throw Object.assign(new Error("Este e-mail já possui uma conta. Edite ou reative o acesso existente."), { status: 409 });
  await query(
    "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)",
    [user.id, user.name, user.email, hashPassword(data.password), user.role],
  );
  return user;
}
