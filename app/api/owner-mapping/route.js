import { requireUser, checkOrigin } from "../../../lib/auth.mjs";
import { query, list, update, transaction, isPostgres } from "../../../lib/db.mjs";
import { entityKeys, models } from "../../../lib/model.mjs";
import { isManagement } from "../../../lib/agenda.mjs";
import { audit, fail } from "../../../lib/domain.mjs";
import { errorResponse, jsonBody } from "../../../lib/http.mjs";
const entities = entityKeys.filter((entity) => models[entity].fields.some((field) => field.key === "owner" || field.key === "owner_id"));
export async function GET() {
  try {
    const user = await requireUser(); if (!isManagement(user)) fail("Acesso reservado à gestão.", 403);
    const counts = new Map();
    for (const entity of entities) for (const record of await list(entity)) if (!record.owner_id && record.owner) counts.set(record.owner, (counts.get(record.owner) || 0) + 1);
    return Response.json([...counts].map(([name, count]) => ({ name, count })));
  } catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  try {
    checkOrigin(request); const user = await requireUser(); if (!isManagement(user)) fail("Acesso reservado à gestão.", 403);
    const body = await jsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) fail("Dados de associação inválidos.");
    if (typeof body.name !== "string" || !body.name || body.name.length > 200 || typeof body.user_id !== "string") fail("Selecione nome antigo e conta de destino.");
    const target = (await query("SELECT id,name FROM users WHERE id=$1 AND active=1", [body.user_id]))[0]; if (!target) fail("Escolha uma conta ativa.");
    let count = 0;
    await transaction(async () => {
      for (const entity of entities) {
        if (isPostgres()) await query(`SELECT id FROM ${entity} ORDER BY id FOR UPDATE`);
        for (const old of (await list(entity)).filter((record) => !record.owner_id && record.owner === body.name)) {
          const record = await update(entity, old.id, { ...old, owner_id: target.id, owner: target.name }, old.version);
          await audit(user, entity, record.id, "responsável antigo associado a uma conta", old, record); count++;
        }
      }
    });
    return Response.json({ count });
  } catch (error) { return errorResponse(error); }
}
