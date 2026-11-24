import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
const dir = mkdtempSync(path.join(tmpdir(), "workgeo-conversation-conversion-"));
process.env.CRM_SQLITE_PATH = path.join(dir, "test.sqlite");
const { migrate, query, get, close } = await import("../lib/db.mjs");
const { seedDatabase } = await import("../lib/seed.mjs");
const { saveRecord, createOpportunityFromConversation } = await import("../lib/domain.mjs");
const user = { id: "conversion-user", name: "Comercial", role: "Comercial" };

before(async () => {
  await migrate();
  await migrate();
  await seedDatabase();
  await query("INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,$2,'conversion@example.invalid','unused',$3,1)", [user.id, user.name, user.role]);
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });

test("migração 3 adiciona o vínculo em uma base de conversas existente", async () => {
  await query("DROP INDEX IF EXISTS conversations_opportunity");
  await query("ALTER TABLE conversations DROP COLUMN opportunity_id");
  await query("DELETE FROM schema_versions WHERE version=3");
  await migrate();
  assert.ok((await query("SELECT sql FROM sqlite_master WHERE type='table' AND name='conversations'"))[0].sql.includes("opportunity_id"));
  assert.equal((await query("SELECT version FROM schema_versions WHERE version=3")).length, 1);
});

test("conversão cria oportunidade e vincula contexto numa operação única", async () => {
  const contact = (await query("SELECT id,unit_id FROM contacts LIMIT 1"))[0];
  const conversation = await saveRecord(user, "conversations", {
    unit_id: contact.unit_id,
    contact_id: contact.id,
    name: "Interesse em inventário",
    channel: "E-mail",
    owner: "Tiago",
    status: "Aguardando equipe",
    next_action: "Entender escopo",
    next_date: "2026-10-15",
  });
  const result = await createOpportunityFromConversation(user, conversation.id, {
    name: "Inventário trimestral",
    owner: "Tiago",
    next_action: "Confirmar quantidade de áreas",
    next_date: "2026-10-16",
  });
  assert.equal(result.opportunity.unit_id, contact.unit_id);
  assert.equal(result.opportunity.contact_id, contact.id);
  assert.equal(result.conversation.opportunity_id, result.opportunity.id);
  assert.equal((await get("conversations", conversation.id)).opportunity_id, result.opportunity.id);
  await assert.rejects(createOpportunityFromConversation(user, conversation.id, {
    name: "Oportunidade duplicada",
    owner: "Tiago",
    next_action: "Retornar",
    next_date: "2026-10-17",
  }), (error) => error.status === 409);
  assert.equal((await query("SELECT COUNT(*) AS n FROM opportunities"))[0].n, 1);
  assert.equal((await query("SELECT version FROM schema_versions WHERE version=3")).length, 1);
});

test("conversão rejeita perfil sem acesso e preserva histórico se a criação falhar", async () => {
  const contact = (await query("SELECT id,unit_id FROM contacts LIMIT 1"))[0];
  const conversation = await saveRecord(user, "conversations", {
    unit_id: contact.unit_id,
    contact_id: contact.id,
    name: "Dúvida sobre prazo",
    channel: "WhatsApp",
    owner: "Tiago",
    status: "Aguardando equipe",
    next_action: "Responder",
    next_date: "2026-10-18",
  });
  await assert.rejects(createOpportunityFromConversation({ ...user, role: "Campo" }, conversation.id, {}), (error) => error.status === 403);
  await assert.rejects(createOpportunityFromConversation(user, conversation.id, {
    name: "Demanda inválida",
    owner: "Tiago",
  }));
  const otherUnit = (await query("SELECT id FROM units WHERE id<>$1 LIMIT 1", [contact.unit_id]))[0];
  await assert.rejects(createOpportunityFromConversation(user, conversation.id, {
    unit_id: otherUnit.id,
    contact_id: contact.id,
    name: "Unidade incompatível",
    owner: "Tiago",
    next_action: "Retornar",
    next_date: "2026-10-19",
  }), /permanecer os mesmos/);
  assert.equal((await get("conversations", conversation.id)).opportunity_id, undefined);
  assert.equal((await query("SELECT COUNT(*) AS n FROM opportunities"))[0].n, 1);
});
