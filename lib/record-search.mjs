function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]/g, "");
}

function textOf(record) {
  return Object.values(record || {})
    .filter((value) => ["string", "number"].includes(typeof value))
    .join(" ");
}

export function matchesRecordSearch(section, record, data, query, extraContext = "") {
  const term = normalize(query);
  if (!term) return true;

  const units = data.units || [];
  const companies = data.companies || [];
  const contacts = data.contacts || [];
  const relatedUnits = [];

  if (section === "units") relatedUnits.push(record);
  if (record.unit_id) {
    const unit = units.find((item) => item.id === record.unit_id);
    if (unit) relatedUnits.push(unit);
  }
  if (record.company_id) {
    relatedUnits.push(...units.filter((unit) => unit.company_id === record.company_id));
  }

  const unitIds = new Set(relatedUnits.map((unit) => unit.id));
  const companyIds = new Set(relatedUnits.map((unit) => unit.company_id));
  if (section === "companies") companyIds.add(record.id);
  if (record.company_id) companyIds.add(record.company_id);

  const relatedRecords = [
    record,
    ...relatedUnits,
    ...companies.filter((company) => companyIds.has(company.id)),
    ...contacts.filter(
      (contact) =>
        unitIds.has(contact.unit_id) || contact.id === record.contact_id,
    ),
  ];
  const searchable = normalize(
    [...relatedRecords.map(textOf), extraContext].join(" "),
  );
  return searchable.includes(term);
}
