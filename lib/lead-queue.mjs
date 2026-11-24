export function getLeadQueueSignal(lead, today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" })) {
  if (lead.last_activity_result === "Solicitou material") return "Solicitou material";
  if (lead.last_activity_result === "Demanda potencial") return "Demanda potencial";
  if (lead.next_date && lead.next_date <= today) return "Retorno vencido";
  if (lead.qualification_status === "Perfil-alvo confirmado") return "Perfil confirmado";
  return lead.last_activity_result || "Sem contato registrado";
}
