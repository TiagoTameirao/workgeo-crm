import { isOperational } from "./access.mjs";
import { isManagement, isField, assignedTo, safeActivity, activityReadable } from "./agenda.mjs";
import { validateAgenda, validateContactHierarchy } from "./agenda-validation.mjs";
import { queueActivityNotifications } from "./notifications.mjs";
import { randomUUID } from "node:crypto";
import { models, entityKeys, canWrite } from "./model.mjs";
import {
  query,
  get,
  list,
  insert,
  update,
  transaction,
  isPostgres,
  isTurso,
} from "./db.mjs";
import { pointInTerritory } from "./geo.mjs";
import { hasCnpjFormat } from "./cnpj.mjs";
import { integrationStatus } from "./integration-status.mjs";
import { seed } from "./seed.mjs";
import { administrativeDocumentContext, nextDocumentData } from "./administrative-workflow.mjs";
import { administrativeCatalog, administrativeCatalogKey, emptyAdministrativeCatalog } from "./administrative-catalog.mjs";
import { validateChecklist, checklistComplete, checklistContext } from "./document-checklist.mjs";
export const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status });
};
export const financeRoles = [
  "Administrador",
  "Administração",
  "Administrativo",
  "Aprovação comercial",
];
export const messagingRoles = [
  "Administrador",
  "Comercial",
  "Administração",
  "Administrativo",
  "Aprovação comercial",
];
export function canRead(user, entity) {
  if (isManagement(user)) return true;
  if (isField(user) && !["activities", "services", "units", "companies", "contacts", "materials", "requests"].includes(entity)) return false;
  if (["invoices", "receipts", "admin_documents"].includes(entity))
    return financeRoles.includes(user.role);
  if (["conversations", "messages"].includes(entity))
    return messagingRoles.includes(user.role);
  return true;
}
export function materialAllowed(user, m) {
  if (!m) return false;
  if (isField(user) && !isOperational(user) && m.owner_id !== user.id) return false;
  if (isManagement(user)) return true;
  if (m.access === "Administrativo") return financeRoles.includes(user.role);
  if (m.access === "Responsável")
    return m.owner_id === user.id;
  if (m.access === "Comercial e técnico")
    return [
      "Administrador",
      "Comercial",
      "Aprovação comercial",
      "Técnico",
      "Geo Processador",
    ].includes(user.role);
  return true;
}
export function moneyToCents(value) {
  const s = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(s))
    fail("Informe um valor positivo com até duas casas decimais.");
  const [a, b = ""] = s.split(".");
  const n = Number(a) * 100 + Number(b.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n <= 0)
    fail("Valor fora do intervalo permitido.");
  return n;
}
export async function audit(user, entity, id, action, before, after) {
  await query(
    "INSERT INTO audit(id,user_id,entity,record_id,action,before_data,after_data,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      randomUUID(),
      user?.id || null,
      entity,
      id,
      action,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      new Date().toISOString(),
    ],
  );
}
export async function territory() {
  const saved = (await query("SELECT data FROM settings WHERE id=$1", ["territory"]))[0]?.data;
  const value = saved == null ? null : typeof saved === "string" ? JSON.parse(saved) : saved;
  return value || seed.territory;
}
export async function validate(entity, input, user, old) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("Dados de cadastro inválidos.");
  const model = models[entity];
  if (!model) fail("Cadastro desconhecido.");
  if (!canWrite(user.role, entity))
    fail("Seu perfil não pode alterar este cadastro.", 403);
  const data = { ...(old || {}) };
  delete data.id;
  delete data.version;
  delete data.created_at;
  delete data.updated_at;
  if (!old) {
    const statusField = model.fields.find((f) => f.key === "status");
    if (statusField) data.status = statusField.options[0];
    if (entity === "units") {
      data.size = "Desconhecido";
      data.size_evidence = "Desconhecido";
      data.priority = "Não definida";
    }
  }
  for (const field of model.fields) {
    if (input[field.key] === undefined) continue;
    const v = input[field.key];
    if (typeof v !== "string" && typeof v !== "number" && v !== null)
      fail("Formato inválido: " + field.label);
    if (String(v ?? "").length > 15000)
      fail("Texto muito longo: " + field.label);
    data[field.key] = v === "" ? null : v;
  }
  if (entity !== "activities" && model.fields.some((field) => field.key === "owner")) {
    const people = await query("SELECT id,name FROM users WHERE active=1");
    if (input.owner_id) {
      const person = people.find((person) => person.id === input.owner_id);
      if (!person) fail("Escolha uma conta ativa para o responsável.");
      data.owner = person.name;
    } else if (input.owner !== undefined && input.owner !== old?.owner) {
      const matches = people.filter((person) => person.name === input.owner);
      data.owner_id = matches.length === 1 ? matches[0].id : null;
    }
  }
  if (entity === "contacts") await validateContactHierarchy(data, old);
  if (entity === "activities") await validateAgenda(data, input, user, old);
  if (isOperational(user) && entity !== "activities") {
    const allowed = { units: ["name", "city", "address", "latitude", "longitude", "maps_url", "sig_url"], contacts: ["unit_id", "name", "role", "department", "superior_id", "email", "phone", "verified_at", "source", "notes"], services: ["status", "scheduled_date", "impediment", "quality", "delivery_url", "delivered_date", "notes", "local_access", "performed_date", "data_url", "processing_reference", "review_reference", "waiting_reason", "waiting_until"], requests: ["status", "notes"] }[entity];
    if (!allowed || !old && !["contacts"].includes(entity)) fail("A gestão cadastra empresas e distribui novos serviços.", 403);
    if (Object.keys(input).some((key) => model.fields.some((field) => field.key === key) && !allowed.includes(key) && JSON.stringify(input[key] ?? null) !== JSON.stringify(old?.[key] ?? null))) fail("Este campo é reservado à gestão.", 403);
  } else if (isField(user) && entity !== "activities") {
    if (!old || !["services", "requests"].includes(entity) || !(await recordAllowed(user, entity, old))) fail("Seu perfil só altera trabalhos operacionais atribuídos a você.", 403);
    const allowed = entity === "services" ? ["status", "impediment", "quality", "delivery_url", "delivered_date", "notes"] : ["status", "notes"];
    if (Object.keys(input).some((key) => !allowed.includes(key) && JSON.stringify(input[key] ?? null) !== JSON.stringify(old[key] ?? null))) fail("A gestão define cliente, escopo e responsáveis do trabalho.", 403);
  }
  if (entity === "companies" && data.cnpj && !hasCnpjFormat(data.cnpj))
    fail("CNPJ deve ter 14 posições: 12 letras/números e 2 dígitos finais.");
  for (const field of model.fields) {
    const v = data[field.key];
    if (field.required && (v === undefined || v === null || v === ""))
      fail("Preencha: " + field.label);
    if (v === undefined || v === null) continue;
    const options = entity === "services" && field.key === "modality"
      ? (await administrativeCatalog()).service_types.filter((item) => item.active || old?.modality === item.name).map((item) => item.name).concat(old?.modality || [])
      : field.key === "owner" ? [...new Set([...field.options, ...(await query("SELECT name FROM users WHERE active=1")).map((person) => person.name), old?.owner].filter(Boolean))] : field.options;
    if (field.type === "select" && !options.includes(v))
      fail("Opção inválida: " + field.label);
    if (field.type === "number") {
      if (!Number.isFinite(Number(v))) fail("Número inválido: " + field.label);
      data[field.key] = Number(v);
    }
    if (
      field.type === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        !Number.isFinite(Date.parse(v + "T12:00:00Z")) ||
        new Date(v + "T12:00:00Z").toISOString().slice(0, 10) !== v)
    )
      fail("Data inválida: " + field.label);
    if (field.type === "email" && !/^\S+@\S+\.\S+$/.test(v))
      fail("E-mail inválido.");
    if (field.type === "reference") {
      const linked = await get(field.entity, v);
      if (!linked) fail("Registro vinculado não encontrado: " + field.label);
      if (isField(user) && !(await recordAllowed(user, field.entity, linked))) fail("O vínculo não pertence a um trabalho atribuído a você.", 403);
      if (field.entity === "materials" && !materialAllowed(user, linked))
        fail("Material sem permissão de acesso.", 403);
      if (data.unit_id && linked.unit_id && linked.unit_id !== data.unit_id)
        fail("O vínculo pertence a outra unidade: " + field.label);
    }
    if (
      ["url", "maps_url", "website", "invoice_url", "delivery_url", "data_url", "sig_url"].includes(
        field.key,
      ) &&
      !/^https?:\/\//i.test(v)
    )
      fail("Use um endereço http ou https: " + field.label);
  }
  if (data.waiting_reason && !data.waiting_until || data.waiting_until && !data.waiting_reason) fail('Informe motivo e data de revisão da espera juntos.');
  if (entity === "units") {
    if (old && data.company_id !== old.company_id) {
      const contacts = await list("contacts"), units = await list("units");
      const companyOf = (contact) => contact.unit_id === old.id ? data.company_id : units.find((unit) => unit.id === contact.unit_id)?.company_id;
      for (const contact of contacts.filter((contact) => contact.superior_id)) {
        const parent = contacts.find((person) => person.id === contact.superior_id);
        if (parent && companyOf(parent) !== companyOf(contact)) fail("Remova a hierarquia entre unidades antes de mudar a empresa.");
      }
    }
    if ((data.latitude == null) !== (data.longitude == null))
      fail("Informe latitude e longitude juntas.");
    const t = await territory();
    data.geo_status = pointInTerritory(
      data.longitude,
      data.latitude,
      t.geometry.coordinates[0],
    );
    if (
      data.size !== "Desconhecido" &&
      (!data.size_source || data.size_evidence === "Desconhecido")
    )
      fail("Informe a fonte e a evidência do porte.");
    if (
      data.priority &&
      data.priority !== "Não definida" &&
      !data.priority_reason
    )
      fail("Justifique a prioridade.");
    if (
      ["Abordagem", "Qualificação", "Pausado"].includes(data.status) &&
      (!data.owner || !data.next_action || !data.next_date)
    )
      fail("Defina responsável, próxima ação e data do retorno.");
  }
  if (entity === "templates" && data.channel === "WhatsApp aprovado") {
    if (!data.provider_name || !/^[a-z0-9_]+$/.test(data.provider_name))
      fail("Informe o nome exato do modelo aprovado na Meta.");
    if (!data.language_code || !/^[a-z]{2}_[A-Z]{2}$/.test(data.language_code))
      fail("Informe o idioma aprovado, como pt_BR.");
    if (!Number.isInteger(data.variable_count) || data.variable_count < 0 || data.variable_count > 20)
      fail("Informe entre 0 e 20 variáveis para o corpo do modelo.");
    if (data.approval_status !== "Aprovado")
      fail("Só registre o canal como WhatsApp aprovado quando a Meta já tiver aprovado o modelo.");
    const variables = Array.from(String(data.body || "").matchAll(/\{\{(\d+)\}\}/g), (m) => Number(m[1]));
    if (variables.length !== data.variable_count || variables.some((number, index) => number !== index + 1))
      fail("O texto precisa conter exatamente as variáveis sequenciais {{1}}, {{2}} etc. configuradas acima.");
  }
  if (entity === "opportunities") {
    if (!data.owner) fail("Defina o responsável pela oportunidade.");
    if (
      !["Ganha", "Perdida"].includes(data.status) &&
      (!data.next_date || !data.next_action)
    )
      fail("Defina a próxima ação e data.");
    if (data.status === "Ganha" && (!data.acceptance || !data.scope))
      fail("O fechamento exige escopo e evidência de aceite.");
    if (
      data.status === "Ganha" &&
      !isManagement(user)
    )
      fail("O fechamento exige aprovação comercial.", 403);
    if (data.status === "Perdida" && !data.loss_reason)
      fail("Registre o motivo da perda.");
    if (data.status === "Validação técnica" && !data.scope)
      fail("Descreva o escopo a validar.");
    if (["Proposta enviada", "Negociação", "Ganha"].includes(data.status)) {
      const proposals = (await list("proposals")).filter(
        (p) => p.opportunity_id === old?.id,
      );
      if (
        !data.technical_validation ||
        !proposals.some((p) => p.status === "Enviada")
      )
        fail(
          "Registre a validação técnica e uma proposta enviada antes de avançar.",
        );
    }
    if (old?.status === "Ganha" && data.status !== "Ganha")
      fail(
        "Contrato já criado. Registre uma nova negociação em outra oportunidade.",
      );
  }
  if (entity === "proposals") {
    if (!Number.isInteger(data.revision) || data.revision < 1)
      fail("A versão deve ser um inteiro positivo.");
    moneyToCents(data.amount);
    if (
      ["Aprovada", "Enviada"].includes(data.status) &&
      (!data.approval || (!data.url && !old?.document_file_ids?.url))
    )
      fail("Informe aprovação e documento.");
    if (
      ["Aprovada", "Enviada"].includes(data.status) &&
      !isManagement(user) &&
      old?.status !== "Aprovada"
    )
      fail("A proposta exige aprovação comercial.", 403);
    if (data.status === "Enviada" && !data.sent_date)
      fail("Registre a data de envio.");
    if (
      old?.status === "Enviada" &&
      ["amount", "scope", "url", "revision"].some((k) => data[k] !== old[k])
    )
      fail("Crie uma nova versão para revisar a proposta enviada.");
    if (
      (await list("proposals")).some(
        (p) =>
          p.id !== old?.id &&
          p.opportunity_id === data.opportunity_id &&
          p.revision === data.revision,
      )
    )
      fail("Esta versão já existe na oportunidade.");
  }
  if (entity === "materials") {
    if (
      data.status === "Aprovado" &&
      (!data.approval || (!data.url && !old?.file_id))
    )
      fail("Aprovar exige autorização e documento.");
    if (
      data.status === "Aprovado" &&
      !["Administrador", "Aprovação comercial", "Técnico"].includes(
        user.role,
      ) &&
      old?.status !== "Aprovado"
    )
      fail("Seu perfil não aprova materiais.", 403);
    if (
      old &&
      (await list("requests")).some(
        (r) =>
          r.material_id === old.id &&
          ["Enviada", "Concluída"].includes(r.status),
      ) &&
      ["revision", "url", "name"].some((k) => data[k] !== old[k])
    )
      fail("Material já enviado. Crie outra versão sem alterar o histórico.");
  }
  if (entity === "requests" && ["Enviada", "Concluída"].includes(data.status)) {
    const material = data.material_id
      ? await get("materials", data.material_id)
      : null;
    if (
      !material ||
      material.status !== "Aprovado" ||
      (material.unit_id && material.unit_id !== data.unit_id) ||
      !data.sent_date ||
      !data.sent_evidence
    )
      fail(
        "Selecione material aprovado para esta unidade e registre data e evidência do envio.",
      );
    data.sent_material = {
      id: material.id,
      name: material.name,
      revision: material.revision,
      url: material.url,
      file_id: material.file_id || null,
    };
  }
  if (entity === "services") {
    if (!data.contract_id && (!old || data.unit_id !== old.unit_id) && !(await administrativeCatalog()).client_ids.includes(data.unit_id)) fail("Inclua a empresa em Administrativo → Catálogos antes de cadastrar um serviço.");
    if (!data.contract_id && (!data.external_reference || !data.scope)) fail("Serviço sem contrato cadastrado exige referência de origem e escopo.");
    if (
      data.status === "Entrega" &&
      (!data.quality || (!data.delivery_url && !old?.document_file_ids?.delivery_url) || !data.delivered_date)
    )
      fail("A entrega exige conferência, documento e data.");
    if (
      old?.scheduled_date &&
      old.scheduled_date !== data.scheduled_date &&
      !data.impediment
    )
      fail("Registre o motivo do reagendamento.");
  }
  if (["invoices", "receipts"].includes(entity)) {
    data.amount_cents = moneyToCents(data.amount);
    if (old) {
      const linked = await query(
        `SELECT COALESCE(SUM(amount_cents),0) AS total FROM allocations WHERE ${entity === "invoices" ? "invoice_id" : "receipt_id"}=$1`,
        [old.id],
      );
      if (data.amount_cents < Number(linked[0].total))
        fail("O valor não pode ficar abaixo do montante já conciliado.");
    }
  }
  if (entity === "invoices") {
    await validateAdministrativeSelection(data, old);
    if (
      ["Autorizada", "Nota emitida"].includes(data.status) &&
      !data.authorization && !old?.document_file_ids?.authorization
    )
      fail("Informe a autorização do cliente.");
    if (
      data.status === "Nota emitida" &&
      (!data.invoice_number || !data.due_date || (!data.invoice_url && !old?.document_file_ids?.invoice_url))
    )
      fail("Informe número, documento e vencimento da nota.");
    if (data.bulletin_sent_date && !data.bulletin && !old?.document_file_ids?.bulletin) fail("Registre o boletim antes de confirmar seu envio.");
    if (data.sent_date && (data.status !== "Nota emitida" || !data.sent_evidence)) fail("Envio da nota exige nota emitida e protocolo / evidência.");
    if (data.reconciled_date) {
      const linked = old ? await query("SELECT COALESCE(SUM(amount_cents),0) AS total FROM allocations WHERE invoice_id=$1", [old.id]) : [];
      if (data.status !== "Nota emitida" || Number(linked[0]?.total || 0) !== data.amount_cents) fail("Confira a baixa somente depois de conciliar o recebimento integral da nota.");
    }
    if (data.owner && data.status !== "Nota emitida" && !data.next_date) fail("Defina a data de retorno para acompanhar o boletim ou a liberação.");
    if (old?.reconciled_date && ["amount", "status", "invoice_number", "service_id", "unit_id", "reconciled_date"].some((key) => data[key] !== old[key])) fail("A baixa conferida deve preservar a nota e a conciliação.");
  }
  if (entity === "admin_documents") {
    try { data.document_checklist = validateChecklist(input.document_checklist === undefined ? old?.document_checklist : input.document_checklist, data, old, user); }
    catch (error) { fail(error.message); }
    if (data.document_checklist?.items?.length && ['Pronto para envio','Enviado','Concluído'].includes(data.status) && (!checklistComplete(data.document_checklist) || data.document_checklist.context !== checklistContext(data))) fail('Conclua a conferência interna desta versão antes de avançar. Alterar documento ou instruções exige nova conferência.');
    await validateAdministrativeSelection(data, old);
    if (old?.archived_at && models.admin_documents.fields.some(({ key }) => key !== "notes" && data[key] !== old[key])) fail("Restaure o documento arquivado antes de alterar o acompanhamento.");
    if (!data.owner) fail("Defina o responsável pelo documento.");
    if (!Number.isInteger(data.revision) || data.revision < 1) fail("A versão do documento deve ser um inteiro positivo.");
    if (["Pronto para envio", "Enviado", "Concluído"].includes(data.status) && !data.url && !old?.document_file_ids?.url) fail("Informe o documento antes de avançar.");
    if (["Enviado", "Concluído"].includes(data.status) && (!data.sent_date || !data.protocol)) fail("Registre data e protocolo / evidência do envio.");
    if (data.status === "Devolvido" && (!data.rejection_reason || !data.sent_date || !data.protocol)) fail("A devolução exige envio registrado e motivo.");
    if (!old && data.status === "Substituído") fail("Use a ação de nova versão para substituir um documento devolvido.");
    if (old?.status === "Enviado" && !["Enviado", "Devolvido", "Concluído"].includes(data.status)) fail("Documento enviado: registre conclusão ou devolução, preservando o envio.");
    if (old?.status === "Devolvido" && data.status !== "Devolvido") fail("Use a ação de nova versão para corrigir o documento devolvido.");
    if (old && ["Enviado", "Devolvido", "Concluído", "Substituído"].includes(old.status) && ["name", "url", "revision", "unit_id", "service_id", "sent_date", "protocol"].some((key) => data[key] !== old[key])) fail("Preserve o documento enviado. Crie uma nova versão para a correção.");
    if (old && ["Concluído", "Substituído"].includes(old.status) && ["status", "due_date", "recurrence"].some((key) => data[key] !== old[key])) fail("Documento encerrado: preserve a situação e a repetição registradas.");
  }
  if (
    entity === "contracts" &&
    (await get("opportunities", data.opportunity_id))?.status !== "Ganha"
  )
    fail("O contrato deve estar vinculado a uma oportunidade ganha.");
  if (entity === "activities" && data.status === "Concluída" && !data.result)
    fail("Registre o resultado da atividade.");
  if (
    entity === "conversations" &&
    (!data.owner || (!data.next_action && !old))
  )
    fail("Defina responsável e próxima ação do atendimento.");
  return data;
}
async function validateAdministrativeSelection(data, old) {
  if ((!old || data.unit_id !== old.unit_id) && !(await administrativeCatalog()).client_ids.includes(data.unit_id)) fail("Inclua a empresa em Administrativo → Catálogos antes de usá-la neste lançamento.");
  if (data.service_id && data.service_id !== old?.service_id && (await get("services", data.service_id))?.administrative_hidden) fail("Este serviço foi retirado das opções. Reative-o em Catálogos ou escolha outro.");
}
export async function changeAdministrativeCatalog(user, input) {
  if (!financeRoles.includes(user?.role)) fail("Seu perfil não pode alterar os catálogos administrativos.", 403);
  if (!input || typeof input !== "object") fail("Ação de catálogo inválida.");
  return transaction(async () => {
    await query("INSERT INTO settings(id,data) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", [administrativeCatalogKey, JSON.stringify(emptyAdministrativeCatalog())]);
    const before = JSON.parse((await query("SELECT data FROM settings WHERE id=$1" + (isPostgres() ? " FOR UPDATE" : ""), [administrativeCatalogKey]))[0].data);
    const catalog = structuredClone(before);
    const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    let unitId = input.unit_id;
    if (input.action === "create-client") {
      for (const key of ["company_name", "name", "cnpj", "city", "contact_name", "email", "phone"]) {
        if (input[key] != null && (typeof input[key] !== "string" || input[key].length > 200)) fail("Dados do cliente inválidos: " + key);
      }
      const name = String(input.company_name || "").trim(), unitName = String(input.name || name).trim();
      const cnpj = String(input.cnpj || "").replace(/[^a-z0-9]/gi, "").toUpperCase();
      const email = String(input.email || "").trim(), phone = String(input.phone || "").replace(/\D/g, "");
      if (!name || name.length > 200 || !unitName || unitName.length > 200) fail("Informe nomes de empresa e unidade com até 200 caracteres.");
      if (cnpj && !hasCnpjFormat(cnpj)) fail("Informe um CNPJ válido com 14 posições.");
      if (email && !/^\S+@\S+\.\S+$/.test(email)) fail("Informe um e-mail válido.");
      if (phone && !/^\d{10,15}$/.test(phone)) fail("Informe um telefone válido com DDD.");
      if ([input.city, input.contact_name, email].some((value) => String(value || "").length > 200)) fail("Preencha os dados do cliente com até 200 caracteres por campo.");
      const companies = await list("companies");
      let company = companies.find((item) => cnpj ? String(item.cnpj || "").replace(/[^a-z0-9]/gi, "").toUpperCase() === cnpj : normalize(item.name) === normalize(name));
      if (company && (await list("units")).some((item) => item.company_id === company.id && normalize(item.name) === normalize(unitName))) fail("Esta empresa/unidade já está cadastrada. Use a opção de incluir um cadastro existente.");
      if (!company) {
        company = await insert("companies", { name, cnpj: cnpj || null, source: "Cadastro administrativo por " + user.name }, randomUUID());
        await audit(user, "companies", company.id, "cadastro administrativo", null, company);
      }
      const unit = await insert("units", { company_id: company.id, name: unitName, city: String(input.city || "").trim() || null, status: "Cadastro conferido", segment: "Não informado", size: "Desconhecido", size_evidence: "Desconhecido", priority: "Não definida", source: "Cadastro administrativo — cliente atendido", source_date: new Date().toISOString().slice(0, 10) }, randomUUID());
      unitId = unit.id;
      await audit(user, "units", unit.id, "cadastro administrativo", null, unit);
      if (email || phone || input.contact_name) {
        const contact = await insert("contacts", { unit_id: unit.id, name: String(input.contact_name || "Canal administrativo").trim(), email: email || null, phone: phone || null, source: "Cadastro administrativo por " + user.name }, randomUUID());
        await audit(user, "contacts", contact.id, "cadastro administrativo", null, contact);
      }
    }
    if (["add-client", "remove-client", "create-client"].includes(input.action)) {
      if (typeof unitId !== "string" || !unitId || unitId.length > 100) fail("Selecione uma empresa/unidade válida.");
      if (!(await get("units", unitId))) fail("Selecione uma empresa/unidade cadastrada.");
      catalog.client_ids = catalog.client_ids.filter((id) => id !== unitId);
      if (input.action !== "remove-client") catalog.client_ids.push(unitId);
    } else if (input.action === "add-service-type") {
      if (typeof input.name !== "string") fail("Informe o nome da modalidade.");
      const name = String(input.name || "").trim();
      if (!name || name.length > 100) fail("Informe o nome da modalidade com até 100 caracteres.");
      if (catalog.service_types.some((item) => normalize(item.name) === normalize(name))) fail("Esta modalidade já existe. Reative-a se estiver retirada.");
      catalog.service_types.push({ id: randomUUID(), name, active: true });
    } else if (input.action === "set-service-type") {
      const type = catalog.service_types.find((item) => item.id === input.id);
      if (!type || typeof input.active !== "boolean") fail("Modalidade ou situação inválida.");
      type.active = input.active;
    } else if (input.action === "set-service") {
      if (typeof input.active !== "boolean" || typeof input.id !== "string" || !input.id) fail("Serviço ou situação inválida.");
      if (isPostgres()) await query("SELECT id FROM services WHERE id=$1 FOR UPDATE", [input.id]);
      const old = await get("services", input.id);
      if (!old) fail("Serviço não encontrado.", 404);
      const record = await update("services", old.id, { ...old, administrative_hidden: !input.active }, old.version);
      await audit(user, "services", old.id, input.active ? "reativado nas opções administrativas" : "retirado das opções administrativas", old, record);
    } else fail("Ação de catálogo inválida.");
    catalog.version += 1;
    await query("UPDATE settings SET data=$1 WHERE id=$2", [JSON.stringify(catalog), administrativeCatalogKey]);
    await audit(user, "settings", administrativeCatalogKey, input.action, before, catalog);
    return { ...catalog, ...(input.action === "create-client" ? { created_unit_id: unitId } : {}) };
  });
}
export async function saveRecord(user, entity, input, id, version, options = {}) {
  return transaction(async () => {
    if (id && ["activities", "services", "invoices", "receipts", "admin_documents"].includes(entity) && isPostgres())
      await query(`SELECT id FROM ${entity} WHERE id=$1 FOR UPDATE`, [id]);
    if (["contacts", "units"].includes(entity) && isPostgres()) await query("SELECT id FROM contacts ORDER BY id FOR UPDATE");
    const old = id ? await get(entity, id) : null;
    if (id && !old) fail("Registro não encontrado.", 404);
    if (entity === "materials" && old && !materialAllowed(user, old))
      fail("Acesso ao material restrito.", 403);
    const data = await validate(entity, input, user, old);
    if (!old || data.status !== old.status) data.stage_started_at = new Date().toISOString();
    const record = id
      ? await update(entity, id, data, version)
      : await insert(entity, data, randomUUID());
    await audit(
      user,
      entity,
      record.id,
      id ? "alteração" : "criação",
      old,
      record,
    );
    if (entity === "activities" && options.notify !== false) await queueActivityNotifications(record, old, user);
    if (entity === "admin_documents" && record.status === "Concluído" && record.recurrence === "Mensal" && old?.status !== "Concluído") {
      const next = await insert("admin_documents", nextDocumentData(record), randomUUID());
      await audit(user, "admin_documents", next.id, "próximo documento mensal gerado", record, next);
    }
    if (
      entity === "opportunities" &&
      record.status === "Ganha" &&
      old?.status !== "Ganha" &&
      !(await list('contracts')).some(contract=>contract.opportunity_id===record.id)
    ) {
      const contract = await insert(
        "contracts",
        {
          name: "Contrato — " + record.name,
          unit_id: record.unit_id,
          opportunity_id: record.id,
          scope: record.scope,
          acceptance: record.acceptance,
          status: "Preparação",
        },
        randomUUID(),
      );
      await audit(
        user,
        "contracts",
        contract.id,
        "gerado pelo fechamento",
        null,
        contract,
      );
    }
    return record;
  });
}
export async function prepareOperation(user, opportunityId, version) {
  if (!canWrite(user.role,'opportunities')) fail('A gestão ou o comercial prepara a operação.',403);
  return transaction(async()=>{
    if (isPostgres()) await query('SELECT id FROM opportunities WHERE id=$1 FOR UPDATE',[opportunityId]);
    const opportunity=await get('opportunities',opportunityId);
    if (!opportunity || opportunity.status!=='Ganha') fail('Escolha uma oportunidade ganha.');
    if (opportunity.version!==version) fail('A oportunidade foi alterada. Atualize antes de preparar a operação.',409);
    const contracts=(await list('contracts')).filter(item=>item.opportunity_id===opportunity.id);
    if (!contracts.length) fail('Registre o contrato antes de preparar a operação.');
    const existing=(await list('services')).find(item=>contracts.some(contract=>contract.id===item.contract_id));
    if (existing) return {service:existing,created:false};
    const service=await insert('services',{name:'Campanha — '+opportunity.name,unit_id:opportunity.unit_id,contract_id:contracts[0].id,scope:opportunity.scope,owner_id:opportunity.owner_id||user.id,owner:opportunity.owner||user.name,kind:'Nova demanda',status:'Preparação',stage_started_at:new Date().toISOString()},randomUUID());
    await audit(user,'services',service.id,'operação preparada explicitamente',null,service);
    return {service,created:true};
  });
}
export async function deleteAdministrativeRecord(user, entity, id, version) {
  const allowed = ["services", "invoices", "receipts", "admin_documents"];
  if (!allowed.includes(entity)) fail("Este tipo de cadastro não pode ser apagado por esta ação.");
  if (!canWrite(user?.role, entity)) fail("Seu perfil não pode apagar este lançamento.", 403);
  return transaction(async () => {
    if (isPostgres()) await query(`SELECT id FROM ${entity} WHERE id=$1 FOR UPDATE`, [id]);
    const record = await get(entity, id);
    if (!record) fail("Lançamento não encontrado.", 404);
    if (record.version !== version) fail("Este lançamento foi alterado. Atualize a tela antes de apagar.", 409);
    if((await query('SELECT id FROM record_files WHERE entity=$1 AND record_id=$2 LIMIT 1',[entity,id])).length)fail('Este lançamento possui arquivos no histórico. Preserve-o e use o arquivamento quando disponível.');
    if (entity === "services") {
      if ((await query("SELECT id FROM invoices WHERE service_id=$1 LIMIT 1", [id])).length || (await query("SELECT id FROM admin_documents WHERE service_id=$1 LIMIT 1", [id])).length)
        fail("Este serviço já está vinculado a um lançamento administrativo.");
    }
    if (entity === "invoices") {
      if ((await query("SELECT id FROM allocations WHERE invoice_id=$1 LIMIT 1", [id])).length) fail("Medição com recebimentos conciliados não pode ser apagada.");
    }
    if (entity === "receipts" && (await query("SELECT id FROM allocations WHERE receipt_id=$1 LIMIT 1", [id])).length)
      fail("Recebimento conciliado não pode ser apagado.");
    if (entity === "admin_documents") {
      if ((await list("admin_documents")).some((item) => item.previous_document_id === id || item.revision_document_id === id))
        fail("Documento ligado a uma revisão não pode ser apagado.");
    }
    await audit(user, entity, id, "exclusão de lançamento", record, null);
    const deleted = await query(`DELETE FROM ${entity} WHERE id=$1 AND version=$2 RETURNING id`, [id, version]);
    if (!deleted.length) fail("Este lançamento foi alterado. Atualize a tela antes de apagar.", 409);
    return { ok: true };
  });
}
export async function reviseAdministrativeDocument(user, id, version, dueDate) {
  if (!financeRoles.includes(user?.role)) fail("Seu perfil não revisa documentos administrativos.", 403);
  return transaction(async () => {
    if (isPostgres()) await query("SELECT id FROM admin_documents WHERE id=$1 FOR UPDATE", [id]);
    const old = await get("admin_documents", id);
    if (!old) fail("Documento não encontrado.", 404);
    if (old.version !== version) fail("Este documento foi alterado. Atualize antes de criar a revisão.", 409);
    if (old.archived_at) fail("Restaure o documento arquivado antes de criar uma revisão.");
    if (old.status !== "Devolvido") fail("Crie uma revisão de um documento devolvido.");
    const data = await validate("admin_documents", { ...administrativeDocumentContext(old), competence: old.competence || null, name: old.name, unit_id: old.unit_id, service_id: old.service_id || null, owner: old.owner, destination: old.destination || null, recurrence: old.recurrence || "Não repetir", due_date: dueDate, revision: old.revision + 1, status: "Pendente", notes: `Correção da versão ${old.revision}: ${old.rejection_reason}` }, user);
    const next = await insert("admin_documents", { ...data, previous_document_id: old.id, recurrence_day: old.recurrence_day || Number(old.due_date.slice(8, 10)) }, randomUUID());
    const replaced = await update("admin_documents", old.id, { ...old, status: "Substituído", revision_document_id: next.id }, old.version);
    await audit(user, "admin_documents", old.id, "substituído por nova versão", old, replaced);
    await audit(user, "admin_documents", next.id, "nova versão gerada", old, next);
    return next;
  });
}
export async function archiveAdministrativeDocument(user, id, version, reason, restore = false) {
  if (!financeRoles.includes(user?.role)) fail("Seu perfil não pode arquivar documentos administrativos.", 403);
  const cleanReason = String(reason || "").trim();
  if (!restore && !cleanReason) fail("Informe por que este documento será arquivado.");
  return transaction(async () => {
    if (isPostgres()) await query("SELECT id FROM admin_documents WHERE id=$1 FOR UPDATE", [id]);
    const old = await get("admin_documents", id);
    if (!old) fail("Documento não encontrado.", 404);
    if (old.version !== version) fail("Este documento foi alterado. Atualize antes de continuar.", 409);
    if (restore && !old.archived_at) fail("Este documento não está arquivado.");
    if (!restore && old.archived_at) fail("Este documento já está arquivado.");
    const data = restore
      ? { ...old, archived_at: null, archived_by: null, archive_reason: null }
      : { ...old, archived_at: new Date().toISOString(), archived_by: user.name, archive_reason: cleanReason };
    const record = await update("admin_documents", id, data, version);
    await audit(user, "admin_documents", id, restore ? "documento restaurado" : "documento arquivado", old, record);
    return record;
  });
}
export async function createOpportunityFromConversation(user, conversationId, input) {
  if (typeof conversationId !== "string" || !conversationId.trim())
    fail("Conversa inválida.");
  if (!canWrite(user.role, "opportunities") || !canWrite(user.role, "conversations"))
    fail("Seu perfil não pode criar oportunidade a partir do atendimento.", 403);
  return transaction(async () => {
    if (isPostgres())
      await query("SELECT id FROM conversations WHERE id=$1 FOR UPDATE", [conversationId]);
    const conversation = await get("conversations", conversationId);
    if (!conversation) fail("Conversa não encontrada.", 404);
    if (
      (input?.unit_id && input.unit_id !== conversation.unit_id) ||
      (input?.contact_id && input.contact_id !== conversation.contact_id)
    )
      fail("A unidade e o contato devem permanecer os mesmos do atendimento.");
    if (conversation.opportunity_id)
      fail("Esta conversa já está vinculada a uma oportunidade.", 409);
    const opportunity = await saveRecord(user, "opportunities", {
      ...input,
      unit_id: conversation.unit_id,
      contact_id: conversation.contact_id,
    });
    const linkedConversation = await saveRecord(
      user,
      "conversations",
      { ...conversation, opportunity_id: opportunity.id },
      conversation.id,
      conversation.version,
    );
    return { opportunity, conversation: linkedConversation };
  });
}
export async function allocate(user, receiptId, invoiceId, amount) {
  if (!financeRoles.includes(user.role))
    fail("Seu perfil não concilia recebimentos.", 403);
  return transaction(async () => {
    const lock = isPostgres() ? " FOR UPDATE" : "";
    const receipt = (
      await query("SELECT * FROM receipts WHERE id=$1" + lock, [receiptId])
    )[0];
    const invoice = (
      await query("SELECT * FROM invoices WHERE id=$1" + lock, [invoiceId])
    )[0];
    if (!receipt || !invoice) fail("Nota ou recebimento não encontrado.");
    if (JSON.parse(invoice.data).status !== "Nota emitida")
      fail("Concilie somente notas emitidas.");
    const cents = moneyToCents(amount);
    const r = await query(
      "SELECT COALESCE(SUM(amount_cents),0) AS total FROM allocations WHERE receipt_id=$1",
      [receiptId],
    );
    const i = await query(
      "SELECT COALESCE(SUM(amount_cents),0) AS total FROM allocations WHERE invoice_id=$1",
      [invoiceId],
    );
    if (
      cents + Number(r[0].total) > Number(receipt.amount_cents) ||
      cents + Number(i[0].total) > Number(invoice.amount_cents)
    )
      fail("A alocação excede o saldo da nota ou do recebimento.");
    const a = {
      id: randomUUID(),
      receipt_id: receiptId,
      invoice_id: invoiceId,
      amount_cents: cents,
      created_at: new Date().toISOString(),
      user_id: user.id,
    };
    await query(
      "INSERT INTO allocations(id,invoice_id,receipt_id,amount_cents,created_at,user_id) VALUES($1,$2,$3,$4,$5,$6)",
      [a.id, invoiceId, receiptId, cents, a.created_at, user.id],
    );
    await audit(user, "allocations", a.id, "conciliação", null, a);
    return a;
  });
}
export async function unallocate(user, id, reason) {
  if (!financeRoles.includes(user?.role)) fail("Seu perfil não pode desfazer conciliações.", 403);
  const cleanReason = typeof reason === "string" ? reason.trim() : "";
  if (!cleanReason || cleanReason.length > 500) fail("Informe o motivo em até 500 caracteres para desfazer o vínculo.");
  return transaction(async () => {
    const old = (await query("SELECT * FROM allocations WHERE id=$1", [id]))[0];
    if (!old) fail("Este vínculo já foi desfeito ou não existe. Atualize a lista.", 409);
    if (isPostgres()) {
      await query("SELECT id FROM receipts WHERE id=$1 FOR UPDATE", [old.receipt_id]);
      await query("SELECT id FROM invoices WHERE id=$1 FOR UPDATE", [old.invoice_id]);
    }
    const removed = await query("DELETE FROM allocations WHERE id=$1 RETURNING id", [id]);
    if (!removed.length) fail("Este vínculo já foi desfeito. Atualize a lista.", 409);
    const invoice = await get("invoices", old.invoice_id);
    if (invoice.reconciled_date) {
      const reopened = await update("invoices", invoice.id, { ...invoice, reconciled_date: null }, invoice.version);
      await audit(user, "invoices", invoice.id, "baixa reaberta ao desfazer conciliação", invoice, reopened);
    }
    await audit(user, "allocations", id, "conciliação desfeita", old, { reason: cleanReason });
    return { ok: true };
  });
}
export async function stateFor(user) {
  const entries = await Promise.all(
    entityKeys.map(async (e) => [e, canRead(user, e) ? await list(e) : []]),
  );
  const data = Object.fromEntries(entries);
  const directory = await query("SELECT id,name FROM users");
  for (const entity of entityKeys) data[entity] = data[entity].map((record) => record.owner_id ? { ...record, owner: directory.find((person) => person.id === record.owner_id)?.name || record.owner } : record);
  if (isField(user)) {
    const activityServices = new Set(data.activities.filter((record) => assignedTo(record, user) && record.status !== "Cancelada").map((record) => record.service_id).filter(Boolean));
    data.services = data.services.filter((record) => isOperational(user) || assignedTo(record, user) || activityServices.has(record.id)).map(({ contract_id, external_reference, acceptance, ...record }) => record);
    const units = new Set(data.services.map((record) => record.unit_id));
    for (const record of data.activities.filter((record) => assignedTo(record, user))) if (record.unit_id) units.add(record.unit_id);
    data.units = data.units.filter((record) => isOperational(user) || units.has(record.id)).map(({ id, version, name, company_id, city, address, latitude, longitude, maps_url, sig_url, segment, materials, geo_status, distance_km, travel_minutes, website }) => ({ id, version, name, company_id, city, address, latitude, longitude, maps_url, sig_url, segment, materials, geo_status, distance_km, travel_minutes, website }));
    const companies = new Set(data.units.map((record) => record.company_id));
    data.companies = data.companies.filter((record) => companies.has(record.id)).map(({ id, name, sig_url }) => ({ id, name, sig_url }));
    data.contacts = data.contacts.filter((record) => isOperational(user) || units.has(record.unit_id)).map(({ id, version, name, unit_id, email, phone, role, department, superior_id }) => ({ id, version, name, unit_id, email, phone, role, department, superior_id }));
    data.requests = data.requests.filter((record) => isOperational(user) || assignedTo(record, user));
  }
  data.activities = data.activities.map((record) => safeActivity(record, user)).filter(Boolean);
  const prospectingRoles = ["Administrador", "Administração", "Administrativo", "Comercial", "Aprovação comercial"];
  data.lead_followups = prospectingRoles.includes(user.role)
    ? (await query(`WITH latest AS (
        SELECT id,candidate_id,author_name,next_action,next_date,created_at,
          ROW_NUMBER() OVER (PARTITION BY candidate_id ORDER BY created_at DESC,id DESC) AS position
        FROM prospecting_activities
      )
      SELECT a.id,a.candidate_id,a.author_name,a.next_action,a.next_date,a.created_at,c.cnpj,c.data
      FROM latest a JOIN prospecting_candidates c ON c.id=a.candidate_id
      WHERE a.position=1 AND c.converted_unit_id IS NULL
      ORDER BY a.next_date,a.created_at`)).map((row) => {
        const candidate = JSON.parse(row.data);
        return {
          id: row.id,
          candidate_id: row.candidate_id,
          cnpj: row.cnpj,
          candidate_name: candidate.company_name || candidate.unit_name || "Empresa sem nome",
          municipality: candidate.municipality || "",
          name: row.next_action,
          next_action: row.next_action,
          due_date: row.next_date,
          owner: row.author_name,
          created_at: row.created_at,
        };
      })
    : [];
  data.messages = data.messages.map((message) => ({
    ...message,
    attachments: (message.attachments || []).map((attachment, index) => {
      const { storage_key, ...safe } = attachment;
      return storage_key
        ? { ...safe, download_url: `/api/messages/${encodeURIComponent(message.id)}/attachments/${index}` }
        : safe;
    }),
  }));
  data.materials = data.materials.filter((m) => materialAllowed(user, m));
  const allowed = new Set(data.materials.map((m) => m.id));
  data.requests = data.requests.map((r) =>
    allowed.has(r.material_id) || !r.material_id
      ? r
      : { ...r, material_id: null, sent_material: null },
  );
  const allocations = financeRoles.includes(user.role)
    ? await query("SELECT * FROM allocations")
    : [];
  const files = (
    await query(
      "SELECT id,material_id,filename,size_bytes,content_type FROM files UNION ALL SELECT id,record_id AS material_id,filename,size_bytes,content_type FROM record_files WHERE entity='materials'",
    )
  ).filter((f) => allowed.has(f.material_id));
  const importReport = JSON.parse(
    (
      await query("SELECT data FROM settings WHERE id=$1", ["initial-import"])
    )[0]?.data || "null",
  );
  const unassigned = messagingRoles.includes(user.role)
    ? (await query("SELECT * FROM inbox_events")).map((r) => ({
        id: r.id,
        ...JSON.parse(r.data),
        attachments: (JSON.parse(r.data).attachments || []).map((attachment, index) => {
          const { storage_key, ...safe } = attachment;
          return storage_key
            ? { ...safe, download_url: `/api/messages/${encodeURIComponent(r.id)}/attachments/${index}` }
            : safe;
        }),
      }))
    : [];
  const catalog = await administrativeCatalog();
  return {
    data,
    administrativeCatalog: financeRoles.includes(user.role) ? catalog : null,
    serviceModalities: catalog.service_types.filter((item) => item.active).map((item) => item.name),
    allocations,
    files,
    unassigned,
    territory: await territory(),
    importReport: isManagement(user) ? importReport : null,
    lastBackup: isManagement(user) ? JSON.parse(
      (await query("SELECT data FROM settings WHERE id=$1", ["last-backup"]))[0]
        ?.data || "null",
    ) : null,
    backupAttempt: isManagement(user) ? JSON.parse((await query('SELECT data FROM settings WHERE id=$1',['last-backup-attempt']))[0]?.data || 'null') : null,
    recoveryBackup: isManagement(user) ? JSON.parse((await query('SELECT data FROM settings WHERE id=$1',['release-backup-verification']))[0]?.data || 'null') : null,
    user,
    integrations: {
      ...(isManagement(user) ? integrationStatus() : {}),
      database: isTurso() ? "Turso" : isPostgres() ? "PostgreSQL" : "SQLite local",
    },
  };
}
export async function recordAllowed(user, entity, record) {
  if (!record || !canRead(user, entity)) return false;
  if (entity === "activities") return activityReadable(record, user);
  if (entity === "materials") return materialAllowed(user, record);
  if (isOperational(user) && ["units", "companies", "contacts", "services", "requests"].includes(entity)) return true;
  if (!isField(user)) return true;
  if (entity === "services") return assignedTo(record, user) || (await list("activities")).some((item) => item.service_id === record.id && item.status !== "Cancelada" && assignedTo(item, user));
  if (entity === "requests") return assignedTo(record, user);
  const units = new Set((await list("services")).filter((item) => assignedTo(item, user)).map((item) => item.unit_id));
  return entity === "units" ? units.has(record.id) : entity === "contacts" ? units.has(record.unit_id) : false;
}
