const CNPJ_FORMAT = /^[A-Z0-9]{12}\d{2}$/;

export function normalizeCnpj(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[.\-/\s]/g, "");
}

export function hasCnpjFormat(value) {
  return CNPJ_FORMAT.test(normalizeCnpj(value));
}

export function cnpjBase(value) {
  const normalized = normalizeCnpj(value);
  return hasCnpjFormat(normalized) ? normalized.slice(0, 8) : "";
}
