import { requireUser, checkOrigin } from "../../../lib/auth.mjs";
import { query, transaction } from "../../../lib/db.mjs";
import { audit, fail } from "../../../lib/domain.mjs";
import { jsonBody, errorResponse } from "../../../lib/http.mjs";
export async function GET() {
  try {
    const user = await requireUser();
    return Response.json({ ...JSON.parse((await query("SELECT data FROM user_profiles WHERE user_id=$1", [user.id]))[0]?.data || "{}"), ...user });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request) {
  try {
    checkOrigin(request);
    const user = await requireUser(), input = await jsonBody(request);
    if (!input || typeof input !== "object" || Array.isArray(input)) fail("Dados de perfil inválidos.");
    if (Object.keys(input).some((key) => !["name", "phone", "job", "department"].includes(key))) fail("Altere apenas seus dados pessoais. O acesso é gerido pela equipe.");
    for (const value of Object.values(input)) if (typeof value !== "string" || value.length > 200) fail("Preencha os dados com até 200 caracteres.");
    if (input.name !== undefined && !input.name.trim()) fail("Informe seu nome.");
    await transaction(async () => {
      const before = JSON.parse((await query("SELECT data FROM user_profiles WHERE user_id=$1", [user.id]))[0]?.data || "{}");
      const after = { ...before, ...input };
      delete after.name;
      await query("INSERT INTO user_profiles(user_id,data) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET data=$2", [user.id, JSON.stringify(after)]);
      if (input.name) await query("UPDATE users SET name=$1 WHERE id=$2", [input.name.trim(), user.id]);
      await audit(user, "user_profiles", user.id, "atualização do perfil", before, input);
    });
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
