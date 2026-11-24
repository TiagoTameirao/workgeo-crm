export const checklistResults = ['Pendente', 'Conferido', 'Divergência', 'Não se aplica'];
export const rejectionCategories = ['Competência', 'Cadastro', 'Documento faltante', 'Legibilidade', 'Validade', 'Assinatura exigida', 'Outro'];
const contextKeys = ['url', 'document_file_ids', 'competence', 'gerdau_contract', 'gerdau_unit', 'unit_id', 'service_id', 'revision'];
export const checklistContext = document => JSON.stringify(contextKeys.map(key => document[key] ?? null));
export const resetChecklist = checklist => checklist ? {...checklist, reviewed_by:null, reviewed_name:null, reviewed_at:null, context:null, items:checklist.items.map(item => ({...item, result:'Pendente', justification:''}))} : null;
export function checklistComplete(checklist) {
  return Boolean(checklist?.items?.length) && !checklist.items.some(item => item.result === 'Divergência' || item.required && !['Conferido', 'Não se aplica'].includes(item.result) || item.result === 'Não se aplica' && !item.justification?.trim());
}
export function validateChecklist(input, document, old, user, now = new Date().toISOString()) {
  if (input == null) {
    if (old?.document_checklist?.items?.length) throw new Error('Preserve os itens da conferência existente.');
    return null;
  }
  if (typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.items) || input.items.length > 60) throw new Error('Checklist inválido: use até 60 itens.');
  const text = (value, limit) => { if (typeof value !== 'string' || value.length > limit) throw new Error('Texto inválido na conferência.'); return value.trim(); };
  const result = { source:text(input.source || '', 1000), source_version:text(input.source_version || '', 120), items: input.items.map((item, index) => {
    if (!item || typeof item.required !== 'boolean' || !checklistResults.includes(item.result)) throw new Error('Item de conferência inválido.');
    const label = text(item.label, 500), justification = text(item.justification || '', 1000);
    if (!label) throw new Error('Descreva cada item de conferência.');
    if (item.result === 'Não se aplica' && !justification) throw new Error('Justifique o item que não se aplica.');
    return { id:String(index + 1), label, required:item.required, result:item.result, justification };
  }) };
  if (old?.document_checklist?.items?.length && !result.items.length) throw new Error('Preserve os itens da conferência existente.');
  if (result.items.length && (!result.source || !result.source_version)) throw new Error('Informe a fonte e a versão das instruções conferidas.');
  const instructions = value => JSON.stringify([value?.source, value?.source_version, value?.items?.map(({label,required}) => ({label,required}))]);
  const changed = old && (checklistContext(document) !== checklistContext(old) || instructions(result) !== instructions(old.document_checklist));
  const previouslyFrozen = old && ['Enviado','Devolvido','Concluído','Substituído'].includes(old.status);
  if (previouslyFrozen && JSON.stringify(result) !== JSON.stringify(old.document_checklist ? { source:old.document_checklist.source, source_version:old.document_checklist.source_version, items:old.document_checklist.items } : result)) throw new Error('Preserve a conferência do documento enviado; use uma nova versão.');
  if (changed) return resetChecklist(result);
  if (!checklistComplete(result)) return {...result, reviewed_by:null, reviewed_name:null, reviewed_at:null, context:null};
  const same = JSON.stringify(result.items) === JSON.stringify(old?.document_checklist?.items) && old?.document_checklist?.context === checklistContext(document);
  return {...result, reviewed_by:same ? old.document_checklist.reviewed_by : user.id, reviewed_name:same ? old.document_checklist.reviewed_name : user.name, reviewed_at:same ? old.document_checklist.reviewed_at : now, context:checklistContext(document)};
}
