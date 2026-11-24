import { transaction, get, list } from "./db.mjs";
import { audit, fail, saveRecord } from "./domain.mjs";
import { canWrite } from "./model.mjs";
import { findCompanyMatches } from "./company-matches.mjs";
import { importCompanyKey, normalizeImportKey } from "./client-csv.mjs";
import { hasCnpjFormat, normalizeCnpj } from "./cnpj.mjs";

const trim = (value) => typeof value === "string" ? value.trim() : "";

function prepareRows(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100)
    fail("Envie entre 1 e 100 linhas válidas por lote.");
  return input.map((item) => {
    const raw = item?.data;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("Linha de importação inválida.");
    const data = { ...raw, company_name: trim(raw.company_name), unit_name: trim(raw.unit_name) };
    if (data.company_name.length < 2 || data.company_name.length > 200) fail("Empresa inválida na importação.");
    if (!data.unit_name) data.unit_name = data.company_name;
    if (data.unit_name.length > 160) fail("Nome da unidade muito longo.");
    if (data.cnpj) {
      data.cnpj = normalizeCnpj(data.cnpj);
      if (!hasCnpjFormat(data.cnpj)) fail(`CNPJ inválido na linha ${item.rowNumber}.`);
    }
    if ((data.latitude == null) !== (data.longitude == null)) fail(`Coordenadas incompletas na linha ${item.rowNumber}.`);
    for (const key of ["latitude", "longitude"]) if (data[key] != null && !Number.isFinite(Number(data[key]))) fail(`Coordenada inválida na linha ${item.rowNumber}.`);
    return { rowNumber: Number.isInteger(item.rowNumber) ? item.rowNumber : 0, data, companyKey: importCompanyKey(data) };
  });
}

export async function importClients(user, input) {
  if (!canWrite(user.role, "units")) fail("Seu perfil não importa clientes.", 403);
  const rows = prepareRows(input?.rows);
  const choices = input?.companyChoices;
  if (!choices || typeof choices !== "object" || Array.isArray(choices)) fail("Resolva as empresas antes de importar.");
  return transaction(async () => {
    const companies = await list("companies");
    const units = await list("units");
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.companyKey)) groups.set(row.companyKey, []);
      groups.get(row.companyKey).push(row);
    }
    const companyForGroup = new Map();
    let createdCompanies = 0;
    for (const [key, group] of groups) {
      const first = group[0].data;
      const matches = findCompanyMatches(first.company_name, first.cnpj, companies, 5);
      const choice = choices[key];
      if (matches.length && !choice) fail(`Escolha o destino da empresa “${first.company_name}” antes de importar.`);
      if (choice === "__new") {
        const created = await saveRecord(user, "companies", {
          name: first.company_name,
          cnpj: first.cnpj || null,
          source: first.source || "Importação CSV",
        });
        companyForGroup.set(key, created);
        companies.push(created);
        createdCompanies++;
      } else if (typeof choice === "string" && choice) {
        const match = matches.find(({ company }) => company.id === choice);
        if (!match) fail(`Empresa escolhida não corresponde à linha de importação: ${first.company_name}.`);
        const selected = await get("companies", choice);
        if (!selected) fail("Empresa selecionada não encontrada.", 409);
        companyForGroup.set(key, selected);
      } else {
        const created = await saveRecord(user, "companies", {
          name: first.company_name,
          cnpj: first.cnpj || null,
          source: first.source || "Importação CSV",
        });
        companyForGroup.set(key, created);
        companies.push(created);
        createdCompanies++;
      }
    }

    const seenUnits = new Set(units.map((unit) => `${unit.company_id}:${normalizeImportKey(unit.name)}`));
    const imported = [], skipped = [], contacts = [];
    for (const row of rows) {
      const { data, rowNumber, companyKey } = row;
      const company = companyForGroup.get(companyKey);
      const unitKey = `${company.id}:${normalizeImportKey(data.unit_name)}`;
      if (seenUnits.has(unitKey)) {
        skipped.push({ rowNumber, reason: "Unidade já cadastrada nessa empresa." });
        continue;
      }
      const unit = await saveRecord(user, "units", {
        company_id: company.id,
        name: data.unit_name,
        segment: data.segment || "Não informado",
        materials: data.materials || "",
        size: data.size || "Desconhecido",
        size_evidence: data.size_evidence || "Desconhecido",
        size_source: data.size_source || "",
        priority: data.priority || "Não definida",
        priority_reason: data.priority_reason || "",
        status: "Pesquisa",
        city: data.city || "",
        address: data.address || "",
        latitude: data.latitude == null || data.latitude === "" ? null : Number(data.latitude),
        longitude: data.longitude == null || data.longitude === "" ? null : Number(data.longitude),
        maps_url: data.maps_url || "",
        website: data.website || "",
        source: data.source || "Importação CSV",
        source_date: data.source_date || new Date().toISOString().slice(0, 10),
        fit: data.fit || "",
        viability: data.viability || "",
        timing: data.timing || "",
        notes: data.notes || "",
      });
      imported.push(unit);
      seenUnits.add(unitKey);
      if (data.contact_name || data.phone || data.email) {
        const contact = await saveRecord(user, "contacts", {
          unit_id: unit.id,
          name: data.contact_name || "Canal geral — pessoa a confirmar",
          role: data.contact_role || "",
          phone: data.phone ? String(data.phone).replace(/\D/g, "") : "",
          email: data.email || "",
          source: data.source || "Importação CSV",
          verified_at: "",
        });
        contacts.push(contact);
      }
    }
    if (!imported.length) fail("Nenhuma unidade nova para importar; confira as linhas repetidas.");
    await audit(user, "clients_import", rows[0].companyKey, "importação CSV", null, {
      requested: rows.length,
      created: imported.length,
      contacts: contacts.length,
      skipped,
    });
    return { created: imported.length, companies: createdCompanies, contacts: contacts.length, skipped };
  });
}
