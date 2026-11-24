"use client";
import { useState } from "react";

const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
const blankClient = { company_name: "", name: "", cnpj: "", city: "", contact_name: "", email: "", phone: "" };

export default function AdministrativeCatalog({ data, catalog, busy, onRun, onAction, onOpen }) {
  const [area, setArea] = useState("Empresas"), [search, setSearch] = useState(""), [existingId, setExistingId] = useState(""), [serviceName, setServiceName] = useState("");
  const [creating, setCreating] = useState(false), [draft, setDraft] = useState(blankClient);
  const company = (unit) => data.companies.find((item) => item.id === unit.company_id)?.name || "";
  const matches = (unit) => !search || normalize([unit.name, company(unit), unit.city].join(" ")).includes(normalize(search));
  const active = (unit) => catalog.client_ids.includes(unit.id);
  const clients = data.units.filter(active).filter(matches);
  const candidates = data.units.filter((unit) => !active(unit)).filter(matches);
  function field(key, label, type = "text", required = false) {
    return <label>{label}<input type={type} maxLength={200} required={required} disabled={busy} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>;
  }
  return <div className="admin-catalog">
    <div className="admin-message-actions" role="group" aria-label="Catálogos disponíveis">{["Empresas", "Serviços"].map((name) => <button key={name} aria-pressed={area === name} onClick={() => { setArea(name); setSearch(""); }}>{name}</button>)}</div>
    {area === "Empresas" ? <>
      <p className="admin-help">Inclua somente empresas/unidades com as quais a WorkGeo já presta serviços. A lista comercial não é incluída automaticamente. Retirar das opções preserva lançamentos e histórico.</p>
      <label className="admin-catalog-search">Buscar empresa ou cidade<input value={search} onChange={(event) => { setSearch(event.target.value); setExistingId(""); }} placeholder="Nome, empresa ou cidade" /></label>
      <div className="admin-list">{clients.map((unit) => <div className="admin-receipt-row" key={unit.id}><div><strong>{unit.name}</strong><small>{[company(unit) !== unit.name && company(unit), unit.city].filter(Boolean).join(" · ") || "Disponível no administrativo"}</small></div><button disabled={busy} onClick={() => onRun(async () => { if (window.confirm(`Retirar ${unit.name} das opções de novos lançamentos? O histórico será preservado.`)) await onAction({ action: "remove-client", unit_id: unit.id }); })}>Retirar das opções</button></div>)}{!clients.length && <div className="admin-empty"><strong>{search ? "Nenhuma empresa incluída corresponde à busca." : "Nenhuma empresa incluída no administrativo."}</strong><p>Inclua um cadastro existente ou cadastre uma empresa atendida abaixo.</p></div>}</div>
      <form className="admin-catalog-form" onSubmit={(event) => { event.preventDefault(); onRun(async () => { await onAction({ action: "add-client", unit_id: existingId }); setExistingId(""); }); }}>
        <h3>Incluir cadastro existente</h3><p className="admin-help">Use a busca para localizar. A inclusão confirma que a empresa poderá ser usada na rotina administrativa.</p>
        <div className="admin-form-grid"><label>Empresa / unidade existente<select value={existingId} required disabled={busy} onChange={(event) => setExistingId(event.target.value)}><option value="">Selecione</option>{candidates.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.city ? ` · ${unit.city}` : ""}</option>)}</select></label><button className="primary" disabled={busy || !existingId}>Incluir no administrativo</button></div>
      </form>
      <button type="button" disabled={busy} onClick={() => setCreating(!creating)}>{creating ? "Fechar novo cadastro" : "Cadastrar empresa atendida"}</button>
      {creating && <form className="admin-catalog-form" onSubmit={(event) => { event.preventDefault(); onRun(async () => { await onAction({ action: "create-client", ...draft }); setDraft(blankClient); setCreating(false); setSearch(""); }); }}>
        <h3>Nova empresa atendida</h3><div className="admin-form-grid">{field("company_name", "Nome da empresa *", "text", true)}{field("name", "Unidade / local (se diferente)")}{field("cnpj", "CNPJ (opcional)")}{field("city", "Cidade")}</div>
        <details className="admin-explanation"><summary>Contato administrativo (opcional)</summary><div className="admin-form-grid">{field("contact_name", "Nome do contato")}{field("email", "E-mail", "email")}{field("phone", "Telefone com DDD", "tel")}</div></details>
        <button className="primary" disabled={busy}>Cadastrar e incluir no administrativo</button>
      </form>}
    </> : <>
      <p className="admin-help">Modalidades são os tipos de serviço oferecidos. Cada serviço executado é registrado para uma empresa, com sua própria referência e escopo.</p>
      <form className="admin-catalog-form" onSubmit={(event) => { event.preventDefault(); onRun(async () => { await onAction({ action: "add-service-type", name: serviceName }); setServiceName(""); }); }}><h3>Modalidades de serviço</h3><div className="admin-form-grid"><label>Nova modalidade<input required maxLength={100} value={serviceName} disabled={busy} onChange={(event) => setServiceName(event.target.value)} placeholder="Ex.: Inventário" /></label><button className="primary" disabled={busy || !serviceName.trim()}>Adicionar modalidade</button></div></form>
      <div className="admin-list">{catalog.service_types.map((type) => <div className="admin-receipt-row" key={type.id}><div><strong>{type.name}</strong><small>{type.active ? "Disponível para novos serviços" : "Retirada das opções; histórico preservado"}</small></div><button disabled={busy} onClick={() => onRun(() => onAction({ action: "set-service-type", id: type.id, active: !type.active }))}>{type.active ? "Retirar modalidade" : "Reativar modalidade"}</button></div>)}</div>
      <h3>Serviços por empresa</h3><button disabled={busy || !catalog.client_ids.length || !catalog.service_types.some((item) => item.active)} onClick={() => onOpen("services", {}, { owner: "Josi" })}>Cadastrar serviço para uma empresa</button>
      {(!catalog.client_ids.length || !catalog.service_types.some((item) => item.active)) && <p className="admin-help">Inclua uma empresa e uma modalidade para cadastrar o serviço.</p>}
      <div className="admin-list">{data.services.map((service) => <div className="admin-receipt-row" key={service.id}><div><strong>{service.name}</strong><small>{data.units.find((unit) => unit.id === service.unit_id)?.name} · {service.modality || "Modalidade não informada"} · {service.administrative_hidden ? "Retirado das opções" : "Disponível"}</small></div><div><button disabled={busy} onClick={() => onOpen("services", service)}>Editar serviço</button><button disabled={busy} onClick={() => onRun(() => onAction({ action: "set-service", id: service.id, active: Boolean(service.administrative_hidden) }))}>{service.administrative_hidden ? "Reativar serviço" : "Retirar serviço das opções"}</button></div></div>)}{!data.services.length && <div className="admin-empty">Nenhum serviço por empresa cadastrado.</div>}</div>
    </>}
  </div>;
}
