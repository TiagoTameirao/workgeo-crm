import { canonicalRole } from "./access.mjs";
import { isManagement } from "./agenda.mjs";
import { query, transaction, isPostgres } from "./db.mjs";
import { roles } from "./model.mjs";
import { audit, fail } from "./domain.mjs";

export async function updateUserAccess(actor, input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("Dados de acesso inválidos.");
  const { user_id: userId, active, email } = input;
  const role = input.role === undefined ? undefined : canonicalRole(input.role);
  if (typeof userId !== "string" || !userId.trim())
    fail("Selecione um acesso válido.");
  if (role === undefined && active === undefined && email === undefined)
    fail("Informe o novo perfil ou a situação do acesso.");
  if (email !== undefined && (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email) || email.length > 200)) fail("E-mail inválido.");
  if (role !== undefined && !roles.includes(role))
    fail("Perfil de acesso inválido.");
  if (active !== undefined && typeof active !== "boolean")
    fail("Situação de acesso inválida.");

  return transaction(async () => {
    const lock = isPostgres() ? " FOR UPDATE" : "";
    const currentActor = (
      await query(
        "SELECT id,role,active FROM users WHERE id=$1" + lock,
        [actor?.id],
      )
    )[0];
    if (!currentActor || currentActor.active !== 1 || !isManagement(currentActor))
      fail("Acesso reservado ao administrador.", 403);
    const before = (
      await query(
        "SELECT id,name,email,role,active FROM users WHERE id=$1" + lock,
        [userId],
      )
    )[0];
    if (!before) fail("Acesso não encontrado.", 404);

    if (email && (await query("SELECT id FROM users WHERE email=$1 AND id<>$2", [email.trim().toLowerCase(), userId])).length) fail("Este e-mail já está associado a outra conta.", 409);
    const nextRole = role ?? before.role;
    const nextActive = active === undefined ? before.active : active ? 1 : 0;
    const removingAdmin =
      before.role === "Administrador" &&
      before.active === 1 &&
      (nextRole !== "Administrador" || nextActive !== 1);
    if (removingAdmin) {
      const admins = await query(
        "SELECT id FROM users WHERE role=$1 AND active=1 ORDER BY id" +
          (isPostgres() ? " FOR UPDATE" : ""),
        ["Administrador"],
      );
      if (admins.length <= 1)
        fail("Mantenha ao menos um administrador ativo.", 409);
    }
    if (currentActor.id === userId && (role !== undefined || active === false))
      fail("Peça a outro administrador para alterar seu próprio acesso.", 409);

    const after = {
      id: before.id,
      name: before.name,
      email: email?.trim().toLowerCase() ?? before.email,
      role: nextRole,
      active: nextActive,
    };
    await query("UPDATE users SET role=$1,active=$2,email=$4 WHERE id=$3", [
      nextRole,
      nextActive,
      userId,
      after.email,
    ]);
    if (nextActive !== 1 || after.email !== before.email)
      await query("DELETE FROM sessions WHERE user_id=$1", [userId]);
    await audit(
      currentActor,
      "users",
      userId,
      "alteração de acesso",
      before,
      after,
    );
    return after;
  });
}
