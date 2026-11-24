import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const directory = mkdtempSync(path.join(tmpdir(), "workgeo-libsql-"));
process.env.CRM_DATABASE_PROVIDER = "turso";
process.env.TURSO_DATABASE_URL = pathToFileURL(path.join(directory, "test.sqlite")).href;
process.env.TURSO_AUTH_TOKEN = "local-test-only";
process.env.DATABASE_URL = "postgres://invalid-unused.example.invalid/test";
process.env.NODE_ENV = "test";
delete process.env.VERCEL;
const { migrate, query, transaction, close, isPostgres, isTurso } = await import("../lib/db.mjs");
const { importCandidateBatch, importCoordinateSuggestions, listLeadPage, listCandidatePage, listCandidateMap } = await import("../lib/prospecting-candidates.mjs");
before(migrate);
after(async () => { await close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

test("seleção explícita do Turso evita acessar PostgreSQL e preserva schema completo", async () => {
  assert.equal(isTurso(), true);
  assert.equal(isPostgres(), false);
  assert.equal((await query("SELECT MAX(version) AS version FROM schema_versions"))[0].version, 17);
  assert.ok((await query("PRAGMA table_info(activities)")).some((column) => column.name === "service_id"));
  assert.deepEqual(await query("PRAGMA foreign_key_check"), []);
  await migrate();
});

test("libSQL reordena parâmetros repetidos e preserva Unicode, null e booleano", async () => {
  const rows = await query("SELECT $2 AS a,$1 AS b,$2 AS c,$3 AS d,$4 AS e", ["Volumetria — revisão", "São Paulo", null, true]);
  assert.deepEqual(rows, [{ a: "São Paulo", b: "Volumetria — revisão", c: "São Paulo", d: null, e: 1 }]);
});

test("Turso aplica sugestões CNEFE em lote sem substituir coordenadas de confiança superior", async () => {
  const user = { id: null, name: "QA", role: "Administrador" };
  const cnpj = "12345678901231";
  await importCandidateBatch(user, [{ cnpj, cnpj_base: "12345678", company_name: "Candidato QA", municipality: "Belo Horizonte", uf: "MG", size_label: "Microempresa", scope_tier: "Aderência direta a validar" }]);
  const first = await importCoordinateSuggestions(user, [{ cnpj, latitude: -19.9, longitude: -43.9, source: "IBGE CNEFE 2022 — teste", source_date: "2024-09-10", confidence: "Alta; revisar", match_method: "municipio_cep_logradouro_numero" }]);
  assert.deepEqual({ received:first.received, matched:first.matched, updated:first.updated, skipped:first.skipped, not_found:first.not_found }, { received:1, matched:1, updated:1, skipped:0, not_found:0 });
  const lower = await importCoordinateSuggestions(user, [{ cnpj, latitude: -20, longitude: -44, source: "IBGE CNEFE 2022 — teste", source_date: "2024-09-10", confidence: "Baixa; revisar", match_method: "municipio_cep_logradouro_sem_numero" }]);
  assert.deepEqual({ matched:lower.matched, updated:lower.updated, skipped:lower.skipped }, { matched:1, updated:0, skipped:1 });
  const row = (await query("SELECT suggested_latitude,suggested_longitude,geocode_confidence FROM prospecting_candidates WHERE cnpj=$1", [cnpj]))[0];
  assert.equal(row.suggested_latitude, -19.9);
  assert.equal(row.suggested_longitude, -43.9);
  assert.match(row.geocode_confidence, /^Alta/);
  await query("DELETE FROM prospecting_candidates WHERE cnpj=$1", [cnpj]);
});

test("transações aninhadas têm rollback integral e restrições de vínculo continuam ativas", async () => {
  await assert.rejects(transaction(async () => {
    await query("INSERT INTO settings(id,data) VALUES($1,$2)", ["rollback-qa", "original"]);
    await transaction(() => query("UPDATE settings SET data=$1 WHERE id=$2", ["alterado", "rollback-qa"]));
    throw new Error("cancelar teste");
  }), /cancelar teste/);
  assert.deepEqual(await query("SELECT * FROM settings WHERE id=$1", ["rollback-qa"]), []);
  await assert.rejects(query("INSERT INTO sessions(id,user_id,expires_at) VALUES('qa-session','missing','2030-01-01')"));
  await transaction(() => query("INSERT INTO settings(id,data) VALUES($1,$2)", ["committed-qa", "ok"]));
  assert.equal((await query("SELECT data FROM settings WHERE id=$1", ["committed-qa"]))[0].data, "ok");
});

test("indexed queues preserve overlapping regions, map membership after reimport and source evidence", async () => {
  const user = { id: null, name: 'QA', role: 'Administrador' };
  const cnpj = '12345678901111';
  const candidate = { cnpj, company_name: 'Unidade regional', municipality: 'Belo Horizonte', uf: 'MG', size_label: 'Microempresa', scope_tier: 'Aderência direta a validar', prospecting_region_ids: ['belo-horizonte-170km'] };
  await importCandidateBatch(user, [candidate]);
  await importCoordinateSuggestions(user, [{ cnpj, latitude: -19.9, longitude: -43.9, source: 'IBGE CNEFE 2022 — teste', confidence: 'Alta; revisar' }]);
  await importCandidateBatch(user, [{ ...candidate, prospecting_region_ids: ['volta-redonda-100km'] }]);
  for (const region of ['belo-horizonte-170km', 'volta-redonda-100km']) {
    assert.equal((await listCandidatePage(user, new URLSearchParams({ region, q: cnpj }))).total, 1);
    const map = await listCandidateMap(user, new URLSearchParams({ region, q: cnpj, compact: '1' }));
    assert.equal(map.total, 1);
    assert.equal(map.points[0].cnpj, cnpj);
    assert.equal(map.points[0].coordinate_confirmed, false);
  }
  assert.equal((await listLeadPage(user, new URLSearchParams({ region: 'belo-horizonte-170km', fit: 'qualificados', q: cnpj }))).total, 1);
  const plan = await query(`EXPLAIN QUERY PLAN SELECT id FROM prospecting_candidates WHERE INSTR(json_extract(data,'$.prospecting_region_ids'),'"belo-horizonte-170km"')>0 ORDER BY CASE review_status WHEN 'Pendente' THEN 0 ELSE 1 END,CASE WHEN cnae_primary_in_scope THEN 0 ELSE 1 END,municipality,cnpj LIMIT 50`);
  assert.ok(plan.some((row) => row.detail.includes('prospecting_region_queue_0')));
  await query('DELETE FROM prospecting_candidate_map_regions WHERE candidate_id IN (SELECT id FROM prospecting_candidates WHERE cnpj=$1)', [cnpj]);
  await query('DELETE FROM prospecting_candidates WHERE cnpj=$1', [cnpj]);
});

test("configuração hospedada rejeita arquivo local em vez de simular persistência remota", async () => {
  await close();
  process.env.VERCEL = "1";
  await assert.rejects(query("SELECT 1"), /remota segura/);
  delete process.env.VERCEL;
});
