"use client";
import { requestJson } from "../lib/client-http.mjs";
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  LayoutDashboard,
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  FileText,
  Library,
  ClipboardList,
  MessagesSquare,
  Handshake,
  Settings,
  Plus,
  Search,
  ArrowUpRight,
  X,
  ChevronRight,
  MapPinned,
  ListChecks,
  LogOut,
  Download,
  Upload,
  Check,
  AlertCircle,
  RefreshCw,
  Send,
  CalendarPlus,
  Phone,
  Mail,
  MessageCircle,
  Target,
  Trash2,
} from "lucide-react";
import { models, roles, canWrite, titleOf } from "../lib/model.mjs";
import { createProspectingLayer, removeProspectingMap } from "../lib/prospecting-map-layer.mjs";
import { loadCompleteProspectingMap } from "../lib/prospecting-map-client.mjs";
import { segmentColor } from "../lib/map-segments.mjs";
import regionCatalog from "../data/prospecting-regions/region-centers.json";
import { distanceMeters, geodesicCircle } from "../lib/territory-radius.mjs";
import ClientFields from "./components/ClientFields";
import DocumentFiles from './components/DocumentFiles';
import {uploadRecordFile} from '../lib/document-upload-client.mjs';
import BulletinEditor from './components/BulletinEditor';
import BankdocReview from './components/BankdocReview';
import ClientImport from "./components/ClientImport";
import ProspectingDesk from "./components/ProspectingDesk";
import LeadDesk from "./components/LeadDesk";
import MaterialFields from "./components/MaterialFields";
import AdministrativeDesk from "./components/AdministrativeDesk";
import OperationOverview, {HandoffReview} from './components/OperationOverview';
const EMPTY_PROSPECTING_MAP_POINTS = Object.freeze([]);
import ClientContext from './components/ClientContext';
import MessageAssistant from './components/MessageAssistant';
import DocumentChecklist from './components/DocumentChecklist';
import PilotMetrics from './components/PilotMetrics';
import {waitingLabel} from '../lib/operation-flow.mjs';
import dynamic from "next/dynamic";
import ActivityFields from "./components/ActivityFields";
import OwnerMapping from "./components/OwnerMapping";
import TeamDesk from "./components/TeamDesk";
import FlightDesk from "./components/FlightDesk";
import { isOperational, flightReaders } from "../lib/access.mjs";
import MyProfile from "./components/MyProfile";
import NotificationCenter from "./components/NotificationCenter";
import ContactDirectory from "./components/ContactDirectory";
import { isManagement, isField } from "../lib/agenda.mjs";
const AgendaDesk = dynamic(() => import("./components/AgendaDesk"), { ssr: false, loading: () => <p>Carregando agenda…</p> });
import { administrativeRoles } from "../lib/administrative-workflow.mjs";
import { actionDateStatus, buildActionQueue, filterActionQueueByOwner } from "../lib/work-queue.mjs";
import { matchesUnitReview } from "../lib/unit-review.mjs";
import { phoneLink, whatsappLink } from "../lib/contact-links.mjs";
import { matchesRecordSearch } from "../lib/record-search.mjs";
import { addMapBaseLayers } from "../lib/map-base-layers.mjs";
import { addMapNavigation } from "../lib/map-navigation.mjs";
const nav = [
  ["dashboard", "Visão geral", LayoutDashboard],
  ["units", "Clientes e unidades", Building2],
  ["opportunities", "Oportunidades", ChartNoAxesCombined],
  ["activities", "Agenda", CalendarDays],
  ["conversations", "Atendimento", MessagesSquare],
  ["materials", "Materiais e pedidos", Library],
  ["proposals", "Propostas", FileText],
  ["renewals", "Pós-venda", Handshake],
  ["map", "Território", MapPinned],
  ["prospects", "Prospecção", ListChecks],
  ["leads", "Leads", Target],
  ["administrative", "Administrativo", ClipboardList],
  ["services", "Operação", ClipboardList],
  ["flights", "Autorizações de voo", FileText],
  ["team", "Equipe e acessos", Building2],
  ["profile", "Meu perfil", Building2],
  ["settings", "Configurações", Settings],
];
const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const date = (s) =>
  s
    ? new Date(s.slice(0, 10) + "T12:00:00Z").toLocaleDateString("pt-BR")
    : "Sem data";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const overdue = (r) =>
  (r.due_date || r.next_date) &&
  (r.due_date || r.next_date) < today() &&
  !["Concluída", "Concluído", "Cancelada", "Ganha", "Perdida"].includes(
    r.status,
  );
const api = requestJson;
const post = (url, data) =>
  api(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
function Badge({ children }) {
  return (
    <span
      className={
        "badge " +
        (["Alta", "Aguardando equipe"].includes(children)
          ? "warm"
          : ["Ganha", "Aprovado", "Concluída", "Dentro"].includes(children)
            ? "green"
            : "")
      }
    >
      {children ?? "Não informado"}
    </span>
  );
}
function Empty({
  title = "Nenhum registro ainda",
  text = "Cadastre o primeiro registro para acompanhar esta etapa.",
  action,
  onAction,
}) {
  return (
    <div className="empty">
      <ClipboardList size={32} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action && (
        <button className="text-button" onClick={onAction}>
          <Plus size={16} />
          {action}
        </button>
      )}
    </div>
  );
}
function TerritoryMap({ territory, units, prospects = [], onSelect, onSelectProspect, region }) {
  const el = useRef(null),
    map = useRef(null), pointLayer = useRef(null), latest = useRef({ prospects, onSelect, onSelectProspect });
  latest.current = { prospects, onSelect, onSelectProspect };
  useEffect(() => { pointLayer.current?.setPoints(prospects); }, [prospects]);
  useEffect(() => {
    let stopped = false, leaflet;
    import("leaflet").then(({ default: L }) => {
      if (stopped || !el.current) return;
      leaflet = L;
      const m = L.map(el.current, { scrollWheelZoom: false, zoomAnimation: false, fadeAnimation: false, maxZoom: 19 });
      map.current = m;
      m.setView([region.center.latitude, region.center.longitude], 5);
      addMapBaseLayers(L, m);
      m.createPane("crm-clients").style.zIndex = "625";
      const bounds = L.latLngBounds([]);
      if (region.id === "belo-horizonte-170km" && territory?.geometry) {
        const polygon = L.geoJSON(territory, { style: { color: "#a879d5", weight: 2, fillOpacity: 0.02 } }).addTo(m);
        bounds.extend(polygon.getBounds());
      }
      const center = [region.center.latitude, region.center.longitude];
      L.polygon(geodesicCircle(region.center, region.radius_km * 1000).map(([longitude, latitude]) => [latitude, longitude]), { color: "#d96428", weight: 2, dashArray: "7 5", fillOpacity: 0.02 }).addTo(m);
      const reference = L.circleMarker(center, { radius: 7, color: "#fff", weight: 2, fillColor: "#193e5a", fillOpacity: 1 }).addTo(m);
      reference.bindTooltip(`${region.city}/${region.uf} · ponto de referência de prospecção · ${region.center_status}`);
      const latitudeDelta = region.radius_km / 111.2;
      const longitudeDelta = latitudeDelta / Math.cos(region.center.latitude * Math.PI / 180);
      bounds.extend([[region.center.latitude - latitudeDelta, region.center.longitude - longitudeDelta], [region.center.latitude + latitudeDelta, region.center.longitude + longitudeDelta]]);
      units
        .filter((u) => u.latitude != null && u.longitude != null)
        .forEach((u) => {
          const distance = distanceMeters([region.center.longitude, region.center.latitude], [u.longitude, u.latitude]);
          const withinRadius = distance <= region.radius_km * 1000;
          bounds.extend([u.latitude, u.longitude]);
          const marker = L.circleMarker([u.latitude, u.longitude], {
            pane: "crm-clients", className: "crm-unit-marker",
            radius: 7,
            color: withinRadius ? "#fff" : "#c14131",
            weight: 2,
            fillColor: segmentColor(u.segment),
            fillOpacity: 1,
          })
            .addTo(m)
            .bindTooltip(
              (() => {
                const info = document.createElement("div");
                const title = document.createElement("strong");
                title.textContent = u.name;
                info.append(title);
                const kind = document.createElement("div");
                kind.textContent = "Cliente cadastrado · coordenadas da ficha";
                info.append(kind);
                for (const text of [
                  u.segment,
                  `Posição frente ao raio selecionado: ${withinRadius ? "Dentro" : "Fora"}`,
                  ...(region.id === "belo-horizonte-170km" && u.geo_status ? [`Situação no KML histórico: ${u.geo_status}`] : []),
                  u.distance_km != null
                    ? "Deslocamento informado: " + u.distance_km + " km"
                    : "Deslocamento não informado",
                  u.geo_evidence || "Coordenadas cadastradas",
                  "Distância geodésica ao centro selecionado: " + (distance / 1000).toFixed(1).replace(".", ",") + " km",
                ]) {
                  const line = document.createElement("div");
                  line.textContent = text;
                  info.append(line);
                }
                return info;
              })(),
            )
            .on("click", () => latest.current.onSelect(u));
          marker.getElement()?.setAttribute("data-unit-id", u.id);
        });
      m.fitBounds(bounds, { animate: false, padding: [18, 18] });
      addMapNavigation(L, m, () => m.fitBounds(bounds, { animate: false, padding: [18, 18] }));
      pointLayer.current = createProspectingLayer(L, m, (point) => latest.current.onSelectProspect(point));
      pointLayer.current.setPoints(latest.current.prospects);
    });
    return () => {
      stopped = true;
      pointLayer.current?.dispose();
      pointLayer.current = null;
      if (leaflet) removeProspectingMap(leaflet, map.current);
      map.current = null;
    };
  }, [territory, units, region] );
  return (
    <div
      className="map-frame"
      ref={el}
      aria-label="Mapa da área de prospecção"
    />
  );
}
export default function CRM() {
  const [auth, setAuth] = useState(null),
    [state, setState] = useState(null),
    [section, setSection] = useState("dashboard"),
    [prospectSearch, setProspectSearch] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [segment, setSegment] = useState(""),
    [owner, setOwner] = useState(""),
    [priority, setPriority] = useState(""),
    [mapRegionId, setMapRegionId] = useState("belo-horizonte-170km"),
    [mapShowProspects, setMapShowProspects] = useState(true),
    [queueFilter, setQueueFilter] = useState("Todas"),
    [queueOwnerFilter, setQueueOwnerFilter] = useState(""),
    [leadFocusCnpj, setLeadFocusCnpj] = useState(""),
    [quickCompletion, setQuickCompletion] = useState(null),
    [quickResult, setQuickResult] = useState(""),
    [unitReviewFilter, setUnitReviewFilter] = useState(""),
    [selectedUnitIds, setSelectedUnitIds] = useState([]),
    [bulkOwner, setBulkOwner] = useState(""),
    [bulkNextAction, setBulkNextAction] = useState(""),
    [bulkNextDate, setBulkNextDate] = useState(""),
    [modal, setModal] = useState(null),
    [clientImportOpen, setClientImportOpen] = useState(false),
    [feedbackOpen, setFeedbackOpen] = useState(false),
    [feedbackRows, setFeedbackRows] = useState([]),
    [feedbackForm, setFeedbackForm] = useState({ category: "Dificuldade", impact: "Atrapalha", title: "", description: "" }),
    [detail, setDetail] = useState(null),
    [conversationDraft, setConversationDraft] = useState(""),
    [tab, setTab] = useState("Resumo"),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [team, setTeam] = useState([]),
    [directory, setDirectory] = useState([]),
    [clientView, setClientView] = useState("clients"),
    [passwordChange, setPasswordChange] = useState({
      current: "",
      next: "",
      confirm: "",
    });
  const [authForm, setAuthForm] = useState({
    name: "Tiago",
    email: "",
    password: "",
    token: "",
  });
  const [connectionChecks, setConnectionChecks] = useState({});
  const [prospectingMapResult, setProspectingMapResult] = useState(null);
  const [prospectingMapLoading, setProspectingMapLoading] = useState(false);
  const [prospectingMapError, setProspectingMapError] = useState("");
  useEffect(() => {
    api("/api/auth")
      .then(setAuth)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (section !== "map" || !auth?.user) return undefined;
    const allowedRoles = ["Administrador", "Administração", "Administrativo", "Comercial", "Aprovação comercial"];
    if (!allowedRoles.includes(auth.user.role)) {
      setProspectingMapResult(null);
      setProspectingMapError("A camada de candidatos não está disponível para este perfil.");
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    setProspectingMapResult(null);
    const params = new URLSearchParams({ view: "map", region: mapRegionId, area: "all", compact: "1" });
    setProspectingMapLoading(true);
    setProspectingMapError("");
    loadCompleteProspectingMap((page) => { const paged = new URLSearchParams(params); paged.set("page", String(page)); return api(`/api/prospects?${paged}`, { signal: controller.signal }); }, { signal: controller.signal, onProgress: (partial) => { if (!cancelled) setProspectingMapResult(partial); } })
      .then((result) => { if (!cancelled) setProspectingMapResult(result); })
      .catch((e) => { if (!cancelled) setProspectingMapError(e.message); })
      .finally(() => { if (!cancelled) setProspectingMapLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [section, mapRegionId, auth?.user?.role]);
  useEffect(() => {
    const activityId = new URLSearchParams(window.location.search).get("activity");
    const record = state?.data?.activities?.find((item) => item.id === activityId && !item.availability_only);
    if (record) { setSection("activities"); open("activities", record); window.history.replaceState({}, "", "/"); }
  }, [state]);
  async function reload() {
    const s = await api("/api/state");
    setState(s);
    setDirectory(await api("/api/directory"));
    return s;
  }
  useEffect(() => {
    if (auth?.user) { if (isField(auth.user)) setSection("activities"); reload().catch((e) => setError(e.message)); }
  }, [auth]);
  useEffect(() => {
    if (section === "settings" && isManagement(auth?.user))
      api("/api/pilot-feedback").then(setFeedbackRows).catch((e) => setError(e.message));
  }, [section, auth]);
  useEffect(() => {
    if (!detail && !modal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [detail, modal]);
  async function perform(fn) {
    setBusy(true);
    setError("");
    let succeeded = true;
    try {
      await fn();
    } catch (e) {
      setError(e.message);
      succeeded = false;
    } finally {
      setBusy(false);
    }
    return succeeded;
  }
  async function checkIntegrationChannel(channel) {
    await perform(async () => {
      const result = await post("/api/integrations/test", { channel });
      setConnectionChecks((current) => ({ ...current, [channel]: result }));
    });
  }
  async function assignSelectedUnits() {
    const selected = selectedUnitIds.slice(0, 50);
    const responsibleName = directory.find((person) => person.id === bulkOwner)?.name || bulkOwner;
    if (!bulkOwner || selected.length === 0) return;
    const nextAction = bulkNextAction.trim();
    if (Boolean(nextAction) !== Boolean(bulkNextDate)) {
      setError("Para registrar a próxima ação, preencha também o prazo.");
      return;
    }
    const followup = nextAction
      ? `\nPróxima ação: ${nextAction} — ${date(bulkNextDate)}.`
      : "";
    if (
      !window.confirm(
        `Atribuir ${selected.length} cliente(s) a ${responsibleName}?${followup}\nCada cadastro alterado receberá um registro no histórico.`,
      )
    )
      return;
    await perform(async () => {
      const result = await post("/api/clients/assign", {
        unit_ids: selected,
        owner_id: bulkOwner,
        next_action: nextAction || null,
        next_date: nextAction ? bulkNextDate : null,
      });
      clearUnitSelection();
      await reload();
      const assignmentNotice =
        result.assigned === result.selected
          ? `${result.assigned} cliente(s) atribuído(s) a ${result.owner}.`
          : `${result.assigned} cliente(s) receberam ${result.owner}; ${result.selected - result.assigned} já estavam atribuídos a essa pessoa.`;
      setNotice(assignmentNotice + followup);
    });
  }
  const data = state?.data || {};
  const user = state?.user || auth?.user;
  const find = (entity, id) => data[entity]?.find((r) => r.id === id);
  const reference = (r) =>
    find("units", r.unit_id)?.name ||
    find("opportunities", r.opportunity_id)?.name ||
    find("companies", r.company_id)?.name ||
    r.candidate_name ||
    "";
  function open(entity, record = {}, prefill = {}, context = {}) {
    if (entity === "activities" && record.availability_only) return;
    setError("");
    const defaults =
      entity === "activities"
        ? { category: "Tarefa geral", area: "Operação", owner_id: user.id, status: "Pendente", all_day: "Sim", schedule_mode: "Contínuo", participant_ids: [], mentioned_ids: [], reminder_minutes: [] }
        : entity === "materials"
        ? {
            revision: "1",
            status: "Rascunho",
            access: "Equipe",
            segment: "Todos",
          }
        : entity === "units"
          ? {
              segment: "Não informado",
              status: "Pesquisa",
              size: "Desconhecido",
              size_evidence: "Desconhecido",
              priority: "Não definida",
            }
          : entity === "services" && !record.id
            ? { modality: state.serviceModalities?.[0] || "" }
            : {};
    const accountDefaults = models[entity]?.fields.some((field) => field.key === "owner_id") && !record.id ? { owner_id: user.id } : {};
    setModal({
      entity,
      record: { ...record, ...prefill },
      values: { ...accountDefaults, ...defaults, ...record, ...prefill },
      ...context,
    });
  }
  const conversationDraftCache = useRef({});
  function closeDetail() {
    if(detail?.conversation && conversationDraftCache.current[detail.conversation]?.trim() && !window.confirm('Fechar a conversa? Seu rascunho ficará disponível enquanto esta página permanecer aberta.')) return;
    setDetail(null);
  }
  function openAdministrativeConversation(contact, channel, body) {
    if (!contact) return;
    setConversationDraft(body);
    setSection("conversations");
    const existing = data.conversations?.find((item) => item.contact_id === contact.id && item.channel === channel && item.status !== "Concluída");
    if (existing) {
      setDetail({ conversation: existing.id });
      return;
    }
    open("conversations", {}, {
      unit_id: contact.unit_id,
      contact_id: contact.id,
      name: "Acompanhamento administrativo — " + contact.name,
      channel,
      owner_id: user.id,
      status: "Aguardando equipe",
      next_action: "Revisar e enviar mensagem administrativa",
      next_date: today(),
    }, { administrativeDraft: body });
  }
  function navigate(s) {
    window.scrollTo(0, 0);
    setSection(s);
    setSearch("");
    setFilter("");
    setSegment("");
    setOwner("");
    setPriority("");
    setUnitReviewFilter("");
    clearUnitSelection();
    setNotice("");
  }
  function clearUnitSelection() {
    setSelectedUnitIds([]);
    setBulkOwner("");
    setBulkNextAction("");
    setBulkNextDate("");
  }
  function updateListFilter(setter, value) {
    setter(value);
    clearUnitSelection();
  }
  const messaging = [
    "Administrador",
    "Comercial",
    "Administração",
    "Administrativo",
    "Aprovação comercial",
  ].includes(user?.role);
  const visibleNav = nav.filter(
    ([k]) => (k !== "team" || isManagement(user)) && (k !== "flights" || flightReaders(user)) && (!isField(user) || (isOperational(user) ? ["units", "activities", "services", "materials", "flights", "profile"] : ["activities", "services", "materials", "profile"]).includes(k)) && (k !== "conversations" || messaging) && (k !== "administrative" || administrativeRoles.includes(user?.role)) && (!["prospects", "leads"].includes(k) || ["Administrador", "Administração", "Administrativo", "Comercial", "Aprovação comercial"].includes(user?.role)),
  );
  const rows = (data[section] || []).filter(
    (r) =>
      matchesRecordSearch(section, r, data, search, reference(r)) &&
      (section !== "units" || matchesUnitReview(r, unitReviewFilter)) &&
      (!filter || r.status === filter) &&
      (!segment || r.segment === segment) &&
      (!owner || r.owner === owner) &&
      (!priority || r.priority === priority),
  );
  const units = useMemo(
    () =>
      (data.units || []).filter(
        (r) =>
          (!segment || r.segment === segment) &&
          (!owner || r.owner === owner) &&
          (!priority || r.priority === priority) &&
          (!filter || r.status === filter) &&
          matchesUnitReview(r, unitReviewFilter),
      ),
    [data.units, segment, owner, priority, filter, unitReviewFilter],
  );
  const selectedMapRegion = regionCatalog.regions.find((region) => region.id === mapRegionId) || regionCatalog.regions[0];
  const selectedMapProspectingData = prospectingMapResult?.region?.id === mapRegionId ? prospectingMapResult : null;
  const openProspectFromMap = useCallback((point) => {
    setProspectSearch(point.cnpj);
    setSearch(point.cnpj);
    setSection("prospects");
    window.scrollTo(0, 0);
  }, [mapRegionId]);
  const queue = buildActionQueue(data);
  const queueOwnerOptions = [...new Set(queue.map((item) => item.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const ownerQueue = filterActionQueueByOwner(queue, queueOwnerFilter);
  const queueFilters = ["Todas", "Vencidas", "Hoje", "Agendada", "Sem data"];
  const queueToday = today();
  const filteredQueue = ownerQueue.filter(
    (item) =>
      queueFilter === "Todas" ||
      actionDateStatus(item, queueToday) === queueFilter,
  );
  const visibleQueue = filteredQueue.slice(0, 8);
  const invoiceBalance = (r) =>
    Number(r.amount_cents) -
    (state?.allocations || [])
      .filter((a) => a.invoice_id === r.id)
      .reduce((s, a) => s + Number(a.amount_cents), 0);
  const current = detail ? find("units", detail.id) : null;
  async function persistDocumentModal(options={}) {
    const {skipAttachment,...overrides}=options;
    let saved=await post('/api/records/'+modal.entity,{data:{...modal.values,...overrides},id:modal.record.id,version:modal.record.version});
    setModal(current=>({...current,record:saved,values:saved}));
    if(!skipAttachment&&modal.pendingAttachment){const {file,purpose}=modal.pendingAttachment;saved=await uploadRecordFile(modal.entity,saved,purpose,file,progress=>setNotice(`Anexando arquivo: ${progress}%`));setModal(current=>({...current,record:saved,values:saved,pendingAttachment:null}));}
    await reload();return saved;
  }
  async function save(e) {
    e.preventDefault();
    await perform(async () => {
      const { entity, record, values } = modal;
      const saved = modal.convertConversationId
        ? await post("/api/conversations/convert", {
            conversation_id: modal.convertConversationId,
            data: values,
          })
        : await post(
            entity === "units" && !record.id
              ? "/api/clients"
              : "/api/records/" + entity,
            {
              data: values,
              id: record.id,
              version: record.version,
            },
          );
      if (entity === "materials" && modal.file) {
        setModal({ ...modal, record: saved, values: saved });
        await attachFile(modal.file, saved.id);
      }
      if(modal.pendingAttachment){setModal(current=>({...current,record:saved,values:saved}));const {file,purpose}=modal.pendingAttachment;await uploadRecordFile(entity,saved,purpose,file);}
      await reload();
      setModal(null);
      if (entity === "conversations" && modal.administrativeDraft) {
        setConversationDraft(modal.administrativeDraft);
        setDetail({ conversation: saved.id });
        setSection("conversations");
      }
      setNotice(
        modal.convertConversationId
          ? "Oportunidade criada e vinculada à conversa."
          : entity === "units"
          ? record.id
            ? "Cadastro atualizado."
            : "Cliente cadastrado."
          : "Registro salvo.",
      );
    });
  }
  async function deleteAdministrativeEntry(entity, record) {
    if (!record?.id || !["services", "invoices", "receipts", "admin_documents"].includes(entity)) return;
    const label = models[entity]?.singular || "lançamento";
    if (!window.confirm(`Apagar este ${label} do CRM? A ação ficará registrada na auditoria. Se algo já foi enviado a um cliente ou portal, isso não cancela o envio externo. Vínculos e recebimentos conciliados serão preservados.`)) return false;
    await api(`/api/records/${entity}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: record.id, version: record.version }),
    });
    await reload();
    setModal(null);
    setNotice("Lançamento apagado. A ação ficou registrada no histórico de auditoria.");
    return true;
  }
  async function importClientRows(rows, companyChoices) {
    return perform(async () => {
      const result = await post("/api/clients/import", { rows, companyChoices });
      await reload();
      setClientImportOpen(false);
      const skipped = result.skipped.length ? ` ${result.skipped.length} repetida(s) ignorada(s).` : "";
      setNotice(`${result.created} unidade(s) importada(s), ${result.companies} empresa(s) nova(s) e ${result.contacts} contato(s).${skipped}`);
    });
  }
  async function updateTeamAccess(userId, changes, message) {
    await perform(async () => {
      await api("/api/team", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, ...changes }),
      });
      if (changes.email && userId === user.id) { setState(null); setAuth({ user: null, setup: false }); setNotice("E-mail atualizado. Entre novamente com o novo endereço."); return; }
      setTeam(await api("/api/team"));
      await reload();
      setNotice(message);
    });
  }
  async function completeQueuedActivity(activity) {
    if (!quickResult.trim()) return;
    await perform(async () => {
      await post("/api/records/activities", {
        data: { ...activity, status: "Concluída", result: quickResult.trim() },
        id: activity.id,
        version: activity.version,
      });
      setQuickCompletion(null);
      setQuickResult("");
      await reload();
      setNotice("Atividade concluída com o resultado registrado.");
    });
  }
  async function submitPasswordChange(e) {
    e.preventDefault();
    if (passwordChange.next !== passwordChange.confirm) {
      setError("A confirmação não corresponde à nova senha.");
      return;
    }
    await perform(async () => {
      await post("/api/auth/password", {
        current_password: passwordChange.current,
        new_password: passwordChange.next,
      });
      setPasswordChange({ current: "", next: "", confirm: "" });
      setNotice("Senha alterada. As outras sessões foram encerradas.");
    });
  }
  async function attachFile(file, materialId) {
    if (state.integrations.storage) {
      const { upload } = await import("@vercel/blob/client");
      const key = crypto.randomUUID();
      await upload("files/" + key, file, {
        access: "private",
        handleUploadUrl: "/api/files/token",
        clientPayload: JSON.stringify({
          material_id: materialId,
          filename: file.name,
          size: file.size,
        }),
        onUploadProgress: event=>setNotice("Enviando arquivo: "+Math.round(event.percentage)+"%"),
      });
      await post("/api/files/complete", { key });
    } else {
      const form = new FormData();
      form.set("file", file);
      form.set("material_id", materialId);
      const result = await fetch("/api/files", { method: "POST", body: form });
      const b = await result.json();
      if (!result.ok) throw new Error(b.error);
    }
  }
  async function login(e) {
    e.preventDefault();
    await perform(async () => {
      const b = await post("/api/auth", {
        ...authForm,
        action: auth.setup ? "setup" : "login",
      });
      setAuth({ ...auth, user: b.user, setup: false });
      setAuthForm({ ...authForm, password: "", token: "" });
    });
  }
  function Records({ entity, items, unitId }) {
    return (
      <div className="related">
        <div className="section-title">
          <h3>{models[entity].label}</h3>
          {canWrite(user.role, entity) && (!isField(user) || ["contacts", "activities"].includes(entity)) && (
            <button
              className="text-button"
              onClick={() =>
                open(entity, {}, unitId ? { unit_id: unitId } : {})
              }
            >
              <Plus size={16} />
              Adicionar
            </button>
          )}
        </div>
        {items.length ? (
          items.map((r) => (
            <button
              className="record-line"
              key={r.id}
              onClick={() => open(entity, r)}
            >
              <div>
                <strong>{titleOf(r)}</strong>
                <small>
                  {r.owner ||
                    r.role ||
                    r.scope ||
                    r.category ||
                    reference(r) ||
                    "Informações a confirmar"}
                </small>
              </div>
              <Badge>{r.status || r.email || r.phone}</Badge>
              <ChevronRight size={16} />
            </button>
          ))
        ) : (
          <p className="muted">Nenhum registro nesta etapa.</p>
        )}
      </div>
    );
  }
  function UnitSummary() {
    return (
      <>
        <ClientContext unit={current} data={data} onOpen={(entity,record)=>{if(!record)return;if(entity==='conversations'){setDetail({conversation:record.id});}else open(entity,record);}} />
        {(current.sig_url || find("companies", current.company_id)?.sig_url) && <a className="button" target="_blank" rel="noopener noreferrer" href={current.sig_url || find("companies", current.company_id)?.sig_url}>Abrir SIG ↗</a>}
        <div className="detail-lead">
          <Badge>{current.status}</Badge>
          <Badge>{current.geo_status}</Badge>
          <p>
            {current.materials || "Materiais em estoque ainda não confirmados."}
          </p>
        </div>
        <div className="facts">
          {[
            ["Segmento", current.segment],
            ["Empresa", find("companies", current.company_id)?.name],
            ["Porte", current.size],
            ["Evidência", current.size_evidence],
            ["Prioridade", current.priority],
            ["Responsável", current.owner || "A definir"],
            ["Próxima ação", current.next_action || "A definir"],
            [
              "Retorno",
              current.next_date ? date(current.next_date) : "A definir",
            ],
            [
              "Deslocamento",
              current.distance_km != null
                ? current.distance_km +
                  " km / " +
                  current.travel_minutes +
                  " min"
                : "Não informado",
            ],
            [
              "Origem do deslocamento",
              current.travel_origin || "Não confirmada",
            ],
            ["Fonte", current.source],
            ["Data da fonte", date(current.source_date)],
          ].map(([label, value]) => (
            <div key={label}>
              <small>{label}</small>
              <strong>{value || "Não informado"}</strong>
            </div>
          ))}
        </div>
        <div className="actions">
          {canWrite(user.role, "activities") && (
            <button
              className="primary small"
              onClick={() =>
                open("activities", {}, {
                  unit_id: current.id,
                  name: "Abordagem — " + current.name,
                  owner: current.owner || "",
                })
              }
            >
              <CalendarPlus size={16} />
              Agendar contato
            </button>
          )}
          <button onClick={() => open("units", current)}>
            Editar cadastro
          </button>
          {current.maps_url && (
            <a href={current.maps_url} target="_blank" rel="noreferrer">
              Abrir localização
              <ArrowUpRight size={15} />
            </a>
          )}
        </div>
        <section className="related contact-shortcuts">
          <div className="section-title">
            <h3>Contatos da unidade</h3>
            <button className="text-button" onClick={() => setTab("Contatos")}>
              Ver todos
            </button>
          </div>
          {data.contacts
            .filter((contact) => contact.unit_id === current.id)
            .slice(0, 3)
            .map((contact) => {
              const phone = phoneLink(contact.phone);
              const whatsapp = whatsappLink(contact.phone);
              return (
                <div className="contact-shortcut" key={contact.id}>
                  <div>
                    <strong>{contact.name}</strong>
                    <small>
                      {contact.role ||
                        contact.phone ||
                        contact.email ||
                        "Canal a confirmar"}
                    </small>
                  </div>
                  <div className="contact-shortcut-links">
                    {phone && (
                      <a href={phone} aria-label={`Ligar para ${contact.name}`}>
                        <Phone size={15} />
                        Ligar
                      </a>
                    )}
                    {whatsapp && (
                      <a
                        href={whatsapp}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Abrir WhatsApp para ${contact.name}`}
                      >
                        <MessageCircle size={15} />
                        WhatsApp
                      </a>
                    )}
                    {contact.email && (
                      <a
                        href={`mailto:${encodeURIComponent(contact.email)}`}
                        aria-label={`Enviar e-mail para ${contact.name}`}
                      >
                        <Mail size={15} />
                        E-mail
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          {!data.contacts.some((contact) => contact.unit_id === current.id) && (
            <div className="empty-contact">
              <p>Nenhum contato cadastrado para esta unidade.</p>
              {canWrite(user.role, "contacts") && (
                <button
                  className="text-button"
                  onClick={() => open("contacts", {}, { unit_id: current.id })}
                >
                  <Plus size={15} />
                  Adicionar contato
                </button>
              )}
            </div>
          )}
        </section>
        <Records
          entity="activities"
          items={(data.activities || []).filter(
            (r) => r.unit_id === current.id,
          )}
          unitId={current.id}
        />
      </>
    );
  }
  if (!auth || !auth.user)
    return (
      <main className="login">
        <div className="login-story">
          <div className="brand">
            work<span>geo</span>
            <small>Relacionamento e operação</small>
          </div>
          <h1>
            O próximo passo
            <br />
            de cada cliente.
          </h1>
          <p>
            Prospecção, atendimento e materiais em um lugar. Uma base para
            crescer com método.
          </p>
          <div className="contours" aria-hidden="true" />
        </div>
        <form className="login-form" onSubmit={login}>
          <span className="pill">CRM WorkGeo</span>
          <h2>
            {auth?.setup
              ? "Criar o primeiro acesso"
              : "Bem-vindo à sua rotina comercial"}
          </h2>
          <p>
            {auth?.setup
              ? "Defina o administrador. Os demais acessos serão individuais."
              : "Entre para acompanhar os clientes e as próximas ações."}
          </p>
          {auth?.setup && (
            <label>
              Nome
              <input
                value={authForm.name}
                onChange={(e) =>
                  setAuthForm({ ...authForm, name: e.target.value })
                }
                required
              />
            </label>
          )}
          <label>
            E-mail
            <input
              type="email"
              value={authForm.email}
              onChange={(e) =>
                setAuthForm({ ...authForm, email: e.target.value })
              }
              autoComplete="username"
              required
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={authForm.password}
              minLength={auth?.setup ? 12 : 1}
              onChange={(e) =>
                setAuthForm({ ...authForm, password: e.target.value })
              }
              autoComplete={auth?.setup ? "new-password" : "current-password"}
              required
            />
          </label>
          {auth?.setup && auth?.hosted && (
            <label>
              Código de instalação
              <input
                type="password"
                value={authForm.token}
                onChange={(e) =>
                  setAuthForm({ ...authForm, token: e.target.value })
                }
                required
              />
            </label>
          )}
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <button className="primary" disabled={busy || !auth}>
            {busy
              ? "Aguarde…"
              : auth?.setup
                ? "Criar acesso e entrar"
                : "Entrar"}
          </button>
          <small>
            Dados restritos à equipe. Cada acesso tem suas permissões.
          </small>
        </form>
      </main>
    );
  if (!state)
    return <main className="loading">{error || "Carregando sua rotina…"}</main>;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          work<span>geo</span>
          <small>CRM</small>
        </div>
        <div className="workspace-label">Área comercial</div>
        <nav>
          {visibleNav.map(([key, label, Icon]) => (
            <div key={key} className={key === "administrative" ? "sidebar-admin-group" : "sidebar-nav-item"}>
            {key === "administrative" && <small className="sidebar-group-label">Rotina administrativa</small>}
            <button
              key={key}
              className={
                section === key ||
                (key === "materials" && section === "requests")
                  ? "active"
                  : ""
              }
              onClick={() => navigate(key)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {key === "units" && <small>{data.units.length}</small>}
            </button>
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="avatar">{user.name.slice(0, 1)}</div>
          <div>
            <strong>{user.name}</strong>
            <small>{user.role}</small>
          </div>
          <button
            aria-label="Sair"
            onClick={() =>
              perform(async () => {
                await post("/api/auth", { action: "logout" });
                conversationDraftCache.current = {};
                setConversationDraft('');
                setDetail(null);
                setState(null);
                setAuth({ user: null, setup: false });
              })
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>
            WorkGeo <ChevronRight size={14} />{" "}
            {nav.find(([k]) => k === section)?.[1] || models[section]?.label}
          </span>
          <div>
            <NotificationCenter onOpen={(id) => { const record = data.activities?.find((item) => item.id === id); if (record && !record.availability_only) { navigate("activities"); open("activities", record); } }} />
            <button className="feedback-trigger" onClick={() => setFeedbackOpen(true)}>
              Reportar atrito
            </button>
            <span className="date-label">
              {new Date().toLocaleDateString("pt-BR", {
                day: "numeric",
                month: "long",
                timeZone: "America/Sao_Paulo",
              })}
            </span>
            <button
              aria-label="Atualizar dados"
              onClick={() => perform(reload)}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <p className="section-context">
                {section === "dashboard"
                  ? "Sua rotina comercial"
                  : "CRM WorkGeo"}
              </p>
              <h1>
                {section === "dashboard"
                  ? "Cada relacionamento, um próximo passo."
                  : nav.find(([k]) => k === section)?.[1] ||
                    models[section]?.label}
              </h1>
              <p>
                {section === "dashboard"
                  ? "Organize o que precisa de atenção e avance com uma base confiável."
                  : section === "units"
                    ? "Cadastre uma empresa e inclua locais e contatos quando precisar."
                    : section === "materials"
                      ? "Organize arquivos aprovados e acompanhe o que cada cliente pediu."
                      : section === "conversations"
                        ? "Atendimento compartilhado, com contexto e responsável."
                        : section === "prospects"
                          ? "Revise atividade, porte e localização antes de transformar um candidato em cliente."
                          : section === "leads"
                            ? "Priorize as empresas com sinais mais fortes de aderência e confira os motivos antes de avançar."
                          : section === "administrative"
                            ? "Boletins, documentos e acompanhamento da equipe."
                        : "Acompanhe os registros e mantenha os próximos passos claros."}
              </p>
            </div>
            {(section !== "activities" && !(isField(user) && ["units", "services", "requests"].includes(section)) && (models[section] && canWrite(user.role, section) || section === "units" && canWrite(user.role, "units"))) && (
              <div className="page-heading-actions">
                {section === "units" && <button onClick={() => setClientImportOpen(true)}><Upload size={16} />Importar lista</button>}
                {models[section] && canWrite(user.role, section) && (
                  <button className="primary" onClick={() => open(section)}>
                    <Plus size={17} />
                    {section === "units"
                      ? "Novo cliente"
                      : section === "materials"
                        ? "Novo material"
                        : section === "requests"
                          ? "Registrar pedido"
                          : "Adicionar " + models[section].singular}
                  </button>
                )}
              </div>
            )}
          </div>
          {error && (
            <div className="error" role="alert">
              <AlertCircle size={17} />
              {error}
              <button aria-label="Fechar erro" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <Check size={16} />
              {notice}
            </div>
          )}
          {section === "prospects" && <ProspectingDesk companies={data.companies} initialSearch={prospectSearch} initialRegion={mapRegionId} />}
          {section === "team" && isManagement(user) && <TeamDesk user={user} onReload={reload} onSessionEnded={() => { setState(null); setAuth({ user: null, setup: false }); setNotice("E-mail atualizado. Entre com o novo endereço."); }} />}
          {section === "flights" && flightReaders(user) && <FlightDesk user={user} data={data} directory={directory} />}
          {section === "activities" && <AgendaDesk data={data} user={user} directory={directory} onOpen={open} />}
          {section === "settings" && isManagement(user) && <OwnerMapping directory={directory} onReload={reload} />}
          {section === "profile" && <MyProfile onReload={reload} />}
          {section === "units" && <div className="agenda-tabs"><button aria-pressed={clientView === "clients"} onClick={() => setClientView("clients")}>Clientes</button><button aria-pressed={clientView === "contacts"} onClick={() => setClientView("contacts")}>Contatos</button></div>}
          {section === "units" && clientView === "contacts" && <ContactDirectory data={data} onOpen={open} />}
          {section === "administrative" && <AdministrativeDesk directory={directory} data={data} catalog={state.administrativeCatalog} allocations={state.allocations} user={user} onReload={reload} onOpen={(entity, record, prefill) => open(entity, record, prefill, { administrative: true })} onOpenConversation={openAdministrativeConversation} onNotice={setNotice} onDeleteRecord={deleteAdministrativeEntry} onAllocate={(receipt) => open("allocation", {}, { receipt_id: receipt.id })} />}
          {section === "leads" && <LeadDesk focusCnpj={leadFocusCnpj} onOpenClient={(unitId) => { const unit = data.units.find((item) => item.id === unitId); if (unit) { setDetail(unit); setTab("Resumo"); } }} onOpenProspect={(cnpj) => { setProspectSearch(cnpj); setSearch(cnpj); setSection("prospects"); window.scrollTo(0, 0); }} />}
          {section === "dashboard" && (
            <>
              <div className="metrics">
                {[
                  [
                    "Unidades na base",
                    data.units.length,
                    "Unidades e locais cadastrados",
                    Building2,
                  ],
                  [
                    "Oportunidades abertas",
                    data.opportunities.filter(
                      (r) => !["Ganha", "Perdida"].includes(r.status),
                    ).length,
                    "Negócios em andamento",
                    ChartNoAxesCombined,
                  ],
                  [
                    "Retornos vencidos",
                    queue.filter(overdue).length,
                    "Ações do fluxo comercial",
                    CalendarDays,
                  ],
                  [
                    "Conversas para responder",
                    data.conversations.filter(
                      (r) => r.status === "Aguardando equipe",
                    ).length + (state.unassigned?.length || 0),
                    `${state.unassigned?.length || 0} sem vínculo confirmado`,
                    ClipboardList,
                  ],
                ].map(([label, value, sub, Icon]) => (
                  <div className="metric" key={label}>
                    <div>
                      <span>{label}</span>
                      <Icon size={19} />
                    </div>
                    <strong>{value}</strong>
                    <small>{sub}</small>
                  </div>
                ))}
              </div>
              <div className="dashboard-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Ações que precisam avançar</h2>
                      <p>Uma fila para conduzir o dia.</p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("activities")}
                    >
                      Ver agenda
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <div
                    className="queue-filters"
                    aria-label="Filtrar ações por prazo"
                  >
                    <label className="queue-owner-filter">
                      Responsável
                      <select aria-label="Filtrar ações por responsável" value={queueOwnerFilter} onChange={(event) => setQueueOwnerFilter(event.target.value)}>
                        <option value="">Toda a equipe</option>
                        {queueOwnerOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                        <option value="__unassigned">Sem responsável</option>
                      </select>
                    </label>
                    {queueFilters.map((item) => {
                      const count =
                        item === "Todas"
                          ? ownerQueue.length
                          : ownerQueue.filter(
                              (row) => actionDateStatus(row, queueToday) === item,
                            ).length;
                      return (
                        <button
                          key={item}
                          type="button"
                          className={queueFilter === item ? "selected" : ""}
                          aria-pressed={queueFilter === item}
                          onClick={() => setQueueFilter(item)}
                        >
                          {item === "Agendada" ? "Próximas" : item}{" "}
                          <span>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  {visibleQueue.length ? (
                    <>
                      {visibleQueue.map((r) => {
                        const dateStatus = actionDateStatus(r, queueToday);
                        return (
                          <div className="queue-item" key={r.entity + r.id}>
                            <div className="queue-item-main">
                              <button className="record-line" onClick={() => r.entity === "lead_followups" ? (setLeadFocusCnpj(r.cnpj), navigate("leads")) : open(r.entity, r)}>
                                <span className={"due " + (dateStatus === "Vencida" ? "late" : "")}>
                                  <strong>{date(r.due_date || r.next_date)}</strong>
                                  <small>{dateStatus}</small>
                                </span>
                                <div>
                                  <strong>{r.name}</strong>
                                  <small>{r.kind} · {reference(r) || "Cliente sem vínculo"} · {r.owner || "Responsável a definir"}</small>
                                  {r.waiting_reason && <small>{waitingLabel(r)}</small>}
                                  {r.stage_started_at && <small>Último andamento registrado em {date(r.stage_started_at)}</small>}
                                </div>
                                <ChevronRight size={16} />
                              </button>
                              {r.entity === "activities" && canWrite(user.role, "activities") && (
                                <button type="button" className="queue-complete" disabled={busy} onClick={() => { setQuickCompletion(quickCompletion === r.id ? null : r.id); setQuickResult(""); }}>
                                  <Check size={15} /> Concluir
                                </button>
                              )}
                            </div>
                            {quickCompletion === r.id && (
                              <form className="quick-completion" onSubmit={(event) => { event.preventDefault(); completeQueuedActivity(r); }}>
                                <label>Resultado do contato<textarea required minLength={2} maxLength={1000} rows={2} value={quickResult} onChange={(event) => setQuickResult(event.target.value)} placeholder="Ex.: Conversamos e combinamos retorno na próxima semana." /></label>
                                <div><button type="button" onClick={() => { setQuickCompletion(null); setQuickResult(""); }}>Cancelar</button><button className="primary small" disabled={busy || !quickResult.trim()}>Salvar e concluir</button></div>
                              </form>
                            )}
                          </div>
                        );
                      })}
                      {filteredQueue.length > visibleQueue.length && (
                        <p className="queue-more">
                          Mostrando 8 de{" "}
                          {filteredQueue.length}{" "}
                          ações. Use os filtros para localizar uma pendência.
                        </p>
                      )}
                    </>
                  ) : (
                    <Empty
                      title={
                          ownerQueue.length
                          ? "Nenhuma ação neste filtro"
                          : "Vamos organizar os primeiros contatos"
                      }
                      text={
                          ownerQueue.length
                          ? "Escolha outro prazo para ver as ações."
                          : "Abra uma unidade e defina a próxima ação. Sua agenda começa aqui."
                      }
                    />
                  )}
                  <button
                    className="primary small"
                    onClick={() => open("activities")}
                  >
                    <Plus size={16} />
                    Agendar atividade
                  </button>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Qualidade da base</h2>
                      <p>Pendências que orientam a pesquisa.</p>
                    </div>
                  </div>
                  {[
                    [
                      "Sem porte confirmado",
                      data.units.filter((r) => r.size === "Desconhecido")
                        .length,
                      "porte",
                    ],
                    [
                      "Localização por conferir",
                      data.units.filter((r) => r.latitude == null).length,
                      "localizacao",
                    ],
                    [
                      "Sem responsável",
                      data.units.filter((r) => !r.owner).length,
                      "responsavel",
                    ],
                    [
                      "Sem próxima ação",
                      data.units.filter((r) => !r.next_action).length,
                      "proxima-acao",
                    ],
                  ].map(([label, value, reviewFilter]) => (
                    <button
                      className="quality-line quality-link"
                      key={label}
                      onClick={() => {
                        navigate("units");
                        setUnitReviewFilter(reviewFilter);
                      }}
                    >
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </button>
                  ))}
                  <div className="source-note">
                    <AlertCircle size={18} />
                    <p>
                      Os registros importados estão em pesquisa. Telefone, porte
                      e demanda precisam de conferência antes da abordagem.
                    </p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("units")}
                  >
                    Conferir cadastros
                    <ChevronRight size={16} />
                  </button>
                </section>
              </div>
              <section className="panel pipeline">
                <div className="panel-heading">
                  <div>
                    <h2>Do diagnóstico ao fechamento</h2>
                    <p>Etapas comerciais com evidência para avançar.</p>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("opportunities")}
                  >
                    Abrir oportunidades
                    <ChevronRight size={16} />
                  </button>
                </div>
                <div className="stage-strip">
                  {models.opportunities.fields
                    .find((f) => f.key === "status")
                    .options.map((s) => (
                      <div key={s}>
                        <span>{s}</span>
                        <strong>
                          {
                            data.opportunities.filter((r) => r.status === s)
                              .length
                          }
                        </strong>
                      </div>
                    ))}
                </div>
              </section>
            </>
          )}
          {section === 'services' && <OperationOverview data={data} user={user} onOpen={open} onPrepare={opportunity=>perform(async()=>{const result=await post('/api/operations/prepare',{id:opportunity.id,version:opportunity.version});await reload();open('services',result.service);setNotice(result.created?'Operação preparada. Confira os dados antes de agendar.':'Esta operação já estava preparada.');})} />}
          {["materials", "requests"].includes(section) && (
            <div className="tabs area-tabs">
              <button
                className={section === "materials" ? "active" : ""}
                onClick={() => navigate("materials")}
              >
                Biblioteca comercial
              </button>
              <button
                className={section === "requests" ? "active" : ""}
                onClick={() => navigate("requests")}
              >
                Pedidos dos clientes{" "}
                <Badge>
                  {data.requests.filter((r) => r.status !== "Concluída").length}
                </Badge>
              </button>
            </div>
          )}
          {models[section] && section !== "activities" && !(section === "units" && clientView === "contacts") && (
            <>
              {section === "conversations" && state.unassigned?.length > 0 && (
                <section className="panel">
                  <h2>Mensagens sem vínculo</h2>
                  <p>
                    Confira o remetente e associe a um contato antes de atender.
                  </p>
                  {state.unassigned.map((event) => (
                    <div key={event.id} className="related">
                      <strong>{event.sender}</strong>
                      <p>{event.body}</p>
                    {event.attachments?.map((attachment, index) => (
                      <p key={index}>
                        {attachment.download_url ? (
                          <a href={attachment.download_url}>{attachment.filename || "Baixar anexo"}</a>
                        ) : (
                          <span className="muted">{attachment.filename || "Mídia recebida"} · {attachment.download_error || "arquivo ainda não disponível para download"}</span>
                        )}
                        {attachment.download_status === "Falha" && attachment.provider_media_id && <button className="text-button" onClick={() => perform(async () => { const result = await post(`/api/messages/${encodeURIComponent(event.id)}/attachments/${index}`, {}); await reload(); setNotice(result.error || "Anexo arquivado."); })}>Tentar arquivar novamente</button>}
                      </p>
                    ))}
                      <select
                        aria-label={"Vincular mensagem de " + event.sender}
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value)
                            perform(async () => {
                              await post("/api/inbox/link", {
                                id: event.id,
                                contact_id: e.target.value,
                              });
                              await reload();
                              setNotice("Mensagem vinculada ao contato.");
                            });
                        }}
                      >
                        <option value="">Escolher contato confirmado</option>
                        {data.contacts.map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.name} — {find("units", c.unit_id)?.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </section>
              )}
              <div className="toolbar">
                <div className="search">
                  <Search size={17} />
                  <input
                    aria-label="Pesquisar registros"
                    placeholder={
                      section === "units"
                        ? "Empresa, unidade, contato, telefone ou cidade…"
                        : "Buscar nome, contexto ou unidade…"
                    }
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      if (section === "units") clearUnitSelection();
                    }}
                  />
                </div>
                {models[section].fields.find((f) => f.key === "status") && (
                  <select
                    aria-label="Filtrar situação"
                    value={filter}
                    onChange={(e) => updateListFilter(setFilter, e.target.value)}
                  >
                    <option value="">Todas as situações</option>
                    {models[section].fields
                      .find((f) => f.key === "status")
                      .options.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                  </select>
                )}
                {section === "units" && (
                  <>
                    <select
                      aria-label="Filtrar pendência de cadastro"
                      value={unitReviewFilter}
                      onChange={(e) => updateListFilter(setUnitReviewFilter, e.target.value)}
                    >
                      <option value="">Todas as pendências</option>
                      <option value="porte">Sem porte confirmado</option>
                      <option value="localizacao">Localização por conferir</option>
                      <option value="responsavel">Sem responsável</option>
                      <option value="proxima-acao">Sem próxima ação</option>
                    </select>
                    <select
                      aria-label="Filtrar segmento"
                      value={segment}
                      onChange={(e) => updateListFilter(setSegment, e.target.value)}
                    >
                      <option value="">Todos os segmentos</option>
                      {[...new Set(data.units.map((r) => r.segment))].map(
                        (s) => (
                          <option key={s}>{s}</option>
                        ),
                      )}
                    </select>
                    <select
                      aria-label="Filtrar responsável"
                      value={owner}
                      onChange={(e) => updateListFilter(setOwner, e.target.value)}
                    >
                      <option value="">Todos os responsáveis</option>
                      {[...new Set([...directory.map((person) => person.name), ...data.units.map((unit) => unit.owner).filter(Boolean)])].map((name) => <option key={name}>{name}</option>)}
                    </select>
                    <select
                      aria-label="Filtrar prioridade"
                      value={priority}
                      onChange={(e) => updateListFilter(setPriority, e.target.value)}
                    >
                      <option value="">Todas as prioridades</option>
                      {["Alta", "Média", "Baixa", "Não definida"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </>
                )}
              </div>
              <section className="panel records-panel">
                <div className="list-caption">
                  <span>{rows.length} registros</span>
                  {section === "units" &&
                    !isOperational(user) && canWrite(user.role, "units") &&
                    selectedUnitIds.length > 0 && (
                      <div className="bulk-assignment">
                        <span>{selectedUnitIds.length} selecionados</span>
                        <select
                          aria-label="Responsável para atribuição em lote"
                          value={bulkOwner}
                          onChange={(e) => setBulkOwner(e.target.value)}
                        >
                          <option value="">Escolha o responsável</option>
                          {directory.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                        </select>
                        <input
                          aria-label="Próxima ação em lote"
                          placeholder="Próxima ação (opcional)"
                          value={bulkNextAction}
                          onChange={(e) => setBulkNextAction(e.target.value)}
                        />
                        <input
                          aria-label="Prazo da próxima ação em lote"
                          type="date"
                          value={bulkNextDate}
                          onChange={(e) => setBulkNextDate(e.target.value)}
                        />
                        <button
                          className="primary small"
                          disabled={
                            !bulkOwner ||
                            selectedUnitIds.length > 50 ||
                            Boolean(bulkNextAction.trim()) !== Boolean(bulkNextDate) ||
                            busy
                          }
                          onClick={assignSelectedUnits}
                        >
                          Aplicar à seleção
                        </button>
                        <button
                          className="text-button"
                          onClick={clearUnitSelection}
                        >
                          Limpar seleção
                        </button>
                        <small className="bulk-assignment-hint">
                          A ação e a data, se preenchidas, serão aplicadas a todas as fichas selecionadas.
                        </small>
                      </div>
                    )}
                  {section === "invoices" && (
                    <div className="actions">
                      <button onClick={() => navigate("receipts")}>
                        Recebimentos
                      </button>
                      <button
                        onClick={() =>
                          setModal({
                            entity: "allocation",
                            values: {},
                            record: {},
                          })
                        }
                      >
                        Conciliar pagamento
                      </button>
                    </div>
                  )}
                  {section === "conversations" && (
                    <button onClick={() => navigate("templates")}>
                      Modelos de mensagem
                    </button>
                  )}
                </div>
                {rows.length ? (
                  section === "materials" ? (
                    <div className="material-grid">
                      {rows.map((r) => (
                        <article key={r.id} className="material-card">
                          <div className="material-title">
                            <FileText size={25} />
                            <Badge>
                              {r.status === "Aprovado"
                                ? "Disponível para envio"
                                : r.status}
                            </Badge>
                          </div>
                          <h3>{r.name}</h3>
                          <p>
                            {r.category || "Tipo a definir"} ·{" "}
                            {r.service || "Serviço a definir"}
                          </p>
                          <small>
                            {r.segment || "Todos os segmentos"} · versão{" "}
                            {r.revision}
                          </small>
                          <p className="material-description">
                            {r.notes ||
                              "Adicione uma descrição curta para orientar o uso deste material."}
                          </p>
                          <div className="actions">
                            {r.file_id ? (
                              (() => {
                                const file = state.files.find((item) => item.id === r.file_id);
                                const isPdf = file?.content_type === "application/pdf" || file?.filename?.toLowerCase().endsWith(".pdf");
                                return <>
                                  {isPdf && <a href={"/api/files/" + r.file_id + "?view=1"} target="_blank" rel="noreferrer">Visualizar PDF<ArrowUpRight size={14} /></a>}
                                  <a href={"/api/files/" + r.file_id} download>
                                    <Download size={14} />
                                    {isPdf ? "Baixar PDF" : "Baixar arquivo"}
                                  </a>
                                </>;
                              })()
                            ) : r.url ? (
                              <a href={r.url} target="_blank" rel="noreferrer">
                                Abrir link
                                <ArrowUpRight size={14} />
                              </a>
                            ) : (
                              <small>Arquivo ou link pendente</small>
                            )}
                            <button onClick={() => open("materials", r)}>
                              Editar
                            </button>
                            <button
                              onClick={() => {
                                const {
                                  id,
                                  version,
                                  file_id,
                                  created_at,
                                  updated_at,
                                  ...base
                                } = r;
                                open(
                                  "materials",
                                  {},
                                  {
                                    ...base,
                                    revision: String(
                                      (Number(r.revision) || 1) + 1,
                                    ),
                                    status: "Rascunho",
                                    url: null,
                                    approval: null,
                                  },
                                );
                              }}
                            >
                              Nova versão
                            </button>
                            {r.status === "Rascunho" &&
                              [
                                "Administrador",
                                "Aprovação comercial",
                                "Técnico",
                              ].includes(user.role) &&
                              (r.file_id || r.url) && (
                                <button
                                  onClick={() =>
                                    perform(async () => {
                                      await post("/api/records/materials", {
                                        id: r.id,
                                        version: r.version,
                                        data: {
                                          status: "Aprovado",
                                          approval:
                                            "Aprovado por " +
                                            user.name +
                                            " em " +
                                            today(),
                                        },
                                      });
                                      await reload();
                                      setNotice(
                                        "Material aprovado para envio.",
                                      );
                                    })
                                  }
                                >
                                  Aprovar para envio
                                </button>
                              )}
                            {r.status === "Aprovado" && (
                              <button
                                onClick={() =>
                                  open(
                                    "requests",
                                    {},
                                    {
                                      material_id: r.id,
                                      name: "Enviar " + r.name,
                                      status: "Recebida",
                                    },
                                  )
                                }
                              >
                                Criar pedido de envio
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            {section === "units" && !isOperational(user) && canWrite(user.role, "units") && (
                              <th>
                                <input
                                  type="checkbox"
                                  aria-label="Selecionar todos os clientes desta lista"
                                  checked={
                                    rows.length > 0 &&
                                    rows.every((row) => selectedUnitIds.includes(row.id))
                                  }
                                  disabled={rows.length === 0 || rows.length > 50}
                                  onChange={(e) => {
                                    if (e.target.checked)
                                      setSelectedUnitIds(rows.map((row) => row.id));
                                    else clearUnitSelection();
                                  }}
                                />
                              </th>
                            )}
                            <th>
                              {section === "units" ? "Unidade" : "Registro"}
                            </th>
                            <th>
                              {section === "units"
                                ? "Segmento"
                                : "Unidade / referência"}
                            </th>
                            <th>Situação</th>
                            <th>
                              {section === "invoices"
                                ? "Saldo"
                                : "Responsável / contato"}
                            </th>
                            <th>Próximo prazo</th>
                            <th>
                              <span className="sr-only">Abrir</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr
                              key={r.id}
                              onClick={() => {
                                if (section === "units") {
                                  setDetail(r);
                                  setTab("Resumo");
                                } else if (section === "conversations") {
                                  setDetail({ conversation: r.id });
                                  setTab("Mensagens");
                                } else open(section, r);
                              }}
                            >
                              {section === "units" && !isOperational(user) && canWrite(user.role, "units") && (
                                <td className="select-cell">
                                  <input
                                    type="checkbox"
                                    aria-label={`Selecionar ${titleOf(r)}`}
                                    checked={selectedUnitIds.includes(r.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => {
                                      if (
                                        e.target.checked &&
                                        selectedUnitIds.length >= 50
                                      ) {
                                        setError("Atribua até 50 clientes por vez.");
                                        return;
                                      }
                                      setSelectedUnitIds((current) =>
                                        e.target.checked ? [...current, r.id] : current.filter((id) => id !== r.id),
                                      );
                                      if (
                                        !e.target.checked &&
                                        selectedUnitIds.length <= 1
                                      ) {
                                        setBulkOwner("");
                                        setBulkNextAction("");
                                        setBulkNextDate("");
                                      }
                                    }}
                                  />
                                </td>
                              )}
                              <td>
                                <button
                                  className="row-name"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (section === "units") {
                                      setDetail(r);
                                      setTab("Resumo");
                                    } else if (section === "conversations")
                                      setDetail({ conversation: r.id });
                                    else open(section, r);
                                  }}
                                >
                                  {titleOf(r)}
                                </button>
                                {section === "units" && (
                                  <small>
                                    {r.priority === "Não definida"
                                      ? "Prioridade a definir"
                                      : r.priority +
                                        " · " +
                                        (r.priority_reason || "")}
                                  </small>
                                )}
                              </td>
                              <td>
                                {section === "units"
                                  ? r.segment
                                  : reference(r) || "—"}
                              </td>
                              <td>
                                <Badge>
                                  {r.status || r.geo_status || "Cadastrado"}
                                </Badge>
                              </td>
                              <td>
                                {section === "invoices"
                                  ? BRL.format(invoiceBalance(r) / 100)
                                  : r.owner ||
                                    r.email ||
                                    r.phone ||
                                    "A definir"}
                              </td>
                              <td className={overdue(r) ? "late" : ""}>
                                {r.due_date || r.next_date || r.scheduled_date
                                  ? date(
                                      r.due_date ||
                                        r.next_date ||
                                        r.scheduled_date,
                                    )
                                  : "A definir"}
                              </td>
                              <td>
                                <ChevronRight size={16} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : (
                  <Empty
                    title={
                      section === "materials"
                        ? "Sua biblioteca começa aqui"
                        : section === "requests"
                          ? "Nenhum pedido de material"
                          : undefined
                    }
                    text={
                      section === "materials"
                        ? "Adicione um arquivo ou link. O material fica em rascunho até a equipe aprovar."
                        : section === "requests"
                          ? "Registre o que o cliente pediu, quem vai atender e o prazo."
                          : undefined
                    }
                    action={
                      section === "materials"
                        ? "Adicionar material"
                        : section === "requests"
                          ? "Registrar pedido"
                          : undefined
                    }
                    onAction={() => open(section)}
                  />
                )}
              </section>
            </>
          )}
          {section === "map" && (
            <>
              <div className="toolbar">
                <select aria-label="Região de prospecção no mapa" value={mapRegionId} onChange={(e) => setMapRegionId(e.target.value)}>
                  {regionCatalog.regions.map((region) => <option key={region.id} value={region.id}>{region.name} · {region.radius_km} km</option>)}
                </select>
                <select
                  aria-label="Segmento no mapa"
                  value={segment}
                  onChange={(e) => updateListFilter(setSegment, e.target.value)}
                >
                  <option value="">Todos os segmentos</option>
                  {[...new Set(data.units.map((r) => r.segment))].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <select
                  aria-label="Responsável no mapa"
                  value={owner}
                  onChange={(e) => updateListFilter(setOwner, e.target.value)}
                >
                  <option value="">Todos os responsáveis</option>
                  {["Tiago", "Fábio", "Josi", "Pedro", "Douglas"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <select
                  aria-label="Prioridade no mapa"
                  value={priority}
                  onChange={(e) => updateListFilter(setPriority, e.target.value)}
                >
                  <option value="">Todas as prioridades</option>
                  {["Alta", "Média", "Baixa", "Não definida"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <select
                  aria-label="Etapa no mapa"
                  value={filter}
                  onChange={(e) => updateListFilter(setFilter, e.target.value)}
                >
                  <option value="">Todas as etapas</option>
                  {models.units.fields
                    .find((f) => f.key === "status")
                    .options.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                </select>
              </div>
              <section className="panel">
                <div className="map-display-options">
                  <label><input type="checkbox" checked={mapShowProspects} onChange={(event) => setMapShowProspects(event.target.checked)} />Mostrar candidatos da prospecção</label>
                  <span>Os filtros acima se aplicam aos clientes cadastrados. Desmarque para ver somente esses clientes.</span>
                </div>
                <TerritoryMap
                  territory={state.territory}
                  units={units}
                  prospects={mapShowProspects ? selectedMapProspectingData?.points || EMPTY_PROSPECTING_MAP_POINTS : EMPTY_PROSPECTING_MAP_POINTS}
                  region={selectedMapRegion}
                  onSelect={setDetail}
                  onSelectProspect={openProspectFromMap}
                />
                <p className="source-note">Arraste o mapa para qualquer lado ou use as setas. O botão de casa reenquadra a área. Marcadores numerados representam grupos, não a posição exata de uma empresa; amplie para ver as coordenadas individuais.</p>
                <p className="source-note"><strong>{selectedMapRegion.name} · raio de referência de {selectedMapRegion.radius_km} km.</strong> {selectedMapRegion.center_status} Fonte do ponto: {selectedMapRegion.center_source}</p>
                <p className="source-note">{prospectingMapLoading ? `${(prospectingMapResult?.points.length || 0).toLocaleString("pt-BR")} pontos carregados · carregando os demais…` : selectedMapProspectingData ? `${selectedMapProspectingData.total.toLocaleString("pt-BR")} candidatos com coordenada nesta região · ${selectedMapProspectingData.area_counts.within.toLocaleString("pt-BR")} dentro e ${selectedMapProspectingData.area_counts.outside.toLocaleString("pt-BR")} fora do raio.${selectedMapProspectingData.truncated ? ` O mapa desenha ${selectedMapProspectingData.points.length.toLocaleString("pt-BR")} pontos.` : " Todos os pontos disponíveis nesta região estão no mapa."}` : prospectingMapError || "A camada de candidatos aparecerá quando houver sugestões de localização importadas."}</p>
                <div className="map-legend" aria-label="Legenda dos segmentos">
                  {[...new Set(data.units.map((u) => u.segment))]
                    .sort()
                    .map((s) => (
                      <button
                        key={s}
                        className={segment === s ? "selected" : ""}
                        onClick={() => setSegment(segment === s ? "" : s)}
                      >
                        <i style={{ background: segmentColor(s) }} />
                        <span>{s}</span>
                        <strong>
                          {
                            data.units.filter(
                              (u) => u.segment === s && u.latitude != null,
                            ).length
                          }
                        </strong>
                      </button>
                    ))}
                  {selectedMapRegion.id === "belo-horizonte-170km" && <span className="territory-key">
                    <i />
                    Limite territorial do KML histórico
                  </span>}
                  {selectedMapProspectingData && <span className="candidate-map-key"><i className="confirmed" />Candidato · coordenada confirmada</span>}
                  {selectedMapProspectingData && <span className="candidate-map-key"><i className="suggested" />Candidato · sugestão para revisar</span>}
                  {selectedMapProspectingData && <span className="candidate-map-key"><i className="outside" />Candidato · sugestão fora do raio</span>}
                  {selectedMapProspectingData && <span className="candidate-map-key"><i className="cluster-key">n</i>Grupo de candidatos · amplie</span>}
                  <span className="candidate-map-key"><i className="reference" />Centro de referência do raio</span>
                  <span className="candidate-map-key"><i className="map-line radius" />Raio geodésico selecionado</span>
                </div>
                <div className="map-footer">
                  <strong>
                    {units.filter((u) => u.latitude != null).length} unidades
                    posicionadas
                  </strong>
                  <span>
                    {units.filter((u) => u.latitude == null).length}{" "}
                    localizações pendentes de conferência
                  </span>
                  <p>
                    {selectedMapRegion.id === "belo-horizonte-170km"
                      ? "Contorno original do KML histórico. A borda vermelha dos pontos indica posição fora do raio selecionado. Distância por estrada é registrada separadamente."
                      : "O círculo mostra o raio selecionado; a borda vermelha indica unidade fora desse raio. Distância por estrada é registrada separadamente."} Cadastre coordenadas na ficha da unidade para posicioná-la.
                  </p>
                  {data.units
                    .filter((u) => u.geo_issue)
                    .map((u) => (
                      <p className="late" key={u.id}>
                        {u.geo_issue}
                      </p>
                    ))}
                </div>
              </section>
            </>
          )}
          {section === "settings" && (
            <div className="settings-grid">
              <PilotMetrics rows={feedbackRows} />
              <section className="panel">
                <h2>Base e portabilidade</h2>
                <p>Importação da planilha fornecida em 13/10/2026.</p>
                <div className="quality-line">
                  <span>Unidades preservadas</span>
                  <strong>{state.importReport?.units}</strong>
                </div>
                <div className="quality-line">
                  <span>Contatos separados</span>
                  <strong>{state.importReport?.contacts}</strong>
                </div>
                <div className="quality-line">
                  <span>Linhas apenas numeradas excluídas</span>
                  <strong>{state.importReport?.excludedNumberOnly}</strong>
                </div>
                <p>{state.importReport?.grouping}</p>
                <div className="source-note">
                  Conferir o telefone compartilhado de MBL e Itabrita. O vínculo
                  não foi presumido.
                </div>
                <div className="actions">
                  <button onClick={() => navigate("companies")}>
                    Empresas
                  </button>
                  <button onClick={() => navigate("contacts")}>Contatos</button>
                  {isManagement(user) && (
                    <a href="/api/export">
                      <Download size={16} />
                      Exportar dados
                    </a>
                  )}
                </div>
              </section>
              <section className="panel">
                <h2>Canais e infraestrutura</h2>
                <h3>Recuperação e cópias de segurança</h3>
                <p>{state.recoveryBackup?.verified_at ? `Última restauração verificada: ${new Date(state.recoveryBackup.verified_at).toLocaleString('pt-BR')}. Cópia pré-alteração; ${state.recoveryBackup.tables} tabelas conferidas.` : 'Nenhuma restauração verificada registrada neste ambiente.'}</p>
                <p>{state.backupAttempt ? `Última tentativa diária: ${state.backupAttempt.status} · ${new Date(state.backupAttempt.started_at).toLocaleString('pt-BR')}` : 'Nenhuma tentativa diária registrada pelo novo monitoramento.'}</p>
                {state.backupAttempt?.message&&<p role="status">{state.backupAttempt.message}</p>}
                <p className="form-hint">Uma cópia pré-alteração não comprova a execução do backup diário. Tentativa em andamento sem conclusão exige conferência.</p>
                {[
                  ["WhatsApp — envio", state.integrations.whatsapp],
                  ["WhatsApp — recebimento", state.integrations.whatsappInbound],
                  ["Envio de e-mail", state.integrations.email],
                  ["Recebimento de e-mail", state.integrations.inboundEmail],
                  ["Arquivos privados na nuvem", state.integrations.storage],
                ].map(([label, ready]) => (
                  <div className="quality-line" key={label}>
                    <span>{label}</span>
                    <Badge>
                      {ready ? "Variáveis presentes" : "Configuração pendente"}
                    </Badge>
                  </div>
                ))}
                <p>
                  Banco de dados: {state.integrations.database}.
                </p>
                <p>
                  O status verifica somente a presença das variáveis; ainda é
                  necessário confirmar que as credenciais e contas funcionam.
                </p>
                {isManagement(user) && (
                  <div className="channel-setup">
                    <h3>Como habilitar os canais</h3>
                    <p>
                      Adicione as chaves na Vercel para Produção e Prévia e
                      publique uma nova versão. Não cole senhas ou tokens no CRM.
                    </p>
                    <details>
                      <summary>WhatsApp Business Platform</summary>
                      <p>
                        Envio: <code>WHATSAPP_TOKEN</code>,{" "}
                        <code>WHATSAPP_PHONE_ID</code> e{" "}
                        <code>WHATSAPP_API_VERSION</code>.
                      </p>
                      <p>
                        Recebimento: <code>WHATSAPP_VERIFY_TOKEN</code> e{" "}
                        <code>WHATSAPP_APP_SECRET</code>, além do ID do número.
                        Configure também o webhook da Meta para{" "}
                        <code>/api/webhooks/whatsapp</code>.
                      </p>
                    </details>
                    <details>
                      <summary>E-mail</summary>
                      <p>
                        Envio: <code>SMTP_HOST</code> e <code>SMTP_FROM</code>.
                        Se o provedor exigir autenticação, adicione{" "}
                        <code>SMTP_USER</code> e <code>SMTP_PASSWORD</code>.
                      </p>
                      <p>
                        Recebimento: <code>IMAP_HOST</code>, <code>IMAP_USER</code>{" "}
                        e <code>IMAP_PASSWORD</code>. A porta IMAP padrão é 993.
                      </p>
                    </details>
                    <div className="channel-setup-links">
                      <a
                        href="https://vercel.com/tiagotameiraos-projects/workgeo-crm"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Abrir projeto na Vercel
                        <ArrowUpRight size={14} />
                      </a>
                      <a
                        href="https://vercel.com/docs/environment-variables/managing-environment-variables"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Instruções de variáveis
                        <ArrowUpRight size={14} />
                      </a>
                    </div>
                    <h3>Testar conexão de e-mail</h3>
                    <p>
                      Estes testes só conectam e autenticam. Não enviam e-mail
                      nem leem mensagens da caixa.
                    </p>
                    <div className="channel-checks">
                      {[
                        ["smtp", "Testar envio SMTP", state.integrations.email],
                        ["imap", "Testar recebimento IMAP", state.integrations.inboundEmail],
                      ].map(([channel, label, configured]) => (
                        <div className="channel-check" key={channel}>
                          <button
                            type="button"
                            disabled={!configured || busy}
                            onClick={() => checkIntegrationChannel(channel)}
                          >
                            {label}
                          </button>
                          {connectionChecks[channel] && (
                            <p
                              className={connectionChecks[channel].ok ? "check-success" : "check-failure"}
                              role="status"
                            >
                              {connectionChecks[channel].message}
                              {connectionChecks[channel].checkedAt && (
                                <small>
                                  {new Date(connectionChecks[channel].checkedAt).toLocaleTimeString("pt-BR", {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                    timeZone: "America/Sao_Paulo",
                                  })}
                                </small>
                              )}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                    <h3>Testar acesso ao WhatsApp</h3>
                    <p>
                      Consulta os dados do número na Meta. Não envia mensagens
                      nem comprova permissão de envio ou entrega do webhook.
                    </p>
                    <div className="channel-checks">
                      <div className="channel-check">
                        <button
                          type="button"
                          disabled={!state.integrations.whatsapp || busy}
                          onClick={() => checkIntegrationChannel("whatsapp")}
                        >
                          Testar acesso ao número
                        </button>
                        {connectionChecks.whatsapp && (
                          <p
                            className={connectionChecks.whatsapp.ok ? "check-success" : "check-failure"}
                            role="status"
                          >
                            {connectionChecks.whatsapp.message}
                            {connectionChecks.whatsapp.checkedAt && (
                              <small>
                                {new Date(connectionChecks.whatsapp.checkedAt).toLocaleTimeString("pt-BR", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  timeZone: "America/Sao_Paulo",
                                })}
                              </small>
                            )}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                {isManagement(user) && (
                  <button
                    disabled={!state.integrations.inboundEmail || busy}
                    onClick={() =>
                      perform(async () => {
                        const result = await post("/api/email/sync", {});
                        await reload();
                        setNotice(result.imported + " mensagens incorporadas.");
                      })
                    }
                  >
                    Conferir caixa de e-mail
                  </button>
                )}
                {isManagement(user) &&
                  !state.integrations.inboundEmail && (
                    <small className="channel-note">
                      A sincronização será liberada quando IMAP estiver configurado.
                    </small>
                  )}
              </section>
              <section className="panel settings-wide">
                <h2>Minha senha</h2>
                <p>
                  Confirme a senha atual para criar uma nova. Outras sessões
                  serão encerradas após a alteração.
                </p>
                <form
                  className="password-change-form"
                  onSubmit={submitPasswordChange}
                >
                  <label>
                    Senha atual
                    <input
                      type="password"
                      autoComplete="current-password"
                      minLength={1}
                      maxLength={200}
                      value={passwordChange.current}
                      onChange={(e) =>
                        setPasswordChange({
                          ...passwordChange,
                          current: e.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    Nova senha
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={200}
                      value={passwordChange.next}
                      onChange={(e) =>
                        setPasswordChange({
                          ...passwordChange,
                          next: e.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <label>
                    Confirmar nova senha
                    <input
                      type="password"
                      autoComplete="new-password"
                      minLength={12}
                      maxLength={200}
                      value={passwordChange.confirm}
                      onChange={(e) =>
                        setPasswordChange({
                          ...passwordChange,
                          confirm: e.target.value,
                        })
                      }
                      required
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    Alterar senha
                  </button>
                </form>
              </section>
              {isManagement(user) && (
                <section className="panel settings-wide">
                  <div className="section-title"><h2>Feedback da equipe</h2><span className="muted">{feedbackRows.filter((row) => row.status !== "Resolvido").length} pendente(s)</span></div>
                  <p>Relatos do piloto para corrigir dificuldades e priorizar melhorias.</p>
                  {feedbackRows.length === 0 ? <Empty title="Nenhum relato recebido" text="Os relatos enviados pela equipe aparecerão aqui." /> : (
                    <div className="feedback-list">
                      {feedbackRows.map((row) => (
                        <article className="feedback-item" key={row.id}>
                          <div className="feedback-item-heading"><div><strong>{row.title}</strong><small>{row.category} · {row.impact} · {nav.find(([key]) => key === row.screen)?.[1] || row.screen}</small></div><select aria-label={`Situação de ${row.title}`} value={row.status} onChange={(event) => perform(async () => { const result = await api("/api/pilot-feedback", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, status: event.target.value }) }); setFeedbackRows((rows) => rows.map((item) => item.id === row.id ? { ...item, ...result } : item)); })}><option>Novo</option><option>Em análise</option><option>Resolvido</option></select></div>
                          <p>{row.description}</p><small>{row.reporter} · {new Date(row.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</small>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}
              {isManagement(user) && <section className="panel"><h2>Equipe e acessos</h2><p>Cadastre e gerencie as funções internas em uma única página.</p><button onClick={() => navigate("team")}>Abrir equipe e acessos</button></section>}
            </div>
          )}
        </div>
      </main>
      {detail && (
        <div className="overlay" onClick={closeDetail}>
          <section
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Ficha do cliente"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="drawer-header">
              <div>
                <small>
                  {detail.conversation ? "Atendimento" : "Ficha da unidade"}
                </small>
                <h2>
                  {detail.conversation
                    ? find("conversations", detail.conversation)?.name
                    : current?.name}
                </h2>
              </div>
              <button aria-label="Fechar ficha" onClick={closeDetail}>
                <X />
              </button>
            </header>
            {detail.conversation ? (
              <Conversation
                key={detail.conversation}
                draftCache={conversationDraftCache}
                conversation={find("conversations", detail.conversation)}
                initialDraft={conversationDraft}
                onDraftConsumed={() => setConversationDraft("")}
                opportunities={data.opportunities}
                messages={data.messages}
                templates={data.templates}
                materials={data.materials}
                user={user}
                state={state}
                reload={reload}
                perform={perform}
                open={open}
                setNotice={setNotice}
              />
            ) : (
              current && (
                <>
                  <div className="tabs">
                    {[
                      "Resumo",
                      "Contatos",
                      "Negócios",
                      "Pedidos",
                      "Conversas",
                    ].map((t) => (
                      <button
                        key={t}
                        className={tab === t ? "active" : ""}
                        onClick={() => setTab(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <div className="drawer-body">
                    {tab === "Resumo" && <UnitSummary />}
                    {tab === "Contatos" && (
                      <Records
                        entity="contacts"
                        items={data.contacts.filter(
                          (r) => r.unit_id === current.id,
                        )}
                        unitId={current.id}
                      />
                    )}{" "}
                    {tab === "Negócios" && (
                      <>
                        <Records
                          entity="opportunities"
                          items={data.opportunities.filter(
                            (r) => r.unit_id === current.id,
                          )}
                          unitId={current.id}
                        />
                        <Records
                          entity="contracts"
                          items={data.contracts.filter(
                            (r) => r.unit_id === current.id,
                          )}
                          unitId={current.id}
                        />
                      </>
                    )}
                    {tab === "Pedidos" && (
                      <Records
                        entity="requests"
                        items={data.requests.filter(
                          (r) => r.unit_id === current.id,
                        )}
                        unitId={current.id}
                      />
                    )}{" "}
                    {tab === "Financeiro" && (
                      <Records
                        entity="invoices"
                        items={data.invoices.filter(
                          (r) => r.unit_id === current.id,
                        )}
                        unitId={current.id}
                      />
                    )}{" "}
                    {tab === "Conversas" && (
                      <>
                        <Records
                          entity="conversations"
                          items={data.conversations.filter(
                            (r) => r.unit_id === current.id,
                          )}
                          unitId={current.id}
                        />
                        {data.conversations
                          .filter((r) => r.unit_id === current.id)
                          .map((c) => (
                            <button
                              key={c.id}
                              onClick={() => setDetail({ conversation: c.id })}
                            >
                              Abrir atendimento: {c.name}
                            </button>
                          ))}
                      </>
                    )}
                  </div>
                </>
              )
            )}
          </section>
        </div>
      )}
      {modal && (
        <div
          className="overlay modal-overlay"
          onClick={() => {
            if (!busy) setModal(null);
          }}
        >
          <section
            className="form-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Editar registro"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="drawer-header">
              <div>
                <small>
                  {modal.record.id ? "Atualizar registro" : "Novo registro"}
                </small>
                <h2>
                  {modal.entity === "units"
                    ? modal.record.id
                      ? "Editar cliente ou local"
                      : "Novo cliente"
                    : modal.entity === "materials"
                      ? "Material da biblioteca"
                      : modal.entity === "requests"
                        ? "Pedido de material"
                        : models[modal.entity]?.label ||
                          (modal.entity === "user"
                            ? "Acesso individual"
                            : "Conciliar pagamento")}
                </h2>
              </div>
              <button
                aria-label="Fechar formulário"
                onClick={() => setModal(null)}
              >
                <X />
              </button>
            </header>
            <form
              onSubmit={
                modal.entity === "user"
                  ? (e) => {
                      e.preventDefault();
                      perform(async () => {
                        await post("/api/team", modal.values);
                        setTeam(await api("/api/team"));
                        setModal(null);
                        setNotice("Acesso criado.");
                      });
                    }
                  : modal.entity === "allocation"
                    ? (e) => {
                        e.preventDefault();
                        perform(async () => {
                          await post("/api/allocations", modal.values);
                          await reload();
                          setModal(null);
                          setNotice("Pagamento conciliado.");
                        });
                      }
                    : save
              }
            >
              <div className="form-fields">
                {['proposals','contracts','services','invoices','admin_documents'].includes(modal.entity) && <DocumentFiles key={modal.entity} entity={modal.entity} record={modal.record} onEnsureRecord={persistDocumentModal} pending={modal.pendingAttachment} onPending={pendingAttachment=>setModal(current=>({...current,pendingAttachment}))} disabled={busy || !canWrite(user.role,modal.entity) || modal.record.archived_at || modal.entity==='admin_documents' && ['Enviado','Devolvido','Concluído','Substituído'].includes(modal.record.status) || modal.entity==='proposals' && ['Enviada','Aceita','Recusada','Substituída'].includes(modal.record.status) || modal.entity==='invoices' && !!modal.record.reconciled_date} onRecord={record=>{setModal(current=>({...current,record,values:{...record,...Object.fromEntries(Object.entries(current.values).filter(([key,value])=>!["document_file_ids","document_checklist","version","updated_at"].includes(key)&&JSON.stringify(value)!==JSON.stringify(current.record[key])))}}));reload();}} />}
                {modal.entity==='invoices' && <BulletinEditor record={modal.record} context={modal.values} onEnsureRecord={persistDocumentModal} data={data} disabled={busy || !canWrite(user.role,'invoices') || !!modal.record.reconciled_date} onRecord={record=>{setModal(current=>({...current,record,values:record}));reload();}} />}
                {modal.entity==='admin_documents' && modal.values.document_area==='Banco DOC' && <BankdocReview record={modal.record} onEnsureRecord={persistDocumentModal} hasPendingFile={!!modal.pendingAttachment} values={modal.values} dirty={JSON.stringify(modal.values)!==JSON.stringify(modal.record)} disabled={busy || !canWrite(user.role,'admin_documents')} onChange={values=>setModal(current=>({...current,values}))} />}
                {modal.entity === 'admin_documents' && <DocumentChecklist document={modal.values} disabled={busy || ['Enviado','Devolvido','Concluído','Substituído'].includes(modal.record.status)} onChange={value=>setModal(current=>({...current,values:{...current.values,document_checklist:value}}))} />}
                {modal.entity === 'services' && <HandoffReview service={modal.values} contacts={data.contacts||[]} />}
                {modal.entity === "units" && (
                  <ClientFields
                    values={modal.values}
                    editing={!!modal.record.id}
                    operational={isOperational(user)}
                    directory={directory}
                    companies={data.companies}
                    setValues={(values) => setModal({ ...modal, values })}
                  />
                )}
                {modal.entity === "activities" && <ActivityFields values={modal.values} setValues={(values) => setModal({ ...modal, values })} user={user} directory={directory} data={data} editing={!!modal.record.id} />}
                {modal.entity === "materials" && (
                  <MaterialFields
                    directory={directory}
                    units={data.units}
                    values={modal.values}
                    editing={!!modal.record.id}
                    file={modal.file}
                    files={state.files.filter(
                      (f) => f.material_id === modal.record.id,
                    )}
                    setFile={(file) => setModal({ ...modal, file })}
                    setValues={(values) => setModal({ ...modal, values })}
                  />
                )}
                {(
                  models[modal.entity]?.fields.filter(
                    (f) =>
                      !["units", "materials", "activities"].includes(modal.entity) &&
                      !(f.key === "owner") &&
                      !['bankdoc_rule_id','bankdoc_rules_confirmed'].includes(f.key) &&
                      !(isField(user) && modal.entity === "services" && !["status", "scheduled_date", "impediment", "quality", "delivery_url", "delivered_date", "notes", "local_access", "performed_date", "data_url", "processing_reference", "review_reference", "waiting_reason", "waiting_until"].includes(f.key)) &&
                      !(modal.entity === "requests" && f.key === "service_id"),
                  ) ||
                  (modal.entity === "user"
                    ? [
                        { key: "name", label: "Nome", required: true },
                        {
                          key: "email",
                          label: "E-mail",
                          type: "email",
                          required: true,
                        },
                        {
                          key: "password",
                          label: "Senha inicial (mínimo 12 caracteres)",
                          type: "password",
                          required: true,
                        },
                        {
                          key: "role",
                          label: "Perfil",
                          type: "select",
                          options: roles,
                        },
                      ]
                    : [
                        {
                          key: "receipt_id",
                          label: "Recebimento",
                          type: "reference",
                          entity: "receipts",
                          required: true,
                        },
                        {
                          key: "invoice_id",
                          label: "Nota",
                          type: "reference",
                          entity: "invoices",
                          required: true,
                        },
                        {
                          key: "amount",
                          label: "Valor a alocar (R$)",
                          type: "number",
                          required: true,
                        },
                      ])
                ).map((f) => (
                  <label
                    key={f.key}
                    className={f.type === "textarea" ? "wide" : ""}
                  >
                    {f.label}
                    {(f.required || (modal.administrative && f.key === "modality")) && <span className="required"> *</span>}
                    {["select", "reference", "user", "contact"].includes(f.type) ? (
                      <>
                      <select
                        aria-label={f.label}
                        required={f.required || (modal.administrative && f.key === "modality")}
                        disabled={modal.convertConversationId && ["unit_id", "contact_id"].includes(f.key)}
                        value={modal.values[f.key] ?? ""}
                        onChange={(e) =>
                          setModal({
                            ...modal,
                            values: {
                              ...modal.values,
                              [f.key]: e.target.value,
                            },
                          })
                        }
                      >
                        <option value="">Selecione</option>
                        {(
                          (f.type === "user" ? directory.map((person) => ({ value: person.id, label: person.name })) : f.type === "contact" ? (data.contacts || []).filter((person) => person.id !== modal.record.id && find("units", person.unit_id)?.company_id === find("units", modal.values.unit_id)?.company_id).map((person) => ({ value: person.id, label: person.name })) : modal.entity === "services" && f.key === "modality" ? [...new Set([...(state.serviceModalities || []), modal.record.modality].filter(Boolean))] : f.options) ||
                          (data[f.entity] || [])
                            .filter((r) => !modal.administrative || f.key !== "unit_id" || state.administrativeCatalog.client_ids.includes(r.id) || modal.record.unit_id === r.id)
                            .filter((r) => modal.entity !== "allocation" || (f.entity === "invoices" ? r.status === "Nota emitida" && invoiceBalance(r) > 0 : f.entity !== "receipts" || Number(r.amount_cents) > (state.allocations || []).filter((item) => item.receipt_id === r.id).reduce((sum, item) => sum + Number(item.amount_cents), 0)))
                            .filter(
                              (r) =>
                                !modal.values.unit_id ||
                                !r.unit_id ||
                                r.unit_id === modal.values.unit_id,
                            )
                            .map((r) => ({ value: r.id, label: titleOf(r) }))
                        ).map((v) => (
                          <option key={v.value || v} value={v.value || v}>
                            {v.label || v}
                          </option>
                        ))}
                      </select>
                    {modal.convertConversationId && ["unit_id", "contact_id"].includes(f.key) && (
                      <small className="form-hint">Vinculado ao atendimento de origem.</small>
                    )}
                      </>
                    ) : f.type === "textarea" ? (
                      <textarea
                        rows={3}
                        required={f.required}
                        value={modal.values[f.key] ?? ""}
                        onChange={(e) =>
                          setModal({
                            ...modal,
                            values: {
                              ...modal.values,
                              [f.key]: e.target.value,
                            },
                          })
                        }
                      />
                    ) : (
                      <input
                        type={f.type || "text"}
                        step={f.type === "number" ? "any" : undefined}
                        required={f.required}
                        value={modal.values[f.key] ?? ""}
                        onChange={(e) =>
                          setModal({
                            ...modal,
                            values: {
                              ...modal.values,
                              [f.key]: e.target.value,
                            },
                          })
                        }
                      />
                    )}
                  </label>
                ))}
              </div>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <footer className="form-footer">
                {["services", "receipts"].includes(modal.entity) && !isField(user) && modal.record.id && canWrite(user.role, modal.entity) && (
                  <button type="button" disabled={busy} onClick={() => perform(() => deleteAdministrativeEntry(modal.entity, modal.record))}>
                    <Trash2 size={16} /> Apagar lançamento
                  </button>
                )}
                <button type="button" onClick={() => setModal(null)}>
                  Cancelar
                </button>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    (models[modal.entity] && !canWrite(user.role, modal.entity))
                  }
                >
                  {busy
                    ? "Salvando…"
                    : modal.entity === "units"
                      ? "Salvar cadastro"
                      : modal.entity === "materials"
                        ? "Salvar material"
                        : modal.entity === "requests"
                          ? "Registrar pedido"
                          : "Salvar"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
      {feedbackOpen && (
        <div className="overlay modal-overlay" onClick={() => setFeedbackOpen(false)}>
          <section className="form-modal feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onClick={(event) => event.stopPropagation()}>
            <header className="drawer-header"><div><small>Ajude a melhorar o piloto</small><h2 id="feedback-title">Reportar atrito</h2></div><button aria-label="Fechar" onClick={() => setFeedbackOpen(false)}><X size={20} /></button></header>
            <form onSubmit={(event) => { event.preventDefault(); perform(async () => { await post("/api/pilot-feedback", { ...feedbackForm, screen: section }); setFeedbackForm({ category: "Dificuldade", impact: "Atrapalha", title: "", description: "" }); setFeedbackOpen(false); setNotice("Relato enviado para revisão."); if (section === "settings" && isManagement(user)) setFeedbackRows(await api("/api/pilot-feedback")); }); }}>
              <div className="form-fields">
                <label>Tipo<select value={feedbackForm.category} onChange={(e) => setFeedbackForm({ ...feedbackForm, category: e.target.value })}><option>Erro</option><option>Dificuldade</option><option>Sugestão</option><option>Dúvida</option></select></label>
                <label>Impacto<select value={feedbackForm.impact} onChange={(e) => setFeedbackForm({ ...feedbackForm, impact: e.target.value })}><option>Impede meu trabalho</option><option>Atrapalha</option><option>Melhoria</option></select></label>
                <label className="wide">O que aconteceu?<input required minLength={5} maxLength={120} value={feedbackForm.title} onChange={(e) => setFeedbackForm({ ...feedbackForm, title: e.target.value })} placeholder="Ex.: Não consigo salvar um contato" /></label>
                <label className="wide">Conte um pouco mais<textarea required minLength={15} maxLength={3000} rows={5} value={feedbackForm.description} onChange={(e) => setFeedbackForm({ ...feedbackForm, description: e.target.value })} placeholder="O que você tentou fazer e o que esperava acontecer?" /></label>
                <details className="wide"><summary>Registrar uma amostra de tempo (opcional)</summary><label>Atividade<select value={feedbackForm.measurement_kind||''} onChange={event=>setFeedbackForm({...feedbackForm,measurement_kind:event.target.value,measurement_phase:feedbackForm.measurement_phase||'Referência',measurement_variant:feedbackForm.measurement_variant||'Não se aplica'})}><option value="">Não medir</option>{['Mensagem','Documentos','Passagem entre equipes','Autorização'].map(value=><option key={value}>{value}</option>)}</select></label>{feedbackForm.measurement_kind&&<><label>Fase<select value={feedbackForm.measurement_phase} onChange={event=>setFeedbackForm({...feedbackForm,measurement_phase:event.target.value})}><option>Referência</option><option>Após melhoria</option></select></label><label>Método<select value={feedbackForm.measurement_variant} onChange={event=>setFeedbackForm({...feedbackForm,measurement_variant:event.target.value})}>{['Não se aplica','Modelo atual','Modelo contextual','IA'].map(value=><option key={value}>{value}</option>)}</select></label><label>Tempo total, incluindo revisão (minutos)<input type="number" required min="0.1" max="480" step="0.1" value={feedbackForm.measurement_minutes||''} onChange={event=>setFeedbackForm({...feedbackForm,measurement_minutes:event.target.value})} /></label></>}</details>
                <p className="wide form-hint">Tela registrada: {nav.find(([key]) => key === section)?.[1] || "CRM"}. Não inclua dados pessoais ou confidenciais de clientes.</p>
              </div>
              <footer className="form-footer"><button type="button" onClick={() => setFeedbackOpen(false)}>Cancelar</button><button className="primary" disabled={busy}>Enviar relato</button></footer>
            </form>
          </section>
        </div>
      )}
      {clientImportOpen && (
        <ClientImport
          companies={data.companies || []}
          units={data.units || []}
          busy={busy}
          error={error}
          onClose={() => setClientImportOpen(false)}
          onImport={importClientRows}
        />
      )}
    </div>
  );
}
function Conversation({
  draftCache,
  conversation,
  initialDraft = "",
  onDraftConsumed,
  opportunities = [],
  messages,
  templates,
  materials,
  state,
  reload,
  perform,
  open,
  setNotice,
}) {
  const [body, setBody] = useState(()=>draftCache.current[conversation?.id]||""),
    [material, setMaterial] = useState(""),
    [templateId, setTemplateId] = useState(""),
    [templateValues, setTemplateValues] = useState([]),
    [confirmed, setConfirmed] = useState(false),
    [internal, setInternal] = useState(false);
  useEffect(() => {
    if (initialDraft) {
      setBody(initialDraft);
      onDraftConsumed?.();
    }
  }, [initialDraft, onDraftConsumed]);
  useEffect(()=>{if(conversation)draftCache.current[conversation.id]=body;},[body,conversation?.id,draftCache]);
  if (!conversation) return null;
  const linkedOpportunity = opportunities.find((item) => item.id === conversation.opportunity_id);
  const selectedTemplate = templates.find((t) => t.id === templateId);
  const approvedTemplates = conversation.channel === "WhatsApp"
    ? templates.filter((t) => t.channel === "WhatsApp aprovado" && t.approval_status === "Aprovado")
    : [];
  return (
    <div className="drawer-body">
      <div className="actions">
        <button onClick={() => open("conversations", conversation)}>
          Editar atendimento
        </button>
        <button
          onClick={() =>
            open(
              "requests",
              {},
              {
                unit_id: conversation.unit_id,
                name: "Solicitação — " + conversation.name,
              },
            )
          }
        >
          Criar solicitação
        </button>
        <button
          onClick={() =>
            open(
              "activities",
              {},
              {
                unit_id: conversation.unit_id,
                name: "Retornar — " + conversation.name,
              },
            )
          }
        >
          Agendar retorno
        </button>
        {linkedOpportunity ? (
          <button onClick={() => open("opportunities", linkedOpportunity)}>
            Abrir oportunidade vinculada
          </button>
        ) : (
          <button
            onClick={() =>
              open(
                "opportunities",
                {},
                {
                  unit_id: conversation.unit_id,
                  contact_id: conversation.contact_id,
                  name: conversation.name,
                  owner: conversation.owner,
                  next_action: conversation.next_action,
                  next_date: conversation.next_date,
                },
                { convertConversationId: conversation.id },
              )
            }
          >
            Criar oportunidade
          </button>
        )}
      </div>
      <p className="muted">
        {conversation.channel} · {conversation.owner || "Responsável a definir"}
      </p>
      <div className="message-history">
        {messages
          .filter((m) => m.conversation_id === conversation.id)
          .map((m) => (
            <article
              key={m.id}
              className={
                "message " +
                (m.direction === "outbound" ? "outbound" : "") +
                (m.direction === "internal" ? " internal" : "")
              }
            >
              <small>
                {m.direction === "internal"
                  ? "Nota interna"
                  : m.direction === "outbound"
                    ? "Equipe"
                    : "Cliente"}{" "}
                · {date(m.created_at)}
              </small>
              <p>{m.body}</p>
              {m.material_snapshot && (
                <small>
                  Material: {m.material_snapshot.name} / versão{" "}
                  {m.material_snapshot.revision}
                </small>
              )}
              {m.attachments?.map((attachment, index) => (
                <small key={index} className="message-attachment">
                  Anexo: {attachment.download_url ? <a href={attachment.download_url}>{attachment.filename || "Baixar anexo"}</a> : <>{attachment.filename || "Mídia recebida"}{attachment.download_error ? ` · ${attachment.download_error}` : " · arquivo indisponível para download"}</>}
                  {attachment.size ? ` · ${Math.ceil(attachment.size / 1024)} KB` : ""}
                  {attachment.download_status === "Falha" && attachment.provider_media_id && <button className="text-button" onClick={() => perform(async () => { const result = await post(`/api/messages/${encodeURIComponent(m.id)}/attachments/${index}`, {}); await reload(); setNotice(result.error || "Anexo arquivado."); })}>Tentar arquivar novamente</button>}
                </small>
              ))}
              <Badge>{m.status}</Badge>
            </article>
          ))}
        {!messages.some((m) => m.conversation_id === conversation.id) && (
          <Empty
            title="A conversa começa aqui"
            text="Registre o contato realizado ou envie pelo canal configurado."
          />
        )}
      </div>
      <div className="composer">
        <label>
          Modelo de mensagem
          <select
            value={templateId}
            onChange={(e) => {
              const chosen = templates.find((t) => t.id === e.target.value);
              setTemplateId(e.target.value);
              setTemplateValues(Array(Number(chosen?.variable_count || 0)).fill(""));
              setBody(chosen?.body || "");
            }}
          >
            <option value="">Sem modelo</option>
            <optgroup label="Textos internos">
              {templates.filter((t) => t.channel !== "WhatsApp aprovado").map((t) => <option value={t.id} key={t.id}>{t.name}</option>)}
            </optgroup>
            {approvedTemplates.length > 0 && <optgroup label="Modelos aprovados no WhatsApp">{approvedTemplates.map((t) => <option value={t.id} key={t.id}>{t.name}</option>)}</optgroup>}
          </select>
        </label>
        {selectedTemplate?.channel === "WhatsApp aprovado" ? (
          <>
            <p className="muted">Modelo Meta: {selectedTemplate.provider_name} · {selectedTemplate.language_code}. O texto aprovado fica fixo; preencha os valores abaixo.</p>
            {templateValues.map((value, index) => <label key={index}>Variável {`{{${index + 1}}}`}<input value={value} onChange={(e) => setTemplateValues((current) => current.map((item, i) => i === index ? e.target.value : item))} /></label>)}
          </>
        ) : <><MessageAssistant text={body} entity="conversations" id={conversation.id} onApply={setBody} /><label>Mensagem<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} /></label></>}
        <label>
          Material aprovado
          <select
            value={material}
            disabled={selectedTemplate?.channel === "WhatsApp aprovado"}
            onChange={(e) => setMaterial(e.target.value)}
          >
            <option value="">Sem material</option>
            {materials
              .filter(
                (m) =>
                  m.status === "Aprovado" &&
                  (!m.unit_id || m.unit_id === conversation.unit_id),
              )
              .map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name} / {m.revision}
                </option>
              ))}
          </select>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={internal}
            onChange={(e) => setInternal(e.target.checked)}
          />
          Nota interna — visível somente à equipe
        </label>
        {!internal && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Conferi destinatário e conteúdo para enviar
          </label>
        )}
        <div className="actions">
          <button
            disabled={!body.trim()}
            onClick={() =>
              perform(async () => {
                await post("/api/messages", {
                  conversation_id: conversation.id,
                  body,
                  material_id: material || null,
                  template_id: selectedTemplate?.channel === "WhatsApp aprovado" ? templateId : null,
                  template_values: templateValues,
                  mode: internal ? "internal" : "manual",
                });
                await reload();
                setBody("");
                setTemplateId("");
                setTemplateValues([]);
                setNotice("Registro salvo. Não houve envio pelo canal.");
              })
            }
          >
            Registrar {internal ? "nota" : "interação manual"}
          </button>
          {!internal && (
            <button
              className="primary"
              disabled={
                !body.trim() ||
                !confirmed ||
                !state.integrations[
                  conversation.channel === "WhatsApp" ? "whatsapp" : "email"
                ]
              }
              onClick={() =>
                perform(async () => {
                  const result = await post("/api/messages", {
                    conversation_id: conversation.id,
                    body,
                    material_id: material || null,
                    template_id: selectedTemplate?.channel === "WhatsApp aprovado" ? templateId : null,
                    template_values: templateValues,
                    mode: "send",
                    confirmed,
                  });
                  await reload();
                  setBody("");
                  setTemplateId("");
                  setTemplateValues([]);
                  setConfirmed(false);
                  setNotice(result.status?.startsWith("Falha no envio")
                    ? "O provedor não confirmou o envio. Confira o canal antes de tentar novamente para evitar uma mensagem duplicada."
                    : "Envio registrado. Confira a confirmação do canal na conversa.");
                })
              }
            >
              <Send size={16} />
              Enviar
            </button>
          )}
        </div>
        {!state.integrations[
          conversation.channel === "WhatsApp" ? "whatsapp" : "email"
        ] && (
          <p className="muted">
            Canal ainda não configurado. Você pode registrar as interações
            realizadas no aplicativo corporativo.
          </p>
        )}
      </div>
    </div>
  );
}
