import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.DATABASE_URL = ""; process.env.NODE_ENV = "test";
process.env.BLOB_READ_WRITE_TOKEN = ""; process.env.BLOB_STORE_ID = ""; process.env.S3_BUCKET = "";
const dir = mkdtempSync(path.join(tmpdir(), "workgeo-flights-")); process.env.CRM_SQLITE_PATH = path.join(dir, "test.sqlite");
const { migrate, query, get, close } = await import("../lib/db.mjs");
const { seedDatabase } = await import("../lib/seed.mjs");
const { saveRecord, stateFor } = await import("../lib/domain.mjs");
const { saveFlight, flightsFor } = await import("../lib/flights.mjs");
const { flightLabel } = await import("../lib/flight-model.mjs");
const { attachFlightFile, inspectFlightFile } = await import("../lib/flight-files.mjs");
const { createUser } = await import("../lib/user-registration.mjs");
const users = [
  { id: "flight-admin", name: "Gestão QA", role: "Administrador" },
  { id: "flight-office", name: "Administração QA", role: "Administração" },
  { id: "flight-pilot", name: "Piloto QA", role: "Piloto de Drone" },
  { id: "flight-geo", name: "Geo QA", role: "Geo Processador" },
  { id: "flight-sales", name: "Comercial QA", role: "Comercial" },
];
const [admin, office, pilot, geo, sales] = users, uploaded = [];
const pdf = Buffer.from("%PDF-1.4\nDocumento QA para verificar integridade de transporte\n%%EOF");
before(async () => { await migrate(); await seedDatabase(); for (const user of users) await query("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,'unused',$4)", [user.id, user.name, user.id + "@example.invalid", user.role]); });
after(async () => { await close(); for (const id of uploaded) rmSync(path.join(process.cwd(), "runtime", "files", id), { force: true }); rmSync(dir, { recursive: true, force: true }); });
const draft = (extra = {}) => ({ name: "Voo QA", owner_id: pilot.id, ...extra });
const complete = { operator_name: "WorkGeo QA", pilot_name: "Piloto QA", aircraft_model: "Modelo QA", aircraft_registration: "Cadastro QA", location: "Local QA", latitude: -19.9, longitude: -43.9, height_m: 100, start_date: "2026-10-30", end_date: "2026-10-30", start_time: "09:00", end_time: "10:00", protocol: "PROTOCOLO-QA", document_timezone: "UTC", valid_from: "2026-10-30T12:00", valid_to: "2026-10-30T14:00" };

test("piloto registra para si e conserva o responsável ao editar; atribuição a outra pessoa exige gestão", async () => {
  await assert.rejects(saveFlight(pilot, draft({ owner_id: admin.id })), (error) => error.status === 403);
  const flight = await saveFlight(admin, draft({ owner_id: admin.id }));
  const updated = await saveFlight(pilot, { notes: "Complemento de campo" }, flight.id, flight.version);
  assert.equal(updated.owner_id, admin.id);
  await assert.rejects(saveFlight(pilot, { owner_id: pilot.id }, updated.id, updated.version), (error) => error.status === 403);
});

test("funções internas canônicas acessam todas as unidades, sem exposição financeira", async () => {
  for (const user of [pilot, geo]) {
    const state = await stateFor(user); assert.equal(state.data.units.length, 27); assert.equal(state.data.contacts.length, 22); assert.equal(state.data.invoices.length, 0); assert.equal(state.data.opportunities.length, 0);
    const unit = await get("units", "unit-001"); const edited = await saveRecord(user, "units", { city: "Local conferido QA" }, unit.id, unit.version); assert.equal(edited.city, "Local conferido QA");
    await assert.rejects(saveRecord(user, "units", { owner_id: user.id }, edited.id, edited.version), /reservado/);
  }
});
test("cadastro rejeita perfis de clientes e e-mails duplicados; mantém papel canônico", async () => {
  for (const role of ["Cliente", "Sócio", "ADM"]) await assert.rejects(createUser({ name: "Pessoa QA", email: "role@example.invalid", role, password: "QA_Senha_20261026!" }), /perfil válidos/);
  const user = await createUser({ name: "Pessoa QA", email: "new-flight@example.invalid", role: "Campo", password: "QA_Senha_20261026!" }); assert.equal(user.role, "Piloto de Drone"); assert.equal(user.password_hash, undefined);
  await assert.rejects(createUser({ name: "Outra QA", email: "new-flight@example.invalid", role: "Piloto de Drone", password: "QA_Senha_20261026!" }), /já possui/);
});
test("piloto e administração cadastram voos; geo consulta; comercial não acessa", async () => {
  const record = await saveFlight(pilot, draft()); assert.equal(record.status, "Em preparação");
  assert.ok((await flightsFor(geo)).flights.some((item) => item.id === record.id));
  await assert.rejects(saveFlight(geo, draft()), /Somente/); await assert.rejects(flightsFor(sales), /não acessa/);
  assert.ok((await saveFlight(office, draft())).id);
});
test("datas, coordenadas, referências cruzadas e conteúdo de arquivo são validados", async () => {
  await assert.rejects(saveFlight(pilot, draft({ latitude: -19.9 })), /juntas/);
  await assert.rejects(saveFlight(pilot, draft({ latitude: -91, longitude: 0 })), /latitude/);
  await assert.rejects(saveFlight(pilot, draft({ start_date: "2026-02-30", end_date: "2026-03-02", start_time: "09:00", end_time: "10:00" })), /período/);
  await assert.rejects(saveFlight(pilot, draft({ service_id: "fake", unit_id: "unit-001" })), /serviço/);
  assert.throws(() => inspectFlightFile("fake.pdf", Buffer.from("<html>não é PDF</html>")), /conteúdo/);
  assert.throws(() => inspectFlightFile("x.pdf", Buffer.alloc(30000001)), /30 MB/);
});
test("upload preserva PDF, não muda situação e não concede parecer automaticamente", async () => {
  const record = await saveFlight(pilot, draft());
  const file = await attachFlightFile(pilot, record.id, "Autorização SARPAS", "Autorização de voo.pdf", pdf); uploaded.push(file.id);
  assert.equal(file.content_type, "application/pdf"); assert.match(file.sha256, /^[a-f0-9]{64}$/);
  assert.equal((await flightsFor(pilot)).flights.find((item) => item.id === record.id).status, "Em preparação");
  await assert.rejects(attachFlightFile(geo, record.id, "Autorização SARPAS", "x.pdf", pdf), /não pode enviar/);
});
test("parecer exige original, protocolo, período e conferência; converte UTC corretamente", async () => {
  let record = await saveFlight(pilot, draft(complete));
  await assert.rejects(saveFlight(pilot, { status: "Parecer favorável registrado", confirm_document: true }, record.id, record.version), /Anexe/);
  const file = await attachFlightFile(pilot, record.id, "Autorização SARPAS", "parecer.pdf", pdf); uploaded.push(file.id);
  await assert.rejects(saveFlight(pilot, { status: "Parecer favorável registrado", evidence_file_id: file.id }, record.id, record.version), /Confirme/);
  record = await saveFlight(pilot, { status: "Parecer favorável registrado", evidence_file_id: file.id, confirm_document: true }, record.id, record.version);
  assert.equal(record.planned_start, "2026-10-30T12:00:00.000Z"); assert.equal(record.authorization_start, "2026-10-30T12:00:00.000Z"); assert.equal(record.verified_by, pilot.id);
  assert.equal(flightLabel(record, "2026-10-31T00:00:00.000Z"), "Validade encerrada");
  await assert.rejects(saveFlight(pilot, { start_time: "08:00", confirm_document: true }, record.id, record.version), /fora da validade/);
  await assert.rejects(saveFlight(pilot, { pilot_name: "Outro piloto" }, record.id, record.version), /Confirme/);
});
test("arquivo de outro voo não comprova autorização e versões concorrentes são rejeitadas", async () => {
  const a = await saveFlight(pilot, draft(complete)), b = await saveFlight(pilot, draft(complete));
  const file = await attachFlightFile(pilot, a.id, "Autorização SARPAS", "parecer.pdf", pdf); uploaded.push(file.id);
  await assert.rejects(saveFlight(pilot, { status: "Parecer favorável registrado", evidence_file_id: file.id, confirm_document: true }, b.id, b.version), /Anexe/);
  await saveFlight(pilot, { notes: "Nota QA" }, b.id, b.version); await assert.rejects(saveFlight(pilot, { notes: "Concorrente" }, b.id, b.version), (error) => error.status === 409);
});
