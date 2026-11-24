import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
const dir = mkdtempSync(path.join(tmpdir(), "workgeo-old-agenda-"));
process.env.CRM_SQLITE_PATH = path.join(dir, "old.sqlite");
const { sqliteConnection, migrate, get, query, close } = await import("../lib/db.mjs");
test("migração preserva agenda antiga com cliente obrigatório e permite tarefas internas", async () => {
  try {
    const db = sqliteConnection();
    db.exec("CREATE TABLE companies(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)");
    db.exec("CREATE TABLE units(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,company_id TEXT NOT NULL REFERENCES companies(id))");
    db.exec("CREATE TABLE activities(id TEXT PRIMARY KEY,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,unit_id TEXT NOT NULL REFERENCES units(id),opportunity_id TEXT)");
    const now = new Date().toISOString();
    await query("INSERT INTO companies(id,data,created_at,updated_at) VALUES('old-company',$1,$2,$2)", [JSON.stringify({ name: "Antiga" }), now]);
    await query("INSERT INTO units(id,data,created_at,updated_at,company_id) VALUES('old-unit',$1,$2,$2,'old-company')", [JSON.stringify({ name: "Unidade", company_id: "old-company" }), now]);
    await query("INSERT INTO activities(id,data,version,created_at,updated_at,unit_id) VALUES('old-activity',$1,7,$2,$2,'old-unit')", [JSON.stringify({ name: "Contato antigo", owner: "Não confirmado", unit_id: "old-unit", due_date: "2026-10-15", notes: "Histórico preservado" }), now]);
    await migrate(); await migrate();
    const record = await get("activities", "old-activity");
    assert.equal(record.version, 7); assert.equal(record.notes, "Histórico preservado"); assert.equal(record.created_at, now); assert.equal(record.due_date, "2026-10-15"); assert.equal(record.owner_id, undefined);
    assert.equal(sqliteConnection().prepare("PRAGMA table_info(activities)").all().find((field) => field.name === "unit_id").notnull, 0);
    assert.ok(sqliteConnection().prepare("PRAGMA table_info(activities)").all().some((field) => field.name === "service_id"));
    assert.equal((await query("SELECT id FROM notifications")).length, 0);
    assert.equal(sqliteConnection().prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { await close(); rmSync(dir, { recursive: true, force: true }); }
});
