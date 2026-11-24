import { createReadStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readProspectingSnapshot } from "../lib/prospecting-snapshot-csv.mjs";
import { assessLeadEligibility } from "../lib/prospect-leads.mjs";
import { deriveCircleCenter, distanceMeters } from "../lib/territory-radius.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidatesPath = path.resolve(root, process.argv[2] || "deliverables/prospecting-cnpj/prospecting-cnpj-2026-10.csv");
const suggestionsPath = path.resolve(root, process.argv[3] || "deliverables/prospecting-cnpj/suggestions-2026-10-expanded.csv");
const kmlPath = path.resolve(root, "data/area_170km.original.kml");
const outputPath = path.resolve(root, process.argv[4] || "deliverables/prospecting-cnpj/lead-sieve-2026-10.json");

function parseKmlRing(kml) {
  const value = kml.match(/<coordinates\b[^>]*>([\s\S]*?)<\/coordinates>/i)?.[1];
  if (!value) throw new Error("O KML não contém uma lista de coordenadas.");
  const ring = value.trim().split(/\s+/).map((point) => point.split(",").slice(0, 2).map(Number));
  if (ring.length < 4 || ring.some(([longitude, latitude]) => !Number.isFinite(longitude) || !Number.isFinite(latitude))) throw new Error("O KML contém coordenadas inválidas.");
  return ring;
}

const radiusCenter = deriveCircleCenter(parseKmlRing(await readFile(kmlPath, "utf8")));
const suggestionMap = new Map();
const candidateHash = createHash("sha256"), suggestionHash = createHash("sha256");
let suggestionRows = 0, duplicateSuggestions = 0;
await readProspectingSnapshot(createReadStream(suggestionsPath), async (rows) => {
  for (const row of rows) {
    suggestionRows++;
    if (suggestionMap.has(row.cnpj)) { duplicateSuggestions++; continue; }
    const latitude = Number(row.latitude), longitude = Number(row.longitude);
    if (Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180)
      suggestionMap.set(row.cnpj, { latitude, longitude, confidence: row.confidence || "Desconhecida" });
  }
}, 250, (chunk) => suggestionHash.update(chunk));

const seen = new Set();
const eligibleRows = [];
let candidateHeaders = null;
const metrics = {
  establishments: 0,
  duplicate_cnpjs: 0,
  direct_segment: 0,
  cadastral_micro_or_small: 0,
  with_location_suggestion: 0,
  with_suggestion_inside_radius: 0,
  eligible_by_requested_sieve: 0,
  eligible_location_confidence: { Alta: 0, "Média": 0, Baixa: 0, Desconhecida: 0 },
  exclusion_reasons: { segment_not_direct: 0, size_not_confirmed_small_or_medium: 0, no_location: 0, outside_170_km: 0 },
  matched_suggestions: 0,
  unmatched_suggestions: 0,
};
await readProspectingSnapshot(createReadStream(candidatesPath), async (rows) => {
  for (const row of rows) {
    metrics.establishments++;
    if (seen.has(row.cnpj)) { metrics.duplicate_cnpjs++; continue; }
    seen.add(row.cnpj);
    candidateHeaders ||= Object.keys(row);
    const directSegment = String(row.scope_tier || "").startsWith("Aderência direta");
    const cadastralSmall = ["Microempresa", "Empresa de pequeno porte"].includes(row.size_label);
    if (directSegment) metrics.direct_segment++;
    if (cadastralSmall) metrics.cadastral_micro_or_small++;
    const suggestion = suggestionMap.get(row.cnpj);
    if (suggestion) {
      metrics.matched_suggestions++;
      metrics.with_location_suggestion++;
    }
    const distance = suggestion ? distanceMeters([suggestion.longitude, suggestion.latitude], [radiusCenter.longitude, radiusCenter.latitude]) : null;
    const withinRadius = distance != null && distance <= 170_000;
    if (withinRadius) metrics.with_suggestion_inside_radius++;
    const eligibility = assessLeadEligibility({ ...row, review_status: "Pendente", segment_fit: "Não avaliado", operating_size: "Não avaliado" }, distance, suggestion ? "Sugestão CNEFE · revisar" : "Sem localização disponível");
    if (eligibility.eligible) {
      metrics.eligible_by_requested_sieve++;
      const confidence = suggestion.confidence.match(/^(Alta|Média|Baixa)/i)?.[1] || "Desconhecida";
      const label = confidence[0].toLocaleUpperCase("pt-BR") + confidence.slice(1);
      metrics.eligible_location_confidence[label] = (metrics.eligible_location_confidence[label] || 0) + 1;
      eligibleRows.push({
        ...row,
        radius_distance_km: (distance / 1000).toFixed(2).replace(".", ","),
        radius_center_source: "Centro estimado do KML · provisório",
        location_evidence: `Sugestão CNEFE 2022 · ${label} · pendente de conferência`,
        lead_basis: "Segmento direto pelo CNAE; porte cadastral ME/EPP; localização sugerida até 170 km",
      });
    }
    if (!directSegment) metrics.exclusion_reasons.segment_not_direct++;
    if (!cadastralSmall) metrics.exclusion_reasons.size_not_confirmed_small_or_medium++;
    if (!suggestion) metrics.exclusion_reasons.no_location++;
    else if (!withinRadius) metrics.exclusion_reasons.outside_170_km++;
  }
}, 250, (chunk) => candidateHash.update(chunk));
metrics.unmatched_suggestions = suggestionMap.size - metrics.matched_suggestions;
const leadCsvPath = path.resolve(root, process.argv[5] || "deliverables/prospecting-cnpj/leads-eligible-2026-10.csv");
const leadCsvHeader = [...(candidateHeaders || []), "radius_distance_km", "radius_center_source", "location_evidence", "lead_basis"];
const csvCell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const leadCsv = `\uFEFF${[leadCsvHeader, ...eligibleRows.map((row) => leadCsvHeader.map((header) => row[header]))].map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
const leadCsvHash = createHash("sha256").update(leadCsv, "utf8").digest("hex");
const report = {
  generated_at: new Date().toISOString(),
  classification: "Auditoria local da peneira; coordenadas CNEFE e centro ajustado ao KML são provisórios, não confirmam endereço nem porte operacional.",
  rule: {
    radius_meters: 170000,
    radius_center: { ...radiusCenter, confirmed_by_user: false, selected_by_user_as_provisional: true },
    segment: "aderência direta da lista CNAE; segmentos adjacentes só contam após confirmação humana",
    size: "ME/EPP segundo Receita Federal, ou pequeno/médio confirmado pela equipe no CRM",
    location: "coordenada manual confirmada, ou sugestão CNEFE associada ao CNPJ; quando existe ponto confirmado, ele prevalece sobre sugestão",
    contact_required: false,
    business_chance_estimated: false,
  },
  sources: [
    { file: path.relative(root, candidatesPath).replaceAll("\\", "/"), sha256: candidateHash.digest("hex") },
    { file: path.relative(root, suggestionsPath).replaceAll("\\", "/"), sha256: suggestionHash.digest("hex") },
    { file: path.relative(root, kmlPath).replaceAll("\\", "/"), sha256: createHash("sha256").update(await readFile(kmlPath)).digest("hex") },
  ],
  output_leads_csv: { file: path.relative(root, leadCsvPath).replaceAll("\\", "/"), rows: eligibleRows.length, sha256: leadCsvHash },
  suggestion_rows: suggestionRows,
  unique_coordinate_suggestions: suggestionMap.size,
  duplicate_suggestion_rows: duplicateSuggestions,
  metrics,
  exclusion_counts_are_independent: true,
  limitations: [
    "A auditoria considera o snapshot de candidatos já configurado pelos grupos CNAE; não comprova cobertura de todos os setores potencialmente aderentes.",
    "Sugestão CNEFE é baseada em endereço de 2022 e permanece pendente de conferência humana.",
    "A Receita classifica ME/EPP, mas não separa empresas médias de grandes em ‘Demais’; porte operacional médio só entra após confirmação pela equipe.",
    "O centro escolhido pelo usuário é o ajuste provisório do KML; o raio será recalculado se o ponto comercial for retificado.",
  ],
};
await mkdir(path.dirname(outputPath), { recursive: true });
await mkdir(path.dirname(leadCsvPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(leadCsvPath, leadCsv, "utf8");
console.log(JSON.stringify({ output: path.relative(root, outputPath).replaceAll("\\", "/"), leads_csv: report.output_leads_csv, center: report.rule.radius_center, metrics, suggestion_rows: suggestionRows, duplicate_suggestions: duplicateSuggestions, sha256: report.sources.map(({ file, sha256 }) => ({ file, sha256 })) }, null, 2));
