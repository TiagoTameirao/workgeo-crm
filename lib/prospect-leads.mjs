import { readFileSync } from "node:fs";

const categories = JSON.parse(
  readFileSync(new URL("../data/prospecting-territory/cnae-scope.json", import.meta.url), "utf8"),
).categories;
const strongMaterialIds = new Set([
  "extracao-mineral", "cimento-concreto-ceramica", "siderurgia-metalurgia",
  "madeira-florestal", "sucata-reciclagem", "atacado-materiais-graneis",
  "depositos-materiais-construcao", "agro-graos-e-racoes", "fabricacao-fertilizantes",
  "estoques-agregados-construcao", "producao-e-beneficiamento-de-graos", "pos-colheita-graos",
]);
const possibleMaterialIds = new Set([
  "armazenagem-carga", "tratamento-residuos", "movimentacao-terra-e-obras-viarias",
  "demolicao-e-residuos-de-obra", "coleta-e-gestao-residuos-nao-perigosos",
  "apoio-producao-florestal", "residuos-perigosos", "pedras-para-revestimento", "fabricacao-acucar-bruto",
  "preparo-solo-agricultura", "moveis-madeira",
  "construcao-civil-canteiros", "armacoes-metalicas-construcao",
  "cafeicultura-e-beneficiamento",
]);
const strongMaterialLabels = categories.filter((category) => strongMaterialIds.has(category.id)).map((category) => category.label);
const possibleMaterialLabels = categories.filter((category) => possibleMaterialIds.has(category.id)).map((category) => category.label);
const smallBusinessSizes = new Set(["Microempresa", "Empresa de pequeno porte"]);

function categorySet(value) {
  return new Set(Array.isArray(value) ? value : String(value ?? "").split(" | ").map((item) => item.trim()).filter(Boolean));
}

export function assessLead(candidate) {
  const matchedCategories = categorySet(candidate.categories);
  const direct = String(candidate.scope_tier ?? "").startsWith("Aderência direta");
  const primary = candidate.cnae_primary_in_scope === true || String(candidate.cnae_primary_in_scope).toLowerCase() === "true" || candidate.cnae_primary_in_scope === 1;
  const small = smallBusinessSizes.has(candidate.size_label);
  const strongMaterials = strongMaterialLabels.filter((label) => matchedCategories.has(label));
  const possibleMaterials = possibleMaterialLabels.filter((label) => matchedCategories.has(label));
  const materialLevel = strongMaterials.length ? "forte" : possibleMaterials.length ? "possível" : "sem sinal";
  const points = {
    segment: direct ? 30 : 10,
    primary_activity: primary ? 20 : 0,
    size: small ? 20 : 0,
    materials: materialLevel === "forte" ? 30 : materialLevel === "possível" ? 10 : 0,
  };
  const score = Object.values(points).reduce((sum, value) => sum + value, 0);
  const tier = score === 100 ? "alta" : score >= 55 ? "validar" : "baixa";
  return {
    score,
    tier,
    version: 8,
    material_level: materialLevel,
    material_categories: strongMaterials.length ? strongMaterials : possibleMaterials,
    factors: [
      { key: "segment", label: "Aderência do segmento", points: points.segment, evidence: direct ? "Direta a validar" : "Adjacente a revisar" },
      { key: "primary_activity", label: "Atividade principal", points: points.primary_activity, evidence: primary ? "CNAE principal no escopo" : "Entra apenas por CNAE secundário" },
      { key: "size", label: "Porte cadastral", points: points.size, evidence: small ? "ME/EPP na Receita Federal" : "Não discriminado como ME/EPP" },
      { key: "materials", label: "Materiais e estoques", points: points.materials, evidence: materialLevel === "forte" ? "Segmento costuma operar com materiais ou estoques mensuráveis" : materialLevel === "possível" ? "Pode envolver volumes de obra, armazenagem ou resíduos" : "Sem categoria de material identificada" },
    ],
    caveat: "Sinal baseado em CNAE e porte cadastral; materiais, estoque, necessidade e endereço desta unidade ainda precisam de confirmação.",
  };
}

function anyCategorySql(ids, params, column = "data") {
  const labels = categories.filter((category) => ids.has(category.id)).map((category) => category.label);
  if (!labels.length) return "FALSE";
  return `(${labels.map((label) => { params.push(`%${label}%`); return `${column} LIKE $${params.length}`; }).join(" OR ")})`;
}

export function leadMaterialFilterSql(level, params, column = "prospecting_candidates.data") {
  const strong = anyCategorySql(strongMaterialIds, params, column);
  const possible = anyCategorySql(possibleMaterialIds, params, column);
  if (level === "forte") return strong;
  if (level === "possível") return `(${possible} AND NOT ${strong})`;
  if (level === "sem-sinal") return `(NOT ${strong} AND NOT ${possible})`;
  return null;
}

export function leadSqlExpressions(params) {
  const direct = "scope_tier LIKE 'Aderência direta%'";
  const primary = "cnae_primary_in_scope=TRUE";
  const small = "size_label IN ('Microempresa','Empresa de pequeno porte')";
  const strong = anyCategorySql(strongMaterialIds, params);
  const possible = anyCategorySql(possibleMaterialIds, params);
  const score = `(CASE WHEN ${direct} THEN 30 ELSE 10 END + CASE WHEN ${primary} THEN 20 ELSE 0 END + CASE WHEN ${small} THEN 20 ELSE 0 END + CASE WHEN ${strong} THEN 30 WHEN ${possible} THEN 10 ELSE 0 END)`;
  const tier = `(CASE WHEN ${score}=100 THEN 'alta' WHEN ${score}>=55 THEN 'validar' ELSE 'baixa' END)`;
  return { score, tier };
}

export function leadRadiusDistanceSql(params, center, table = "prospecting_candidates") {
  params.push(center.latitude, center.longitude);
  const centerLat = `$${params.length - 1}`;
  const centerLon = `$${params.length}`;
  const distance = (latitude, longitude) => `2*6371008.8*ASIN(SQRT(POWER(SIN((RADIANS(${latitude})-RADIANS(${centerLat}))/2),2)+COS(RADIANS(${centerLat}))*COS(RADIANS(${latitude}))*POWER(SIN((RADIANS(${longitude})-RADIANS(${centerLon}))/2),2)))`;
  return `(CASE WHEN ${table}.latitude IS NOT NULL AND ${table}.longitude IS NOT NULL THEN ${distance(`${table}.latitude`, `${table}.longitude`)} WHEN ${table}.suggested_latitude IS NOT NULL AND ${table}.suggested_longitude IS NOT NULL THEN ${distance(`${table}.suggested_latitude`, `${table}.suggested_longitude`)} ELSE NULL END)`;
}

export function leadEligibilitySql(distanceExpression, radiusParameter) {
  return `(${distanceExpression} <= ${radiusParameter} AND (scope_tier LIKE 'Aderência direta%' OR segment_fit='Aderente') AND COALESCE(segment_fit,'Não avaliado') <> 'Não aderente' AND review_status NOT IN ('Fora do escopo','Possível duplicidade') AND (size_label IN ('Microempresa','Empresa de pequeno porte') OR operating_size IN ('Pequeno','Médio')))`;
}

export function assessLeadEligibility(candidate, distanceMeters, locationSource = "", radiusKm = 170) {
  const directSegment = String(candidate.scope_tier ?? "").startsWith("Aderência direta");
  const segment = (directSegment || candidate.segment_fit === "Aderente") && candidate.segment_fit !== "Não aderente" && !["Fora do escopo", "Possível duplicidade"].includes(candidate.review_status);
  const cadastralSmall = smallBusinessSizes.has(candidate.size_label);
  const confirmedOperatingSize = ["Pequeno", "Médio"].includes(candidate.operating_size);
  const hasLocation = Boolean(locationSource && locationSource !== "Sem localização disponível");
  const withinRadius = hasLocation && Number.isFinite(distanceMeters) && distanceMeters <= radiusKm * 1000;
  return {
    eligible: segment && (cadastralSmall || confirmedOperatingSize) && withinRadius,
    segment,
    segment_evidence: directSegment ? "Direta pelo CNAE (presumida)" : candidate.segment_fit === "Aderente" ? "Aderência confirmada pela equipe" : "Pendente ou fora do foco",
    size: cadastralSmall || confirmedOperatingSize,
    size_evidence: confirmedOperatingSize ? `Porte operacional ${candidate.operating_size} confirmado` : cadastralSmall ? `Porte cadastral ${candidate.size_label} (Receita Federal)` : "Porte operacional pequeno/médio não confirmado",
    location_available: hasLocation,
    within_radius: withinRadius,
    location_source: locationSource || "Sem localização disponível",
    distance_meters: hasLocation ? Math.round(distanceMeters) : null,
    radius_km: radiusKm,
  };
}
