import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { query, transaction, isPostgres, isTurso, writeBatch } from "./db.mjs";
import { audit, fail, territory } from "./domain.mjs";
import { pointInGeometry } from "./territory-coverage.mjs";
import { assessLead, assessLeadEligibility, leadEligibilitySql, leadMaterialFilterSql, leadRadiusDistanceSql } from "./prospect-leads.mjs";
import { getLeadQueueSignal } from "./lead-queue.mjs";
import { distanceMeters } from "./territory-radius.mjs";
import { regionMembershipSql, candidateOrderSql } from "./prospecting-indexes.mjs";
import { addCandidateSearchFilter } from "./prospecting-search.mjs";

const editableRoles = ["Administrador", "Administração", "Administrativo", "Comercial", "Aprovação comercial"];
const reviews = ["Pendente", "Aderente", "Fora do escopo", "Possível duplicidade"];
const locations = ["Pendente", "Dentro do KML", "Fora do KML", "Dentro do raio", "Fora do raio"];
const segmentFits = ["Não avaliado", "Aderente", "Não aderente"];
const operatingSizes = ["Não avaliado", "Pequeno", "Médio", "Grande", "Desconhecido"];
const materialFits = ["Não avaliado", "Estoque mensurável identificado", "Não identificado"];
const qualificationSources = ["Conversa com cliente", "Site da empresa", "Consulta pública", "Indicação", "Outro"];
const qualificationStatus = ({ segment_fit, operating_size, materials_fit, location_status }) => {
  if (segment_fit === "Não aderente" || materials_fit === "Não identificado" || operating_size === "Grande" || ["Fora do KML", "Fora do raio"].includes(location_status)) return "Fora do foco";
  if (segment_fit === "Aderente" && ["Pequeno", "Médio"].includes(operating_size) && materials_fit === "Estoque mensurável identificado" && ["Dentro do KML", "Dentro do raio"].includes(location_status)) return "Perfil-alvo confirmado";
  return "Validação pendente";
};
const text = (value, max = 300) => String(value ?? "").trim().slice(0, max);
const coordinateConfidenceRank = (value) => ({ alta: 3, "média": 2, baixa: 1 })[String(value ?? "").match(/^(Alta|Média|Baixa)\b/i)?.[1]?.toLocaleLowerCase("pt-BR") || ""] || 0;
const cnaeCategories = JSON.parse(readFileSync(new URL("../data/prospecting-territory/cnae-scope.json", import.meta.url), "utf8")).categories;
const cnaeCategoryLabels = new Set(cnaeCategories.map((category) => category.label));
const cnaePrefixes = cnaeCategories.flatMap((category) => category.cnae_prefixes);
const prospectingRegions = JSON.parse(readFileSync(new URL("../data/prospecting-regions/region-centers.json", import.meta.url), "utf8")).regions;
const prospectingRegionIds = new Set(prospectingRegions.map((region) => region.id));
const prospectingRegionCatalog = JSON.parse(readFileSync(new URL("../data/prospecting-regions/regions.json", import.meta.url), "utf8")).regions;
const prospectingRegionDetails = new Map(prospectingRegionCatalog.map((region) => [region.id, region]));
function parseProspectingRegionIds(value) {
  if (value == null || value === "") return [];
  let ids = value;
  if (!Array.isArray(ids)) {
    try { ids = JSON.parse(String(value)); } catch { fail("A lista de regiões do candidato está inválida."); }
  }
  if (!Array.isArray(ids) || ids.length > prospectingRegionIds.size || ids.some((id) => !prospectingRegionIds.has(id)))
    fail("O candidato contém uma região de prospecção desconhecida.");
  return [...new Set(ids)];
}
function addRegionFilter(clauses, params, regionId, table = "prospecting_candidates") {
  if (!regionId) return;
  if (!prospectingRegionIds.has(regionId)) fail("Região de prospecção inválida.", 400);
  const data = `${table}.data`;
  if (isPostgres()) {
    params.push(regionId);
    clauses.push(`(${data}::jsonb->'prospecting_region_ids') ? $${params.length}`);
  } else clauses.push(`(${regionMembershipSql(regionId, table)})`);
}
function addLocationSituationFilter(clauses, params, value, table = "prospecting_candidates") {
  if (!value) return;
  const confirmed = `(${table}.latitude IS NOT NULL AND ${table}.longitude IS NOT NULL)`;
  const suggestion = `(${table}.latitude IS NULL AND ${table}.suggested_latitude IS NOT NULL AND ${table}.suggested_longitude IS NOT NULL)`;
  const pending = `(${table}.latitude IS NULL AND ${table}.suggested_latitude IS NULL)`;
  if (value === "confirmada") clauses.push(confirmed);
  else if (value === "sugestao") clauses.push(suggestion);
  else if (value === "pendente") clauses.push(pending);
  else if (["Pendente", "Dentro do KML", "Fora do KML", "Dentro do raio", "Fora do raio"].includes(value)) { params.push(value); clauses.push(`${table}.location_status=$${params.length}`); }
  else fail("Situação da localização inválida.", 400);
}
function addUfFilter(clauses, params, value, table = "prospecting_candidates") {
  const uf = text(value, 2).toUpperCase();
  if (!uf) return;
  if (!/^[A-Z]{2}$/.test(uf)) fail("UF inválida.", 400);
  params.push(uf);
  clauses.push(isPostgres()
    ? `(${table}.data::jsonb->>'uf')=$${params.length}`
    : `json_extract(${table}.data, '$.uf')=$${params.length}`);
}
export function validateCandidateBatch(user, rows) {
  if (!editableRoles.includes(user?.role)) fail("Seu perfil não pode revisar prospecções.", 403);
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 250) fail("Envie entre 1 e 250 candidatos por lote.");
  return rows.map((row) => {
    const cnpj = text(row?.cnpj, 20).replace(/[.\-/]/g, "").toUpperCase();
    if (!/^(?:\d{14}|[A-Z0-9]{12}\d{2})$/.test(cnpj)) fail("Cada candidato precisa ter CNPJ válido no formato atual da Receita.");
    const cnaePrimary = text(row.cnae_primary, 20);
    const candidate = {
      cnpj, cnpj_base: text(row.cnpj_base, 12), company_name: text(row.company_name, 180),
      unit_name: text(row.unit_name, 180), branch_type: text(row.branch_type, 40),
      rfb_size_code: text(row.rfb_size_code, 10), size_label: text(row.size_label, 50), size_confirmed_small: text(row.size_confirmed_small,10),
      scope_tier: text(row.scope_tier, 80), categories: text(row.categories, 800),
      cnae_primary: cnaePrimary, cnae_primary_in_scope: cnaePrefixes.some((prefix) => cnaePrimary.startsWith(prefix)), cnae_primary_description: text(row.cnae_primary_description, 240),
      cnae_context: text(row.cnae_context, 3000),
      municipality: text(row.municipality, 120), municipality_code_ibge: text(row.municipality_code_ibge, 20),
      prospecting_region_ids: parseProspectingRegionIds(row.prospecting_region_ids),
      uf: text(row.uf, 2), address: text(row.address, 240), postal_code: text(row.postal_code, 20),
      phone: text(row.phone, 40), email: text(row.email, 180), source_status: text(row.source_status, 40), source: text(row.source, 180),
      source_date: text(row.source_date, 20), source_review_note: text(row.review_status, 400), coordinates_status: text(row.coordinates_status, 240), review_status: "Pendente", location_status: "Pendente",
      latitude: null, longitude: null, review_note: "", qualification_status: "Validação pendente",
      segment_fit: "Não avaliado", operating_size: "Não avaliado", materials_fit: "Não avaliado",
      qualification_source: "", qualification_evidence: "",
    };
    const lead = assessLead(candidate);
    candidate.lead_score = lead.score;
    candidate.lead_tier = lead.tier;
    candidate.lead_scoring_version = lead.version;
    return candidate;
  });
}
export async function importCandidateBatch(user, rows) {
  const candidates = validateCandidateBatch(user, rows).map((candidate) => {
    if (candidate.prospecting_region_ids.length) return candidate;
    const inferredRegions = prospectingRegionCatalog.filter((region) => region.municipalities.some((item) =>
      item.uf === candidate.uf && ((candidate.municipality_code_ibge && item.ibge_code === candidate.municipality_code_ibge) || item.municipality.toLocaleLowerCase("pt-BR") === candidate.municipality.toLocaleLowerCase("pt-BR")),
    )).map((region) => region.id);
    return { ...candidate, prospecting_region_ids: inferredRegions };
  });
  if (isTurso()) {
    const now = new Date().toISOString();
    const existing = new Set((await query(
      `SELECT cnpj FROM prospecting_candidates WHERE cnpj IN (${candidates.map((_, index) => `$${index + 1}`).join(",")})`,
      candidates.map((candidate) => candidate.cnpj),
    )).map((row) => row.cnpj));
    const statements = candidates.map((candidate) => ({
      sql: `INSERT INTO prospecting_candidates(id,cnpj,cnpj_base,municipality,scope_tier,size_label,cnae_primary_in_scope,lead_score,lead_tier,lead_scoring_version,review_status,location_status,latitude,longitude,data,review_note,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,NULL,$13,'',$14,$14)
        ON CONFLICT(cnpj) DO UPDATE SET cnpj_base=excluded.cnpj_base,municipality=excluded.municipality,scope_tier=excluded.scope_tier,size_label=excluded.size_label,cnae_primary_in_scope=excluded.cnae_primary_in_scope,lead_score=excluded.lead_score,lead_tier=excluded.lead_tier,lead_scoring_version=excluded.lead_scoring_version,
        data=json_patch(excluded.data,json_object(
          'review_status',prospecting_candidates.review_status,'location_status',prospecting_candidates.location_status,
          'latitude',prospecting_candidates.latitude,'longitude',prospecting_candidates.longitude,'review_note',prospecting_candidates.review_note,
          'reviewed_by',prospecting_candidates.reviewed_by,'reviewed_at',prospecting_candidates.reviewed_at,
          'qualification_status',prospecting_candidates.qualification_status,'segment_fit',prospecting_candidates.segment_fit,
          'operating_size',prospecting_candidates.operating_size,'materials_fit',prospecting_candidates.materials_fit,
          'qualification_source',COALESCE(json_extract(prospecting_candidates.data,'$.qualification_source'),''),
          'qualification_evidence',COALESCE(json_extract(prospecting_candidates.data,'$.qualification_evidence'),''),
          'qualification_by',COALESCE(json_extract(prospecting_candidates.data,'$.qualification_by'),''),
          'qualification_at',COALESCE(json_extract(prospecting_candidates.data,'$.qualification_at'),''),
          'prospecting_region_ids',json((SELECT json_group_array(region_id) FROM (
            SELECT value AS region_id FROM json_each(COALESCE(json_extract(prospecting_candidates.data,'$.prospecting_region_ids'),'[]'))
            UNION SELECT value AS region_id FROM json_each(COALESCE(json_extract(excluded.data,'$.prospecting_region_ids'),'[]'))
          )))
        )),updated_at=excluded.updated_at`,
      args: [randomUUID(),candidate.cnpj,candidate.cnpj_base,candidate.municipality,candidate.scope_tier,candidate.size_label,candidate.cnae_primary_in_scope,candidate.lead_score,candidate.lead_tier,candidate.lead_scoring_version,candidate.review_status,candidate.location_status,JSON.stringify(candidate),now],
    }));
    await writeBatch(statements);
    const inserted = candidates.filter((candidate) => !existing.has(candidate.cnpj)).length;
    const updated = candidates.length - inserted;
    await query(`INSERT OR IGNORE INTO prospecting_candidate_map_regions(candidate_id,region_id)
      SELECT candidate.id,region.value FROM prospecting_candidates AS candidate,json_each(candidate.data,'$.prospecting_region_ids') AS region
      WHERE candidate.cnpj IN (${candidates.map((_, index) => `$${index + 1}`).join(",")})
        AND (candidate.latitude IS NOT NULL OR candidate.suggested_latitude IS NOT NULL)`, candidates.map((candidate) => candidate.cnpj));
    await audit(user,"prospecting_candidates","batch","import",null,{inserted,updated});
    return { inserted, updated };
  }
  return transaction(async () => {
    if (isPostgres()) {
      const timestamp = new Date().toISOString();
      const payload = candidates.map((candidate) => ({
        id: randomUUID(), cnpj: candidate.cnpj, cnpj_base: candidate.cnpj_base,
        municipality: candidate.municipality, scope_tier: candidate.scope_tier,
        size_label: candidate.size_label, cnae_primary_in_scope: candidate.cnae_primary_in_scope,
        lead_score: candidate.lead_score, lead_tier: candidate.lead_tier, lead_scoring_version: candidate.lead_scoring_version, review_status: candidate.review_status,
        location_status: candidate.location_status, latitude: null, longitude: null,
        data: JSON.stringify(candidate), review_note: "", created_at: timestamp, updated_at: timestamp,
      }));
      const outcomes = await query(`
        INSERT INTO prospecting_candidates(id,cnpj,cnpj_base,municipality,scope_tier,size_label,cnae_primary_in_scope,lead_score,lead_tier,lead_scoring_version,review_status,location_status,latitude,longitude,data,review_note,created_at,updated_at)
        SELECT id,cnpj,cnpj_base,municipality,scope_tier,size_label,cnae_primary_in_scope,lead_score,lead_tier,lead_scoring_version,review_status,location_status,latitude,longitude,data,review_note,created_at,updated_at
        FROM jsonb_to_recordset($1::jsonb) AS row(id text,cnpj text,cnpj_base text,municipality text,scope_tier text,size_label text,cnae_primary_in_scope boolean,lead_score integer,lead_tier text,lead_scoring_version integer,review_status text,location_status text,latitude double precision,longitude double precision,data text,review_note text,created_at text,updated_at text)
        ON CONFLICT(cnpj) DO UPDATE SET
          cnpj_base=EXCLUDED.cnpj_base, municipality=EXCLUDED.municipality,
          scope_tier=EXCLUDED.scope_tier, size_label=EXCLUDED.size_label,
          cnae_primary_in_scope=EXCLUDED.cnae_primary_in_scope, lead_score=EXCLUDED.lead_score,
          lead_tier=EXCLUDED.lead_tier, lead_scoring_version=EXCLUDED.lead_scoring_version,
          data=(EXCLUDED.data::jsonb || jsonb_build_object(
            'review_status',prospecting_candidates.review_status,
            'location_status',prospecting_candidates.location_status,
            'latitude',prospecting_candidates.latitude,'longitude',prospecting_candidates.longitude,
            'review_note',prospecting_candidates.review_note,'reviewed_by',prospecting_candidates.reviewed_by,
            'reviewed_at',prospecting_candidates.reviewed_at,
            'qualification_status',prospecting_candidates.qualification_status,
            'segment_fit',prospecting_candidates.segment_fit,'operating_size',prospecting_candidates.operating_size,
            'materials_fit',prospecting_candidates.materials_fit,
            'qualification_source',COALESCE(prospecting_candidates.data::jsonb->>'qualification_source',''),
            'qualification_evidence',COALESCE(prospecting_candidates.data::jsonb->>'qualification_evidence',''),
            'qualification_by',COALESCE(prospecting_candidates.data::jsonb->>'qualification_by',''),
            'qualification_at',COALESCE(prospecting_candidates.data::jsonb->>'qualification_at',''),
            'prospecting_region_ids',COALESCE((
              SELECT jsonb_agg(DISTINCT region_id)
              FROM jsonb_array_elements_text(
                COALESCE(prospecting_candidates.data::jsonb->'prospecting_region_ids','[]'::jsonb) ||
                COALESCE(EXCLUDED.data::jsonb->'prospecting_region_ids','[]'::jsonb)
              ) AS region(region_id)
            ),'[]'::jsonb)
          ))::text, updated_at=EXCLUDED.updated_at
        RETURNING (xmax=0) AS inserted`, [JSON.stringify(payload)]);
      const inserted = outcomes.filter((row) => row.inserted).length;
      const updated = outcomes.length - inserted;
      await audit(user,"prospecting_candidates","batch","import",null,{inserted,updated});
      return { inserted, updated };
    }
    let inserted = 0, updated = 0;
    for (const candidate of candidates) {
      const prior = (await query("SELECT id,data FROM prospecting_candidates WHERE cnpj=$1", [candidate.cnpj]))[0];
      const now = new Date().toISOString();
      if (!prior) {
        const id = randomUUID();
        await query("INSERT INTO prospecting_candidates(id,cnpj,cnpj_base,municipality,scope_tier,size_label,cnae_primary_in_scope,lead_score,lead_tier,lead_scoring_version,review_status,location_status,latitude,longitude,data,review_note,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)", [id,candidate.cnpj,candidate.cnpj_base,candidate.municipality,candidate.scope_tier,candidate.size_label,candidate.cnae_primary_in_scope ? 1 : 0,candidate.lead_score,candidate.lead_tier,candidate.lead_scoring_version,candidate.review_status,candidate.location_status,null,null,JSON.stringify(candidate),"",now]);
        inserted++;
      } else {
        const before = JSON.parse(prior.data);
        const merged = { ...candidate, prospecting_region_ids: [...new Set([...(before.prospecting_region_ids || []), ...candidate.prospecting_region_ids])], review_status: before.review_status || "Pendente", location_status: before.location_status || "Pendente", latitude: before.latitude ?? null, longitude: before.longitude ?? null, review_note: before.review_note || "", qualification_status: before.qualification_status || "Validação pendente", segment_fit: before.segment_fit || "Não avaliado", operating_size: before.operating_size || "Não avaliado", materials_fit: before.materials_fit || "Não avaliado", qualification_source: before.qualification_source || "", qualification_evidence: before.qualification_evidence || "", qualification_by: before.qualification_by || "", qualification_at: before.qualification_at || "" };
        await query("UPDATE prospecting_candidates SET cnpj_base=$1,municipality=$2,scope_tier=$3,size_label=$4,cnae_primary_in_scope=$5,lead_score=$6,lead_tier=$7,lead_scoring_version=$8,data=$9,updated_at=$10 WHERE id=$11", [merged.cnpj_base,merged.municipality,merged.scope_tier,merged.size_label,merged.cnae_primary_in_scope ? 1 : 0,merged.lead_score,merged.lead_tier,merged.lead_scoring_version,JSON.stringify(merged),now,prior.id]);
        updated++;
      }
    }
    await audit(user,"prospecting_candidates","batch","import",null,{inserted,updated});
    return { inserted, updated };
  });
}
export async function listCandidatePage(user, searchParams) {
  if (!user) fail("Entre para acessar o CRM.", 401);
  if (!editableRoles.includes(user.role)) fail("Seu perfil não tem acesso à prospecção comercial.",403);
  const page = Math.max(1, Math.min(100000, Number(searchParams.get("page")) || 1));
  const limit = 50;
  const clauses = [], params = [];
  const add = (column, value) => { if (value) { params.push(value); clauses.push(`${column}=$${params.length}`); } };
  add("review_status", searchParams.get("review")); add("location_status", searchParams.get("location")); addLocationSituationFilter(clauses, params, searchParams.get("locationSituation")); add("scope_tier", searchParams.get("scope")); add("size_label", searchParams.get("size"));
  addRegionFilter(clauses, params, searchParams.get("region"));
  addUfFilter(clauses, params, searchParams.get("uf"));
  const candidateRegionId = searchParams.get("region");
  if (candidateRegionId) {
    const candidateRegion = prospectingRegionDetails.get(candidateRegionId);
    if (!candidateRegion) fail("Região de prospecção inválida.", 400);
    const exactMunicipality = searchParams.get("municipality") || "";
    if (exactMunicipality && !candidateRegion.municipalities.some((item) => item.municipality === exactMunicipality && (!searchParams.get("uf") || item.uf === searchParams.get("uf")))) fail("Município fora da região de prospecção selecionada.", 400);
    if (exactMunicipality) { params.push(exactMunicipality); clauses.push(`municipality=$${params.length}`); }
  } else {
    const municipality = text(searchParams.get("municipality"), 120);
    if (municipality) { params.push(`%${municipality}%`); clauses.push(`municipality LIKE $${params.length}`); }
  }
  const primaryCnae = searchParams.get("cnaePrimary");
  if (primaryCnae) {
    if (!["in-scope", "secondary-only"].includes(primaryCnae)) fail("Filtro de CNAE principal inválido.", 400);
    clauses.push(`cnae_primary_in_scope=${primaryCnae === "in-scope" ? "TRUE" : "FALSE"}`);
  }
  const category = text(searchParams.get("category"), 120);
  if (category) {
    if (!cnaeCategoryLabels.has(category)) fail("Grupo CNAE inválido.", 400);
    params.push(`%${category}%`); clauses.push(`data LIKE $${params.length}`);
  }
  const suggestions = searchParams.get("suggestions");
  if (suggestions === "available") clauses.push("suggested_latitude IS NOT NULL");
  if (suggestions === "missing") clauses.push("suggested_latitude IS NULL");
  const q = text(searchParams.get("q"), 120);
  await addCandidateSearchFilter(clauses, params, q, { query, isPostgres });
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = Number((await query(`SELECT COUNT(*) AS n FROM prospecting_candidates ${where}`,params))[0].n);
  params.push(limit, (page - 1) * limit);
  const rows = await query(`SELECT id,data,cnae_primary_in_scope,review_status,location_status,qualification_status,segment_fit,operating_size,materials_fit,latitude,longitude,suggested_latitude,suggested_longitude,geocode_source,geocode_date,geocode_confidence,geocode_match_method,geocoded_at,review_note,reviewed_by,reviewed_at,converted_unit_id,converted_at,updated_at FROM prospecting_candidates ${where} ORDER BY ${candidateOrderSql} LIMIT $${params.length-1} OFFSET $${params.length}`,params);
  return { rows: rows.map(r=>({...JSON.parse(r.data),id:r.id,cnae_primary_in_scope:Boolean(r.cnae_primary_in_scope),review_status:r.review_status,location_status:r.location_status,qualification_status:r.qualification_status,segment_fit:r.segment_fit,operating_size:r.operating_size,materials_fit:r.materials_fit,latitude:r.latitude,longitude:r.longitude,suggested_latitude:r.suggested_latitude,suggested_longitude:r.suggested_longitude,geocode_source:r.geocode_source,geocode_date:r.geocode_date,geocode_confidence:r.geocode_confidence,geocode_match_method:r.geocode_match_method,geocoded_at:r.geocoded_at,review_note:r.review_note,reviewed_by:r.reviewed_by,reviewed_at:r.reviewed_at,converted_unit_id:r.converted_unit_id,converted_at:r.converted_at,updated_at:r.updated_at})), total, page, pages: Math.ceil(total/limit) };
}

export async function listLeadPage(user, searchParams) {
  if (!user) fail("Entre para acessar o CRM.", 401);
  if (!editableRoles.includes(user.role)) fail("Seu perfil não tem acesso à triagem de leads.", 403);
  const page = Math.max(1, Math.min(100000, Number(searchParams.get("page")) || 1));
  const limit = 50;
  const clauses = [], params = [];
  const add = (column, value) => { if (value) { params.push(value); clauses.push(`${column}=$${params.length}`); } };
  const regionId = searchParams.get("region") || "belo-horizonte-170km";
  const region = prospectingRegionDetails.get(regionId);
  if (!region) fail("Região de prospecção inválida.", 400);
  const radiusCenter = region.center;
  const radiusKm = region.radius_km;
  if (!searchParams.has("region")) {
    const legacyMunicipality = text(searchParams.get("municipality"), 120);
    if (legacyMunicipality) { params.push(`%${legacyMunicipality}%`); clauses.push(`municipality LIKE $${params.length}`); }
  } else if (!(isTurso() && searchParams.get("fit") === "qualificados")) addRegionFilter(clauses, params, regionId);
  addUfFilter(clauses, params, searchParams.get("uf"));
  addLocationSituationFilter(clauses, params, searchParams.get("locationSituation"));
  const fit = searchParams.get("fit") || "todos";
  if (!["qualificados", "priorizar", "todos", "baixa"].includes(fit)) fail("Visão da peneira inválida.", 400);
  let radiusDistanceExpression = null;
  if (fit === "qualificados") {
    clauses.push("(prospecting_candidates.latitude IS NOT NULL OR prospecting_candidates.suggested_latitude IS NOT NULL)");
    if (isTurso() && searchParams.has("region")) {
      params.push(regionId);
      clauses.push(`prospecting_candidates.id IN (SELECT candidate_id FROM prospecting_candidate_map_regions WHERE region_id=$${params.length})`);
    }
    if (!radiusCenter) clauses.push("FALSE");
    else {
      radiusDistanceExpression = leadRadiusDistanceSql(params, radiusCenter);
      params.push(radiusKm * 1000);
      clauses.push(leadEligibilitySql(radiusDistanceExpression, `$${params.length}`));
    }
  }
  if (fit === "priorizar") clauses.push("lead_tier IN ('alta','validar') AND qualification_status <> 'Fora do foco'");
  if (fit === "baixa") clauses.push("(lead_tier='baixa' OR qualification_status='Fora do foco')");
  const tier = searchParams.get("tier");
  if (tier && !["alta", "validar", "baixa"].includes(tier)) fail("Prioridade de lead inválida.", 400);
  add("lead_tier", tier);
  const ultrafine = searchParams.get("ultrafine");
  if (ultrafine && ultrafine !== "all") fail("Filtro de peneira ultrafina inválido.", 400);
  if (ultrafine === "all") clauses.push(`data LIKE '%"ultrafine_sieve"%'`);
  const qualification = searchParams.get("qualification");
  if (qualification && !["Validação pendente", "Perfil-alvo confirmado", "Fora do foco"].includes(qualification)) fail("Filtro de qualificação inválido.", 400);
  add("qualification_status", qualification);
  const segment = text(searchParams.get("segment"), 80);
  add("scope_tier", segment);
  const category = text(searchParams.get("category"), 120);
  if (category) {
    if (!cnaeCategoryLabels.has(category)) fail("Grupo CNAE inválido.", 400);
    params.push(`%${category}%`); clauses.push(`data LIKE $${params.length}`);
  }
  const size = text(searchParams.get("size"), 50);
  add("size_label", size);
  const primaryCnae = searchParams.get("cnaePrimary");
  if (primaryCnae) {
    if (!["in-scope", "secondary-only"].includes(primaryCnae)) fail("Filtro de CNAE principal inválido.", 400);
    clauses.push(`prospecting_candidates.cnae_primary_in_scope=${primaryCnae === "in-scope" ? "TRUE" : "FALSE"}`);
  }
  const materialPotential = searchParams.get("materialPotential");
  if (materialPotential) {
    if (!["forte", "possível", "sem-sinal"].includes(materialPotential)) fail("Filtro de potencial de materiais inválido.", 400);
    clauses.push(leadMaterialFilterSql(materialPotential, params));
  }
  const operatingSize = text(searchParams.get("operatingSize"), 40);
  if (operatingSize) {
    if (!["Não avaliado", "Pequeno", "Médio", "Grande", "Desconhecido"].includes(operatingSize)) fail("Filtro de porte operacional inválido.", 400);
    add("operating_size", operatingSize);
  }
  const materialsFit = text(searchParams.get("materialsFit"), 60);
  if (materialsFit) {
    if (!["Não avaliado", "Estoque mensurável identificado", "Não identificado"].includes(materialsFit)) fail("Filtro de materiais confirmados inválido.", 400);
    add("materials_fit", materialsFit);
  }
  const q = text(searchParams.get("q"), 120);
  const indexedSearch = await addCandidateSearchFilter(clauses, params, q, { query, isPostgres });
  const leadIndex = !isPostgres() && fit === "qualificados" && indexedSearch !== "cnpj" ? " INDEXED BY prospecting_positioned_sieve" : "";
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const includeSummary = searchParams.get("summary") !== "0";
  const [summaryRows, filteredCount] = await Promise.all([
    includeSummary ? query("SELECT lead_tier,qualification_status,COUNT(*) AS n FROM prospecting_candidates GROUP BY qualification_status,lead_tier") : [],
    query(`SELECT COUNT(*) AS n FROM prospecting_candidates${leadIndex} ${where}`, params),
  ]);
  const summary = { alta: 0, validar: 0, baixa: 0, total: 0, "Validação pendente": 0, "Perfil-alvo confirmado": 0, "Fora do foco": 0 };
  for (const row of summaryRows) {
    summary[row.lead_tier] = (summary[row.lead_tier] || 0) + Number(row.n);
    summary[row.qualification_status] = (summary[row.qualification_status] || 0) + Number(row.n);
    summary.total += Number(row.n);
  }
  if (radiusCenter && !radiusDistanceExpression) radiusDistanceExpression = leadRadiusDistanceSql(params, radiusCenter);
  const selectedDistance = radiusDistanceExpression || "NULL";
  params.push(limit, (page - 1) * limit);
  const rows = await query(`WITH page AS MATERIALIZED (SELECT prospecting_candidates.id,${selectedDistance} AS radius_distance_meters,last_activity.result AS last_activity_result,last_activity.next_action,last_activity.next_date,last_activity.created_at AS last_activity_at FROM prospecting_candidates${leadIndex} LEFT JOIN (SELECT candidate_id,result,next_action,next_date,created_at,ROW_NUMBER() OVER (PARTITION BY candidate_id ORDER BY created_at DESC,id DESC) AS recency FROM prospecting_activities) last_activity ON last_activity.candidate_id=prospecting_candidates.id AND last_activity.recency=1 ${where} ORDER BY CASE WHEN last_activity.result='Solicitou material' THEN 0 WHEN last_activity.result='Demanda potencial' THEN 1 WHEN last_activity.next_date<=CAST(CURRENT_DATE AS TEXT) THEN 2 WHEN prospecting_candidates.qualification_status='Perfil-alvo confirmado' THEN 3 WHEN last_activity.candidate_id IS NOT NULL THEN 4 ELSE 5 END,prospecting_candidates.lead_score DESC,prospecting_candidates.cnpj LIMIT $${params.length - 1} OFFSET $${params.length}) SELECT prospecting_candidates.id,prospecting_candidates.cnpj,prospecting_candidates.data,prospecting_candidates.lead_score,prospecting_candidates.lead_tier,prospecting_candidates.lead_scoring_version,prospecting_candidates.review_status,prospecting_candidates.location_status,prospecting_candidates.latitude,prospecting_candidates.longitude,prospecting_candidates.suggested_latitude,prospecting_candidates.suggested_longitude,prospecting_candidates.geocode_source,prospecting_candidates.qualification_status,prospecting_candidates.segment_fit,prospecting_candidates.operating_size,prospecting_candidates.materials_fit,prospecting_candidates.converted_unit_id,page.radius_distance_meters,page.last_activity_result,page.next_action,page.next_date,page.last_activity_at FROM page JOIN prospecting_candidates ON prospecting_candidates.id=page.id ORDER BY CASE WHEN page.last_activity_result='Solicitou material' THEN 0 WHEN page.last_activity_result='Demanda potencial' THEN 1 WHEN page.next_date<=CAST(CURRENT_DATE AS TEXT) THEN 2 WHEN prospecting_candidates.qualification_status='Perfil-alvo confirmado' THEN 3 WHEN page.last_activity_at IS NOT NULL THEN 4 ELSE 5 END,prospecting_candidates.lead_score DESC,prospecting_candidates.cnpj`, params);
  return {
    rows: rows.map((row) => {
      const candidateData = JSON.parse(row.data);
      const locationSource = row.latitude != null && row.longitude != null ? "Confirmada pela equipe" : row.suggested_latitude != null && row.suggested_longitude != null ? `${row.geocode_source || "Sugestão CNEFE"} · revisar` : "Sem localização disponível";
      const candidate = { ...candidateData, id: row.id, lead_score: Number(row.lead_score), lead_tier: row.lead_tier, lead_scoring_version: Number(row.lead_scoring_version), review_status: row.review_status, location_status: row.location_status, qualification_status: row.qualification_status, segment_fit: row.segment_fit, operating_size: row.operating_size, materials_fit: row.materials_fit, converted_unit_id: row.converted_unit_id, latitude: row.latitude, longitude: row.longitude, suggested_latitude: row.suggested_latitude, suggested_longitude: row.suggested_longitude, last_activity_result: row.last_activity_result, next_action: row.next_action, next_date: row.next_date, last_activity_at: row.last_activity_at };
      const eligibility = assessLeadEligibility(candidate, row.radius_distance_meters == null ? null : Number(row.radius_distance_meters), locationSource, radiusKm);
      return { ...candidate, eligibility, queue_signal: getLeadQueueSignal(candidate), assessment: assessLead(candidate) };
    }),
    total: Number(filteredCount[0].n), page, pages: Math.ceil(Number(filteredCount[0].n) / limit), summary: includeSummary ? summary : null,
    territory: { region_id: region.id, name: region.name, city: region.city, uf: region.uf, center_latitude: radiusCenter.latitude, center_longitude: radiusCenter.longitude, center_method: region.center_status, center_source: region.center_source, radius_km: radiusKm, center_confirmed: false },
  };
}

export async function listLeadPerformance(user) {
  if (!user) fail("Entre para acessar o CRM.", 401);
  if (!editableRoles.includes(user.role)) fail("Seu perfil não tem acesso à triagem de leads.", 403);
  const windowDays = 90;
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = await query(`SELECT candidate.lead_tier,COUNT(*) AS units,SUM(CASE WHEN recent_activity.candidate_id IS NOT NULL THEN 1 ELSE 0 END) AS activity_units,SUM(CASE WHEN recent_activity.result IN ('Demanda potencial','Solicitou material') THEN 1 ELSE 0 END) AS positive_units,SUM(CASE WHEN recent_activity.result='Solicitou material' THEN 1 ELSE 0 END) AS materials_requested,SUM(CASE WHEN recent_activity.result='Demanda potencial' THEN 1 ELSE 0 END) AS potential_demand FROM prospecting_candidates candidate LEFT JOIN (SELECT candidate_id,result,ROW_NUMBER() OVER (PARTITION BY candidate_id ORDER BY created_at DESC,id DESC) AS recency FROM prospecting_activities WHERE created_at >= $1) recent_activity ON recent_activity.candidate_id=candidate.id AND recent_activity.recency=1 GROUP BY candidate.lead_tier`, [since]);
  const by_tier = {};
  for (const row of rows) {
    const activityUnits = Number(row.activity_units), positiveUnits = Number(row.positive_units);
    by_tier[row.lead_tier] = {
      units: Number(row.units), activity_units: activityUnits, positive_units: positiveUnits,
      materials_requested: Number(row.materials_requested), potential_demand: Number(row.potential_demand),
      positive_signal_rate: activityUnits ? positiveUnits / activityUnits : null,
    };
  }
  return { window_days: windowDays, by_tier };
}

export async function listCandidateMap(user, searchParams) {
  if (!user) fail("Entre para acessar o CRM.", 401);
  if (!editableRoles.includes(user.role)) fail("Seu perfil não tem acesso à prospecção comercial.", 403);
  const regionId = searchParams.get("region") || "belo-horizonte-170km";
  const region = prospectingRegionDetails.get(regionId);
  if (!region) fail("Região de prospecção inválida.", 400);
  const area = searchParams.get("area") || "all";
  if (!["all", "within", "outside", "confirmed"].includes(area)) fail("Filtro de área do mapa inválido.", 400);
  const clauses = [], params = [];
  const add = (column, value) => { if (value) { params.push(value); clauses.push(`${column}=$${params.length}`); } };
  add("review_status", searchParams.get("review"));
  add("location_status", searchParams.get("location"));
  addLocationSituationFilter(clauses, params, searchParams.get("locationSituation"));
  if (isTurso()) {
    params.push(regionId);
    clauses.push(`prospecting_candidate_map_regions.region_id=$${params.length}`);
  } else if (searchParams.has("region")) addRegionFilter(clauses, params, regionId);
  addUfFilter(clauses, params, searchParams.get("uf"));
  add("scope_tier", searchParams.get("scope"));
  add("size_label", searchParams.get("size"));
  const primaryCnae = searchParams.get("cnaePrimary");
  if (primaryCnae) {
    if (!["in-scope", "secondary-only"].includes(primaryCnae)) fail("Filtro de CNAE principal inválido.", 400);
    clauses.push(`cnae_primary_in_scope=${primaryCnae === "in-scope" ? "TRUE" : "FALSE"}`);
  }
  const category = text(searchParams.get("category"), 120);
  if (category) {
    if (!cnaeCategoryLabels.has(category)) fail("Grupo CNAE inválido.", 400);
    params.push(`%${category}%`); clauses.push(`data LIKE $${params.length}`);
  }
  const municipality = text(searchParams.get("municipality"), 120);
  if (municipality) { params.push(`%${municipality}%`); clauses.push(`municipality LIKE $${params.length}`); }
  const q = text(searchParams.get("q"), 120);
  await addCandidateSearchFilter(clauses, params, q, { query, isPostgres });
  const suggestions = searchParams.get("suggestions");
  if (suggestions === "available") clauses.push("suggested_latitude IS NOT NULL");
  if (suggestions === "missing") clauses.push("suggested_latitude IS NULL");
  const compact = searchParams.get("compact") === "1";
  const from = isTurso() ? "prospecting_candidate_map_regions JOIN prospecting_candidates ON prospecting_candidates.id=prospecting_candidate_map_regions.candidate_id" : "prospecting_candidates";
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const positioned = "(prospecting_candidates.latitude IS NOT NULL OR prospecting_candidates.suggested_latitude IS NOT NULL)";
  const positionedClauses = [...clauses, positioned];
  const coordinateParams = [...params];
  const distanceExpression = leadRadiusDistanceSql(coordinateParams, region.center);
  if (area === "confirmed") positionedClauses.push("prospecting_candidates.latitude IS NOT NULL AND prospecting_candidates.longitude IS NOT NULL");
  if (area === "within" || area === "outside") {
    positionedClauses.push(`${distanceExpression} ${area === "within" ? "<=" : ">"} ${Number(region.radius_km) * 1000}`);
    params.push(...coordinateParams.slice(params.length));
  }
  const positionedWhere = `WHERE ${positionedClauses.join(" AND ")}`;
  const pageSize = compact ? 5000 : 2000;
  const page = Math.max(0, Number.parseInt(searchParams.get("page") || "0", 10) || 0);
  const unfilteredRegion = isTurso() && clauses.length === 1 && area === "all";
  const regionTotal = Number((await query(unfilteredRegion
    ? "SELECT COUNT(*) AS n FROM prospecting_candidate_map_regions WHERE region_id=$1"
    : `SELECT COUNT(*) AS n FROM ${from} ${positionedWhere}`, params))[0].n);
  // Full candidate counts are useful only for the legacy detailed map response.
  const candidateTotal = !compact && !isTurso() ? Number((await query(`SELECT COUNT(*) AS n FROM prospecting_candidates ${where}`, coordinateParams.slice(0, coordinateParams.length - 2)))[0].n) : null;
  const companyName = compact ? "NULL" : isPostgres() ? "prospecting_candidates.data::jsonb->>'company_name'" : "json_extract(prospecting_candidates.data,'$.company_name')";
  const ufName = compact ? "NULL" : isPostgres() ? "prospecting_candidates.data::jsonb->>'uf'" : "json_extract(prospecting_candidates.data,'$.uf')";
  const pageFrom = unfilteredRegion
    ? `(SELECT candidate_id FROM prospecting_candidate_map_regions WHERE region_id=$1 ORDER BY candidate_id LIMIT ${pageSize} OFFSET ${page * pageSize}) AS map_page JOIN prospecting_candidates ON prospecting_candidates.id=map_page.candidate_id`
    : from;
  const pageWhere = unfilteredRegion ? "" : positionedWhere;
  const pageOffset = unfilteredRegion ? "" : `LIMIT ${pageSize} OFFSET ${page * pageSize}`;
  const rows = await query(`SELECT prospecting_candidates.id,prospecting_candidates.cnpj,${companyName} AS company_name,prospecting_candidates.municipality,${ufName} AS uf,review_status,location_status,latitude,longitude,suggested_latitude,suggested_longitude,geocode_source,geocode_date,geocode_confidence,geocode_match_method,reviewed_at FROM ${pageFrom} ${pageWhere} ORDER BY prospecting_candidates.id ${pageOffset}`, params);
  const points = rows.map((row) => {
    const latitude = row.latitude ?? row.suggested_latitude, longitude = row.longitude ?? row.suggested_longitude;
    const coordinateConfirmed = row.latitude != null && row.longitude != null;
    const distance = distanceMeters([region.center.longitude, region.center.latitude], [longitude, latitude]);
    if (compact) return { id: row.id, cnpj: row.cnpj, latitude, longitude,
      coordinate_confirmed: coordinateConfirmed, within_radius: distance <= region.radius_km * 1000,
      distance_km: Math.round(distance / 100) / 10 };
    return {
      id: row.id, cnpj: row.cnpj, company_name: row.company_name, municipality: row.municipality,
      uf: row.uf, review_status: row.review_status, location_status: row.location_status,
      latitude, longitude,
      coordinate_confirmed: coordinateConfirmed,
      coordinate_situation: coordinateConfirmed ? "Confirmada" : "Sugestão — revisar",
      coordinate_source: coordinateConfirmed ? "Revisão humana do cadastro" : row.geocode_source || "Origem não informada",
      coordinate_date: coordinateConfirmed ? row.reviewed_at || null : row.geocode_date || null,
      geocode_confidence: row.geocode_confidence, geocode_match_method: row.geocode_match_method,
      distance_meters: Math.round(distance),
      distance_km: Math.round(distance / 100) / 10,
      within_radius: distance <= region.radius_km * 1000,
      territory_position: region.id === "belo-horizonte-170km" && region.geometry ? (pointInGeometry([longitude, latitude], region.geometry) ? "Dentro do KML" : "Fora do KML") : "Não avaliado contra o KML de Belo Horizonte",
    };
  });
  const areaCounts = points.reduce((counts, point) => {
    counts.all++;
    counts[point.within_radius ? "within" : "outside"]++;
    if (point.coordinate_confirmed) counts.confirmed++;
    return counts;
  }, { all: 0, within: 0, outside: 0, confirmed: 0 });
  const summary = points.reduce((counts, point) => {
    const key = point.coordinate_confirmed ? "confirmed" : "suggested";
    counts[key]++;
    if (point.within_radius) counts[`${key}_within_radius`]++;
    else counts[`${key}_outside_radius`]++;
    return counts;
  }, { confirmed:0, confirmed_within_radius:0, confirmed_outside_radius:0, suggested:0, suggested_within_radius:0, suggested_outside_radius:0 });
  summary.suggested_inside = summary.suggested_within_radius;
  summary.suggested_outside = summary.suggested_outside_radius;
  const matchingPoints = area === "within" ? points.filter((point) => point.within_radius)
    : area === "outside" ? points.filter((point) => !point.within_radius)
    : area === "confirmed" ? points.filter((point) => point.coordinate_confirmed) : points;
  return {
    region,
    total: regionTotal,
    candidate_total: candidateTotal,
    without_coordinates: candidateTotal == null ? null : candidateTotal - Number((await query(`SELECT COUNT(*) AS n FROM ${from} ${where}${where ? " AND " : "WHERE "}${positioned}`, coordinateParams.slice(0, coordinateParams.length - 2)))[0].n),
    area,
    area_counts: areaCounts,
    truncated: rows.length === pageSize,
    page,
    page_count: Math.ceil(regionTotal / pageSize),
    summary,
    points: matchingPoints,
    territory: { region_id: region.id, name: region.name, city: region.city, uf: region.uf, center_latitude: region.center.latitude, center_longitude: region.center.longitude, center_method: region.center_status, center_source: region.center_source, radius_km: region.radius_km, center_confirmed: false },
  };
}

export async function getCandidateForReview(user, id) {
  if (!user) fail("Entre para acessar o CRM.", 401);
  if (!editableRoles.includes(user.role)) fail("Seu perfil não tem acesso à prospecção comercial.", 403);
  const row = (await query("SELECT * FROM prospecting_candidates WHERE id=$1", [text(id, 80)]))[0];
  if (!row) fail("Candidato não encontrado.", 404);
  return {
    ...JSON.parse(row.data), id: row.id, cnae_primary_in_scope: Boolean(row.cnae_primary_in_scope),
    review_status: row.review_status, location_status: row.location_status,
    qualification_status: row.qualification_status, segment_fit: row.segment_fit, operating_size: row.operating_size, materials_fit: row.materials_fit,
    latitude: row.latitude, longitude: row.longitude,
    suggested_latitude: row.suggested_latitude, suggested_longitude: row.suggested_longitude,
    geocode_source: row.geocode_source, geocode_date: row.geocode_date,
    geocode_confidence: row.geocode_confidence, geocode_match_method: row.geocode_match_method,
    geocoded_at: row.geocoded_at, review_note: row.review_note, reviewed_by: row.reviewed_by,
    reviewed_at: row.reviewed_at, converted_unit_id: row.converted_unit_id,
    converted_at: row.converted_at, updated_at: row.updated_at,
  };
}

export async function importCoordinateSuggestions(user, rows) {
  if (!editableRoles.includes(user?.role)) fail("Seu perfil não pode atualizar sugestões de localização.", 403);
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 250) fail("Envie entre 1 e 250 sugestões por lote.");
  const seen = new Set();
  const suggestions = rows.map((row) => {
    const cnpj = text(row?.cnpj, 20).replace(/[.\-/]/g, "").toUpperCase();
    const latitude = Number(row?.latitude), longitude = Number(row?.longitude);
    if (!/^(?:\d{14}|[A-Z0-9]{12}\d{2})$/.test(cnpj) || seen.has(cnpj)) fail("A lista contém CNPJ inválido ou repetido.");
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) fail("A lista contém coordenada inválida.");
    if (!String(row?.source || "").startsWith("IBGE CNEFE 2022")) fail("A fonte da sugestão precisa estar identificada como IBGE CNEFE 2022.");
    const confidence = text(row.confidence, 120);
    if (!coordinateConfidenceRank(confidence)) fail("Classifique a confiança da sugestão como Alta, Média ou Baixa.");
    seen.add(cnpj);
    return { cnpj, latitude, longitude, source: text(row.source, 240), source_date: text(row.source_date, 20), confidence, match_method: text(row.match_method, 80), confidence_rank: coordinateConfidenceRank(confidence) };
  });
  if (isTurso()) {
    const now = new Date().toISOString();
    const existing = await query(
      `SELECT cnpj,geocode_confidence,suggested_latitude FROM prospecting_candidates WHERE cnpj IN (${suggestions.map((_, index) => `$${index + 1}`).join(",")})`,
      suggestions.map((suggestion) => suggestion.cnpj),
    );
    const byCnpj = new Map(existing.map((row) => [row.cnpj, row]));
    const updates = suggestions.filter((suggestion) => {
      const prior = byCnpj.get(suggestion.cnpj);
      return prior && (prior.suggested_latitude == null || suggestion.confidence_rank > coordinateConfidenceRank(prior.geocode_confidence));
    });
    if (updates.length) await writeBatch(updates.map((item) => ({
      sql: `UPDATE prospecting_candidates SET suggested_latitude=$1,suggested_longitude=$2,geocode_source=$3,geocode_date=$4,geocode_confidence=$5,geocode_match_method=$6,geocoded_at=$7 WHERE cnpj=$8 AND (suggested_latitude IS NULL OR CASE WHEN geocode_confidence LIKE 'Alta%' THEN 3 WHEN geocode_confidence LIKE 'Média%' THEN 2 WHEN geocode_confidence LIKE 'Baixa%' THEN 1 ELSE 0 END < $9)`,
      args: [item.latitude,item.longitude,item.source,item.source_date,item.confidence,item.match_method,now,item.cnpj,item.confidence_rank],
    })));
    if (suggestions.length) await query(`INSERT OR IGNORE INTO prospecting_candidate_map_regions(candidate_id,region_id)
      SELECT candidate.id,region.value FROM prospecting_candidates AS candidate,json_each(candidate.data,'$.prospecting_region_ids') AS region
      WHERE candidate.cnpj IN (${suggestions.map((_, index) => `$${index + 1}`).join(",")})
        AND (candidate.latitude IS NOT NULL OR candidate.suggested_latitude IS NOT NULL)`, suggestions.map((item) => item.cnpj));
    const matched = existing.length, updated = updates.length, skipped = matched - updated;
    await audit(user, "prospecting_candidates", "coordinate-suggestions", "import_ibge_geocoding", null, { received:suggestions.length, matched, updated, skipped, source:"IBGE CNEFE 2022", imported_at:now });
    return { received:suggestions.length, matched, updated, skipped, not_found:suggestions.length-matched };
  }
  return transaction(async () => {
    const now = new Date().toISOString();
    let matched = 0, updated = 0;
    if (isPostgres()) {
      const payload = suggestions.map(({ confidence_rank, ...suggestion }) => ({ ...suggestion, confidence_rank }));
      const result = await query(`
        WITH incoming AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS row(
            cnpj text, latitude double precision, longitude double precision,
            source text, source_date text, confidence text, match_method text,
            confidence_rank integer
          )
        ), updated AS (
          UPDATE prospecting_candidates AS candidate
          SET suggested_latitude=incoming.latitude,
              suggested_longitude=incoming.longitude,
              geocode_source=incoming.source,
              geocode_date=incoming.source_date,
              geocode_confidence=incoming.confidence,
              geocode_match_method=incoming.match_method,
              geocoded_at=$2
          FROM incoming
          WHERE candidate.cnpj=incoming.cnpj
            AND (candidate.suggested_latitude IS NULL OR
              CASE WHEN candidate.geocode_confidence LIKE 'Alta%' THEN 3
                   WHEN candidate.geocode_confidence LIKE 'Média%' THEN 2
                   WHEN candidate.geocode_confidence LIKE 'Baixa%' THEN 1 ELSE 0 END < incoming.confidence_rank)
          RETURNING candidate.cnpj
        )
        SELECT COUNT(candidate.cnpj)::int AS matched,
               COUNT(updated.cnpj)::int AS updated
        FROM incoming
        LEFT JOIN prospecting_candidates AS candidate ON candidate.cnpj=incoming.cnpj
        LEFT JOIN updated ON updated.cnpj=incoming.cnpj
      `, [JSON.stringify(payload), now]);
      matched = Number(result[0].matched);
      updated = Number(result[0].updated);
      const skipped = matched - updated;
      await audit(user, "prospecting_candidates", "coordinate-suggestions", "import_ibge_geocoding", null, { received:suggestions.length, matched, updated, skipped, source:"IBGE CNEFE 2022", imported_at:now });
      return { received:suggestions.length, matched, updated, skipped, not_found:suggestions.length-matched };
    }
    for (const item of suggestions) {
      const result = await query("UPDATE prospecting_candidates SET suggested_latitude=$1,suggested_longitude=$2,geocode_source=$3,geocode_date=$4,geocode_confidence=$5,geocode_match_method=$6,geocoded_at=$7 WHERE cnpj=$8 AND (suggested_latitude IS NULL OR CASE WHEN geocode_confidence LIKE 'Alta%' THEN 3 WHEN geocode_confidence LIKE 'Média%' THEN 2 WHEN geocode_confidence LIKE 'Baixa%' THEN 1 ELSE 0 END < $9) RETURNING id", [item.latitude,item.longitude,item.source,item.source_date,item.confidence,item.match_method,now,item.cnpj,item.confidence_rank]);
      if (result.length) updated++;
      const exists = result.length ? result : await query("SELECT id FROM prospecting_candidates WHERE cnpj=$1", [item.cnpj]);
      if (exists.length) matched++;
    }
    const skipped = matched - updated;
    await audit(user, "prospecting_candidates", "coordinate-suggestions", "import_ibge_geocoding", null, { received:suggestions.length, matched, updated, skipped, source:"IBGE CNEFE 2022", imported_at:now });
    return { received:suggestions.length, matched, updated, skipped, not_found:suggestions.length-matched };
  });
}
export async function clearStaleCoordinateSuggestions(user, cnpjs) {
  if (!editableRoles.includes(user?.role)) fail("Seu perfil não pode revisar sugestões de localização.", 403);
  if (!Array.isArray(cnpjs) || cnpjs.length < 1 || cnpjs.length > 250) fail("Envie entre 1 e 250 CNPJs para revisar sugestões antigas.");
  const normalized = cnpjs.map((value) => text(value, 20).replace(/[.\-/]/g, "").toUpperCase());
  if (normalized.some((cnpj) => !/^(?:\d{14}|[A-Z0-9]{12}\d{2})$/.test(cnpj)) || new Set(normalized).size !== normalized.length) fail("A lista contém CNPJ inválido ou repetido.");
  return transaction(async () => {
    let cleared = 0;
    for (const cnpj of normalized) {
      const result = await query("UPDATE prospecting_candidates SET suggested_latitude=NULL,suggested_longitude=NULL,geocode_source=NULL,geocode_date=NULL,geocode_confidence=NULL,geocode_match_method=NULL,geocoded_at=NULL WHERE cnpj=$1 AND geocode_source LIKE 'IBGE CNEFE 2022%' RETURNING id", [cnpj]);
      cleared += result.length;
    }
    if (isTurso()) await query(`DELETE FROM prospecting_candidate_map_regions WHERE candidate_id IN (SELECT id FROM prospecting_candidates WHERE cnpj IN (${normalized.map((_, index) => `$${index + 1}`).join(",")}))
      AND candidate_id IN (SELECT id FROM prospecting_candidates WHERE latitude IS NULL AND suggested_latitude IS NULL)`, normalized);
    const not_found = normalized.length - cleared;
    await audit(user, "prospecting_candidates", "coordinate-suggestions", "clear_stale_ibge_suggestions", null, { received:normalized.length, cleared, not_found, source:"IBGE CNEFE 2022", reason:"não reproduzida na correspondência atual" });
    return { received:normalized.length, cleared, not_found };
  });
}
export async function reviewCandidate(user, id, input) {
  if (!editableRoles.includes(user?.role)) fail("Seu perfil não pode revisar prospecções.",403);
  const row = (await query("SELECT * FROM prospecting_candidates WHERE id=$1",[id]))[0];
  if (!row) fail("Candidato não encontrado.",404);
  if (row.converted_unit_id) fail("Este candidato já foi convertido. Atualize os dados pela ficha do cliente.",409);
  const review_status = input.review_status ?? row.review_status;
  const location_status = input.location_status ?? row.location_status;
  if (!reviews.includes(review_status) || !locations.includes(location_status)) fail("Revise situação comercial e localização.");
  const latitudeInput = input.latitude === undefined ? row.latitude : input.latitude;
  const longitudeInput = input.longitude === undefined ? row.longitude : input.longitude;
  const latitude = latitudeInput === "" || latitudeInput == null ? null : Number(latitudeInput);
  const longitude = longitudeInput === "" || longitudeInput == null ? null : Number(longitudeInput);
  if ((latitude == null) !== (longitude == null) || (latitude != null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180))) fail("Informe latitude e longitude válidas.");
  if (location_status !== "Pendente" && latitude == null) fail("Para confirmar a localização dentro ou fora do território, informe as coordenadas verificadas.");
  if (latitude != null) {
    const area = await territory();
    if (!area?.geometry) fail("O contorno territorial não está configurado.",503);
    const position = pointInGeometry([longitude, latitude], area.geometry) ? "Dentro" : "Fora";
    if (location_status === "Dentro do KML" && position !== "Dentro") fail("As coordenadas ficam fora do contorno KML.");
    if (location_status === "Fora do KML" && position !== "Fora") fail("As coordenadas ficam dentro do contorno KML; revise a classificação.");
    if (location_status === "Dentro do raio" || location_status === "Fora do raio") {
      const matches = prospectingRegionCatalog.some((region) => {
        if (!Array.isArray(row.prospecting_region_ids) || !row.prospecting_region_ids.includes(region.id)) return false;
        const distance = distanceMeters([region.center.longitude, region.center.latitude], [longitude, latitude]);
        return (location_status === "Dentro do raio") === (distance <= region.radius_km * 1000);
      });
      if (!matches) fail("As coordenadas não correspondem à situação selecionada em nenhuma região associada.");
    }
  }
  const previousQualification = JSON.parse(row.data);
  const segment_fit = input.segment_fit ?? row.segment_fit ?? "Não avaliado";
  const operating_size = input.operating_size ?? row.operating_size ?? "Não avaliado";
  const materials_fit = input.materials_fit ?? row.materials_fit ?? "Não avaliado";
  if (!segmentFits.includes(segment_fit) || !operatingSizes.includes(operating_size) || !materialFits.includes(materials_fit)) fail("Revise os campos da qualificação comercial.");
  const qualification_source = text(input.qualification_source ?? previousQualification.qualification_source, 40);
  const qualification_evidence = text(input.qualification_evidence ?? previousQualification.qualification_evidence, 600);
  const hasHumanAssessment = segment_fit !== "Não avaliado" || operating_size !== "Não avaliado" || materials_fit !== "Não avaliado";
  if (hasHumanAssessment && (!qualificationSources.includes(qualification_source) || !qualification_evidence)) fail("Informe a fonte e a evidência da qualificação comercial.");
  const qualificationChanged = segment_fit !== row.segment_fit || operating_size !== row.operating_size || materials_fit !== row.materials_fit || qualification_source !== text(previousQualification.qualification_source, 40) || qualification_evidence !== text(previousQualification.qualification_evidence, 600);
  const qualification_status = qualificationStatus({ segment_fit, operating_size, materials_fit, location_status });
  const now = new Date().toISOString();
  const before = {...previousQualification,review_status:row.review_status,location_status:row.location_status,latitude:row.latitude,longitude:row.longitude,review_note:row.review_note,qualification_status:row.qualification_status,segment_fit:row.segment_fit,operating_size:row.operating_size,materials_fit:row.materials_fit};
  const after = {...before,review_status,location_status,latitude,longitude,review_note:input.review_note === undefined ? row.review_note : text(input.review_note,1000),qualification_status,segment_fit,operating_size,materials_fit,qualification_source:hasHumanAssessment?qualification_source:"",qualification_evidence:hasHumanAssessment?qualification_evidence:"",qualification_by:hasHumanAssessment?(qualificationChanged?user.name:(previousQualification.qualification_by||"")):"",qualification_at:hasHumanAssessment?(qualificationChanged?now:(previousQualification.qualification_at||"")):""};
  await transaction(async()=>{
    await query("UPDATE prospecting_candidates SET review_status=$1,location_status=$2,latitude=$3,longitude=$4,qualification_status=$5,segment_fit=$6,operating_size=$7,materials_fit=$8,data=$9,review_note=$10,reviewed_by=$11,reviewed_at=$12,updated_at=$12 WHERE id=$13",[after.review_status,after.location_status,latitude,longitude,qualification_status,segment_fit,operating_size,materials_fit,JSON.stringify(after),after.review_note,user.name,now,id]);
    if (isTurso() && (latitude != null || row.suggested_latitude != null)) await query(`INSERT OR IGNORE INTO prospecting_candidate_map_regions(candidate_id,region_id)
      SELECT candidate.id,region.value FROM prospecting_candidates AS candidate,json_each(candidate.data,'$.prospecting_region_ids') AS region WHERE candidate.id=$1`, [id]);
    await audit(user,"prospecting_candidates",id,"review",before,after);
  });
  return {...after,id,reviewed_by:user.name,reviewed_at:now};
}
