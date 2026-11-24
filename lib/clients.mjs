import { transaction, get } from "./db.mjs";
import { saveRecord, fail } from "./domain.mjs";
import { canWrite } from "./model.mjs";
export async function createClient(user, input) {
  if (!input || !canWrite(user.role, "units"))
    fail("Seu perfil não cadastra clientes.", 403);
  return transaction(async () => {
    let company;
    if (input.company_mode === "existing") {
      company = await get("companies", input.company_id);
      if (!company) fail("Escolha uma empresa já cadastrada.");
    } else {
      if (typeof input.company_name !== "string" || !input.company_name.trim())
        fail("Informe o nome da empresa.");
      company = await saveRecord(user, "companies", {
        name: input.company_name.trim(),
        cnpj: input.cnpj || null,
        source: "Cadastro interno por " + user.name,
      });
    }
    const unit = await saveRecord(user, "units", {
      ...input,
      company_id: company.id,
      name: input.name?.trim() || company.name,
      segment: input.segment || "Não informado",
      source: input.source || "Cadastro interno por " + user.name,
      source_date: new Date().toISOString().slice(0, 10),
    });
    if (input.email || input.phone || input.contact_name)
      await saveRecord(user, "contacts", {
        unit_id: unit.id,
        name: input.contact_name?.trim() || "Canal geral — pessoa a confirmar",
        email: input.email || null,
        phone: input.phone ? input.phone.replace(/\D/g, "") : null,
        source: "Cadastro interno por " + user.name,
      });
    return unit;
  });
}
