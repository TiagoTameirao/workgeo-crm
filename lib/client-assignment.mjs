import { transaction, get, query } from "./db.mjs";
import { saveRecord, fail } from "./domain.mjs";
import { canWrite, models } from "./model.mjs";

const owners = models.units.fields.find((field) => field.key === "owner").options;

export async function assignUnits(user, input = {}) {
  if (!canWrite(user.role, "units"))
    fail("Seu perfil não pode distribuir clientes.", 403);
  if (
    (input.next_action != null && typeof input.next_action !== "string") ||
    (input.next_date != null && typeof input.next_date !== "string")
  )
    fail("Os campos de próxima ação e data são inválidos.");
  if (!Array.isArray(input.unit_ids) || input.unit_ids.length < 1 || input.unit_ids.length > 50)
    fail("Selecione entre 1 e 50 clientes.");
  if (
    input.unit_ids.some((id) => typeof id !== "string" || id.length > 100) ||
    new Set(input.unit_ids).size !== input.unit_ids.length
  )
    fail("A seleção de clientes é inválida.");
  const account = input.owner_id ? (await query("SELECT id,name FROM users WHERE id=$1 AND active=1", [input.owner_id]))[0] : null;
  if (input.owner_id && !account || !input.owner_id && !owners.includes(input.owner)) fail("Escolha um responsável válido.");
  const ownerName = account?.name || input.owner;
  const nextAction =
    input.next_action == null ? "" : String(input.next_action).trim();
  const nextDate = input.next_date == null ? "" : String(input.next_date);
  if (Boolean(nextAction) !== Boolean(nextDate))
    fail("Para definir a próxima ação, preencha também a data do retorno.");

  return transaction(async () => {
    let assigned = 0;
    for (const id of input.unit_ids) {
      const unit = await get("units", id);
      if (!unit) fail("Um cliente da seleção não foi encontrado. Atualize a lista.", 409);
      const update = { ...unit, owner: ownerName, owner_id: account?.id || null };
      if (nextAction) {
        update.next_action = nextAction;
        update.next_date = nextDate;
      }
      if (
        unit.owner !== update.owner || unit.owner_id !== update.owner_id ||
        (nextAction &&
          (unit.next_action !== update.next_action ||
            unit.next_date !== update.next_date))
      ) {
        await saveRecord(user, "units", update, id, unit.version);
        assigned += 1;
      }
    }
    return {
      assigned,
      selected: input.unit_ids.length,
      owner: ownerName,
      next_action: nextAction || null,
      next_date: nextDate || null,
    };
  });
}
