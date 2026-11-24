"use client";
import { useState, useMemo, useCallback } from "react";
import FullCalendar from "@fullcalendar/react";
import themePlugin from "@fullcalendar/react/themes/monarch";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import listPlugin from "@fullcalendar/react/list";
import ptLocale from "@fullcalendar/react/locales/pt-br";
import "temporal-polyfill/global";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/monarch/theme.css";
import "@fullcalendar/react/themes/monarch/palettes/green.css";
import { activityCategories, activityAreas, activityIntervals } from "../../lib/agenda.mjs";
const plugins = [themePlugin, dayGridPlugin, timeGridPlugin, listPlugin];
const locales = [ptLocale];
const toolbar = { start: "prev,next today", center: "title", end: "dayGridMonth,timeGridWeek,listWeek" };

export default function AgendaDesk({ data, user, directory, onOpen, tasksOnly = false }) {
  const [scope, setScope] = useState("mine"), [person, setPerson] = useState(""), [category, setCategory] = useState(""), [area, setArea] = useState(""), [status, setStatus] = useState(""), [search, setSearch] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [mode, setMode] = useState(tasksOnly ? "tasks" : "calendar");
  const [range, setRange] = useState(null);
  const updateRange = useCallback((info) => setRange((previous) => { const from = info.startStr.slice(0, 10), to = info.endStr.slice(0, 10); return previous?.from === from && previous?.to === to ? previous : { from, to }; }), []);
  const filtered = useMemo(() => (data.activities || []).filter((record) =>
    (!tasksOnly || !record.availability_only && ["Escritório", "Financeiro"].includes(record.area)) &&
    (scope === "team" || scope === "mine" && record.owner_id === user.id || scope === "participation" && record.participant_ids?.includes(user.id)) &&
    (!person || record.owner_id === person || record.participant_ids?.includes(person)) && (!category || record.category === category) && (!area || record.area === area) && (!status || record.status === status) && (!search || record.name?.toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR"))) &&
    (!from || (record.end_date || record.start_date || record.due_date || "") >= from) && (!to || (record.start_date || record.due_date || "9999") <= to)), [data.activities, tasksOnly, scope, person, category, area, status, search, from, to, user.id]);
  const events = useMemo(() => filtered.flatMap((record) => activityIntervals(record, range?.from, range?.to).map((interval, index) => ({ id: record.id + ":" + index, title: record.name, ...interval, backgroundColor: record.availability_only ? "#64748b" : record.category === "Tarefa geral" ? "#be751d" : "#287760", extendedProps: { record } }))), [filtered, range]);
  const openEvent = useCallback((info) => { const record = info.event.extendedProps.record; if (!record.availability_only) onOpen("activities", record); }, [onOpen]);
  const choices = (label, value, setter, items) => <label>{label}<select value={value} onChange={(event) => setter(event.target.value)}><option value="">Todos</option>{items.map((item) => <option key={item.id || item} value={item.id || item}>{item.name || item}</option>)}</select></label>;
  return <section className="agenda-desk panel">
    <div className="agenda-tabs"><div role="group" aria-label="Visibilidade da agenda">{[["mine", "Minhas atividades"], ["participation", "Minha participação"], ["team", "Equipe"]].map(([key, label]) => <button key={key} aria-pressed={scope === key} onClick={() => setScope(key)}>{label}</button>)}</div><button className="primary" onClick={() => onOpen("activities", {}, { area: tasksOnly ? "Escritório" : "Operação" })}>Nova {tasksOnly ? "tarefa" : "atividade"}</button></div>
    <details className="agenda-filters"><summary>Buscar e filtrar</summary><div className="form-fields"><label>Buscar título<input value={search} onChange={(event) => setSearch(event.target.value)} /></label>{choices("Pessoa", person, setPerson, directory)}{choices("Categoria", category, setCategory, activityCategories)}{choices("Área", area, setArea, activityAreas)}{choices("Situação", status, setStatus, ["Pendente", "Em andamento", "Concluída", "Cancelada"])}<label>Desde<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Até<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label></div></details>
    {!tasksOnly && <div className="agenda-tabs"><button aria-pressed={mode === "calendar"} onClick={() => setMode("calendar")}>Calendário</button><button aria-pressed={mode === "tasks"} onClick={() => setMode("tasks")}>Tarefas e prazos</button><small>Horário de São Paulo · dias finais inclusivos</small></div>}
    {mode === "calendar" ? <FullCalendar plugins={plugins} locales={locales} locale="pt-br" timeZone="America/Sao_Paulo" initialView={typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches ? "listWeek" : "dayGridMonth"} headerToolbar={toolbar} height="auto" events={events} datesSet={updateRange} eventClick={openEvent} /> : <div className="agenda-task-list">{filtered.filter((record) => !record.availability_only).sort((a, b) => (a.start_date || a.due_date || "9999").localeCompare(b.start_date || b.due_date || "9999")).map((record) => <button key={record.id} className="record-line" onClick={() => onOpen("activities", record)}><div><strong>{record.name}</strong><small>{record.area || "Atividade anterior"} · {record.category || record.channel || "Sem categoria"}</small><small>{directory.find((person) => person.id === record.owner_id)?.name || record.owner || "Responsável a revisar"}</small></div><div><span>{record.status}</span><small>{record.start_date || record.due_date || "Sem prazo"}{record.start_time ? " · " + record.start_time : ""}</small></div></button>)}{!filtered.some((record) => !record.availability_only) && <p className="admin-empty">Nenhuma atividade nesta seleção. Experimente a visão Equipe ou adicione uma atividade.</p>}</div>}
    {filtered.some((record) => !record.start_date && !record.due_date) && mode === "calendar" && <p className="form-hint">Há tarefas sem data. Consulte “Tarefas e prazos”.</p>}
  </section>;
}
