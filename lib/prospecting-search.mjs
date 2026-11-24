import { prospectingRegionIds, regionMembershipSql } from "./prospecting-indexes.mjs";

export const searchIndexVersion = "prospecting-search-v1";

export function candidateSearchExpression(table) {
  const fields = ["company_name", "unit_name", "cnae_primary", "cnae_primary_description", "cnae_context", "categories", "address", "postal_code", "phone", "email", "uf"];
  return [`${table}.cnpj`, `${table}.municipality`, ...fields.map((field) => `COALESCE(json_extract(${table}.data,'$.${field}'),'')`)].join(" || ' ' || ");
}

export function searchIndexStatements() {
  const value = candidateSearchExpression("new");
  return [
    "CREATE VIRTUAL TABLE IF NOT EXISTS prospecting_search USING fts5(search_text, content='', contentless_delete=1, detail=none, tokenize='unicode61 remove_diacritics 2', prefix='2 3')",
    `CREATE TRIGGER IF NOT EXISTS prospecting_search_insert AFTER INSERT ON prospecting_candidates BEGIN INSERT INTO prospecting_search(rowid,search_text) VALUES(new.rowid,${value}); END`,
    "CREATE TRIGGER IF NOT EXISTS prospecting_search_delete AFTER DELETE ON prospecting_candidates BEGIN DELETE FROM prospecting_search WHERE rowid=old.rowid; END",
    `CREATE TRIGGER IF NOT EXISTS prospecting_search_update AFTER UPDATE OF cnpj,municipality,data ON prospecting_candidates BEGIN DELETE FROM prospecting_search WHERE rowid=old.rowid; INSERT INTO prospecting_search(rowid,search_text) VALUES(new.rowid,${value}); END`,
  ];
}

export function searchMatchQuery(value) {
  const term = String(value ?? "").trim().slice(0, 120);
  const compact = term.replace(/[.\s/\-]/g, "");
  if (/^[a-z0-9]{8,14}$/i.test(compact) && /\d/.test(compact)) return `"${compact}"*`;
  const tokens = term.normalize("NFC").match(/[\p{L}\p{N}]+/gu) || [];
  return tokens.map((token) => `"${token}"*`).join(" AND ");
}

export async function addCandidateSearchFilter(clauses, params, value, { query, isPostgres }) {
  const term = String(value ?? "").trim().slice(0, 120);
  if (!term) return false;
  const cnpj = term.replace(/[.\s/\-]/g, "").toUpperCase();
  if (/^[A-Z0-9]{12}\d{2}$/.test(cnpj)) {
    params.push(cnpj);
    clauses.push(`cnpj=$${params.length}`);
    return "cnpj";
  }
  const ready = !isPostgres() && (await query("SELECT id FROM settings WHERE id=$1", [searchIndexVersion])).length > 0;
  if (ready) {
    const match = searchMatchQuery(term);
    if (!match) clauses.push("0=1");
    else {
      params.push(match);
      const region = prospectingRegionIds.find((id) => clauses.includes(`(${regionMembershipSql(id)})`));
      let regionIntersection = "";
      if (region) {
        const membership = regionMembershipSql(region);
        clauses.splice(clauses.indexOf(`(${membership})`), 1);
        regionIntersection = ` INTERSECT SELECT rowid FROM prospecting_candidates WHERE ${membership}`;
      }
      clauses.push(`prospecting_candidates.rowid IN (SELECT rowid FROM prospecting_search WHERE prospecting_search MATCH $${params.length}${regionIntersection})`);
    }
    return true;
  }
  params.push(`%${term}%`);
  const p = `$${params.length}`;
  clauses.push(`(cnpj LIKE ${p} OR municipality LIKE ${p} OR data LIKE ${p})`);
  return false;
}

