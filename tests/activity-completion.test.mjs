import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
const dir = mkdtempSync(path.join(tmpdir(), "workgeo-activity-completion-"));
process.env.CRM_SQLITE_PATH = path.join(dir, "test.sqlite");
const { migrate, query, get, close } = await import("../lib/db.mjs");
const { seedDatabase } = await import("../lib/seed.mjs");
const { saveRecord } = await import("../lib/domain.mjs");
const user = { id: "activity-user", name: "Comercial", role: "Comercial" };

before(async () => {
  await migrate();
  await seedDatabase();
  await query("INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,$2,'activity@example.invalid','unused',$3,1)", [user.id, user.name, user.role]);
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test("concluir atividade exige resultado e registra conclusão auditável", async () => {
  const unit = (await query("SELECT id FROM units LIMIT 1"))[0];
  const activity = await saveRecord(user, "activities", {
    unit_id: unit.id,
    name: "Ligar para confirmar necessidade",
    owner: "Tiago",
    due_date: "2026-10-14",
    channel: "Ligação",
    status: "Pendente",
  });
  await assert.rejects(
    saveRecord(user, "activities", { ...activity, status: "Concluída", result: "" }, activity.id, activity.version),
    /resultado da atividade/,
  );
  const completed = await saveRecord(user, "activities", { ...activity, status: "Concluída", result: "Contato feito; aguardando dados técnicos." }, activity.id, activity.version);
  assert.equal(completed.status, "Concluída");
  assert.equal((await get("activities", activity.id)).result, "Contato feito; aguardando dados técnicos.");
  assert.equal((await query("SELECT action FROM audit WHERE entity='activities' ORDER BY created_at DESC LIMIT 1"))[0].action, "alteração");
});
