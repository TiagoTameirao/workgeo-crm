import {nextReviewDate} from './operation-flow.mjs';
const rows = (data, key) => (Array.isArray(data[key]) ? data[key] : []);

export function actionDateStatus(item, currentDate) {
  const dueDate = item.due_date || item.next_date;
  if (!dueDate) return "Sem data";
  if (dueDate < currentDate) return "Vencida";
  if (dueDate === currentDate) return "Hoje";
  return "Agendada";
}

export function filterActionQueueByOwner(items, owner) {
  if (!owner) return items;
  if (owner === "__unassigned") return items.filter((item) => !item.owner);
  return items.filter((item) => item.owner === owner);
}

export function buildActionQueue(data = {}) {
  return [
    ...rows(data, "activities")
      .filter((item) => ["Pendente", "Em andamento"].includes(item.status) && !item.availability_only)
      .map((item) => ({ ...item, kind: "Atividade", entity: "activities" })),
    ...rows(data, "requests")
      .filter((item) => item.status !== "Concluída")
      .map((item) => ({ ...item, kind: "Pedido de material", entity: "requests" })),
    ...rows(data, "units")
      .filter((item) => item.next_action || item.waiting_reason)
      .map((item) => ({
        ...item,
        name: item.next_action || 'Revisar espera pelo cliente',
        due_date: item.next_date,
        kind: "Prospecção",
        entity: "units",
      })),
    ...rows(data, "lead_followups").map((item) => ({ ...item, kind: "Retorno de lead", entity: "lead_followups" })),
    ...rows(data, "opportunities")
      .filter((item) => !["Ganha", "Perdida"].includes(item.status))
      .map((item) => ({
        ...item,
        name: item.next_action || item.name,
        due_date: item.next_date,
        kind: "Oportunidade",
        entity: "opportunities",
      })),
    ...rows(data, "conversations")
      .filter((item) => item.status === "Aguardando equipe")
      .map((item) => ({
        ...item,
        name: item.next_action || item.name,
        due_date: item.next_date,
        kind: "Responder cliente",
        entity: "conversations",
      })),
    ...rows(data, "renewals")
      .filter((item) => item.status !== "Concluído")
      .map((item) => ({ ...item, kind: "Pós-venda", entity: "renewals" })),
  ].map(item=>({...item,due_date:nextReviewDate(item,item.due_date||item.next_date)})).sort((a, b) =>
    (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31"),
  );
}
