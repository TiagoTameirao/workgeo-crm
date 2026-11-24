import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.DATABASE_URL = "";
process.env.CRM_DATABASE_PROVIDER = "";
process.env.NODE_ENV = "test";
const dir = mkdtempSync(path.join(tmpdir(), "workgeo-search-"));
process.env.CRM_SQLITE_PATH = path.join(dir, "crm.sqlite");
const { migrate, query, close, sqliteConnection } = await import("../lib/db.mjs");
const { buildProspectingSearch } = await import("../scripts/build-prospecting-search.mjs");
const { searchMatchQuery } = await import("../lib/prospecting-search.mjs");
const { importCandidateBatch, listCandidatePage, listLeadPage, listCandidateMap } = await import("../lib/prospecting-candidates.mjs");
const user = { id: "search-user", name: "Comercial", role: "Comercial" };
const candidate = { cnpj: "12345678000199", cnpj_base: "12345678", company_name: "Mineração São José", unit_name: "Pátio Central", municipality: "Belo Horizonte", municipality_code_ibge: "3106200", uf: "MG", size_label: "Microempresa", scope_tier: "Aderência direta a validar", cnae_primary: "2391503", cnae_primary_description: "Aparelhamento de placas", categories: "Cimento, concreto e minerais não metálicos", prospecting_region_ids: ["belo-horizonte-170km"] };
before(async () => {
  await migrate();
  await query("INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,$2,$3,$4,$5,1)", [user.id,user.name,"search@example.test","hash",user.role]);
  await importCandidateBatch(user, [candidate]);
});
after(async () => { await close(); rmSync(dir, {recursive:true,force:true}); });

test("search index backfills existing candidates and supports accents, words, prefixes and formatted CNPJ", async () => {
  await buildProspectingSearch(() => {});
  for (const term of ["mineracao", "sao jose", "jose miner", "12.345.678/0001-99", "23915", "patio", "horizonte"]) {
    const page = await listCandidatePage(user, new URLSearchParams({ q: term, region: "belo-horizonte-170km" }));
    assert.equal(page.total, 1, term);
    assert.equal(page.rows[0].cnpj, candidate.cnpj);
  }
  assert.equal((await listCandidatePage(user, new URLSearchParams({q:'" OR * : % _'}))).total, 0);
  assert.equal(searchMatchQuery('São "José"'), '"São"* AND "José"*');
  const plan = sqliteConnection().prepare("EXPLAIN QUERY PLAN SELECT id FROM prospecting_candidates WHERE rowid IN (SELECT rowid FROM prospecting_search WHERE prospecting_search MATCH ?)").all('"mineracao"*');
  assert.ok(plan.some((row) => row.detail.includes("INTEGER PRIMARY KEY")));
});

test("indexed searches retain lead criteria, map locations and regional isolation", async () => {
  await query("UPDATE prospecting_candidates SET suggested_latitude=-19.9,suggested_longitude=-43.9 WHERE cnpj=$1", [candidate.cnpj]);
  await query("INSERT INTO prospecting_candidate_map_regions(candidate_id,region_id) SELECT id,$1 FROM prospecting_candidates WHERE cnpj=$2", ["belo-horizonte-170km",candidate.cnpj]);
  const leads = await listLeadPage(user, new URLSearchParams({view:"leads",q:"sao jose",region:"belo-horizonte-170km",fit:"qualificados"}));
  assert.equal(leads.total, 1);
  assert.equal(leads.summary.total, 1);
  assert.equal(leads.summary["Validação pendente"], 1);
  const withoutSummary = await listLeadPage(user, new URLSearchParams({q:"sao jose",region:"belo-horizonte-170km",fit:"qualificados",summary:"0"}));
  assert.equal(withoutSummary.summary, null);
  assert.equal(withoutSummary.total, leads.total);
  assert.deepEqual(withoutSummary.rows, leads.rows);
  const map = await listCandidateMap(user, new URLSearchParams({q:"sao jose",region:"belo-horizonte-170km",compact:"1"}));
  assert.equal(map.total, 1);
  assert.equal((await listCandidatePage(user, new URLSearchParams({q:"sao jose",region:"campinas-250km"}))).total, 0);
});

test("search index follows inserts, reimports and deletions without duplicates", async () => {
  await importCandidateBatch(user, [{...candidate,company_name:"Pedreira Nova"}]);
  assert.equal((await listCandidatePage(user, new URLSearchParams({q:"mineracao"}))).total, 0);
  assert.equal((await listCandidatePage(user, new URLSearchParams({q:"pedreira"}))).total, 1);
  await importCandidateBatch(user, [{...candidate,cnpj:"12345678000270",company_name:"Pedreira Segunda"}]);
  assert.equal((await listCandidatePage(user, new URLSearchParams({q:"pedreira"}))).total, 2);
  await buildProspectingSearch(() => {});
  assert.equal(Number((await query("SELECT COUNT(*) AS n FROM prospecting_search"))[0].n), 2);
  await query("DELETE FROM prospecting_candidates WHERE cnpj=$1", ["12345678000270"]);
  assert.equal((await listCandidatePage(user, new URLSearchParams({q:"pedreira"}))).total, 1);
});
