export const timeZone = "America/Sao_Paulo";
export const activityCategories = ["Reunião", "Visita", "Trabalho em campo", "Processamento em escritório", "Férias", "Day-off", "Médico", "Locação de veículos", "Tarefa geral"];
export const activityAreas = ["Comercial", "Operação", "Escritório", "Financeiro"];
export const absenceCategories = ["Férias", "Day-off", "Médico"];
export const managementRoles = ["Administrador", "Administração", "Administrativo", "Aprovação comercial"];
export const isManagement = (user) => managementRoles.includes(user?.role);
export const isField = (user) => ["Campo", "Técnico", "Piloto de Drone", "Geo Processador"].includes(user?.role);
export const assignedTo = (record, user) => Boolean(user?.id && (record.owner_id === user.id || record.participant_ids?.includes(user.id)));
export const activityReadable = (record, user) => isManagement(user) || record.area !== "Financeiro" && (!isField(user) || assignedTo(record, user));
export function nextDay(day) {
  return new Date(Date.parse(day + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
}
export function validDay(day) {
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day + "T12:00:00Z").toISOString().slice(0, 10) === day;
}
// Uses IANA rules rather than the device's zone or a fixed UTC offset.
export function zonedInstant(day, time = "09:00") {
  const target = Date.parse(`${day}T${time}:00Z`);
  let instant = target;
  const formatter = new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let i = 0; i < 3; i++) {
    const wall = formatter.format(new Date(instant)).replace(" ", "T");
    instant += target - Date.parse(wall + "Z");
  }
  return new Date(instant).toISOString();
}
export function activityIntervals(record, from = "0001-01-01", to = "9999-12-31") {
  const start = record.start_date || record.due_date;
  const end = record.end_date || start;
  if (!start || end < from || start >= to || record.status === "Cancelada") return [];
  const allDay = !record.start_date || record.all_day === "Sim";
  const interval = (day, last) => ({
    start: allDay ? day : zonedInstant(day, record.start_time),
    end: allDay ? nextDay(last) : zonedInstant(last, record.end_time), allDay,
  });
  if (record.schedule_mode !== "Horário diário" || allDay) return [interval(start, end)];
  const result = [];
  for (let day = start < from ? from : start; day <= end && day < to; day = nextDay(day)) result.push(interval(day, day));
  return result;
}
export const blocksAvailability = (record) => record.category && !["Tarefa geral", "Locação de veículos"].includes(record.category) && !["Cancelada", "Concluída"].includes(record.status);
export function availabilityRecord(record) {
  if (!blocksAvailability(record)) return null;
  return { id: record.id, name: absenceCategories.includes(record.category) ? record.category : "Ocupado", category: absenceCategories.includes(record.category) ? record.category : null, owner_id: record.owner_id, participant_ids: record.participant_ids || [], start_date: record.start_date, end_date: record.end_date, start_time: record.start_time, end_time: record.end_time, all_day: record.all_day, schedule_mode: record.schedule_mode, availability_only: true };
}
export function safeActivity(record, user) {
  if (!activityReadable(record, user)) return availabilityRecord(record);
  if (absenceCategories.includes(record.category) && record.owner_id !== user.id && !isManagement(user)) return { ...record, name: record.category, notes: null, result: null };
  return record;
}
