import { pathToFileURL } from "node:url";
import { setTimeout } from "node:timers/promises";
import { query as databaseQuery, close, isPostgres } from "../lib/db.mjs";
import { candidateSearchExpression, searchIndexStatements, searchIndexVersion } from "../lib/prospecting-search.mjs";

async function query(sql, params) {
  for (let attempt = 0; ; attempt++) {
    try { return await databaseQuery(sql, params); }
    catch (error) {
      const code = error.cause?.code || error.code;
      if (attempt >= 3 || !["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "ECONNRESET", "ETIMEDOUT"].includes(code)) throw error;
      await setTimeout(1000 * 2 ** attempt);
    }
  }
}

export async function buildProspectingSearch(log = console.log) {
  if (isPostgres()) throw new Error("Este índice é específico de SQLite/libSQL.");
  if ((await query("SELECT id FROM settings WHERE id=$1", [searchIndexVersion])).length) {
    log("Índice de pesquisa já está pronto.");
    return;
  }
  for (const sql of searchIndexStatements()) await query(sql);
  const [{ last_rowid: lastRowid }] = await query("SELECT COALESCE(MAX(rowid),0) AS last_rowid FROM prospecting_candidates");
  const batchSize = 5000;
  const [firstMissing] = await query("SELECT MIN(rowid) AS missing_rowid FROM (SELECT rowid FROM prospecting_candidates EXCEPT SELECT rowid FROM prospecting_search)");
  const firstBatch = firstMissing.missing_rowid != null ? Math.floor((Number(firstMissing.missing_rowid) - 1) / batchSize) * batchSize : Number(lastRowid);
  for (let start = firstBatch; start < Number(lastRowid); start += batchSize) {
    const started = performance.now();
    await query(`INSERT INTO prospecting_search(rowid,search_text)
      SELECT candidate.rowid,${candidateSearchExpression("candidate")} FROM prospecting_candidates candidate
      WHERE candidate.rowid>$1 AND candidate.rowid<=$2
        AND NOT EXISTS(SELECT 1 FROM prospecting_search WHERE rowid=candidate.rowid)`, [start, start + batchSize]);
    if (start % 20000 === 0) log(JSON.stringify({ indexed_through: Math.min(start + batchSize, Number(lastRowid)), last_rowid: Number(lastRowid), batch_ms: Math.round(performance.now() - started) }));
  }
  const [{ missing }] = await query("SELECT COUNT(*) AS missing FROM (SELECT rowid FROM prospecting_candidates EXCEPT SELECT rowid FROM prospecting_search)");
  if (Number(missing)) throw new Error("O índice ainda não cobre todos os candidatos.");
  await query("INSERT INTO settings(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", [searchIndexVersion, JSON.stringify({ ready_at: new Date().toISOString() })]);
  log("Índice completo; pesquisa habilitada. Cadastros e qualificações preservados.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await buildProspectingSearch(); } finally { await close(); }
}
