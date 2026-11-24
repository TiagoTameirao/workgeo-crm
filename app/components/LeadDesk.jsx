"use client";
import { requestJson, readJsonResponse } from "../../lib/client-http.mjs";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { phoneLink, whatsappLink } from "../../lib/contact-links.mjs";
import cnaeScope from "../../data/prospecting-territory/cnae-scope.json";
import regionCatalog from "../../data/prospecting-regions/region-centers.json";

const load = requestJson;
const count = (value) => Number(value || 0).toLocaleString("pt-BR");
const tierLabel = { alta: "Alta aderência presumida", validar: "Em validação", baixa: "Baixa aderência presumida" };

export default function LeadDesk({ onOpenProspect, onOpenClient, focusCnpj = "" }) {
  const [filters, setFilters] = useState({ fit: "qualificados", region: "belo-horizonte-170km", tier: "", ultrafine: "", qualification: "", q: "", municipality: "", uf: "", locationSituation: "", segment: "", category: "", size: "", cnaePrimary: "", materialPotential: "", operatingSize: "", materialsFit: "" });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ rows: [], total: 0, pages: 0, summary: {} });
  const summaryCache = useRef(null);
  const [performance, setPerformance] = useState(null), [performanceReload, setPerformanceReload] = useState(0), [performanceOpen, setPerformanceOpen] = useState(false);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [hasLoaded, setHasLoaded] = useState(false);
  const [editing, setEditing] = useState(null), [saving, setSaving] = useState(false), [reload, setReload] = useState(0);
  const [activityLead, setActivityLead] = useState(null), [activityHistory, setActivityHistory] = useState([]), [activityForm, setActivityForm] = useState(null), [activitySaving, setActivitySaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true); setHasLoaded(false); setError("");
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ ...filters, page: String(page), view: "leads", summary: summaryCache.current ? "0" : "1" });
        const data = await load(`/api/prospects?${params}`, { signal: controller.signal });
        if (!cancelled) {
          if (data.summary) summaryCache.current = data.summary;
          setResult({ ...data, summary: summaryCache.current || {} }); setHasLoaded(true);
        }
      } catch (e) { if (!cancelled) setError(e.message); }
      finally { if (!cancelled) setLoading(false); }
    }, 200);
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [filters, page, reload]);
  useEffect(() => {
    if (!performanceOpen) return undefined;
    let cancelled = false;
    load("/api/prospects?view=lead-performance").then((data) => { if (!cancelled) setPerformance(data); }).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [performanceReload, performanceOpen]);
  useEffect(() => {
    if (focusCnpj) {
      setFilters((current) => ({ ...current, fit: "todos", tier: "", ultrafine: "", qualification: "", municipality: "", segment: "", category: "", size: "", cnaePrimary: "", materialPotential: "", operatingSize: "", materialsFit: "", q: focusCnpj }));
      setPage(1);
    }
  }, [focusCnpj]);
  function update(key, value) { setFilters((current) => ({ ...current, [key]: value, ...(["tier", "qualification", "ultrafine"].includes(key) && value ? { fit: "todos" } : {}) })); setPage(1); }
  async function saveQualification(event) {
    event.preventDefault(); if (!editing) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/prospects/${encodeURIComponent(editing.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing) });
      const body = await readJsonResponse(response);
      if (!response.ok) throw new Error(body.error || "Não foi possível salvar a qualificação.");
      summaryCache.current = null;
      setEditing(null); setReload((value) => value + 1);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  }
  async function openActivity(lead) {
    setActivityLead(lead); setActivityForm({ channel: "Telefone", result: "Sem resposta", notes: "", next_action: "", next_date: "" }); setActivityHistory([]); setError("");
    try { setActivityHistory(await load(`/api/prospects?view=lead-activities&candidateId=${encodeURIComponent(lead.id)}`)); }
    catch (e) { setError(e.message); }
  }
  async function saveActivity(event) {
    event.preventDefault(); if (!activityLead || !activityForm) return;
    setActivitySaving(true); setError("");
    try {
      const response = await fetch("/api/prospects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "lead-activity", candidate_id: activityLead.id, ...activityForm }) });
      const body = await readJsonResponse(response);
      if (!response.ok) throw new Error(body.error || "Não foi possível registrar a atividade.");
      setActivityHistory((current) => [body, ...current].slice(0, 50));
      setActivityForm({ channel: activityForm.channel, result: "Sem resposta", notes: "", next_action: "", next_date: "" });
      setReload((value) => value + 1);
      setPerformanceReload((value) => value + 1);
    } catch (e) { setError(e.message); }
    finally { setActivitySaving(false); }
  }
  const advancedFilterCount = [filters.cnaePrimary, filters.materialPotential, filters.operatingSize, filters.materialsFit].filter(Boolean).length;
  const displayCount = (value) => !hasLoaded ? "…" : count(value);

  return <section className="prospects-desk leads-desk">
    <div className="prospects-intro">
      <div><strong aria-live="polite">{displayCount(result.total)}</strong><span>{filters.fit === "qualificados" ? "candidatos que atendem aos critérios da peneira" : filters.fit === "priorizar" ? "empresas para qualificar primeiro" : filters.fit === "baixa" ? "baixa aderência presumida ou fora do foco" : "empresas classificadas nesta visão"}</span><p>Leads percorre a região selecionada. A visão inicial exige localização disponível dentro do raio vigente, segmento direto ou confirmado e porte pequeno/médio confirmado ou ME/EPP cadastral. Contatos não são requisito para entrar na peneira.</p></div>
      <div><small className="lead-summary-label">Faixas cadastrais do universo completo</small><div className="lead-summary">
        {["alta", "validar", "baixa"].map((tier) => <button key={tier} className={filters.tier === tier ? "selected" : ""} onClick={() => update("tier", filters.tier === tier ? "" : tier)}><strong>{displayCount(result.summary?.[tier])}</strong><span>{tierLabel[tier]}</span></button>)}
      </div></div>
    </div>
    <details className="lead-performance" onToggle={(event) => setPerformanceOpen(event.currentTarget.open)}>
      <summary>Resultados registrados nos últimos 90 dias</summary>
      <p>Amostra por faixa cadastral. Considera a atividade mais recente de cada unidade; sinal positivo significa “Demanda potencial” ou “Solicitou material”, não contratação.</p>
      <div className="lead-performance-wrap"><table><thead><tr><th>Faixa</th><th>Unidades</th><th>Com atividade</th><th>Demanda ou pedido</th><th>Sinal positivo entre atividades</th></tr></thead><tbody>
        {!performance ? <tr><td colSpan={5}>Carregando resultados…</td></tr> : ["alta", "validar", "baixa"].map((tier) => {
          const row = performance?.by_tier?.[tier];
          const rate = row?.positive_signal_rate == null ? "—" : `${(row.positive_signal_rate * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
          return <tr key={tier}><th>{tierLabel[tier]}</th><td>{count(row?.units)}</td><td>{count(row?.activity_units)}</td><td>{count(row?.positive_units)}</td><td>{rate}</td></tr>;
        })}
      </tbody></table></div>
    </details>
    <div className="lead-sieve-notice"><strong>Requisitos da peneira</strong><span>{result.territory ? `Até ${result.territory.radius_km} km do ponto de referência de ${result.territory.name}/${result.territory.uf}` : "Raio da região selecionada"}</span><span>Segmento direto pelo CNAE ou aderência confirmada pela equipe</span><span>ME/EPP cadastral ou porte operacional pequeno/médio confirmado</span><span>Coordenada confirmada ou sugestão de endereço disponível</span><small>{result.territory ? `Centro provisório: ${result.territory.center_latitude.toFixed(5)}, ${result.territory.center_longitude.toFixed(5)}. ${result.territory.center_method}.` : "O contorno não permite calcular o centro do raio; nenhum candidato será incluído na visão qualificada."} Sugestões CNEFE não são endereços confirmados. “Demais” pode incluir empresas médias e grandes, por isso não entra sem porte operacional confirmado. A classificação organiza a revisão; não comprova interesse ou chance de contratação.</small></div>
    <div className="lead-method"><strong>Prioridade dentro da fila</strong><span>Segmento: até 30 pontos</span><span>CNAE principal: até 20</span><span>Porte cadastral ME/EPP: até 20</span><span>Potencial de materiais inferido do CNAE: até 30</span><small>A nota ordena candidatos depois dos requisitos; não representa probabilidade de compra. Confirme endereço e evidências antes da abordagem.</small></div>
    <div className="lead-qualification-summary" aria-label="Qualificação humana">
      {["Validação pendente", "Perfil-alvo confirmado", "Fora do foco"].map((status) => <button type="button" key={status} className={filters.qualification === status ? "selected" : ""} onClick={() => update("qualification", filters.qualification === status ? "" : status)}><strong>{displayCount(result.summary?.[status])}</strong><span>{status}</span></button>)}
    </div>
    <div className="prospect-filters">
      <select aria-label="Região de prospecção" value={filters.region} onChange={(e) => { setFilters((current) => ({ ...current, region: e.target.value, municipality: "", uf: "" })); setPage(1); }}>{regionCatalog.regions.map((region) => <option key={region.id} value={region.id}>{region.name} · {region.radius_km} km</option>)}</select>
      <select aria-label="UF" value={filters.uf} onChange={(e) => update("uf", e.target.value)}><option value="">Todas as UFs da região</option>{[...new Set((regionCatalog.regions.find((region) => region.id === filters.region)?.municipalities || []).map((item) => item.uf))].sort().map((uf) => <option key={uf}>{uf}</option>)}</select>
      <select aria-label="Visão da peneira" value={filters.fit} onChange={(e) => { setFilters((current) => ({ ...current, fit: e.target.value, tier: "", qualification: "" })); setPage(1); }}><option value="qualificados">Atendem aos critérios de Leads</option><option value="todos">Toda a peneira cadastral</option><option value="priorizar">Prioridade cadastral para qualificar</option><option value="baixa">Baixa aderência presumida ou fora do foco</option></select>
      <select aria-label="Origem da lista" value={filters.ultrafine} onChange={(e) => update("ultrafine", e.target.value)}><option value="">Todas as origens</option><option value="all">Peneira ultrafina · lista completa</option></select>
      <label className="search"><Search size={16}/><input aria-label="Buscar empresa, CNPJ ou CNAE" placeholder="Empresa, CNPJ, CNAE…" value={filters.q} onChange={(e) => update("q", e.target.value)} /></label>
      <select aria-label="Município" value={filters.municipality} onChange={(e) => update("municipality", e.target.value)}><option value="">Todos os municípios</option>{[...new Set((regionCatalog.regions.find((region) => region.id === filters.region)?.municipalities || []).filter((item) => !filters.uf || item.uf === filters.uf).map((item) => item.municipality))].sort((a,b) => a.localeCompare(b,"pt-BR")).map((municipality) => <option key={municipality}>{municipality}</option>)}</select>
      <select aria-label="Situação da localização" value={filters.locationSituation} onChange={(e) => update("locationSituation", e.target.value)}><option value="">Todas as situações</option><option value="confirmada">Coordenada confirmada</option><option value="sugestao">Sugestão de endereço</option><option value="pendente">Localização pendente</option></select>
      <select aria-label="Aderência do segmento" value={filters.segment} onChange={(e) => update("segment", e.target.value)}><option value="">Toda aderência</option>{[...new Set(cnaeScope.categories.map((c) => c.tier))].map((item) => <option key={item} value={item}>{item}</option>)}</select>
      <select aria-label="Setor ou grupo CNAE" value={filters.category} onChange={(e) => update("category", e.target.value)}><option value="">Todos os setores</option>{cnaeScope.categories.map((item) => <option key={item.id} value={item.label}>{item.label}</option>)}</select>
      <select aria-label="Porte" value={filters.size} onChange={(e) => update("size", e.target.value)}><option value="">Todos os portes</option><option>Microempresa</option><option>Empresa de pequeno porte</option><option>Demais (porte não discriminado)</option></select>
      <select aria-label="Qualificação humana" value={filters.qualification} onChange={(e) => update("qualification", e.target.value)}><option value="">Todas as qualificações</option>{["Validação pendente", "Perfil-alvo confirmado", "Fora do foco"].map((item) => <option key={item}>{item}</option>)}</select>
    </div>
    <details className="lead-advanced-filters">
      <summary>Refinar por critérios cadastrais e confirmados{advancedFilterCount ? ` · ${advancedFilterCount} ativo(s)` : ""}</summary>
      <div className="prospect-filters">
        <select aria-label="CNAE principal" value={filters.cnaePrimary} onChange={(e) => update("cnaePrimary", e.target.value)}><option value="">Atividade principal: todas</option><option value="in-scope">CNAE principal no escopo</option><option value="secondary-only">Apenas CNAE secundário no escopo</option></select>
        <select aria-label="Potencial de materiais pelo CNAE" value={filters.materialPotential} onChange={(e) => update("materialPotential", e.target.value)}><option value="">Potencial por CNAE: todos</option><option value="forte">Sinal mais forte por setor</option><option value="possível">Sinal possível por setor</option><option value="sem-sinal">Sem sinal mapeado</option></select>
        <select aria-label="Porte operacional confirmado" value={filters.operatingSize} onChange={(e) => update("operatingSize", e.target.value)}><option value="">Porte operacional: todos</option>{["Não avaliado", "Pequeno", "Médio", "Grande", "Desconhecido"].map((item) => <option key={item}>{item}</option>)}</select>
        <select aria-label="Materiais confirmados" value={filters.materialsFit} onChange={(e) => update("materialsFit", e.target.value)}><option value="">Materiais confirmados: todos</option>{["Não avaliado", "Estoque mensurável identificado", "Não identificado"].map((item) => <option key={item}>{item}</option>)}</select>
      </div>
    </details>
    {error && <div className="error" role="alert">{error}</div>}
    <div className="prospects-table-wrap"><table className="prospects-table leads-table"><thead><tr><th>Empresa</th><th>Fila recomendada</th><th>Triagem cadastral</th><th>Sinais encontrados</th><th>Qualificação humana</th><th>Localização</th><th>Contato e próxima ação</th><th></th></tr></thead><tbody>
      {hasLoaded && result.rows.map((lead) => <tr key={lead.id}>
        <td><strong>{lead.company_name || lead.unit_name || "Empresa sem nome"}</strong>{lead.ultrafine_sieve && <small>Peneira ultrafina · {{ selected: "selecionada", pending: "pendente de pesquisa", outside: "fora do raio/perfil" }[lead.ultrafine_sieve.status_by_region?.find((item) => item.region_id === filters.region)?.status] || "associação regional preservada"}</small>}<small>{lead.cnpj} · {lead.municipality || "Município não informado"}/{lead.uf || "—"}</small><small>CNAE {lead.cnae_primary || "não informado"} · {lead.cnae_primary_description || "descrição indisponível"}</small></td>
        <td>{lead.converted_unit_id ? <strong className="lead-client-converted">Cliente cadastrado</strong> : <><strong className={lead.eligibility.eligible ? "lead-eligible" : "lead-not-eligible"}>{lead.eligibility.eligible ? "Atende aos critérios" : "Pendente em algum critério"}</strong><small>{lead.eligibility.segment_evidence}</small><small>{lead.eligibility.size_evidence}</small><span className={`lead-queue-signal ${["Solicitou material", "Demanda potencial"].includes(lead.queue_signal) ? "active" : ""}`}>{lead.queue_signal}</span></>}<small>{lead.converted_unit_id ? "Atendimento continua na ficha do cliente" : `${tierLabel[lead.lead_tier]} · ${lead.lead_score}/100 em sinais cadastrais`}</small></td>
        <td><strong>{lead.scope_tier || "Segmento pendente"}</strong><small>{lead.size_label || "Porte desconhecido"}{lead.size_label === "Demais" ? " · porte sem discriminação ME/EPP" : ""}</small></td>
        <td>{lead.assessment.factors.map((factor) => <small key={factor.key} className="lead-factor"><b>{factor.points > 0 ? `+${factor.points}` : "0"}</b> {factor.label}: {factor.evidence}</small>)}{lead.assessment.material_categories.length > 0 && <small>Grupo associado: {lead.assessment.material_categories.join(", ")}</small>}</td>
        <td><span className={`lead-qualification ${lead.qualification_status === "Perfil-alvo confirmado" ? "confirmed" : lead.qualification_status === "Fora do foco" ? "out" : "pending"}`}>{lead.qualification_status || "Validação pendente"}</span><small>Segmento: {lead.segment_fit || "Não avaliado"}</small><small>Porte operacional: {lead.operating_size || "Não avaliado"}</small><small>Materiais: {lead.materials_fit || "Não avaliado"}</small>{lead.converted_unit_id ? <small>Qualificação preservada no cadastro do cliente</small> : <button type="button" className="text-button" onClick={() => setEditing({ ...lead, segment_fit: lead.segment_fit || "Não avaliado", operating_size: lead.operating_size || "Não avaliado", materials_fit: lead.materials_fit || "Não avaliado", qualification_source: lead.qualification_source || "", qualification_evidence: lead.qualification_evidence || "" })}>{lead.qualification_status === "Validação pendente" ? "Qualificar" : "Atualizar qualificação"}</button>}</td>
        <td><span>{lead.eligibility.within_radius ? `Dentro de ${lead.eligibility.radius_km} km` : lead.eligibility.location_available ? `Fora de ${lead.eligibility.radius_km} km` : "Localização pendente"}</span><small>{lead.eligibility.location_source}</small><small>{lead.eligibility.distance_meters == null ? "Distância indisponível" : `${(lead.eligibility.distance_meters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km do centro selecionado`}</small></td>
        <td>{lead.converted_unit_id ? <small>Histórico e contatos disponíveis na ficha do cliente.</small> : <><div className="lead-contact-channels">
          {phoneLink(lead.phone) && <a href={phoneLink(lead.phone)}>Ligar · {lead.phone}</a>}
          {whatsappLink(lead.phone) && <a href={whatsappLink(lead.phone)} target="_blank" rel="noreferrer">Abrir WhatsApp</a>}
          {lead.email && <a href={`mailto:${encodeURIComponent(lead.email)}`}>E-mail · {lead.email}</a>}
          {!phoneLink(lead.phone) && !lead.email && <small>Sem telefone ou e-mail cadastral utilizável</small>}
          {(lead.phone || lead.email) && <small className="lead-contact-source">Contato cadastral a confirmar</small>}
        </div>{lead.last_activity_result ? <><strong>{lead.last_activity_result}</strong><small>{lead.next_action}</small><small>Retorno: {new Date(`${lead.next_date}T12:00:00`).toLocaleDateString("pt-BR")}</small></> : <small>Nenhum contato registrado</small>}<button type="button" className="text-button" onClick={() => openActivity(lead)}>{lead.last_activity_result ? "Ver histórico / registrar" : "Registrar contato"}</button></>}</td>
        <td>{lead.converted_unit_id ? <button className="text-button" onClick={() => onOpenClient(lead.converted_unit_id)}>Abrir cliente <ArrowUpRight size={15}/></button> : <button className="text-button" onClick={() => onOpenProspect(lead.cnpj)}>Abrir na Prospecção <ArrowUpRight size={15}/></button>}</td>
      </tr>)}
      {loading && !hasLoaded && <tr><td colSpan="8" role="status">Buscando empresas nesta seleção…</td></tr>}
      {!loading && !hasLoaded && error && <tr><td colSpan="8">Não foi possível carregar esta seleção.</td></tr>}
      {!result.rows.length && !loading && hasLoaded && <tr><td colSpan="8">Nenhuma empresa corresponde a estes filtros.</td></tr>}
    </tbody></table></div>
    <div className="prospect-pagination"><span>{loading ? "Atualizando…" : `${count(result.total)} empresas nesta seleção · Página ${page} de ${Math.max(1, result.pages)}`}</span><button disabled={page <= 1 || loading} onClick={() => setPage((n) => n - 1)}><ChevronLeft size={16}/>Anterior</button><button disabled={page >= result.pages || loading} onClick={() => setPage((n) => n + 1)}>Próxima<ChevronRight size={16}/></button></div>
    <p className="lead-disclaimer">Esta é uma peneira de toda a lista, não uma confirmação automática de lead comercial. Confirme segmento, porte operacional, materiais, estoque, localização e necessidade antes de criar oportunidade ou abordar a empresa.</p>
    {editing && <div className="modal-backdrop"><form className="modal lead-qualification-form" onSubmit={saveQualification}><div className="modal-head"><div><h2>Qualificar unidade</h2><p>{editing.company_name || editing.unit_name} · {editing.cnpj}</p></div><button type="button" onClick={() => setEditing(null)}>Fechar</button></div><p>Registre o que foi confirmado. A pontuação automática continua separada desta avaliação.</p><label>Segmento da unidade<select value={editing.segment_fit} onChange={(e) => setEditing({ ...editing, segment_fit: e.target.value })}><option>Não avaliado</option><option>Aderente</option><option>Não aderente</option></select></label><label>Porte operacional<select value={editing.operating_size} onChange={(e) => setEditing({ ...editing, operating_size: e.target.value })}><option>Não avaliado</option><option>Pequeno</option><option>Médio</option><option>Grande</option><option>Desconhecido</option></select></label><label>Materiais e estoque<select value={editing.materials_fit} onChange={(e) => setEditing({ ...editing, materials_fit: e.target.value })}><option>Não avaliado</option><option>Estoque mensurável identificado</option><option>Não identificado</option></select></label><label>Fonte da informação<select required={editing.segment_fit !== "Não avaliado" || editing.operating_size !== "Não avaliado" || editing.materials_fit !== "Não avaliado"} value={editing.qualification_source} onChange={(e) => setEditing({ ...editing, qualification_source: e.target.value })}><option value="">Selecione a fonte</option>{["Conversa com cliente", "Site da empresa", "Consulta pública", "Indicação", "Outro"].map((source) => <option key={source}>{source}</option>)}</select></label><label>Evidência observada<textarea rows="3" maxLength="600" required={editing.segment_fit !== "Não avaliado" || editing.operating_size !== "Não avaliado" || editing.materials_fit !== "Não avaliado"} placeholder="Ex.: unidade mantém pilha de agregado e informou inventário mensal." value={editing.qualification_evidence} onChange={(e) => setEditing({ ...editing, qualification_evidence: e.target.value })}/></label><small>“Perfil-alvo confirmado” exige segmento aderente, empresa pequena ou média, estoque mensurável e localização confirmada dentro do raio selecionado. Isso não confirma interesse ou intenção de compra.</small><button className="primary" disabled={saving}>{saving ? "Salvando…" : "Salvar qualificação"}</button></form></div>}
    {activityLead && activityForm && <div className="modal-backdrop"><div className="modal lead-qualification-form lead-activity-modal"><div className="modal-head"><div><h2>Histórico de contato</h2><p>{activityLead.company_name || activityLead.unit_name} · {activityLead.cnpj}</p></div><button type="button" onClick={() => setActivityLead(null)}>Fechar</button></div><form onSubmit={saveActivity}><p>Registre ligação, mensagem ou pesquisa manual. Este formulário não envia mensagens.</p><label>Canal<select value={activityForm.channel} onChange={(e) => setActivityForm({ ...activityForm, channel: e.target.value })}>{["Telefone", "WhatsApp", "E-mail", "Pesquisa", "Indicação", "Outro"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Resultado<select value={activityForm.result} onChange={(e) => setActivityForm({ ...activityForm, result: e.target.value })}>{["Sem resposta", "Contato realizado", "Pessoa errada", "Dados inválidos", "Sem aderência", "Demanda potencial", "Solicitou material", "Outro"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Observações<textarea rows="3" maxLength="1500" value={activityForm.notes} onChange={(e) => setActivityForm({ ...activityForm, notes: e.target.value })} /></label><label>Próxima ação<input required maxLength="240" placeholder="Ex.: ligar para responsável pelo pátio" value={activityForm.next_action} onChange={(e) => setActivityForm({ ...activityForm, next_action: e.target.value })} /></label><label>Data do retorno<input required type="date" value={activityForm.next_date} onChange={(e) => setActivityForm({ ...activityForm, next_date: e.target.value })} /></label>{error && <div className="error" role="alert">{error}</div>}<button className="primary" disabled={activitySaving}>{activitySaving ? "Salvando…" : "Registrar contato"}</button></form><div className="lead-activity-history"><h3>Atividades anteriores</h3>{activityHistory.length ? activityHistory.map((item) => <article key={item.id}><strong>{item.result} · {item.channel}</strong><small>{new Date(item.created_at).toLocaleString("pt-BR")} · {item.author_name}</small><span>{item.notes || "Sem observações."}</span><small>Próxima ação: {item.next_action} · {new Date(`${item.next_date}T12:00:00`).toLocaleDateString("pt-BR")}</small></article>) : <p>Nenhuma atividade registrada.</p>}</div></div></div>}
  </section>;
}
