import { resetChecklist } from './document-checklist.mjs';
import {nextReviewDate} from './operation-flow.mjs';
export const administrativeRoles = ["Administrador", "Administração", "Administrativo", "Aprovação comercial"];

export function invoiceBalance(invoice, allocations = []) {
  return Number(invoice.amount_cents) - allocations.filter((item) => item.invoice_id === invoice.id).reduce((sum, item) => sum + Number(item.amount_cents), 0);
}

export function invoiceNextStep(invoice, allocations = []) {
  if (invoice.reconciled_date) return "Concluído";
  if (invoice.status === "Nota emitida") {
    if (invoiceBalance(invoice, allocations) === 0) return "Conferir baixa";
    if (!invoice.sent_date) return "Enviar nota";
    return "Acompanhar recebimento";
  }
  if (invoice.status === "Autorizada") return "Emitir nota";
  if (["Boletim enviado", "Autorização pendente"].includes(invoice.status)) return "Solicitar liberação";
  return "Preparar boletim";
}

export function nextMonthlyDeadline(date, anchorDay) {
  const current = new Date(date + "T12:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !Number.isFinite(current.getTime()) || current.toISOString().slice(0, 10) !== date) throw new Error("Prazo inválido para repetição mensal.");
  const year = current.getUTCFullYear(), month = current.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchorDay || current.getUTCDate(), lastDay), 12)).toISOString().slice(0, 10);
}

export function administrativeDocumentContext(document) {
  return { ...Object.fromEntries(["owner_id", "document_area", "bankdoc_module", "bankdoc_record_type", "gerdau_unit", "gerdau_contract", "submission_checklist", "bankdoc_rule_id", "bankdoc_company_name", "bankdoc_company_cnpj", "bankdoc_subject_name", "bankdoc_subject_id", "bankdoc_job"].filter((key) => document[key] != null).map((key) => [key, document[key]])), ...(document.document_checklist ? {document_checklist:resetChecklist(document.document_checklist)} : {}) };
}

export function nextDocumentData(document) {
  return {
    ...administrativeDocumentContext(document),
    name: document.name, unit_id: document.unit_id, service_id: document.service_id || null,
    owner: document.owner, destination: document.destination || null, recurrence: "Mensal",
    due_date: nextMonthlyDeadline(document.due_date, document.recurrence_day), revision: 1, status: "Pendente",
    recurrence_day: document.recurrence_day || Number(document.due_date.slice(8, 10)),
    previous_document_id: document.id,
  };
}

export function buildAdministrativeQueue(data) {
  const invoices = data.invoices || [], allocations = data.allocations || [];
  const invoicedServices = new Set(invoices.map((item) => item.service_id));
  const queue = [
    ...(data.services || []).filter((item) => item.status === "Entrega" && item.delivered_date && !invoicedServices.has(item.id)).map((item) => ({
      id: "service-" + item.id, entity: "services", record_id: item.id, unit_id: item.unit_id, name: item.name,
      action: "Iniciar boletim / faturamento", owner: "", due_date: null,
      reason: "Serviço entregue sem acompanhamento administrativo",
    })),
    ...invoices.filter((item) => !item.reconciled_date).map((item) => ({
      id: "invoice-" + item.id, entity: "invoices", record_id: item.id, unit_id: item.unit_id, name: item.name,
      action: invoiceNextStep(item, allocations), owner: item.owner || "", due_date: item.next_date || (item.status === "Nota emitida" ? item.due_date : null),
      reason: item.next_action || "Próxima etapa identificada pelo andamento registrado",
      waiting_reason:item.waiting_reason, waiting_until:item.waiting_until, stage_started_at:item.stage_started_at,
    })),
    ...(data.admin_documents || []).filter((item) => !item.archived_at && !["Concluído", "Substituído"].includes(item.status)).map((item) => ({
      id: "document-" + item.id, entity: "admin_documents", record_id: item.id, unit_id: item.unit_id, name: item.name,
      action: item.status === "Devolvido" ? "Preparar nova versão" : item.status === "Enviado" ? "Conferir aceite do documento" : item.status === "Pronto para envio" ? "Enviar documento" : "Preparar / revisar documento",
      owner: item.owner || "", due_date: item.due_date, reason: item.rejection_reason || item.destination || "Exigência documental registrada",
      waiting_reason:item.waiting_reason, waiting_until:item.waiting_until, stage_started_at:item.stage_started_at,
    })),
  ];
  return queue.map(item=>({...item,due_date:nextReviewDate(item,item.due_date)})).sort((a, b) => (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31") || a.name.localeCompare(b.name, "pt-BR"));
}

export function administrativeMessage(invoice, clientName, kind) {
  const client = clientName || "equipe", reference = invoice.name;
  if (kind === "bulletin") return `Olá, ${client}. Encaminho o boletim referente a ${reference}: ${invoice.bulletin || "[inserir documento]"}. Poderiam conferir e informar a liberação ou o número de pedido para emissão da nota? Obrigado.`;
  if (kind === "authorization") return `Olá, ${client}. Estamos acompanhando a liberação para faturamento de ${reference}. Poderiam informar o andamento e o número de pedido/autorização? Obrigado.`;
  return `Olá, ${client}. Encaminho a nota ${invoice.invoice_number || "[número]"}, referente a ${reference}: ${invoice.invoice_url || "[inserir documento]"}. Por favor, confirmem o recebimento. Obrigado.`;
}

export function administrativeDocumentMessage(document, clientName, kind) {
  const client = clientName || "equipe";
  const reference = document.name || "documento solicitado";
  if (kind === "request") {
    const pending=(document.document_checklist?.items||[]).filter(item=>['Pendente','Divergência'].includes(item.result)).map(item=>item.label);
    const context=[document.competence&&`competência ${document.competence}`,document.gerdau_contract&&`contrato/OS ${document.gerdau_contract}`].filter(Boolean).join(' · ');
    return `Olá, ${client}. Para dar andamento a ${reference}${context?` (${context})`:''}, poderia nos encaminhar ${pending.length?'os seguintes itens:\n'+pending.map(label=>'• '+label).join('\n'):'os documentos e informações indicados no acompanhamento'}? Se houver alguma dúvida sobre as exigências, podemos conferir juntos. Obrigado.`;
  }
  if (kind === "submitted") return `Olá, ${client}. Registramos o envio de ${reference}${document.protocol ? ` (protocolo ${document.protocol})` : ""}. Poderiam confirmar se o recebimento está correto ou se há alguma pendência? Obrigado.`;
  if (kind === "returned") return `Olá, ${client}. O documento ${reference} retornou para ajuste${document.rejection_reason ? `: ${document.rejection_reason}` : ""}. Estamos revisando e avisaremos quando a nova versão estiver pronta. Obrigado.`;
  return `Olá, ${client}. Estamos acompanhando ${reference}. Poderiam informar se há atualização ou alguma pendência para concluirmos o processo? Obrigado.`;
}
