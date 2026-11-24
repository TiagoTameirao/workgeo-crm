import { cnpjBase, hasCnpjFormat, normalizeCnpj } from "./cnpj.mjs";

const aliases = {
  empresa: "company_name", nome_da_empresa: "company_name", razao_social: "company_name", company: "company_name",
  unidade: "unit_name", nome_da_unidade: "unit_name", local: "unit_name", unidade_operacional: "unit_name",
  cnpj: "cnpj", segmento: "segment", materiais: "materials", porte: "size", evidencia_do_porte: "size_evidence", fonte_do_porte: "size_source",
  municipio: "city", cidade: "city", endereco: "address", latitude: "latitude", longitude: "longitude", site: "website", website: "website", maps: "maps_url", url_do_maps: "maps_url",
  prioridade: "priority", justificativa_da_prioridade: "priority_reason", fonte: "source", data_da_fonte: "source_date", aderencia: "fit", viabilidade: "viability", momento_comercial: "timing",
  contato: "contact_name", nome_do_contato: "contact_name", funcao_do_contato: "contact_role", telefone: "phone", email: "email", e_mail: "email", observacoes: "notes", notas: "notes",
};
const segments = ["Mineração", "Pedreira", "Siderurgia", "Concreteira", "Cimenteira", "Sucateiro", "Madeireira", "Areal", "Cerâmica", "Indústria", "Agro", "Serviços Ferroviários", "Outros", "Não informado"];
const sizes = ["Pequeno", "Médio", "Grande", "Desconhecido"];
const sizeEvidence = ["Confirmado", "Declarado", "Desconhecido"];
const priorities = ["Alta", "Média", "Baixa", "Não definida"];

function normalizeHeader(value) {
  return String(value || "").trim().replace(/^\uFEFF/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
function parseRows(text, delimiter) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error("O arquivo termina com um campo entre aspas sem fechamento.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}
function coordinate(value, min, max, field, errors) {
  if (!value) return undefined;
  const number = Number(value.replace(",", "."));
  if (!Number.isFinite(number) || number < min || number > max) errors.push(`${field} fora do intervalo válido`);
  return Number.isFinite(number) ? number : undefined;
}
function validateRow(data, rowNumber) {
  const errors = [];
  data.company_name = data.company_name?.trim();
  if (!data.company_name || data.company_name.length < 2 || data.company_name.length > 200) errors.push("informe uma empresa com até 200 caracteres");
  data.unit_name = data.unit_name?.trim() || data.company_name;
  if (data.unit_name && data.unit_name.length > 160) errors.push("unidade acima de 160 caracteres");
  if (data.cnpj) {
    data.cnpj = normalizeCnpj(data.cnpj);
    if (!hasCnpjFormat(data.cnpj)) errors.push("CNPJ precisa ter 14 posições: 12 letras/números e 2 dígitos finais");
  }
  if (data.segment && !segments.includes(data.segment)) errors.push("segmento não reconhecido");
  if (data.size && !sizes.includes(data.size)) errors.push("porte não reconhecido");
  if (data.size_evidence && !sizeEvidence.includes(data.size_evidence)) errors.push("evidência do porte não reconhecida");
  if (data.size && data.size !== "Desconhecido" && (!data.size_evidence || data.size_evidence === "Desconhecido" || !data.size_source)) errors.push("porte exige evidência e fonte");
  if (data.priority && !priorities.includes(data.priority)) errors.push("prioridade não reconhecida");
  if (data.priority && data.priority !== "Não definida" && !data.priority_reason) errors.push("prioridade exige justificativa");
  data.latitude = coordinate(data.latitude, -90, 90, "latitude", errors);
  data.longitude = coordinate(data.longitude, -180, 180, "longitude", errors);
  if ((data.latitude == null) !== (data.longitude == null)) errors.push("latitude e longitude devem ser informadas juntas");
  for (const key of ["website", "maps_url"]) if (data[key] && !/^https?:\/\//i.test(data[key])) errors.push(`${key === "website" ? "site" : "link do Maps"} precisa começar com http:// ou https://`);
  if (data.email && !/^\S+@\S+\.\S+$/.test(data.email)) errors.push("e-mail inválido");
  if (data.source_date && !/^\d{4}-\d{2}-\d{2}$/.test(data.source_date)) errors.push("data da fonte deve usar AAAA-MM-DD");
  return { rowNumber, data, errors };
}

export function parseProspectingCsv(input) {
  if (typeof input !== "string" || !input.trim()) throw new Error("Selecione um CSV preenchido.");
  const text = input.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiters = [";", ",", "\t"];
  const delimiter = delimiters.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const parsed = parseRows(text, delimiter);
  if (parsed.length < 2) throw new Error("Inclua o cabeçalho e pelo menos uma empresa.");
  const headers = parsed[0].map(normalizeHeader);
  const keys = headers.map((header) => aliases[header] || null);
  if (!keys.includes("company_name")) throw new Error("Inclua uma coluna chamada Empresa.");
  const recognized = keys.filter(Boolean);
  if (new Set(recognized).size !== recognized.length) throw new Error("Há colunas repetidas para o mesmo campo.");
  const rows = parsed.slice(1).map((values, index) => {
    const data = {};
    keys.forEach((key, column) => { if (key) data[key] = String(values[column] || "").trim(); });
    return validateRow(data, index + 2);
  });
  if (rows.length > 100) throw new Error("Importe até 100 linhas por vez. Divida listas maiores em arquivos menores.");
  return rows;
}

export function normalizeImportKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]/g, "");
}

export function importCompanyKey(data) {
  const cnpj = normalizeCnpj(data?.cnpj);
  return hasCnpjFormat(cnpj) ? `cnpj:${cnpjBase(cnpj)}` : `name:${normalizeImportKey(data?.company_name)}`;
}
