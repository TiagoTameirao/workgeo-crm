import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { decryptBackup, encryptBackup, restoreSnapshot } from "../lib/backup.mjs";
import { migrate, query, transaction, close } from "../lib/db.mjs";
import { validateCandidateBatch } from "../lib/prospecting-candidates.mjs";
import { readProspectingSnapshot } from "../lib/prospecting-snapshot-csv.mjs";
import { migrationDigest } from "../lib/migration-integrity.mjs";

if (process.env.CRM_DATABASE_PROVIDER || process.env.DATABASE_URL || process.env.VERCEL || !process.env.CRM_SQLITE_PATH || process.env.NODE_ENV === "production")
  throw new Error("Prepare a recuperação somente em SQLite local novo, sem conexão de produção.");
const output = path.resolve(process.argv[2] || "backups/oct20-authorized-recovery-20261026");
await mkdir(output);
const now = new Date().toISOString();
const original = decryptBackup(await readFile("backups/agenda-before-schema13-20261020.enc"));
if (original.kind !== "workgeo-agenda-migration-safety-copy" || original.schema !== "crm_production") throw new Error("A cópia operacional não é da produção esperada.");
const fileBackup = decryptBackup(await readFile("backups/backup-2026-10-13T20-10-37-653Z.enc"));
const prior = JSON.parse(await readFile("deliverables/prospecting-cnpj/lead-sieve-2026-10.json", "utf8"));
const sources = [];
for (const source of prior.sources) {
  const sha256 = createHash("sha256").update(await readFile(source.file)).digest("hex");
  if (sha256 !== source.sha256) throw new Error(`Arquivo difere da auditoria salva: ${source.file}`);
  sources.push({ ...source, sha256 });
}
for (const file of original.tables.files) {
  const binary = fileBackup.binaries?.[file.storage_key];
  if (!binary || Buffer.from(binary, "base64").length !== Number(file.size_bytes)) throw new Error("Documento da cópia operacional não reconciliado.");
}
try {
  await migrate();
  await restoreSnapshot({ schemaVersion: 2, tables: original.tables, binaries: {} });
  const operationalCounts = Object.fromEntries(Object.entries(original.tables).filter(([name]) => name !== "schema_versions").map(([name, rows]) => [name, rows.length]));
  const suggestions = new Map();
  await readProspectingSnapshot(createReadStream("deliverables/prospecting-cnpj/suggestions-2026-10-expanded.csv"), async (rows) => {
    for (const row of rows) {
      if (suggestions.has(row.cnpj)) throw new Error("CNPJ repetido nas sugestões.");
      suggestions.set(row.cnpj, row);
    }
  });
  const actor = { id: null, name: "Recuperação autorizada em 26/10/2026", role: "Administrador" };
  let restored = 0, matched = 0;
  await readProspectingSnapshot(createReadStream("deliverables/prospecting-cnpj/prospecting-cnpj-2026-10.csv"), async (rows) => {
    const candidates = validateCandidateBatch(actor, rows);
    await transaction(async () => {
      for (const candidate of candidates) {
        const suggestion = suggestions.get(candidate.cnpj);
        if (suggestion) matched++;
        await query("INSERT INTO prospecting_candidates(id,cnpj,cnpj_base,municipality,scope_tier,size_label,cnae_primary_in_scope,lead_score,lead_tier,lead_scoring_version,review_status,location_status,data,created_at,updated_at,suggested_latitude,suggested_longitude,geocode_source,geocode_date,geocode_confidence,geocode_match_method,geocoded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16,$17,$18,$19,$20,$21)", [
          "cnpj-" + candidate.cnpj, candidate.cnpj, candidate.cnpj_base, candidate.municipality, candidate.scope_tier, candidate.size_label, candidate.cnae_primary_in_scope ? 1 : 0,
          candidate.lead_score, candidate.lead_tier, candidate.lead_scoring_version, candidate.review_status, candidate.location_status, JSON.stringify(candidate), now,
          suggestion ? Number(suggestion.latitude) : null, suggestion ? Number(suggestion.longitude) : null, suggestion?.source || null, suggestion?.source_date || null, suggestion?.confidence || null, suggestion?.match_method || null, suggestion ? now : null,
        ]);
        restored++;
      }
    });
    if (restored % 10000 === 0) console.log(`Prospectos preparados: ${restored}`);
  });
  if (restored !== prior.metrics.establishments || matched !== prior.metrics.matched_suggestions) throw new Error("Totais da prospecção não correspondem à auditoria anterior.");
  for (const [table, count] of Object.entries(operationalCounts)) if (Number((await query(`SELECT COUNT(*) AS n FROM ${table}`))[0].n) !== count) throw new Error(`Dados operacionais não preservados: ${table}`);
  if ((await query("PRAGMA foreign_key_check")).length) throw new Error("Vínculos locais inconsistentes.");
  const recovery = { authorized_at: "2026-10-26", operational_copy: original.created_at, prospects: restored, suggestions: matched, candidate_ids: "Reconstituídos pelo CNPJ; IDs internos antigos ausentes da cópia, sem vínculos individuais conhecidos", user_statement: "Usuário confirmou não ter alterado a base e autorizou a cópia de 20/10", sources };
  await query("INSERT INTO settings(id,data) VALUES('authorized-recovery-20261026',$1)", [JSON.stringify(recovery)]);
  await query("INSERT INTO audit(id,entity,record_id,action,after_data,created_at) VALUES($1,'settings','authorized-recovery-20261026','restauração autorizada',$2,$3)", [randomUUID(), JSON.stringify(recovery), now]);
  const manifest = { kind: "workgeo-authorized-recovery", complete: true, authorization: { date: "2026-10-26", scope: "Base operacional de20/10 e arquivos salvos da prospecção/Leads; versão atual do código" }, recovery, created_at: now, tables: [] };
  const tables = await query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  for (const { name } of tables) {
    const info = await query(`PRAGMA table_info(${name})`);
    const key = info.filter((column) => column.pk).map((column) => column.name);
    if (key.length !== 1) throw new Error("Chave de recuperação não suportada.");
    const columns = info.map((column) => ({ name: column.name, type: /INT/i.test(column.type) ? "bigint" : /BOOL/i.test(column.type) ? "boolean" : /DOUBLE|REAL|NUMERIC/i.test(column.type) ? "double precision" : "text" }));
    const parents = [...new Set((await query(`PRAGMA foreign_key_list(${name})`)).map((row) => row.table))];
    const digest = migrationDigest(), files = [];
    let last;
    for (;;) {
      const rows = await query(`SELECT * FROM ${name}${last === undefined ? "" : ` WHERE ${key[0]}>$1`} ORDER BY ${key[0]} LIMIT 1000`, last === undefined ? [] : [last]);
      if (!rows.length) break;
      rows.forEach((row) => digest.add(row, columns));
      const filename = `${name}-${String(files.length + 1).padStart(5, "0")}.enc`;
      await writeFile(path.join(output, filename), encryptBackup({ table: name, rows }));
      files.push(filename); last = rows.at(-1)[key[0]];
    }
    manifest.tables.push({ name, key: key[0], columns, parents, ...digest.finish(), files });
  }
  await writeFile(path.join(output, "manifest.enc"), encryptBackup(manifest));
  await writeFile(path.join(output, "recovery-summary.json"), JSON.stringify({ ...recovery, operationalCounts, files: original.tables.files.length }, null, 2));
  console.log(JSON.stringify({ output, prospects: restored, suggestions: matched, operationalCounts, files: original.tables.files.length }));
} finally { await close(); }
