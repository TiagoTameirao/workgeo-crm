import { randomUUID } from "node:crypto";
import { query, transaction } from "./db.mjs";
import { audit, fail } from "./domain.mjs";

const roles = ["Administrador", "Administração", "Administrativo", "Comercial", "Aprovação comercial"];
const channels = ["Telefone", "WhatsApp", "E-mail", "Pesquisa", "Indicação", "Outro"];
const results = ["Sem resposta", "Contato realizado", "Pessoa errada", "Dados inválidos", "Sem aderência", "Demanda potencial", "Solicitou material", "Outro"];
const text = (value, max) => String(value ?? "").trim().slice(0, max);

function requireAccess(user) {
  if (!user) fail("Entre para acessar o CRM.", 401);
  if (!roles.includes(user.role)) fail("Seu perfil não tem acesso às atividades de prospecção.", 403);
}

export async function listProspectingActivities(user, candidateId) {
  requireAccess(user);
  const id = text(candidateId, 80);
  if (!id) fail("Selecione uma empresa para consultar o histórico.");
  if (!(await query("SELECT id FROM prospecting_candidates WHERE id=$1", [id]))[0]) fail("Empresa não encontrada.", 404);
  return query("SELECT id,candidate_id,created_by,author_name,channel,result,notes,next_action,next_date,created_at FROM prospecting_activities WHERE candidate_id=$1 ORDER BY created_at DESC LIMIT 50", [id]);
}

export async function recordProspectingActivity(user, candidateId, input) {
  requireAccess(user);
  const id = text(candidateId, 80);
  const candidate = id ? (await query("SELECT id,converted_unit_id FROM prospecting_candidates WHERE id=$1", [id]))[0] : null;
  if (!candidate) fail("Empresa não encontrada.", 404);
  if (candidate.converted_unit_id) fail("Este Lead já foi convertido. Registre novas atividades na ficha do cliente.", 409);
  const channel = text(input?.channel, 30), result = text(input?.result, 40);
  const notes = text(input?.notes, 1500), next_action = text(input?.next_action, 240), next_date = text(input?.next_date, 10);
  if (!channels.includes(channel)) fail("Selecione um canal válido.");
  if (!results.includes(result)) fail("Selecione um resultado válido.");
  if (!next_action) fail("Descreva a próxima ação.");
  const date = new Date(`${next_date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next_date) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== next_date) fail("Informe uma data válida para a próxima ação.");
  const activity = { id: randomUUID(), candidate_id: id, created_by: user.id, author_name: user.name, channel, result, notes, next_action, next_date, created_at: new Date().toISOString() };
  await transaction(async () => {
    await query("INSERT INTO prospecting_activities(id,candidate_id,created_by,author_name,channel,result,notes,next_action,next_date,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [activity.id, activity.candidate_id, activity.created_by, activity.author_name, activity.channel, activity.result, activity.notes, activity.next_action, activity.next_date, activity.created_at]);
    await audit(user, "prospecting_activities", activity.id, "atividade registrada", null, activity);
  });
  return activity;
}
