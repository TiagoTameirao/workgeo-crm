import { cnpjBase, hasCnpjFormat, normalizeCnpj } from "./cnpj.mjs";

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]/g, "");
}

export function findCompanyMatches(name, cnpj, companies, limit = 3) {
  const normalizedName = normalizeName(name);
  const normalizedCnpj = hasCnpjFormat(cnpj) ? normalizeCnpj(cnpj) : "";
  if (!normalizedName && !normalizedCnpj) return [];

  return (companies || [])
    .map((company) => {
      const existingCnpj = hasCnpjFormat(company.cnpj)
        ? normalizeCnpj(company.cnpj)
        : "";
      const existingName = normalizeName(company.name);
      const reasons = [];
      if (
        normalizedCnpj &&
        existingCnpj &&
        normalizedCnpj === existingCnpj
      )
        reasons.push("CNPJ igual");
      else if (
        normalizedCnpj &&
        existingCnpj &&
        cnpjBase(normalizedCnpj) === cnpjBase(existingCnpj)
      )
        reasons.push("Base do CNPJ igual");
      if (
        normalizedName &&
        existingName &&
        (normalizedName === existingName ||
          (Math.min(normalizedName.length, existingName.length) >= 7 &&
            (normalizedName.includes(existingName) ||
              existingName.includes(normalizedName))))
      )
        reasons.push(
          normalizedName === existingName ? "Nome igual" : "Nome parecido",
        );
      return reasons.length ? { company, reasons } : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      const exact = (item) =>
        item.reasons.includes("CNPJ igual") ||
        item.reasons.includes("Base do CNPJ igual") ||
        item.reasons.includes("Nome igual");
      return Number(exact(b)) - Number(exact(a));
    })
    .slice(0, Math.max(0, limit));
}
