import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
test("migração do contrato opcional preserva serviços antigos e notas vinculadas", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wg-admin-migration-"));
  process.env.CRM_SQLITE_PATH = path.join(dir, "test.sqlite");
  const legacy = new DatabaseSync(process.env.CRM_SQLITE_PATH);
  legacy.exec(`
    CREATE TABLE units(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE contracts(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,unit_id TEXT,opportunity_id TEXT);
    CREATE TABLE services(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,unit_id TEXT NOT NULL REFERENCES units(id),contract_id TEXT NOT NULL REFERENCES contracts(id));
    CREATE TABLE invoices(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,unit_id TEXT REFERENCES units(id),service_id TEXT NOT NULL REFERENCES services(id),amount_cents INTEGER);
    INSERT INTO units VALUES('unit','{"name":"Cliente"}',1,'2026-10-14','2026-10-14');
    INSERT INTO contracts VALUES('contract','{"name":"Contrato"}',1,'2026-10-14','2026-10-14','unit',NULL);
    INSERT INTO services VALUES('service','{"name":"Serviço existente"}',3,'2026-10-14','2026-10-14','unit','contract');
    INSERT INTO invoices VALUES('invoice','{"name":"Nota existente"}',1,'2026-10-14','2026-10-14','unit','service',10000);
  `);
  legacy.close();
  const db = await import("../lib/db.mjs");
  try {
    await db.migrate(); await db.migrate();
    assert.equal(db.sqliteConnection().prepare("PRAGMA table_info(services)").all().find((field) => field.name === "contract_id").notnull, 0);
    assert.equal((await db.get("services", "service")).version, 3);
    assert.equal((await db.query("SELECT service_id FROM invoices WHERE id=$1", ["invoice"]))[0].service_id, "service");
    assert.equal(db.sqliteConnection().prepare("PRAGMA foreign_key_check").all().length, 0);
    assert.equal(db.sqliteConnection().prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  } finally { await db.close(); rmSync(dir, { recursive: true, force: true }); }
});
