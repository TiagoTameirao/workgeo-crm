import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
process.env.DATABASE_URL = "";
process.env.NODE_ENV = "test";
const dir = mkdtempSync(path.join(tmpdir(), "workgeo-crm-test-"));
process.env.CRM_SQLITE_PATH = path.join(dir, "test.sqlite");
const { migrate, query, insert, list, get, close } =
  await import("../lib/db.mjs");
const { seedDatabase, seed } = await import("../lib/seed.mjs");
const { saveRecord, allocate, moneyToCents, stateFor, changeAdministrativeCatalog, prepareOperation } =
  await import("../lib/domain.mjs");
const { pointInTerritory } = await import("../lib/geo.mjs");
const { recordMessage, inbound, metaEvent, downloadWhatsappMedia, retryWhatsappAttachment, verifyMetaSignature } =
  await import("../lib/messaging.mjs");
const admin = { id: randomUUID(), name: "Teste", role: "Administrador" };
before(async () => {
  await migrate();
  await seedDatabase();
  await query(
    "INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)",
    [admin.id, "Teste", "teste@example.invalid", "não usado", "Administrador"],
  );
  await changeAdministrativeCatalog(admin, { action: "add-client", unit_id: "unit-001" });
});
after(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});
test("importação preserva 27 unidades, 22 contatos e é idempotente", async () => {
  assert.equal((await list("units")).length, 27);
  assert.equal((await list("contacts")).length, 22);
  await seedDatabase();
  assert.equal((await list("units")).length, 27);
  assert.equal(seed.territory.geometry.coordinates[0].length, 73);
  assert.deepEqual(
    seed.territory.geometry.coordinates[0][0],
    seed.territory.geometry.coordinates[0].at(-1),
  );
});
test('cadastro simplificado cria empresa, unidade e contato em uma transação',async()=>{const {createClient}=await import('../lib/clients.mjs');const client=await createClient(admin,{company_name:'Empresa QA',segment:'Pedreira',contact_name:'Interlocutor QA',email:'qa-client@example.invalid'});assert.equal(client.name,'Empresa QA');assert.equal((await get('companies',client.company_id)).name,'Empresa QA');assert.ok((await list('contacts')).some(c=>c.unit_id===client.id&&c.email==='qa-client@example.invalid'));const unit2=await createClient(admin,{company_mode:'existing',company_id:client.company_id,name:'Unidade 2'});assert.equal(unit2.company_id,client.company_id);const count=(await list('companies')).length;await assert.rejects(createClient(admin,{company_name:'Inválida QA',email:'invalid'}),/E-mail/);assert.equal((await list('companies')).length,count);});
test("geografia: interior, exterior, borda e ausência", () => {
  const ring = [
    [0, 0],
    [0, 2],
    [2, 2],
    [2, 0],
    [0, 0],
  ];
  assert.equal(pointInTerritory(1, 1, ring), "Dentro");
  assert.equal(pointInTerritory(0, 1, ring), "Dentro");
  assert.equal(pointInTerritory(3, 1, ring), "Fora");
  assert.equal(pointInTerritory(null, 1, ring), "Localização pendente");
  assert.throws(() => pointInTerritory(181, 1, ring));
});

test("manual coordinates survive creation and editing in the same state used by the map", async () => {
  const { createClient } = await import("../lib/clients.mjs");
  const unit = await createClient(admin, {company_name:"Coordenadas manuais QA",latitude:-19.912345,longitude:-43.987654});
  let state = await stateFor(admin);
  let saved = state.data.units.find(item => item.id === unit.id);
  assert.equal(saved.latitude, -19.912345);
  assert.equal(saved.longitude, -43.987654);
  await saveRecord(admin,"units",{latitude:-22.9,longitude:-43.1},unit.id,saved.version);
  state = await stateFor(admin);
  saved = state.data.units.find(item => item.id === unit.id);
  assert.equal(saved.latitude, -22.9);
  assert.equal(saved.longitude, -43.1);
  await assert.rejects(saveRecord(admin,"units",{latitude:91,longitude:0},unit.id,saved.version),/Coordenadas inválidas/);
  assert.equal((await get("units",unit.id)).latitude,-22.9);
});
test("precisão monetária e entradas inválidas", () => {
  assert.equal(moneyToCents("10.01"), 1001);
  assert.throws(() => moneyToCents("1.001"));
  assert.throws(() => moneyToCents("-1"));
  assert.throws(() => moneyToCents("0"));
});
test("perfis não autorizados e concorrência de edição", async () => {
  await assert.rejects(
    saveRecord(
      { ...admin, role: "Campo" },
      "units",
      { name: "X" },
      "unit-001",
      1,
    ),
    /perfil/,
  );
  const u = await get("units", "unit-001");
  await saveRecord(admin, "units", { notes: "Conferir" }, u.id, u.version);
  await assert.rejects(
    saveRecord(admin, "units", { notes: "Outra" }, u.id, u.version),
    /alterado/,
  );
});
test("qualificação exige responsável e retorno; contato de outra unidade é rejeitado", async () => {
  await assert.rejects(
    saveRecord(admin, "units", { status: "Abordagem" }, "unit-002", 1),
    /responsável/,
  );
  await assert.rejects(
    saveRecord(admin, "opportunities", {
      unit_id: "unit-001",
      contact_id: "contact-phone-003",
      name: "Demanda",
      owner: "Tiago",
      next_action: "Retornar",
      next_date: "2026-10-20",
      status: "Diagnóstico",
    }),
    /outra unidade/,
  );
});
test("fluxo integral: demanda, material, proposta, contrato, serviço e pagamento", async () => {
  const contact = await saveRecord(admin, "contacts", {
    unit_id: "unit-001",
    name: "Contato de teste",
    email: "cliente@example.invalid",
  });
  let opp = await saveRecord(admin, "opportunities", {
    unit_id: "unit-001",
    contact_id: contact.id,
    name: "Inventário de teste",
    owner: "Tiago",
    status: "Diagnóstico",
    next_action: "Diagnosticar",
    next_date: "2026-10-20",
    scope: "Volumetria de uma pilha",
  });
  await assert.rejects(
    saveRecord(
      admin,
      "opportunities",
      { status: "Ganha", acceptance: "Aceite documentado" },
      opp.id,
      opp.version,
    ),
    /validação/,
  );
  const material = await saveRecord(admin, "materials", {
    name: "Portfólio de teste",
    revision: "1",
    status: "Aprovado",
    approval: "Aprovado pelo responsável",
    url: "https://example.invalid/portfolio.pdf",
    access: "Equipe",
  });
  const request = await saveRecord(admin, "requests", {
    unit_id: "unit-001",
    name: "Pedido de portfólio",
    owner: "Tiago",
    due_date: "2026-10-20",
    status: "Recebida",
  });
  await assert.rejects(
    saveRecord(
      admin,
      "requests",
      { status: "Enviada" },
      request.id,
      request.version,
    ),
    /material aprovado/,
  );
  const sent = await saveRecord(
    admin,
    "requests",
    {
      status: "Enviada",
      material_id: material.id,
      sent_date: "2026-10-20",
      sent_evidence: "Envio manual registrado",
      channel: "E-mail",
    },
    request.id,
    request.version,
  );
  assert.equal(sent.sent_material.revision, "1");
  await assert.rejects(
    saveRecord(
      admin,
      "materials",
      { revision: "2" },
      material.id,
      material.version,
    ),
    /outra versão/,
  );
  const proposal = await saveRecord(admin, "proposals", {
    opportunity_id: opp.id,
    name: "Proposta 1",
    revision: 1,
    amount: "1000.00",
    scope: "Volumetria",
    status: "Enviada",
    url: "https://example.invalid/proposta.pdf",
    approval: "Aprovação comercial documentada",
    sent_date: "2026-10-20",
  });
  await assert.rejects(
    saveRecord(
      admin,
      "proposals",
      { amount: 900 },
      proposal.id,
      proposal.version,
    ),
    /nova versão/,
  );
  opp = await saveRecord(
    admin,
    "opportunities",
    {
      status: "Ganha",
      technical_validation: "Viabilidade conferida",
      acceptance: "Contrato aceito",
    },
    opp.id,
    opp.version,
  );
  const contract = (await list("contracts")).find(
    (c) => c.opportunity_id === opp.id,
  );
  assert.ok(contract);
  assert.equal((await list('services')).filter(item=>item.contract_id===contract.id).length,0);
  await assert.rejects(prepareOperation({...admin,role:'Piloto de Drone'},opp.id,opp.version),/gestão/);
  const prepared=await prepareOperation(admin,opp.id,opp.version);
  assert.equal(prepared.created,true);
  let service = prepared.service;
  assert.equal((await prepareOperation(admin,opp.id,opp.version)).service.id,service.id);
  assert.ok(service);
  await assert.rejects(
    saveRecord(
      admin,
      "services",
      { status: "Entrega" },
      service.id,
      service.version,
    ),
    /conferência/,
  );
  service = await saveRecord(
    admin,
    "services",
    {
      status: "Entrega",
      quality: "Conferência concluída",
      delivery_url: "https://example.invalid/entrega",
      delivered_date: "2026-10-21",
    },
    service.id,
    service.version,
  );
  const invoice = await saveRecord(admin, "invoices", {
    unit_id: "unit-001",
    service_id: service.id,
    name: "NF teste",
    amount: 1000,
    status: "Nota emitida",
    authorization: "Pedido 123",
    invoice_number: "123",
    invoice_url: "https://example.invalid/nota",
    due_date: "2026-11-01",
  });
  const invoice2 = await saveRecord(admin, "invoices", {
    unit_id: "unit-001",
    service_id: service.id,
    name: "NF teste 2",
    amount: 500,
    status: "Nota emitida",
    authorization: "Pedido 124",
    invoice_number: "124",
    invoice_url: "https://example.invalid/nota2",
    due_date: "2026-11-01",
  });
  const receipt = await saveRecord(admin, "receipts", {
    name: "Pagamento agrupado",
    amount: 1200,
    received_date: "2026-11-01",
    evidence: "Comprovante recebido",
  });
  await allocate(admin, receipt.id, invoice.id, 800);
  await allocate(admin, receipt.id, invoice2.id, 400);
  await assert.rejects(allocate(admin, receipt.id, invoice.id, 1), /saldo/);
  await assert.rejects(
    saveRecord(admin, "invoices", { amount: 700 }, invoice.id, invoice.version),
    /conciliado/,
  );
  assert.equal(
    (await query("SELECT SUM(amount_cents) AS total FROM allocations"))[0]
      .total,
    120000,
  );
  const renewal = await saveRecord(admin, "renewals", {
    unit_id: "unit-001",
    contract_id: contract.id,
    name: "Próxima campanha",
    due_date: "2026-12-01",
    owner: "Tiago",
    status: "Pendente",
  });
  assert.ok(renewal.id);
});
test("mensagens manuais não enviam e eventos recebidos não duplicam", async () => {
  const c = (await list("contacts")).find(
    (c) => c.email === "cliente@example.invalid",
  );
  const conv = await saveRecord(admin, "conversations", {
    unit_id: c.unit_id,
    contact_id: c.id,
    name: "Atendimento teste",
    next_action: "Responder ao cliente",
    channel: "E-mail",
    owner: "Tiago",
    status: "Aguardando equipe",
  });
  const manual = await recordMessage(admin, {
    conversation_id: conv.id,
    body: "Registro",
    mode: "manual",
  });
  assert.match(manual.status, /não verificado/);
  assert.ok(
    await inbound({
      channel: "E-mail",
      sender: c.email,
      providerId: "event-1",
      body: "Pedido",
    }),
  );
  assert.equal(
    await inbound({
      channel: "E-mail",
      sender: c.email,
      providerId: "event-1",
      body: "Pedido",
    }),
    false,
  );
  assert.equal(
    (await list("messages")).filter((m) => m.provider_id === "event-1").length,
    1,
  );
  assert.equal(verifyMetaSignature("raw", "bad", "secret"), false);
});
test("falha do provedor não é reportada como envio bem-sucedido nem expõe detalhes", async () => {
  const contact = (await list("contacts")).find((item) => item.email === "cliente@example.invalid");
  contact.phone = "5531999999999";
  await query("UPDATE contacts SET data=$1 WHERE id=$2", [JSON.stringify(contact), contact.id]);
  await inbound({ channel: "WhatsApp", providerId: "qa-inbound-for-send-failure", sender: contact.phone, body: "Olá" });
  const conversation = (await list("conversations")).find((item) => item.contact_id === contact.id && item.channel === "WhatsApp");
  const names = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_ID", "WHATSAPP_API_VERSION"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  try {
    process.env.WHATSAPP_TOKEN = "qa-token";
    process.env.WHATSAPP_PHONE_ID = "123456789012345";
    process.env.WHATSAPP_API_VERSION = "v25.0";
    globalThis.fetch = async () => { throw new Error("private provider detail"); };
    const result = await recordMessage(admin, { conversation_id: conversation.id, body: "Mensagem de teste", mode: "send", confirmed: true });
    assert.match(result.status, /^Falha no envio/);
    assert.doesNotMatch(result.status, /private provider detail|qa-token/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) previous[name] === undefined ? delete process.env[name] : process.env[name] = previous[name];
  }
});
test("WhatsApp arquiva mídia recebida, autentica o download e evita baixar evento repetido", async () => {
  const previous = {
    token: process.env.WHATSAPP_TOKEN,
    version: process.env.WHATSAPP_API_VERSION,
    phone: process.env.WHATSAPP_PHONE_ID,
  };
  process.env.WHATSAPP_TOKEN = "test-token";
  process.env.WHATSAPP_API_VERSION = "v25.0";
  process.env.WHATSAPP_PHONE_ID = "phone-123";
  const bytes = Buffer.from("pdf de teste");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const payload = { entry: [{ changes: [{ value: {
    metadata: { phone_number_id: "phone-123" },
    messages: [{ id: "wamid-media-1", from: "550000000000000", type: "document", timestamp: "1781395200", document: { id: "media-1", filename: "relatorio.pdf", mime_type: "application/pdf", caption: "Relatório" } }],
  } }] }] };
  let fetches = 0, stored = null;
  const fetchImpl = async (input, options) => {
    fetches += 1;
    const url = new URL(input);
    assert.equal(options.headers.Authorization, "Bearer test-token");
    if (url.hostname === "graph.facebook.com") {
      assert.equal(url.pathname, "/v25.0/media-1");
      assert.equal(url.searchParams.get("phone_number_id"), "phone-123");
      return Response.json({ url: "https://lookaside.fbsbx.com/media/file", mime_type: "application/pdf", file_size: bytes.length, sha256 });
    }
    assert.equal(url.hostname, "lookaside.fbsbx.com");
    return new Response(bytes, { headers: { "content-type": "application/pdf", "content-length": String(bytes.length) } });
  };
  try {
    await metaEvent(payload, { fetchImpl, storeFile: async (key, content, type) => { stored = { key, content: Buffer.from(content), type }; } });
    assert.equal(fetches, 2);
    assert.deepEqual(stored.content, bytes);
    assert.equal(stored.type, "application/pdf");
    const event = JSON.parse((await query("SELECT data FROM inbox_events WHERE id=$1", ["wamid-media-1"]))[0].data);
    assert.equal(event.body, "Relatório");
    assert.equal(event.attachments[0].filename, "relatorio.pdf");
    assert.equal(event.attachments[0].download_status, "Arquivada");
    assert.equal(event.attachments[0].storage_key, stored.key);
    assert.match(stored.key, /^whatsapp-attachment-/);
    const state = await stateFor(admin);
    assert.equal(state.unassigned.find((item) => item.id === "wamid-media-1").attachments[0].download_url, "/api/messages/wamid-media-1/attachments/0");
    await metaEvent(payload, { fetchImpl, storeFile: async () => assert.fail("evento repetido não deve salvar arquivo novamente") });
    assert.equal(fetches, 2);
    await inbound({ channel: "WhatsApp", providerId: "wamid-media-1", sender: "550000000000000", body: "reentrega", attachments: [{ type: "document", download_status: "Falha" }] });
    const preserved = JSON.parse((await query("SELECT data FROM inbox_events WHERE id=$1", ["wamid-media-1"]))[0].data);
    assert.equal(preserved.attachments[0].storage_key, stored.key);
    assert.equal((await query("SELECT id FROM inbox_events WHERE id=$1", ["wamid-media-1"])).length, 1);
  } finally {
    if (previous.token === undefined) delete process.env.WHATSAPP_TOKEN; else process.env.WHATSAPP_TOKEN = previous.token;
    if (previous.version === undefined) delete process.env.WHATSAPP_API_VERSION; else process.env.WHATSAPP_API_VERSION = previous.version;
    if (previous.phone === undefined) delete process.env.WHATSAPP_PHONE_ID; else process.env.WHATSAPP_PHONE_ID = previous.phone;
  }
});
test("WhatsApp rejeita URL de mídia fora da Meta e hash divergente sem armazenar", async () => {
  const previous = { token: process.env.WHATSAPP_TOKEN, version: process.env.WHATSAPP_API_VERSION, phone: process.env.WHATSAPP_PHONE_ID };
  process.env.WHATSAPP_TOKEN = "test-token";
  process.env.WHATSAPP_API_VERSION = "v25.0";
  process.env.WHATSAPP_PHONE_ID = "phone-123";
  try {
    let fetches = 0;
    await assert.rejects(downloadWhatsappMedia({ id: "media-url" }, "wamid-1", {
      fetchImpl: async () => { fetches += 1; return Response.json({ url: "https://attacker.example/file", file_size: 4 }); },
      storeFile: async () => assert.fail("URL externa não pode produzir arquivo armazenado"),
    }), /media_url_invalid/);
    assert.equal(fetches, 1);
    await assert.rejects(downloadWhatsappMedia({ id: "media-hash", type: "image" }, "wamid-2", {
      fetchImpl: async (input) => new URL(input).hostname === "graph.facebook.com"
        ? Response.json({ url: "https://lookaside.fbsbx.com/media/file", file_size: 4, sha256: "0".repeat(64) })
        : new Response(Buffer.from("real"), { headers: { "content-length": "4" } }),
      storeFile: async () => assert.fail("hash divergente não pode ser armazenado"),
    }), /media_checksum_mismatch/);
  } finally {
    if (previous.token === undefined) delete process.env.WHATSAPP_TOKEN; else process.env.WHATSAPP_TOKEN = previous.token;
    if (previous.version === undefined) delete process.env.WHATSAPP_API_VERSION; else process.env.WHATSAPP_API_VERSION = previous.version;
    if (previous.phone === undefined) delete process.env.WHATSAPP_PHONE_ID; else process.env.WHATSAPP_PHONE_ID = previous.phone;
  }
});
test("WhatsApp preserva referência e aviso quando mídia excede o limite de armazenamento", async () => {
  const previous = { token: process.env.WHATSAPP_TOKEN, version: process.env.WHATSAPP_API_VERSION, phone: process.env.WHATSAPP_PHONE_ID };
  process.env.WHATSAPP_TOKEN = "test-token";
  process.env.WHATSAPP_API_VERSION = "v25.0";
  process.env.WHATSAPP_PHONE_ID = "phone-123";
  let fetches = 0;
  const payload = { entry: [{ changes: [{ value: { metadata: { phone_number_id: "phone-123" }, messages: [{ id: "wamid-media-large", from: "5500000000001", type: "image", image: { id: "media-large", mime_type: "image/jpeg" } }] } }] }] };
  try {
    await metaEvent(payload, {
      fetchImpl: async () => { fetches += 1; return Response.json({ url: "https://lookaside.fbsbx.com/media/large", mime_type: "image/jpeg", file_size: 21 * 1024 * 1024 }); },
      storeFile: async () => assert.fail("mídia acima do limite não deve ser armazenada"),
    });
    assert.equal(fetches, 1);
    const event = JSON.parse((await query("SELECT data FROM inbox_events WHERE id=$1", ["wamid-media-large"]))[0].data);
    assert.equal(event.attachments[0].download_status, "Falha");
    assert.match(event.attachments[0].download_error, /solicite o reenvio/);
    assert.equal(event.attachments[0].provider_media_id, "media-large");
  } finally {
    if (previous.token === undefined) delete process.env.WHATSAPP_TOKEN; else process.env.WHATSAPP_TOKEN = previous.token;
    if (previous.version === undefined) delete process.env.WHATSAPP_API_VERSION; else process.env.WHATSAPP_API_VERSION = previous.version;
    if (previous.phone === undefined) delete process.env.WHATSAPP_PHONE_ID; else process.env.WHATSAPP_PHONE_ID = previous.phone;
  }
});
test("atendente pode recuperar mídia arquivada com falha depois de configurar o canal", async () => {
  const previous = { token: process.env.WHATSAPP_TOKEN, version: process.env.WHATSAPP_API_VERSION, phone: process.env.WHATSAPP_PHONE_ID };
  delete process.env.WHATSAPP_TOKEN;
  process.env.WHATSAPP_API_VERSION = "v25.0";
  process.env.WHATSAPP_PHONE_ID = "phone-retry";
  const payload = { entry: [{ changes: [{ value: { metadata: { phone_number_id: "phone-retry" }, messages: [{ id: "wamid-retry", from: "5500000000002", type: "image", image: { id: "media-retry", mime_type: "image/jpeg" } }] } }] }] };
  try {
    await metaEvent(payload);
    const before = JSON.parse((await query("SELECT data FROM inbox_events WHERE id=$1", ["wamid-retry"]))[0].data);
    assert.equal(before.attachments[0].download_status, "Falha");
    const bytes = Buffer.from("imagem recuperada");
    let stored = false;
    process.env.WHATSAPP_TOKEN = "test-token";
    const result = await retryWhatsappAttachment(admin, "wamid-retry", 0, {
      fetchImpl: async (input) => new URL(input).hostname === "graph.facebook.com"
        ? Response.json({ url: "https://lookaside.fbsbx.com/media/retry", mime_type: "image/jpeg", file_size: bytes.length })
        : new Response(bytes, { headers: { "content-length": String(bytes.length) } }),
      storeFile: async () => { stored = true; },
    });
    assert.deepEqual(result, { download_status: "Arquivada" });
    assert.equal(stored, true);
    const after = JSON.parse((await query("SELECT data FROM inbox_events WHERE id=$1", ["wamid-retry"]))[0].data);
    assert.equal(after.attachments[0].download_status, "Arquivada");
    assert.ok(after.attachments[0].storage_key);
  } finally {
    if (previous.token === undefined) delete process.env.WHATSAPP_TOKEN; else process.env.WHATSAPP_TOKEN = previous.token;
    if (previous.version === undefined) delete process.env.WHATSAPP_API_VERSION; else process.env.WHATSAPP_API_VERSION = previous.version;
    if (previous.phone === undefined) delete process.env.WHATSAPP_PHONE_ID; else process.env.WHATSAPP_PHONE_ID = previous.phone;
  }
});
test("material restrito e financeiro não vazam para perfil de campo", async () => {
  const m = await saveRecord(admin, "materials", {
    name: "Documento administrativo",
    revision: "1",
    status: "Restrito",
    access: "Administrativo",
    url: "https://example.invalid/restrito",
  });
  const state = await stateFor({ ...admin, role: "Campo" });
  assert.equal(state.data.invoices.length, 0);
  assert.equal(state.data.receipts.length, 0);
  assert.ok(!state.data.materials.some((r) => r.id === m.id));
  assert.equal(state.data.messages.length, 0);
});
