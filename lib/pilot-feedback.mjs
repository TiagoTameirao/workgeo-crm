import { isManagement } from "./agenda.mjs";
import { randomUUID } from "node:crypto";
import { query, transaction } from "./db.mjs";
import { audit, fail } from "./domain.mjs";

export const feedbackScreens = [
  "dashboard", "units", "opportunities", "activities", "conversations",
  "materials", "proposals", "renewals", "map", "settings", "administrative",
  "prospects", "leads", "services", "flights", "team", "profile", "companies", "contacts",
];
const categories = ["Erro", "Dificuldade", "Sugestão", "Dúvida"];
const impacts = ["Impede meu trabalho", "Atrapalha", "Melhoria"];
const statuses = ["Novo", "Em análise", "Resolvido"];
function text(value, min, max, label) {
  if (typeof value !== "string") fail(`${label} inválido.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max)
    fail(`${label} deve ter entre ${min} e ${max} caracteres.`);
  return normalized;
}
export function validateFeedback(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("Dados do relato inválidos.");
  if (!feedbackScreens.includes(input.screen)) fail("Tela inválida.");
  if (!categories.includes(input.category)) fail("Categoria inválida.");
  if (!impacts.includes(input.impact)) fail("Impacto inválido.");
  let measurement=null;
  if(input.measurement_kind){
    if(!['Mensagem','Documentos','Passagem entre equipes','Autorização'].includes(input.measurement_kind)||!['Referência','Após melhoria'].includes(input.measurement_phase)||!['Modelo atual','Modelo contextual','IA','Não se aplica'].includes(input.measurement_variant))fail('Classificação da medição inválida.');
    const minutes=Number(input.measurement_minutes);
    if(!Number.isFinite(minutes)||minutes<=0||minutes>480)fail('Informe um tempo maior que zero e até 480 minutos.');
    measurement={kind:input.measurement_kind,phase:input.measurement_phase,variant:input.measurement_variant,minutes};
  }
  return {
    ...(measurement?{measurement}:{}),
    screen: input.screen,
    category: input.category,
    impact: input.impact,
    title: text(input.title, 5, 120, "O título"),
    description: text(input.description, 15, 3000, "A descrição"),
  };
}
export async function createFeedback(user, input) {
  const data = validateFeedback(input), id = randomUUID(), now = new Date().toISOString();
  await transaction(async () => {
    await query(
      "INSERT INTO pilot_feedback(id,user_id,screen,category,impact,title,description,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'Novo',$8,$8)",
      [id, user.id, data.screen, data.category, data.impact, data.title, data.description, now],
    );
    await audit(user, "pilot_feedback", id, "relato criado", null, data);
    if(data.measurement)await query('INSERT INTO settings(id,data) VALUES($1,$2)',['pilot-measurement:'+id,JSON.stringify(data.measurement)]);
  });
  return { id, status: "Novo", created_at: now };
}
export async function listFeedback(user) {
  if (!isManagement(user)) fail("Acesso reservado ao administrador.", 403);
  return (await query(
    "SELECT f.id,f.screen,f.category,f.impact,f.title,f.description,f.status,f.created_at,f.updated_at,u.name AS reporter,m.data AS measurement FROM pilot_feedback f JOIN users u ON u.id=f.user_id LEFT JOIN settings m ON m.id='pilot-measurement:'||f.id ORDER BY CASE f.status WHEN 'Novo' THEN 0 WHEN 'Em análise' THEN 1 ELSE 2 END,f.created_at DESC LIMIT 200",
  )).map(row=>({...row,measurement:row.measurement?JSON.parse(row.measurement):null}));
}
export async function updateFeedbackStatus(user, input) {
  if (!isManagement(user)) fail("Acesso reservado ao administrador.", 403);
  if (!input || typeof input.id !== "string" || input.id.length > 80)
    fail("Relato inválido.");
  if (!statuses.includes(input.status)) fail("Situação inválida.");
  return transaction(async () => {
    const before = (await query("SELECT id,status FROM pilot_feedback WHERE id=$1", [input.id]))[0];
    if (!before) fail("Relato não encontrado.", 404);
    const updated = { ...before, status: input.status };
    if (before.status !== input.status) {
      const now = new Date().toISOString();
      await query("UPDATE pilot_feedback SET status=$1,updated_at=$2 WHERE id=$3", [input.status, now, input.id]);
      updated.updated_at = now;
      await audit(user, "pilot_feedback", input.id, "situação alterada", before, updated);
    }
    return updated;
  });
}
