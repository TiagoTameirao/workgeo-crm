export function handoffWarnings(service, contacts = []) {
  const missing = [];
  if (!service.scope) missing.push('Confirmar o escopo do serviço');
  if (!service.owner_id) missing.push('Definir uma conta responsável');
  if (!contacts.some(contact => contact.unit_id === service.unit_id)) missing.push('Confirmar o contato da unidade');
  if (!service.scheduled_date) missing.push('Definir o agendamento');
  if (!service.local_access) missing.push('Confirmar acesso e orientações do local');
  if (['Processamento','Conferência','Entrega'].includes(service.status)) {
    if (!service.performed_date) missing.push('Registrar a data realizada em campo');
    if (!service.data_url) missing.push('Informar o link dos dados coletados');
  }
  if (['Conferência','Entrega'].includes(service.status) && !service.processing_reference) missing.push('Identificar a versão produzida no processamento');
  if (service.status === 'Entrega') {
    if (!service.quality || !service.review_reference) missing.push('Registrar a conferência técnica e sua referência');
    if (!service.delivery_url || !service.delivered_date) missing.push('Registrar a entrega e sua data');
  }
  return missing;
}
export function waitingLabel(record) {
  return record.waiting_reason ? `Aguardando terceiro: ${record.waiting_reason} · revisar ${record.waiting_until || 'sem data'}` : '';
}
export function nextReviewDate(record, originalDate) {
  return [originalDate, record.waiting_until].filter(Boolean).sort()[0] || null;
}
