import { randomUUID } from "node:crypto";
import { query, get, transaction, isPostgres } from "./db.mjs";
import { audit, fail } from "./domain.mjs";
import { flightReaders, flightEditors } from "./access.mjs";
import { validDay, zonedInstant, isManagement } from "./agenda.mjs";

import { flightStatuses, flightFileKinds, flightSources } from "./flight-model.mjs";
export { flightStatuses, flightFileKinds, flightSources } from "./flight-model.mjs";
const fields = ["name", "unit_id", "service_id", "owner_id", "pilot_name", "operator_name", "operator_code", "aircraft_model", "aircraft_registration", "location", "latitude", "longitude", "height_m", "operation_category", "operation_profile", "purpose", "start_date", "end_date", "start_time", "end_time", "protocol", "status", "document_timezone", "valid_from", "valid_to", "conditions", "evidence_file_id", "notes"];
export const unpackFlight = (row) => row ? { ...JSON.parse(row.data), id: row.id, version: row.version, created_at: row.created_at, updated_at: row.updated_at } : null;
export async function getFlight(user, id) {
  if (!flightReaders(user)) fail("Seu perfil não acessa autorizações de voo.", 403);
  return unpackFlight((await query("SELECT * FROM flight_authorizations WHERE id=$1", [id]))[0]);
}
export async function flightsFor(user) {
  if (!flightReaders(user)) fail("Seu perfil não acessa autorizações de voo.", 403);
  return {
    flights: (await query("SELECT * FROM flight_authorizations ORDER BY updated_at DESC")).map(unpackFlight),
    files: await query("SELECT id,flight_id,filename,content_type,size_bytes,kind,uploaded_by,created_at FROM flight_files ORDER BY created_at DESC"),
    sources: flightSources,
  };
}
function documentInstant(value, zone) {
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value || "") || !validDay(value.slice(0, 10))) fail("Confira as datas e horários da validade do documento.");
  return zone === "UTC" ? new Date(value + ":00Z").toISOString() : zonedInstant(value.slice(0, 10), value.slice(11));
}
export async function saveFlight(user, input, id, version) {
  if (!flightEditors(user)) fail("Somente Administração e Piloto de Drone alteram autorizações de voo.", 403);
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("Dados de voo inválidos.");
  if (id !== undefined && id !== null && (typeof id !== "string" || !id || id.length > 100)) fail("Identificador de voo inválido.");
  return transaction(async () => {
    if (id && isPostgres()) await query("SELECT id FROM flight_authorizations WHERE id=$1 FOR UPDATE", [id]);
    const old = id ? await getFlight(user, id) : null;
    if (id && !old) fail("Registro de voo não encontrado.", 404);
    const data = { status: "Em preparação", operation_category: "A verificar", document_timezone: "UTC", owner_id: user.id, ...old };
    for (const key of fields) if (input[key] !== undefined) {
      if ((input[key] !== null && typeof input[key] !== "string" && !(typeof input[key] === "number" && ["latitude", "longitude", "height_m"].includes(key))) || String(input[key] ?? "").length > 15000) fail("Campo inválido: " + key);
      data[key] = input[key] === "" ? null : input[key];
    }
    for (const key of ["id", "version", "created_at", "updated_at"]) delete data[key];
    if (typeof data.name !== "string" || !data.name.trim()) fail("Informe um título para a operação.");
    if (!flightStatuses.includes(data.status) || !["UTC", "America/Sao_Paulo"].includes(data.document_timezone)) fail("Situação ou fuso inválido.");
    if (!["A verificar", "Aberta", "Específica", "Certificada"].includes(data.operation_category)) fail("Categoria operacional inválida.");
    if (!isManagement(user) && data.owner_id !== (old?.owner_id || user.id)) fail("Somente a gestão pode atribuir outro responsável.", 403);
    const owner = (await query("SELECT id FROM users WHERE id=$1 AND active=1", [data.owner_id]))[0];
    if (!owner) fail("Selecione um responsável ativo.");
    if (data.unit_id && !(await get("units", data.unit_id))) fail("Unidade não encontrada.");
    if (data.service_id) {
      const service = await get("services", data.service_id);
      if (!service || service.unit_id !== data.unit_id) fail("O serviço deve pertencer à unidade selecionada.");
    }
    for (const [key, min, max] of [["latitude", -90, 90], ["longitude", -180, 180], ["height_m", 0, 30000]]) if (data[key] != null) {
      const number = Number(data[key]); if (!Number.isFinite(number) || number < min || number > max) fail("Confira o valor de " + key); data[key] = number;
    }
    if ((data.latitude == null) !== (data.longitude == null)) fail("Informe latitude e longitude juntas.");
    if (data.start_date || data.end_date || data.start_time || data.end_time) {
      if (![data.start_date, data.end_date].every(validDay) || ![data.start_time, data.end_time].every((value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || ""))) fail("Preencha o período planejado completo, em horário de São Paulo.");
      data.planned_start = zonedInstant(data.start_date, data.start_time); data.planned_end = zonedInstant(data.end_date, data.end_time);
      if (data.planned_end <= data.planned_start) fail("O fim planejado deve ser posterior ao início.");
    } else { data.planned_start = null; data.planned_end = null; }
    if (data.valid_from || data.valid_to) {
      data.authorization_start = documentInstant(data.valid_from, data.document_timezone); data.authorization_end = documentInstant(data.valid_to, data.document_timezone);
      if (data.authorization_end <= data.authorization_start) fail("Confira o período de validade da autorização.");
    } else { data.authorization_start = null; data.authorization_end = null; }
    const scope = ["unit_id", "service_id", "pilot_name", "operator_name", "operator_code", "aircraft_model", "aircraft_registration", "location", "latitude", "longitude", "height_m", "operation_category", "operation_profile", "purpose", "start_date", "end_date", "start_time", "end_time", "protocol", "document_timezone", "valid_from", "valid_to", "conditions", "evidence_file_id"];
    const changed = old && scope.some((key) => (data[key] ?? null) !== (old[key] ?? null));
    if (changed || data.status !== "Parecer favorável registrado") { data.verified_by = null; data.verified_at = null; }
    if (data.status === "Parecer favorável registrado") {
      if (!data.protocol || !data.pilot_name || !data.aircraft_registration || !data.aircraft_model || !data.operator_name || !data.location || !data.authorization_start || !data.planned_start || data.latitude == null || data.height_m == null) fail("Para registrar o parecer favorável, complete protocolo, piloto, operador, aeronave, local, coordenadas, altura e períodos.");
      const proof = (await query("SELECT id FROM flight_files WHERE id=$1 AND flight_id=$2 AND kind=$3", [data.evidence_file_id || "", id || "", "Autorização SARPAS"]))[0];
      if (!proof) fail("Anexe a autorização SARPAS original e selecione o arquivo comprobatório.");
      if (data.planned_start < data.authorization_start || data.planned_end > data.authorization_end) fail("O voo planejado está fora da validade registrada no documento.");
      if ((!old?.verified_at || changed || old.status !== data.status) && input.confirm_document !== true) fail("Confirme a conferência do documento original, área, horários, aeronave e condicionantes.");
      data.verified_by ||= user.id; data.verified_at ||= new Date().toISOString();
    }
    const recordId = id || randomUUID(), now = new Date().toISOString();
    if (old) {
      const rows = await query("UPDATE flight_authorizations SET data=$1,version=version+1,updated_at=$2 WHERE id=$3 AND version=$4 RETURNING id", [JSON.stringify(data), now, id, version]);
      if (!rows.length) fail("O registro mudou. Atualize antes de salvar.", 409);
    } else await query("INSERT INTO flight_authorizations(id,data,created_at,updated_at) VALUES($1,$2,$3,$3)", [recordId, JSON.stringify(data), now]);
    const record = await getFlight(user, recordId); await audit(user, "flight_authorizations", recordId, old ? "alteração" : "criação", old, record); return record;
  });
}
