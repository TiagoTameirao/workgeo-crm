"use client";
import { activityCategories, activityAreas, isManagement } from "../../lib/agenda.mjs";

export default function ActivityFields({ values, setValues, user, directory, data, editing }) {
  const change = (key, value) => setValues({ ...values, [key]: value, ...(key === "category" ? { reminder_minutes: values.start_date && ["Reunião", "Visita", "Trabalho em campo"].includes(value) ? [1440, 60] : [] } : {}) });
  const management = isManagement(user), received = editing && values.owner_id !== user.id && !management;
  const selection = (key, label, choices, required = false, disabled = received) => <label key={key}>{label}<select aria-label={label} required={required} disabled={disabled} value={values[key] || ""} onChange={(event) => change(key, event.target.value)}><option value="">Selecione</option>{choices.map((item) => <option key={item.id || item} value={item.id || item}>{item.name || item}</option>)}</select></label>;
  const input = (key, label, type = "text", required = false) => <label key={key}>{label}<input aria-label={label} type={type} required={required} disabled={received} value={values[key] || ""} onChange={(event) => change(key, event.target.value)} /></label>;
  const people = (key, label) => <fieldset className="wide agenda-people"><legend>{label}</legend>{management ? directory.map((person) => <label key={person.id}><input type="checkbox" checked={(values[key] || []).includes(person.id)} onChange={(event) => change(key, event.target.checked ? [...(values[key] || []), person.id] : values[key].filter((id) => id !== person.id))} />{person.name}</label>) : <p>{(values[key] || []).map((id) => directory.find((person) => person.id === id)?.name || "Acesso inativo").join(", ") || "Nenhum"}</p>}</fieldset>;
  return <>
    {input("name", "Título", "text", true)}
    {selection("category", "Categoria", activityCategories, true)}
    {selection("area", "Área", management ? activityAreas : activityAreas.filter((area) => area !== "Financeiro"), true)}
    {selection("owner_id", "Responsável", directory, true, !management)}
    {!values.owner_id && editing && <p className="wide form-hint">Responsável antigo: {values.owner || "não informado"}. A gestão deve associar uma conta para revisar esta atividade.</p>}
    {selection("status", "Situação", ["Pendente", "Em andamento", "Concluída", "Cancelada"], true, false)}
    <label>Datas<select aria-label="Datas" disabled={received} value={values.start_date ? "Período" : "Prazo"} onChange={(event) => setValues({ ...values, start_date: event.target.value === "Período" ? values.due_date || new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()) : "", end_date: "", reminder_minutes: event.target.value === "Período" && ["Reunião", "Visita", "Trabalho em campo"].includes(values.category) ? [1440, 60] : [] })}><option value="Prazo">Somente prazo / sem data</option><option value="Período">Compromisso com início e fim</option></select></label>
    {values.start_date ? <>
      {input("start_date", "Data inicial", "date", true)}{input("end_date", "Data final (inclusive)", "date")}
      {selection("all_day", "Dia inteiro", ["Sim", "Não"], true)}
      {values.all_day !== "Sim" && <>{selection("schedule_mode", "Formato do período", ["Contínuo", "Horário diário"], true)}{input("start_time", "Das (São Paulo)", "time", true)}{input("end_time", "Até (São Paulo)", "time", true)}</>}
      <label className="wide">Lembretes prévios (minutos, separados por vírgula)<input disabled={received} value={(values.reminder_minutes || []).join(", ")} placeholder="1440, 60 — deixe vazio para desativar" onChange={(event) => change("reminder_minutes", event.target.value.trim() ? event.target.value.split(",").map((value) => Number(value.trim())) : [])} /><small>1440 = 1 dia · 60 = 1 hora. Em períodos de vários dias, considera o primeiro início.</small></label>
    </> : input("due_date", "Prazo opcional", "date")}
    {people("participant_ids", "Participantes")}{people("mentioned_ids", "Mencionar / avisar (não concede acesso)")}
    <details className="wide"><summary>Cliente, serviço e contexto (opcionais)</summary><div className="form-fields">
      {selection("unit_id", "Cliente / unidade", data.units || [])}
      {selection("service_id", "Serviço", (data.services || []).filter((record) => !values.unit_id || record.unit_id === values.unit_id))}
      {selection("opportunity_id", "Oportunidade", (data.opportunities || []).filter((record) => !values.unit_id || record.unit_id === values.unit_id))}
    </div></details>
    <label className="wide">Resultado{values.status === "Concluída" ? " (obrigatório)" : ""}<textarea required={values.status === "Concluída"} value={values.result || ""} onChange={(event) => change("result", event.target.value)} /></label>
    <label className="wide">Observações{["Férias", "Day-off", "Médico"].includes(values.category) && " (somente titular e gestão)"}<textarea value={values.notes || ""} onChange={(event) => change("notes", event.target.value)} /></label>
  </>;
}
