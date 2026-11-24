import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
const dir = mkdtempSync(path.join(tmpdir(), "workgeo-client-import-"));
process.env.CRM_SQLITE_PATH = path.join(dir, "test.sqlite");
const { migrate, query, list, close } = await import("../lib/db.mjs");
const { seedDatabase } = await import("../lib/seed.mjs");
const { importClients } = await import("../lib/client-import.mjs");
const { parseProspectingCsv, importCompanyKey } = await import("../lib/client-csv.mjs");
const commercial = { id: "import-commercial", name: "Tiago", role: "Comercial" };

before(async () => {
  await migrate();
  await seedDatabase();
  await query("INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,$2,'import@example.invalid','unused',$3,1)", [commercial.id, commercial.name, commercial.role]);
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test("CSV aceita BOM, ponto e vírgula, aspas, coordenadas e campos opcionais", () => {
  const rows = parseProspectingCsv('\uFEFFempresa;unidade;segmento;latitude;longitude;endereco\r\n"Areia; Minas";Pátio "Norte";Areal;-19,95;-43,94;"BR-040, km 500"');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data.company_name, "Areia; Minas");
  assert.equal(rows[0].data.unit_name, 'Pátio "Norte"');
  assert.equal(rows[0].data.latitude, -19.95);
  assert.equal(rows[0].errors.length, 0);
});

test("CSV identifica erros por linha e limita o lote", () => {
  const bad = parseProspectingCsv("empresa;latitude;longitude\n;91;-200\nEmpresa válida;;");
  assert.ok(bad[0].errors.some((error) => error.includes("empresa")));
  assert.ok(bad[0].errors.some((error) => error.includes("latitude")));
  assert.throws(() => parseProspectingCsv("empresa\n" + Array.from({ length: 101 }, (_, i) => `Empresa ${i}`).join("\n")), /100 linhas/);
});

test("CSV reconhece CNPJ alfanumérico do novo padrão", () => {
  const [row] = parseProspectingCsv("empresa;unidade;cnpj\nNova Indústria;Matriz;12.abc.345/0001-90");
  assert.equal(row.data.cnpj, "12ABC345000190");
  assert.deepEqual(row.errors, []);
});

test("lote agrupa filiais pelo CNPJ básico alfanumérico", async () => {
  const parsed = parseProspectingCsv([
    "empresa;unidade;cnpj",
    "Nova Metalúrgica;Matriz;12.ABC.345/0001-90",
    "Nova Metalúrgica;Unidade Norte;12.ABC.345/0002-71",
  ].join("\n"));
  const key = importCompanyKey(parsed[0].data);
  assert.equal(key, "cnpj:12ABC345");
  const result = await importClients(commercial, { rows: parsed, companyChoices: { [key]: "__new" } });
  assert.equal(result.companies, 1);
  assert.equal(result.created, 2);
});

test("importação agrupa empresas, cria unidades/contatos e pula repetidas com auditoria", async () => {
  const auditsBefore = (await query("SELECT COUNT(*) AS n FROM audit WHERE entity='clients_import'"))[0].n;
  const parsed = parseProspectingCsv([
    "empresa;unidade;segmento;contato;telefone;email;fonte",
    "Nova Areal Ltda;Pátio Central;Areal;Marina;(31) 99999-1234;marina@example.com;Pesquisa própria",
    "Nova Areal Ltda;Unidade Norte;Areal;;;;Pesquisa própria",
  ].join("\n"));
  const key = importCompanyKey(parsed[0].data);
  const created = await importClients(commercial, { rows: parsed, companyChoices: { [key]: "__new" } });
  assert.equal(created.created, 2);
  assert.equal(created.companies, 1);
  assert.equal(created.contacts, 1);
  const company = (await list("companies")).find((item) => item.name === "Nova Areal Ltda");
  assert.ok(company);

  const repeated = parseProspectingCsv("empresa;unidade\nNova Areal Ltda;Pátio Central\nNova Areal Ltda;Unidade Sul");
  const repeatedResult = await importClients(commercial, { rows: repeated, companyChoices: { [key]: company.id } });
  assert.equal(repeatedResult.created, 1);
  assert.equal(repeatedResult.skipped.length, 1);
  assert.equal((await query("SELECT COUNT(*) AS n FROM audit WHERE entity='clients_import'"))[0].n - auditsBefore, 2);
});

test("importação exige resolução explícita de empresa existente e respeita perfil", async () => {
  const parsed = parseProspectingCsv("empresa;unidade\nSiderbom;Novo local");
  const key = importCompanyKey(parsed[0].data);
  const before = (await list("units")).length;
  await assert.rejects(importClients(commercial, { rows: parsed, companyChoices: {} }), /Escolha o destino/);
  assert.equal((await list("units")).length, before);
  await assert.rejects(importClients({ ...commercial, role: "Campo" }, { rows: parsed, companyChoices: { [key]: "__new" } }), (error) => error.status === 403);
});
