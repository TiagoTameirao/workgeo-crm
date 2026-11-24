import { get, list, query } from "./db.mjs";
import { absenceCategories, activityAreas, activityCategories, assignedTo, isManagement, validDay, zonedInstant } from "./agenda.mjs";

const reject = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export async function validateAgenda(data, input, user, old) {
  const staff = await query("SELECT id,name,role,active FROM users");
  const active = staff.filter((person) => person.active === 1);
  for (const key of ["participant_ids", "mentioned_ids", "reminder_minutes"]) {
    if (input[key] !== undefined) {
      if (!Array.isArray(input[key]) || input[key].length > 50) reject("Lista inválida: " + key);
      data[key] = [...new Set(input[key])];
    } else data[key] = old?.[key] || [];
  }
  if (!isManagement(user)) {
    if (old && !assignedTo(old, user)) reject("Você só pode atualizar atividades atribuídas a você.", 403);
    if (!old) { data.owner_id = user.id; data.owner = user.name; }
    else if (data.owner_id !== old.owner_id) reject("Somente a gestão pode distribuir atividades.", 403);
    for (const key of ["participant_ids", "mentioned_ids"]) if (JSON.stringify(data[key]) !== JSON.stringify(old?.[key] || [])) reject("Somente a gestão pode adicionar participantes ou menções.", 403);
    if (old && old.owner_id !== user.id && ["name", "category", "area", "owner_id", "unit_id", "service_id", "opportunity_id", "due_date", "start_date", "end_date", "start_time", "end_time", "all_day", "schedule_mode", "channel", "participant_ids", "mentioned_ids", "reminder_minutes"].some((key) => input[key] !== undefined && JSON.stringify(input[key] ?? null) !== JSON.stringify(old[key] ?? null))) reject("Atualize apenas situação, resultado e observações da atividade recebida.", 403);
    if (old && absenceCategories.includes(old.category) && old.owner_id !== user.id && (data.notes !== old.notes || data.result !== old.result)) reject("Observações pessoais são restritas ao titular e à gestão.", 403);
    if (data.area === "Financeiro") reject("Área financeira restrita à gestão.", 403);
  }
  if (data.owner_id) {
    const owner = active.find((person) => person.id === data.owner_id);
    if (!owner && data.owner_id !== old?.owner_id) reject("Escolha um responsável ativo.");
    data.owner = owner?.name || old?.owner;
  } else if (!old || input.owner_id !== undefined) reject("Selecione o responsável pela atividade.");
  for (const key of ["participant_ids", "mentioned_ids"]) {
    if (data[key].some((id) => typeof id !== "string" || !active.some((person) => person.id === id) && !old?.[key]?.includes(id))) reject("Selecione pessoas cadastradas e ativas.");
  }
  if (data.area === "Financeiro" && [data.owner_id, ...data.participant_ids].some((id) => !isManagement(staff.find((person) => person.id === id)))) reject("Atividades financeiras só podem ser atribuídas à gestão.");
  if (data.category && !activityCategories.includes(data.category)) reject("Categoria inválida.");
  if (data.area && !activityAreas.includes(data.area)) reject("Área inválida.");
  if (data.start_date) {
    data.end_date ||= data.start_date;
    if (!validDay(data.start_date) || !validDay(data.end_date) || data.end_date < data.start_date) reject("Confira o início e o fim do período.");
    if (Date.parse(data.end_date) - Date.parse(data.start_date) > 366 * 86400000) reject("Use períodos de até um ano.");
    if (data.all_day !== "Sim") {
      if (![data.start_time, data.end_time].every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time || ""))) reject("Informe os dois horários.");
      if ((data.schedule_mode === "Horário diário" || data.start_date === data.end_date) && data.end_time <= data.start_time) reject("O término deve ser posterior ao início.");
      if (zonedInstant(data.end_date, data.end_time) <= zonedInstant(data.start_date, data.start_time)) reject("Intervalo de horário inválido.");
    }
    data.due_date = data.start_date;
  } else { data.end_date = null; data.start_time = null; data.end_time = null; }
  if (data.reminder_minutes.some((minutes) => !Number.isInteger(minutes) || minutes < 1 || minutes > 43200)) reject("Lembretes: informe minutos entre 1 e 43200.");
  if (data.reminder_minutes.length && !data.start_date) reject("Defina o início antes de incluir lembretes.");
  return data;
}

export async function validateContactHierarchy(data, old) {
  if (old && data.unit_id !== old.unit_id) {
    const company = (await get("units", data.unit_id))?.company_id;
    for (const child of (await list("contacts")).filter((person) => person.superior_id === old.id)) {
      if ((await get("units", child.unit_id))?.company_id !== company) reject("Remova os vínculos de subordinados antes de mudar o contato para outra empresa.");
    }
  }
  if (!data.superior_id) return;
  const unit = await get("units", data.unit_id);
  const seen = new Set(old ? [old.id] : []);
  let id = data.superior_id;
  while (id) {
    if (seen.has(id)) reject("A hierarquia não pode conter ciclos ou o próprio contato.");
    seen.add(id);
    const parent = await get("contacts", id);
    if (!parent || (await get("units", parent.unit_id))?.company_id !== unit?.company_id) reject("O superior precisa ser da mesma empresa.");
    id = parent.superior_id;
  }
}

export async function migrateOwners() {
  const normalize = (name) => String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  const users = await query("SELECT id,name FROM users WHERE active=1");
  const { entityKeys, models } = await import("./model.mjs");
  for (const entity of entityKeys.filter((entity) => models[entity].fields.some((field) => field.key === "owner"))) {
    for (const record of await list(entity)) {
      if (record.owner_id || !record.owner) continue;
      const matches = users.filter((person) => normalize(person.name) === normalize(record.owner));
      if (matches.length !== 1) continue;
      const { id, version, created_at, updated_at, ...data } = record;
      data.owner_id = matches[0].id;
      await query(`UPDATE ${entity} SET data=$1 WHERE id=$2`, [JSON.stringify(data), id]);
    }
  }
}
