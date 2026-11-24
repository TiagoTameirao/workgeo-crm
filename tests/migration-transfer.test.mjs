import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { encryptBackup, decryptBackup } from "../lib/backup.mjs";
import { migrationDigest } from "../lib/migration-integrity.mjs";
import { importMigration } from "../lib/migration-transfer.mjs";

process.env.BACKUP_KEY = "e4".repeat(32);
let directory, client, manifest, source;
const column = (name, type = "text") => ({ name, type });
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "workgeo-transfer-"));
  source = path.join(directory, "source"); await mkdir(source);
  client = createClient({ url: "file:" + path.join(directory, "target.sqlite").replaceAll("\\", "/") });
  await client.executeMultiple(`PRAGMA foreign_keys=ON;
    CREATE TABLE schema_versions(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
    INSERT INTO schema_versions VALUES(1,'new'),(13,'new'),(14,'new');
    CREATE TABLE users(id TEXT PRIMARY KEY,password_hash TEXT NOT NULL,role TEXT NOT NULL,active INTEGER NOT NULL);
    CREATE TABLE companies(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE units(id TEXT PRIMARY KEY,company_id TEXT REFERENCES companies(id),data TEXT NOT NULL);
    CREATE TABLE prospecting_candidates(id TEXT PRIMARY KEY,cnpj TEXT UNIQUE,data TEXT NOT NULL,review_note TEXT,reviewed_by TEXT REFERENCES users(id),latitude DOUBLE PRECISION,cnae_primary_in_scope BOOLEAN);
    CREATE TABLE prospecting_activities(id TEXT PRIMARY KEY,candidate_id TEXT REFERENCES prospecting_candidates(id),created_by TEXT REFERENCES users(id),notes TEXT);`);
  const prospectColumns = [column("id"), column("cnpj"), column("data"), column("review_note"), column("reviewed_by"), column("latitude", "double precision"), column("cnae_primary_in_scope", "boolean")];
  const prospects = Array.from({ length: 1005 }, (_, n) => ({
    id: `prospect-${String(n).padStart(5, "0")}`, cnpj: String(n).padStart(14, "0"),
    data: JSON.stringify({ qualification_evidence: "Conversa com responsável — não recriar pelo CNPJ", owner_id: "u-original", material: "Minério", phone: "000000000", converted_unit_id: n === 1004 ? "unit-original" : null }),
    review_note: n === 0 ? "Conferência humana\nRetornar após reunião" : "Nota " + n,
    reviewed_by: "u-original", latitude: n === 0 ? null : -19.9, cnae_primary_in_scope: n % 2 === 0,
  }));
  const tables = [
    { name: "prospecting_activities", key: "id", parents: ["users", "prospecting_candidates"], columns: [column("id"), column("candidate_id"), column("created_by"), column("notes")], rows: [{ id: "activity-original", candidate_id: "prospect-00000", created_by: "u-original", notes: "Ligação realizada; retorno combinado" }] },
    { name: "units", key: "id", parents: ["companies"], columns: [column("id"), column("company_id"), column("data")], rows: [{ id: "unit-original", company_id: "company-original", data: '{"name":"São José — Unidade"}' }] },
    { name: "prospecting_candidates", key: "id", parents: ["users"], columns: prospectColumns, rows: prospects },
    { name: "users", key: "id", parents: [], columns: [column("id"), column("password_hash"), column("role"), column("active", "integer")], rows: [{ id: "u-original", password_hash: "hash-preservado", role: "Administrador", active: 1 }] },
    { name: "companies", key: "id", parents: [], columns: [column("id"), column("data")], rows: [{ id: "company-original", data: '{"name":"Empresa original"}' }] },
    { name: "schema_versions", key: "version", parents: [], columns: [column("version", "integer"), column("applied_at")], rows: [{ version: 1, applied_at: "2026-10-13" }, { version: 13, applied_at: "2026-10-20" }] },
  ];
  manifest = { kind: "workgeo-postgres-migration", complete: true, created_at: "2026-10-26", tables: [] };
  for (const { rows, ...table } of tables) {
    const digest = migrationDigest(), files = [];
    for (let index = 0; index < rows.length; index += 1000) {
      const part = rows.slice(index, index + 1000); part.forEach((row) => digest.add(row, table.columns));
      const filename = `${table.name}-${files.length}.enc`; files.push(filename);
      await writeFile(path.join(source, filename), encryptBackup({ table: table.name, rows: part }));
    }
    manifest.tables.push({ ...table, ...digest.finish(), files });
  }
  await writeFile(path.join(source, "manifest.enc"), encryptBackup(manifest));
});
after(async () => { client?.close(); await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

test("migração preserva todos os campos em várias páginas, vínculos e revisões, e confere fonte/destino", async () => {
  const report = await importMigration(client, source);
  assert.equal(report.tables.find((table) => table.name === "prospecting_candidates").count, 1005);
  const row = (await client.execute("SELECT * FROM prospecting_candidates WHERE id='prospect-00000'")).rows[0];
  assert.equal(row.review_note, "Conferência humana\nRetornar após reunião");
  assert.equal(row.latitude, null);
  assert.equal(row.reviewed_by, "u-original");
  assert.equal(JSON.parse(row.data).qualification_evidence, "Conversa com responsável — não recriar pelo CNPJ");
  assert.equal((await client.execute("SELECT password_hash FROM users")).rows[0].password_hash, "hash-preservado");
  assert.equal((await client.execute("SELECT applied_at FROM schema_versions WHERE version=13")).rows[0].applied_at, "2026-10-20");
  assert.equal((await client.execute("SELECT version FROM schema_versions WHERE version=14")).rows[0].version, 14);
  assert.equal((await client.execute("SELECT COUNT(*) AS n FROM prospecting_activities")).rows[0].n, 1);
  assert.deepEqual((await client.execute("PRAGMA foreign_key_check")).rows, []);
  assert.deepEqual(decryptBackup(await readFile(path.join(source, "target-verification.enc"))), report);
});

test("recusa sobrescrever destino com dados; retomada preserva a mesma cópia sem duplicar prospectos", async () => {
  await assert.rejects(importMigration(client, source), /destino vazio/);
  const report = await importMigration(client, source, { resume: true });
  assert.equal(report.tables.find((table) => table.name === "prospecting_candidates").count, 1005);
});

test("recuperação de cópia antiga exige opção explícita e mantém a origem identificada", async () => {
  const recovery = { ...manifest, kind: "workgeo-authorized-recovery", authorization: { date: "2026-10-26" } };
  await writeFile(path.join(source, "manifest.enc"), encryptBackup(recovery));
  await assert.rejects(importMigration(client, source, { resume: true }), /completa da fonte/);
  const report = await importMigration(client, source, { resume: true, allowRecovery: true });
  assert.equal(report.source_kind, "workgeo-authorized-recovery");
  assert.equal(report.tables.find((table) => table.name === "prospecting_candidates").count, 1005);
  await writeFile(path.join(source, "manifest.enc"), encryptBackup(manifest));
});

test("timeout após gravar um bloco permite retomar sem duplicar ou sobrescrever dados", async () => {
  await client.execute("DELETE FROM prospecting_candidates WHERE id='prospect-01004'");
  let interrupted = false;
  const interruptedClient = { execute: async (statement) => {
    const result = await client.execute(statement);
    if (!interrupted && statement.sql.startsWith("INSERT INTO prospecting_candidates")) {
      interrupted = true;
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } });
    }
    return result;
  } };
  const report = await importMigration(interruptedClient, source, { resume: true });
  assert.equal(interrupted, true);
  assert.equal(report.tables.find((table) => table.name === "prospecting_candidates").count, 1005);
});

test("uma nota alterada no destino impede a reconciliação, sem substituí-la silenciosamente", async () => {
  await client.execute("UPDATE prospecting_candidates SET review_note='alteração posterior' WHERE id='prospect-00000'");
  await assert.rejects(importMigration(client, source, { resume: true }), /Destino não reconciliado integralmente: prospecting_candidates/);
  assert.equal((await client.execute("SELECT review_note FROM prospecting_candidates WHERE id='prospect-00000'")).rows[0].review_note, "alteração posterior");
});

test("exportação parcial e bloco adulterado são rejeitados antes de qualquer nova gravação", async () => {
  await writeFile(path.join(source, "manifest.enc"), encryptBackup({ ...manifest, complete: false }));
  await assert.rejects(importMigration(client, source, { resume: true }), /completa da fonte/);
  await writeFile(path.join(source, "manifest.enc"), encryptBackup(manifest));
  const table = manifest.tables.find((table) => table.name === "prospecting_candidates");
  await writeFile(path.join(source, table.files[0]), encryptBackup({ table: table.name, rows: [] }));
  await assert.rejects(importMigration(client, source, { resume: true }), /Exportação incompleta ou alterada/);
});
