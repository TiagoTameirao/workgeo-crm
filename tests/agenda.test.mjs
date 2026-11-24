import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
const dir = mkdtempSync(path.join(tmpdir(), "workgeo-agenda-"));
process.env.CRM_SQLITE_PATH = path.join(dir, "test.sqlite");
const { migrate, query, get, insert, list, close } = await import("../lib/db.mjs");
const { saveRecord, stateFor, changeAdministrativeCatalog } = await import("../lib/domain.mjs");
const { seedDatabase } = await import("../lib/seed.mjs");
const { activityIntervals, zonedInstant, safeActivity, blocksAvailability } = await import("../lib/agenda.mjs");
const { deliverNotification, notificationsFor } = await import("../lib/notifications.mjs");
const admin = { id: "agenda-admin", name: "Gestão QA", role: "Administrador" };
const pedro = { id: "agenda-pedro", name: "Pedro QA", role: "Campo" };
const douglas = { id: "agenda-douglas", name: "Douglas QA", role: "Técnico" };
const josi = { id: "agenda-josi", name: "Josi QA", role: "Administrativo" };
before(async () => {
  await migrate(); await seedDatabase();
  for (const user of [admin, pedro, douglas, josi]) await query("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,'unused',$4)", [user.id, user.name, user.id + "@example.invalid", user.role]);
  await changeAdministrativeCatalog(admin, { action: "add-client", unit_id: "unit-001" });
});
after(async () => { await close(); rmSync(dir, { recursive: true, force: true }); });
const internal = (extra = {}) => ({ name: "Tarefa interna QA", owner_id: admin.id, category: "Tarefa geral", area: "Escritório", ...extra });

test("tarefas internas aceitam prazo opcional, progresso e conclusão com resultado", async () => {
  const record = await saveRecord(admin, "activities", internal());
  assert.equal(record.unit_id, undefined); assert.equal(activityIntervals(record).length, 0);
  const progress = await saveRecord(admin, "activities", { status: "Em andamento" }, record.id, record.version);
  await assert.rejects(saveRecord(admin, "activities", { status: "Concluída" }, progress.id, progress.version), /resultado/);
  const done = await saveRecord(admin, "activities", { status: "Concluída", result: "Conferido" }, progress.id, progress.version);
  assert.equal(done.result, "Conferido");
});
test("dias finais inclusivos, meses e intervalo diário usam São Paulo", () => {
  const all = activityIntervals({ start_date: "2026-10-31", end_date: "2026-11-02", all_day: "Sim" });
  assert.deepEqual(all, [{ start: "2026-10-31", end: "2026-11-03", allDay: true }]);
  const daily = activityIntervals({ start_date: "2026-10-31", end_date: "2026-11-02", start_time: "08:00", end_time: "17:00", schedule_mode: "Horário diário" });
  assert.equal(daily.length, 3); assert.equal(daily[0].start, "2026-10-31T11:00:00.000Z"); assert.equal(daily[2].end, "2026-11-02T20:00:00.000Z");
  const continuous = activityIntervals({ start_date: "2026-10-31", end_date: "2026-11-02", start_time: "18:00", end_time: "08:00", schedule_mode: "Contínuo" });
  assert.equal(continuous.length, 1); assert.equal(continuous[0].end, "2026-11-02T11:00:00.000Z");
  assert.equal(zonedInstant("2026-10-20", "09:00"), "2026-10-20T12:00:00.000Z");
});
test("legado permanece como prazo de dia inteiro, sem horário inventado", async () => {
  const old = await insert("activities", { name: "Legado", owner: "Nome sem conta", unit_id: "unit-001", due_date: "2026-10-22", status: "Pendente" }, "agenda-legacy");
  assert.deepEqual(activityIntervals(old), [{ start: "2026-10-22", end: "2026-10-23", allDay: true }]);
  await migrate(); assert.equal((await get("activities", old.id)).due_date, "2026-10-22");
});
test("operação cria somente para si e não distribui participantes", async () => {
  const own = await saveRecord(pedro, "activities", internal({ owner_id: douglas.id, area: "Operação" }));
  assert.equal(own.owner_id, pedro.id);
  await assert.rejects(saveRecord(pedro, "activities", { owner_id: douglas.id }, own.id, own.version), /gestão/);
  await assert.rejects(saveRecord(pedro, "activities", internal({ area: "Operação", participant_ids: [douglas.id] })), /gestão/);
  await assert.rejects(saveRecord(pedro, "activities", internal({ area: "Financeiro" })), /financeira/);
});
test("atividade recebida permite andamento mas preserva datas, cliente e distribuição", async () => {
  const received = await saveRecord(admin, "activities", internal({ owner_id: admin.id, participant_ids: [pedro.id], area: "Operação" }));
  await assert.rejects(saveRecord(douglas, "activities", { status: "Em andamento" }, received.id, received.version), /atribuídas/);
  await assert.rejects(saveRecord(pedro, "activities", { due_date: "2026-11-10" }, received.id, received.version), /apenas situação/);
  assert.equal((await saveRecord(pedro, "activities", { status: "Em andamento" }, received.id, received.version)).status, "Em andamento");
});
test("ausências mostram categoria e disponibilidade, sem título pessoal nem notas", async () => {
  const record = await saveRecord(admin, "activities", internal({ name: "Consulta particular", owner_id: pedro.id, category: "Médico", area: "Operação", start_date: "2026-11-02", end_date: "2026-11-02", all_day: "Sim", notes: "Informação pessoal" }));
  const availability = safeActivity(record, douglas);
  assert.equal(availability.name, "Médico"); assert.equal(availability.notes, undefined); assert.equal(availability.unit_id, undefined);
  assert.equal(safeActivity(record, pedro).notes, "Informação pessoal");
  assert.ok((await notificationsFor(josi)).some((item) => item.activity_id === record.id));
  assert.ok(blocksAvailability(record)); assert.ok(!blocksAvailability({ ...record, category: "Locação de veículos" }));
});
test("servidor restringe financeiro, serviços e arquivos de campo por atribuição", async () => {
  const assigned = await saveRecord(admin, "services", { name: "Campo QA", owner_id: pedro.id, unit_id: "unit-001", scope: "Medição", external_reference: "Histórico", status: "Preparação" });
  const state = await stateFor(pedro);
  assert.equal(state.data.invoices.length, 0); assert.equal(state.data.opportunities.length, 0); assert.equal(state.data.admin_documents.length, 0);
  assert.ok(state.data.services.some((item) => item.id === assigned.id)); assert.equal(state.data.services.find((item) => item.id === assigned.id).external_reference, undefined);
  assert.equal((await stateFor(douglas)).data.services.length, 0);
  await assert.rejects(saveRecord(douglas, "services", { notes: "Não autorizado" }, assigned.id, assigned.version), /atribuídos/);
  await assert.rejects(saveRecord(pedro, "services", { owner_id: douglas.id }, assigned.id, assigned.version), /gestão/);
  await assert.rejects(saveRecord(pedro, "activities", internal({ area: "Operação", service_id: "inexistente" })), /não encontrado/);
});
test("hierarquia aceita outra unidade da mesma empresa e rejeita ciclo e outra empresa", async () => {
  const unit = await get("units", "unit-001");
  await insert("units", { name: "Outra unidade QA", company_id: unit.company_id }, "hierarchy-unit");
  const manager = await saveRecord(admin, "contacts", { name: "Gerente", unit_id: "hierarchy-unit", department: "Suprimentos" });
  const buyer = await saveRecord(admin, "contacts", { name: "Comprador", unit_id: unit.id, superior_id: manager.id });
  assert.equal(buyer.superior_id, manager.id);
  await assert.rejects(saveRecord(admin, "contacts", { superior_id: buyer.id }, manager.id, manager.version), /ciclos/);
  await assert.rejects(saveRecord(admin, "contacts", { superior_id: buyer.id }, buyer.id, buyer.version), /ciclos/);
  const other = (await list("units")).find((item) => item.company_id !== unit.company_id);
  await assert.rejects(saveRecord(admin, "contacts", { name: "Outra empresa", unit_id: other.id, superior_id: manager.id }), /mesma empresa/);
});
test("SIG aceita http/https e rejeita execução de código", async () => {
  const unit = await get("units", "unit-001");
  await assert.rejects(saveRecord(admin, "units", { sig_url: "javascript:alert(1)" }, unit.id, unit.version), /http/);
  assert.equal((await saveRecord(admin, "units", { sig_url: "https://example.invalid/sig" }, unit.id, unit.version)).sig_url, "https://example.invalid/sig");
});
test("lembretes são duráveis, reprogramados por versão e não reenviam duplicados", async () => {
  const record = await saveRecord(admin, "activities", internal({ category: "Reunião", start_date: "2030-11-02", end_date: "2030-11-02", all_day: "Sim", participant_ids: [pedro.id], reminder_minutes: [1440, 60] }));
  const reminders = await query("SELECT * FROM notifications WHERE activity_id=$1 AND kind='Lembrete'", [record.id]);
  assert.equal(reminders.length, 4); assert.ok(reminders.some((item) => item.due_at === "2030-11-01T12:00:00.000Z"));
  const changed = await saveRecord(admin, "activities", { start_date: "2030-11-03", end_date: "2030-11-03" }, record.id, record.version);
  assert.ok((await query("SELECT email_status FROM notifications WHERE id=$1", [reminders[0].id]))[0].email_status === "Invalidado");
  await saveRecord(admin, "activities", { status: "Cancelada" }, changed.id, changed.version);
  assert.equal((await query("SELECT id FROM notifications WHERE activity_id=$1 AND kind='Lembrete' AND email_status='Pendente'", [record.id])).length, 0);
  assert.equal(await deliverNotification(reminders[0].id), "encerrado");
});
test("e-mail exige ativação, confere destinatário e mantém estado de entrega", async () => {
  const record = await saveRecord(admin, "activities", internal());
  const notice = (await query("SELECT * FROM notifications WHERE activity_id=$1", [record.id]))[0];
  let calls = 0;
  const transport = () => ({ sendMail: async (message) => { calls++; assert.equal(message.to, admin.id + "@example.invalid"); return { messageId: "fake" }; } });
  assert.equal(await deliverNotification(notice.id, transport), "configuração"); assert.equal(calls, 0);
  process.env.SMTP_HOST = "example.invalid"; process.env.SMTP_FROM = "qa@example.invalid"; process.env.APP_URL = "https://example.invalid";
  await query("INSERT INTO settings(id,data) VALUES('notification-email',$1)", [JSON.stringify({ enabled: true })]);
  assert.equal(await deliverNotification(notice.id, transport), "enviado");
  assert.equal(await deliverNotification(notice.id, transport), "encerrado"); assert.equal(calls, 1);
});
test("falhas confirmadas permitem nova tentativa e falhas incertas não reenviam", async () => {
  const record = await saveRecord(admin, "activities", internal());
  const notice = (await query("SELECT * FROM notifications WHERE activity_id=$1", [record.id]))[0];
  assert.equal(await deliverNotification(notice.id, () => ({ sendMail: async () => { throw Object.assign(new Error("Falha QA"), { responseCode: 451 }); } })), "tentar novamente");
  assert.equal((await query("SELECT email_status FROM notifications WHERE id=$1", [notice.id]))[0].email_status, "Falha");
  assert.equal(await deliverNotification(notice.id, () => ({ sendMail: async () => { throw new Error("Resposta perdida QA"); } })), "revisão");
  assert.equal((await query("SELECT email_status FROM notifications WHERE id=$1", [notice.id]))[0].email_status, "Revisar envio");
  assert.equal(await deliverNotification(notice.id, () => { throw new Error("Não deveria reenviar"); }), "encerrado");
});
test("alteração e cancelamento invalidam também os avisos imediatos ainda não enviados", async () => {
  const record = await saveRecord(admin, "activities", internal({ start_date: "2030-10-20", all_day: "Sim" }));
  const initial = (await query("SELECT id FROM notifications WHERE activity_id=$1 AND kind='Inclusão'", [record.id]))[0];
  const changed = await saveRecord(admin, "activities", { start_date: "2030-10-21", end_date: "2030-10-21" }, record.id, record.version);
  assert.equal((await query("SELECT email_status FROM notifications WHERE id=$1", [initial.id]))[0].email_status, "Invalidado");
  await saveRecord(admin, "activities", { status: "Cancelada" }, changed.id, changed.version);
  assert.equal((await query("SELECT kind FROM notifications WHERE activity_id=$1 AND email_status='Pendente'", [record.id]))[0].kind, "Cancelamento");
});
test("administrativo e aprovação têm gestão completa; campo não altera acessos", async () => {
  const { updateUserAccess } = await import("../lib/team.mjs");
  const fabio = { id: "agenda-fabio", name: "Fábio QA", role: "Aprovação comercial" };
  await query("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,'fabio@example.invalid','unused',$3)", [fabio.id, fabio.name, fabio.role]);
  for (const actor of [josi, fabio]) {
    assert.ok((await saveRecord(actor, "companies", { name: "Cadastro pela gestão " + actor.name })).id);
    assert.equal((await updateUserAccess(actor, { user_id: douglas.id, role: "Técnico" })).role, "Geo Processador");
  }
  await assert.rejects(updateUserAccess(pedro, { user_id: douglas.id, role: "Administrador" }), /Acesso reservado/);
});
test("materiais e metadados de arquivos são visíveis somente à operação atribuída", async () => {
  const material = await saveRecord(admin, "materials", { name: "Documento operacional QA", owner_id: pedro.id, revision: "1", access: "Equipe", status: "Rascunho" });
  await query("INSERT INTO files(id,material_id,filename,content_type,storage_key,size_bytes,created_at) VALUES('agenda-file',$1,'qa.pdf','application/pdf','qa-local-only',10,$2)", [material.id, new Date().toISOString()]);
  const own = await stateFor(pedro), other = await stateFor(douglas);
  assert.ok(own.data.materials.some((item) => item.id === material.id)); assert.ok(own.files.some((item) => item.id === "agenda-file"));
  assert.ok(!other.data.materials.some((item) => item.id === material.id)); assert.ok(!other.files.some((item) => item.id === "agenda-file"));
});
