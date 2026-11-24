"use client";
import { requestJson, readJsonResponse } from "../../lib/client-http.mjs";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, FileUp, Layers, MapPin, Search, Upload } from "lucide-react";
import { findCompanyMatches } from "../../lib/company-matches.mjs";
import cnaeScope from "../../data/prospecting-territory/cnae-scope.json";
import regionCatalog from "../../data/prospecting-regions/regions.json";
import { createProspectingLayer, removeProspectingMap } from "../../lib/prospecting-map-layer.mjs";
import { loadCompleteProspectingMap } from "../../lib/prospecting-map-client.mjs";
import { addMapBaseLayers } from "../../lib/map-base-layers.mjs";
import { addMapNavigation } from "../../lib/map-navigation.mjs";

function parseCsv(source) {
  const rows = [], row = []; let cell = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted && ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === ";" || ch === "\t")) { row.push(cell); cell = ""; }
    else if (!quoted && (ch === "\n" || ch === "\r")) { row.push(cell); if (row.some(Boolean)) rows.push(row.slice()); row.length = 0; cell = ""; if (ch === "\r" && source[i + 1] === "\n") i++; }
    else cell += ch;
  }
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift()?.map((v, i) => (i === 0 ? v.replace(/^\uFEFF/, "") : v).trim()) || [];
  return rows.map((values) => Object.fromEntries(headers.map((key, i) => [key, values[i] || ""])));
}
const request = requestJson;
const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const matchMethodLabel = {
  municipio_cep_logradouro_numero: "Município, CEP, logradouro e número coincidem.",
  municipio_logradouro_numero_cep_divergente_ou_ausente: "Município, logradouro e número coincidem; o CEP diverge ou não está informado.",
  municipio_cep_logradouro_sem_numero: "Município, CEP e logradouro coincidem; o cadastro não informa número.",
};

function ProspectingMap({ result, onSelect, areaFilter }) {
  const element = useRef(null), pointLayer = useRef(null), latest = useRef({ result, onSelect, areaFilter });
  latest.current = { result, onSelect, areaFilter };
  const visiblePoints = () => (latest.current.result?.points || []).filter((point) =>
    latest.current.areaFilter === "within" ? point.within_radius : latest.current.areaFilter === "outside" ? !point.within_radius : latest.current.areaFilter === "confirmed" ? point.coordinate_confirmed : true);
  useEffect(() => { pointLayer.current?.setPoints(visiblePoints()); }, [result, areaFilter]);
  useEffect(() => {
    let cancelled = false, map, resizeObserver, leaflet;
    if (!result) return undefined;
    import("leaflet").then(({ default: L }) => {
      if (cancelled || !element.current) return;
      leaflet = L;
      map = L.map(element.current, { scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, maxZoom: 19 });
      map.setView([result.region.center.latitude, result.region.center.longitude], 5);
      addMapBaseLayers(L, map);
      const region = result.region;
      const bounds = L.latLngBounds([]);
      const referenceRing = region.reference_circle_geometry.coordinates[0];
      bounds.extend(L.latLngBounds(referenceRing.map(([longitude, latitude]) => [latitude, longitude])));
      if (region.id === "belo-horizonte-170km") {
        const boundary = L.geoJSON(region.geometry, { style: { color: "#a879d5", weight: 2, fillOpacity: 0.02 } }).addTo(map);
        bounds.extend(boundary.getBounds());
      }
      const center = [region.center.latitude, region.center.longitude];
      L.geoJSON(region.reference_circle_geometry, { style: { color: "#d96428", weight: 2, dashArray: "7 5", fillOpacity: 0.02 } }).addTo(map);
      L.circleMarker(center, { radius: 7, color: "#fff", weight: 2, fillColor: "#193e5a", fillOpacity: 1 }).addTo(map)
        .bindTooltip(`${region.city}/${region.uf} · ponto de referência · raio ${region.radius_km} km`);
      map.fitBounds(bounds, { animate: false, padding: [16, 16] });
      addMapNavigation(L, map, () => map.fitBounds(bounds, { animate: false, padding: [16, 16] }));
      pointLayer.current = createProspectingLayer(L, map, (point) => latest.current.onSelect(point));
      pointLayer.current.setPoints(visiblePoints());
      resizeObserver = new ResizeObserver(() => map?.invalidateSize({ pan: false }));
      resizeObserver.observe(element.current);
    });
    return () => { cancelled = true; resizeObserver?.disconnect(); pointLayer.current?.dispose(); pointLayer.current = null; if (leaflet) removeProspectingMap(leaflet, map); };
  }, [result?.region?.id]);
  return <div className="prospecting-map-frame" ref={element} role="region" aria-label={`Mapa da região ${result?.region?.name || "selecionada"} e candidatos com localização disponível`} />;
}

export default function ProspectingDesk({ companies = [], initialSearch = "", initialRegion = "belo-horizonte-170km" }) {
  const [filters, setFilters] = useState({ q: initialSearch, region: initialRegion, review: "", location: "", locationSituation: "", scope: "", category: "", cnaePrimary: "", size: "", municipality: "", uf: "", suggestions: "" });
  const [page, setPage] = useState(1), [result, setResult] = useState({ rows: [], total: 0, pages: 0 });
  const [error, setError] = useState(""), [loading, setLoading] = useState(true), [hasLoaded, setHasLoaded] = useState(false), [file, setFile] = useState(null), [coordinatesFile, setCoordinatesFile] = useState(null), [progress, setProgress] = useState("");
  const requestSequence = useRef(0), listController = useRef(null);
  const [editing, setEditing] = useState(null), [saving, setSaving] = useState(false);
  const [conversion, setConversion] = useState(null);
  const [mapOpen, setMapOpen] = useState(false), [mapResult, setMapResult] = useState(null), [mapLoading, setMapLoading] = useState(false), [mapError, setMapError] = useState(""), [mapVersion, setMapVersion] = useState(0);
  const [mapAreaFilter, setMapAreaFilter] = useState("all");
  const selectedRegion = regionCatalog.regions.find((region) => region.id === filters.region) || regionCatalog.regions[0];
  const municipalityOptions = selectedRegion?.municipalities || [];
  const ufOptions = [...new Set(municipalityOptions.map((item) => item.uf))].sort();
  const municipalityNames = [...new Set(municipalityOptions.filter((item) => !filters.uf || item.uf === filters.uf).map((item) => item.municipality))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  async function refresh(nextPage = page) {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    const sequence = ++requestSequence.current;
    setLoading(true); setHasLoaded(false); setError("");
    try {
      const params = new URLSearchParams({ ...filters, page: String(nextPage) });
      const data = await request(`/api/prospects?${params}`, { signal: controller.signal });
      if (sequence === requestSequence.current) { setResult(data); setHasLoaded(true); }
    } catch (e) { if (sequence === requestSequence.current) setError(e.message); }
    finally { if (sequence === requestSequence.current) setLoading(false); }
  }
  useEffect(() => {
    setLoading(true); setHasLoaded(false);
    const id = setTimeout(() => refresh(page), 250);
    return () => { clearTimeout(id); listController.current?.abort(); requestSequence.current++; };
  }, [filters, page]);
  useEffect(() => {
    if (!mapOpen) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    setMapResult(null);
    const load = async () => {
      setMapLoading(true); setMapError("");
      try {
        const params = new URLSearchParams({ ...filters, view: "map", area: "all", compact: "1" });
        const data = await loadCompleteProspectingMap((page) => { const paged = new URLSearchParams(params); paged.set("page", String(page)); return request(`/api/prospects?${paged}`, { signal: controller.signal }); }, { signal: controller.signal, onProgress: (partial) => { if (!cancelled) setMapResult(partial); } });
        if (!cancelled) setMapResult(data);
      } catch (e) { if (!cancelled) setMapError(e.message); }
      finally { if (!cancelled) setMapLoading(false); }
    };
    load();
    return () => { cancelled = true; controller.abort(); };
  }, [mapOpen, filters, mapVersion]);
  async function importFile() {
    if (!file) return;
    setLoading(true); setError("");
    try {
      const candidates = parseCsv(await file.text());
      if (!candidates.length) throw new Error("O arquivo não contém candidatos.");
      if (!candidates[0]?.cnpj) throw new Error("Use o CSV mestre da prospecção, com a coluna cnpj.");
      let inserted = 0, updated = 0;
      for (let i = 0; i < candidates.length; i += 250) {
        const response = await request("/api/prospects", json("POST", candidates.slice(i, i + 250)));
        inserted += response.inserted; updated += response.updated;
        setProgress(`Importando ${Math.min(i + 250, candidates.length).toLocaleString("pt-BR")} de ${candidates.length.toLocaleString("pt-BR")}`);
      }
      setProgress(`${inserted.toLocaleString("pt-BR")} novos candidatos; ${updated.toLocaleString("pt-BR")} atualizados.`); setFile(null); document.getElementById("prospect-file").value=""; await refresh(1); setPage(1);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  async function importCoordinates() {
    if (!coordinatesFile) return;
    setLoading(true); setError("");
    try {
      const rows = parseCsv(await coordinatesFile.text());
      if (!rows.length || !rows[0]?.cnpj || !rows[0]?.latitude || !rows[0]?.longitude || !rows[0]?.source) throw new Error("Use o CSV de sugestões IBGE gerado pela ferramenta de georreferenciamento.");
      let updated = 0, skipped = 0, notFound = 0;
      for (let i = 0; i < rows.length; i += 250) {
        const result = await request("/api/prospects", json("POST", { type:"coordinate-suggestions", rows:rows.slice(i, i + 250) }));
        updated += result.updated; skipped += result.skipped; notFound += result.not_found;
        setProgress(`Vinculando sugestões ${Math.min(i + 250, rows.length).toLocaleString("pt-BR")} de ${rows.length.toLocaleString("pt-BR")}`);
      }
      setProgress(`${updated.toLocaleString("pt-BR")} sugestões novas ou melhores; ${skipped.toLocaleString("pt-BR")} mantidas por já serem iguais ou mais confiáveis; ${notFound.toLocaleString("pt-BR")} CNPJs não encontrados. Nenhuma localização foi confirmada.`);
      setCoordinatesFile(null); document.getElementById("coordinate-file").value=""; await refresh(1); setPage(1);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }
  async function saveReview(event) {
    event.preventDefault(); setSaving(true); setError("");
    try { await request(`/api/prospects/${editing.id}`, json("PATCH", editing)); setEditing(null); await refresh(); setMapVersion((value)=>value+1); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  }
  async function convert(event) {
    event.preventDefault(); if (!conversion?.company_choice) { setError("Escolha uma empresa existente ou confirme uma nova."); return; }
    setSaving(true); setError("");
    try {
      const company_mode=conversion.company_choice==="new"?"new":"existing";
      await request(`/api/prospects/${conversion.id}`,json("POST",{company_mode,company_id:company_mode==="existing"?conversion.company_choice:undefined,company_name:conversion.company_name,unit_name:conversion.unit_name}));
      setConversion(null); setProgress("Cliente cadastrado e vinculado ao candidato."); await refresh();
    } catch(e) { setError(e.message); } finally { setSaving(false); }
  }
  async function openMapCandidate(point) {
    try { setEditing(await request(`/api/prospects/${encodeURIComponent(point.id)}`)); }
    catch (e) { setError(e.message); }
  }
  const setFilter = (key, value) => { setFilters((v) => ({ ...v, [key]: value })); setPage(1); };
  return <section className="prospects-desk">
    <div className="prospects-intro"><div><strong aria-live="polite">{hasLoaded ? result.total.toLocaleString("pt-BR") : "…"}</strong><span>candidatos na fila</span><p>São estabelecimentos de municípios que cruzam o território de referência. Confirme a localização e a aderência antes de cadastrar ou abordar.</p></div><div className="prospects-import"><label className="text-button" htmlFor="prospect-file"><FileUp size={17}/>Escolher CSV mestre</label><input id="prospect-file" type="file" accept=".csv,text/csv" onChange={(e)=>{setFile(e.target.files?.[0]||null);setProgress("")}}/><span>{file?.name || "Base Receita Federal · separador ponto e vírgula"}</span><button disabled={!file||loading} onClick={importFile}><Upload size={16}/>{loading ? "Processando…" : "Carregar candidatos"}</button><label className="text-button" htmlFor="coordinate-file"><MapPin size={17}/>Escolher sugestões de localização</label><input id="coordinate-file" type="file" accept=".csv,text/csv" onChange={(e)=>{setCoordinatesFile(e.target.files?.[0]||null);setProgress("")}}/><span>{coordinatesFile?.name || "CSV de correspondências IBGE CNEFE com nível de confiança"}</span><button disabled={!coordinatesFile||loading} onClick={importCoordinates}><Upload size={16}/>{loading ? "Processando…" : "Vincular sugestões"}</button>{progress&&<small role="status">{progress}</small>}</div></div>
    {error&&<div className="error" role="alert">{error}</div>}
    <div className="prospect-filters"><label className="search"><Search size={17}/><input aria-label="Buscar candidatos" placeholder="CNPJ, empresa ou CNAE…" value={filters.q} onChange={e=>setFilter("q",e.target.value)}/></label><select aria-label="Revisão comercial" value={filters.review} onChange={e=>setFilter("review",e.target.value)}><option value="">Todas as revisões</option>{["Pendente","Aderente","Fora do escopo","Possível duplicidade"].map(x=><option key={x}>{x}</option>)}</select><select aria-label="Localização histórica de BH" value={filters.location} onChange={e=>setFilter("location",e.target.value)}><option value="">Todas as localizações históricas BH</option>{["Pendente","Dentro do KML","Fora do KML"].map(x=><option key={x}>{x}</option>)}</select><select aria-label="Sugestão IBGE" value={filters.suggestions} onChange={e=>setFilter("suggestions",e.target.value)}><option value="">Todas as sugestões</option><option value="available">Com coordenada sugerida</option><option value="missing">Sem correspondência IBGE</option></select><select aria-label="Aderência" value={filters.scope} onChange={e=>setFilter("scope",e.target.value)}><option value="">Todas as aderências</option>{["Aderência direta a validar","Adjacente para revisão"].map(x=><option key={x}>{x}</option>)}</select><select aria-label="Segmento CNAE" value={filters.category} onChange={e=>setFilter("category",e.target.value)}><option value="">Todos os segmentos</option>{cnaeScope.categories.map(category=><option key={category.id} value={category.label}>{category.label}</option>)}</select><select aria-label="CNAE principal" value={filters.cnaePrimary} onChange={e=>setFilter("cnaePrimary",e.target.value)}><option value="">Principal ou secundário</option><option value="in-scope">CNAE principal no escopo</option><option value="secondary-only">Só CNAE secundário no escopo</option></select><select aria-label="Porte cadastral" value={filters.size} onChange={e=>setFilter("size",e.target.value)}><option value="">Todos os portes</option>{["Microempresa","Empresa de Pequeno Porte","Demais"].map(x=><option key={x}>{x}</option>)}</select></div>
    <div className="prospect-filters prospect-region-filters">
      <select aria-label="Região de prospecção" value={filters.region} onChange={e=>setFilters(v=>({...v,region:e.target.value,municipality:"",uf:""}))}>{regionCatalog.regions.map(region=><option key={region.id} value={region.id}>{region.name} · {region.radius_km} km</option>)}</select>
      <select aria-label="UF" value={filters.uf} onChange={e=>setFilter("uf",e.target.value)}><option value="">Todas as UFs da região</option>{ufOptions.map(uf=><option key={uf}>{uf}</option>)}</select>
      <select aria-label="Município" value={filters.municipality} onChange={e=>setFilter("municipality",e.target.value)}><option value="">Todos os municípios</option>{municipalityNames.map(name=><option key={name}>{name}</option>)}</select>
      <select aria-label="Situação da localização" value={filters.locationSituation} onChange={e=>setFilter("locationSituation",e.target.value)}><option value="">Todas as situações</option><option value="confirmada">Coordenada confirmada</option><option value="sugestao">Sugestão de endereço</option><option value="pendente">Localização pendente</option><option value="Dentro do raio">Revisada dentro do raio</option><option value="Fora do raio">Revisada fora do raio</option></select>
    </div>
    <div className="prospect-map-actions"><button className="text-button" aria-expanded={mapOpen} onClick={()=>setMapOpen((value)=>!value)}><Layers size={16}/>{mapOpen?"Ocultar mapa":"Ver mapa das localizações"}</button>{mapOpen&&mapResult&&<span>{mapResult.points.length.toLocaleString("pt-BR")} pontos com coordenadas · {mapResult.summary.confirmed.toLocaleString("pt-BR")} confirmadas</span>}</div>
    {mapOpen&&<section className="prospecting-map-panel"><div className="prospecting-map-heading"><div><strong>Localizações para conferência</strong><p>O círculo mostra o raio e o ponto de referência selecionados. Distâncias de sugestões são aproximadas; registros sem localização ficam na lista como pendentes e não aparecem como pontos.</p></div>{mapLoading&&<span>Atualizando mapa…</span>}</div>{mapError&&<div className="error" role="alert">{mapError}</div>}{mapResult&&<><p className="source-note"><strong>{mapResult.region.city}/{mapResult.region.uf} · raio de {mapResult.region.radius_km} km.</strong> {mapResult.region.center_status} Fonte do centro: {mapResult.region.center_source} Os pontos exibidos têm coordenadas individuais; os demais permanecem na lista como pendentes.</p><div className="prospecting-map-controls" aria-label="Filtrar pontos do mapa"><button className={mapAreaFilter==="all"?"selected":""} onClick={()=>setMapAreaFilter("all")}>Todos ({mapResult.area_counts.all.toLocaleString("pt-BR")})</button><button className={mapAreaFilter==="within"?"selected":""} onClick={()=>setMapAreaFilter("within")}>Dentro do raio ({mapResult.area_counts.within.toLocaleString("pt-BR")})</button><button className={mapAreaFilter==="outside"?"selected":""} onClick={()=>setMapAreaFilter("outside")}>Fora do raio ({mapResult.area_counts.outside.toLocaleString("pt-BR")})</button><button className={mapAreaFilter==="confirmed"?"selected":""} onClick={()=>setMapAreaFilter("confirmed")}>Confirmadas ({mapResult.area_counts.confirmed.toLocaleString("pt-BR")})</button></div><ProspectingMap result={mapResult} onSelect={openMapCandidate} areaFilter={mapAreaFilter}/><div className="prospecting-map-legend"><span><i className="map-dot confirmed"/>Coordenada confirmada</span><span><i className="map-dot high"/>Sugestão dentro do raio</span><span><i className="map-dot outside"/>Sugestão fora do raio</span><span><i className="map-line radius"/>Raio geodésico selecionado</span>{mapResult.region.id==="belo-horizonte-170km"&&<span><i className="map-line historical"/>KML histórico de Belo Horizonte</span>}<span><i className="cluster-key">n</i>Grupo de candidatos · amplie</span><small>Arraste o mapa ou use as setas. Números representam grupos em uma posição aproximada, não uma empresa. Amplie para ver as coordenadas individuais; clique no ponto para conferir ficha e fonte.</small></div>{mapResult.truncated&&<p className="late">O mapa mostra os primeiros {mapResult.points.length.toLocaleString("pt-BR")} pontos. Os demais pontos estão sendo carregados.</p>}{!mapResult.total&&<p>Nenhum candidato com coordenada neste filtro.</p>}</>}</section>}
    <div className="prospects-table-wrap"><table className="prospects-table"><thead><tr><th>Empresa e CNPJ</th><th>Atividade</th><th>Município</th><th>Porte cadastral</th><th>Revisão</th><th>Localização</th><th>CRM</th><th></th></tr></thead><tbody>{hasLoaded && result.rows.map((r)=><tr key={r.id}><td><strong>{r.company_name}</strong><small>{r.cnpj} · {r.branch_type}</small></td><td>{r.categories}<small>{r.cnae_primary} · {r.cnae_primary_description}</small><small>{r.cnae_primary_in_scope?"CNAE principal no escopo":"Aderência apenas em CNAE secundário"}</small></td><td>{r.municipality} · {r.uf}<small>{r.address}</small></td><td>{r.size_label}</td><td><span className="badge">{r.review_status}</span></td><td><span className="badge">{r.location_status}</span>{r.suggested_latitude!=null&&<small>Sugestão IBGE · {r.geocode_confidence?.split(";")[0]||"revisar"}</small>}</td><td>{r.converted_unit_id?<span className="badge green">Cliente cadastrado</span>:r.review_status==="Aderente"&&r.location_status==="Dentro do KML"?<button className="text-button" onClick={()=>{const matches=findCompanyMatches(r.company_name,r.cnpj,companies,5);setConversion({...r,company_name:r.company_name,unit_name:r.unit_name||r.municipality,company_choice:matches.length?"":"new"})}}>Cadastrar</button>:<small>Após revisão</small>}</td><td>{r.converted_unit_id?<small>Revisão encerrada</small>:<button className="text-button" onClick={()=>setEditing({...r})}>{r.reviewed_at?"Revisar":"Conferir"}</button>}</td></tr>)}{loading && !hasLoaded && <tr><td colSpan="8" role="status">Buscando candidatos nesta seleção…</td></tr>}{!loading && !hasLoaded && error && <tr><td colSpan="8">Não foi possível carregar esta seleção.</td></tr>}{!loading && hasLoaded && !result.rows.length && <tr><td colSpan="8">Nenhum candidato neste filtro.</td></tr>}</tbody></table></div>
    <div className="prospect-pagination"><span>{loading || !hasLoaded ? "Buscando candidatos…" : `${result.total.toLocaleString("pt-BR")} registros · página ${result.pages ? page : 0} de ${result.pages}`}</span><button disabled={page<=1||loading} onClick={()=>setPage(page-1)} aria-label="Página anterior"><ChevronLeft size={18}/></button><button disabled={page>=result.pages||loading} onClick={()=>setPage(page+1)} aria-label="Próxima página"><ChevronRight size={18}/></button></div>
    {editing&&<div className="modal-backdrop"><form className="modal prospect-review" onSubmit={saveReview}><div className="modal-head"><div><h2>Revisar candidato</h2><p>{editing.company_name} · {editing.cnpj}</p></div><button type="button" onClick={()=>setEditing(null)}>Fechar</button></div><p><MapPin size={15}/> {editing.address}, {editing.municipality} · {editing.uf}</p><p>{editing.cnae_primary} · {editing.cnae_primary_description}</p>{editing.suggested_latitude!=null&&<div className="coordinate-suggestion"><strong>Sugestão de localização · IBGE CNEFE</strong><span>{editing.geocode_confidence} · dados do Censo 2022</span><span>{matchMethodLabel[editing.geocode_match_method]||"Correspondência de endereço; revise os dados antes de usar."}</span><div><button type="button" className="text-button" onClick={()=>setEditing({...editing,latitude:String(editing.suggested_latitude),longitude:String(editing.suggested_longitude)})}>Usar coordenadas para revisar</button><a href={`https://www.openstreetmap.org/?mlat=${editing.suggested_latitude}&mlon=${editing.suggested_longitude}#map=18/${editing.suggested_latitude}/${editing.suggested_longitude}`} target="_blank" rel="noreferrer">Conferir no mapa</a></div></div>}<label>Revisão comercial<select value={editing.review_status} onChange={e=>setEditing({...editing,review_status:e.target.value})}>{["Pendente","Aderente","Fora do escopo","Possível duplicidade"].map(x=><option key={x}>{x}</option>)}</select></label><label>Localização na região selecionada<select value={editing.location_status} onChange={e=>setEditing({...editing,location_status:e.target.value})}>{(filters.region === "belo-horizonte-170km" ? ["Pendente","Dentro do KML","Fora do KML"] : ["Pendente","Dentro do raio","Fora do raio"]).map(x=><option key={x}>{x}</option>)}</select></label><div className="prospect-coordinates"><label>Latitude<input type="number" step="any" value={editing.latitude??""} onChange={e=>setEditing({...editing,latitude:e.target.value})}/></label><label>Longitude<input type="number" step="any" value={editing.longitude??""} onChange={e=>setEditing({...editing,longitude:e.target.value})}/></label></div><small>Valide o endereço no mapa. A revisão registra a posição verificada. O mapa calcula a distância ao centro da região selecionada; uma sugestão de endereço continua não confirmada.</small><label>Observação da revisão<textarea rows="3" maxLength="1000" value={editing.review_note||""} onChange={e=>setEditing({...editing,review_note:e.target.value})}/></label><button className="primary" disabled={saving}><Check size={16}/>{saving?"Salvando…":"Salvar revisão"}</button></form></div>}
    {conversion&&<div className="modal-backdrop"><form className="modal prospect-review" onSubmit={convert}><div className="modal-head"><div><h2>Cadastrar candidato como cliente</h2><p>{conversion.company_name} · {conversion.cnpj}</p></div><button type="button" onClick={()=>setConversion(null)}>Fechar</button></div><p>A conversão cria a empresa/unidade e, quando houver, um canal geral. Nenhuma mensagem será enviada. O porte operacional começa como desconhecido.</p><label>Destino da empresa<select value={conversion.company_choice} onChange={e=>setConversion({...conversion,company_choice:e.target.value})}><option value="">Escolha o destino</option>{findCompanyMatches(conversion.company_name,conversion.cnpj,companies,5).map(({company,reasons})=><option value={company.id} key={company.id}>{company.name} — {reasons.join(", ")}</option>)}<option value="new">Criar nova empresa</option></select></label>{conversion.company_choice==="new"&&<label>Nome da empresa<input value={conversion.company_name} maxLength="200" onChange={e=>setConversion({...conversion,company_name:e.target.value})}/></label>}<label>Nome desta unidade<input value={conversion.unit_name} maxLength="160" onChange={e=>setConversion({...conversion,unit_name:e.target.value})}/></label><p>{conversion.address}, {conversion.municipality} · posição confirmada conforme a região selecionada</p><button className="primary" disabled={saving}><Check size={16}/>{saving?"Cadastrando…":"Confirmar cadastro"}</button></form></div>}
  </section>;
}

