"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Copy, ChevronRight, X, Clock3, FileCheck2, RotateCcw, Trash2 } from "lucide-react";
import { models } from "../../lib/model.mjs";
import AgendaDesk from "./AgendaDesk";
import AdministrativeCatalog from "./AdministrativeCatalog";
import DocumentChecklist from './DocumentChecklist';
import DocumentFiles, {FileDrop} from './DocumentFiles';
import BulletinEditor from './BulletinEditor';
import BankdocReview from './BankdocReview';
import {uploadRecordFile} from '../../lib/document-upload-client.mjs';
import DocumentDossier from './DocumentDossier';
import MessageAssistant from './MessageAssistant';
import {waitingLabel} from '../../lib/operation-flow.mjs';
import { whatsappLink } from "../../lib/contact-links.mjs";
import { administrativeRoles, buildAdministrativeQueue, invoiceBalance, invoiceNextStep, administrativeMessage, administrativeDocumentMessage } from "../../lib/administrative-workflow.mjs";

const currency = (cents) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const dateLabel = (value) => value ? new Date(value + "T12:00:00Z").toLocaleDateString("pt-BR") : "Definir data";
const searchText = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
async function post(url, body, method = "POST") {
  let response;
  try { response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new Error("Não foi possível conectar ao CRM. Verifique a internet e tente novamente; seus dados ainda não foram confirmados como salvos."); }
  let result;
  try { result = await response.json(); } catch { throw new Error("O CRM respondeu em formato inesperado. Atualize a tela antes de tentar novamente."); }
  if (!response.ok) throw new Error(result.error || "Não foi possível salvar. Tente novamente.");
  return result;
}

export default function AdministrativeDesk({ directory, data, allocations, catalog, user, onReload, onOpen, onOpenConversation, onAllocate, onNotice, onDeleteRecord }) {
  const [tab, setTab] = useState("Prioridades"), [search, setSearch] = useState(""), [owner, setOwner] = useState(""), [deadline, setDeadline] = useState("Todas"), [includeClosed, setIncludeClosed] = useState(false);
  const [editor, setEditor] = useState(null), [message, setMessage] = useState(""), [revisionDate, setRevisionDate] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [serviceDraft, setServiceDraft] = useState(null), [messageContactId, setMessageContactId] = useState("");
  const setNotice = onNotice;
  const dialog = useRef(null), busyRef = useRef(false), leaveRef = useRef(null);
  leaveRef.current = confirmLeave;
  busyRef.current = busy;
  const editorOpen = Boolean(editor);
  useEffect(() => {
    if (!editorOpen) return;
    const previousFocus = document.activeElement, previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector("input:not(:disabled), select:not(:disabled)")?.focus();
    function keyboard(event) {
      if (event.key === "Escape" && !busyRef.current && leaveRef.current()) setEditor(null);
      if (event.key !== "Tab") return;
      const focusable = [...(dialog.current?.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary") || [])].filter((element) => element.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", keyboard);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", keyboard); previousFocus?.focus(); };
  }, [editorOpen]);
  const invoices = data.invoices || [], documents = data.admin_documents || [], services = data.services || [], receipts = data.receipts || [];
  const serviceTypes = (catalog?.service_types || []).filter((item) => item.active);
  const catalogClients = new Set(catalog?.client_ids || []);
  const queue = useMemo(() => buildAdministrativeQueue({ ...data, allocations }), [data, allocations]);
  if (!administrativeRoles.includes(user.role)) return null;
  const client = (id) => data.units.find((unit) => unit.id === id)?.name || "Cliente não encontrado";
  const matches = (record) => (!owner || record.owner === owner) && (!search || searchText([record.name, client(record.unit_id), record.invoice_number, record.protocol, record.bankdoc_module, record.competence].filter(Boolean).join(" ")).includes(searchText(search)));
  const pending = queue.filter(matches).filter((item) => deadline === "Todas" || (deadline === "Vencidas" && item.due_date && item.due_date < today()) || (deadline === "Hoje" && item.due_date === today()) || (deadline === "Sem data" && !item.due_date));
  const receiptLinks = (receipt) => allocations.filter((item) => item.receipt_id === receipt.id);
  const visibleReceipts = receipts.filter((receipt) => !search || searchText([receipt.name, receipt.evidence, ...receiptLinks(receipt).map((link) => { const invoice = invoices.find((item) => item.id === link.invoice_id); return [invoice?.name, invoice?.invoice_number, invoice && client(invoice.unit_id)].filter(Boolean).join(" "); })].join(" ")).includes(searchText(search)));
  const selected = editor?.values;
  const messageContacts = (data.contacts || []).filter((item) => item.unit_id === selected?.unit_id);
  const messageContact = messageContacts.find((item) => item.id === messageContactId) || messageContacts[0];
  const documentFrozen = editor?.entity === "admin_documents" && ["Enviado", "Devolvido", "Concluído", "Substituído"].includes(editor.record.status);
  const finalized = editor?.record.archived_at || editor?.record.reconciled_date || ["Concluído", "Substituído"].includes(editor?.record.status);
  function recipientFor(channel, integrated = false) {
    const canReceive = (contact) => channel === "WhatsApp"
      ? Boolean(whatsappLink(contact?.phone)) && (!integrated || /^\d{12,15}$/.test(contact?.phone || ""))
      : /^\S+@\S+\.\S+$/.test(contact?.email || "");
    const recipient = messageContact;
    if (!canReceive(recipient)) {
      setError(`Cadastre um ${channel === "WhatsApp" ? `telefone válido${integrated ? " com código do país" : ""}` : "e-mail válido"} para este cliente antes de abrir o atendimento.`);
      return null;
    }

    return recipient;
  }
  function openMessageDraft(channel) {
    if (!message) { setError("Prepare uma mensagem antes de abrir o rascunho."); return; }
    if (/\[(inserir|número)/i.test(message)) { setError("Preencha os dados pendentes no rascunho antes de abrir o canal."); return; }
    const recipient = recipientFor(channel);
    if (!recipient) return;
    const base = channel === "WhatsApp" ? whatsappLink(recipient.phone) : "mailto:" + encodeURIComponent(recipient.email) + "?subject=" + encodeURIComponent("Acompanhamento WorkGeo");
    const url = channel === "WhatsApp" ? base + "?text=" + encodeURIComponent(message) : base + "&body=" + encodeURIComponent(message);
    window.open(url, "_blank", "noopener,noreferrer");
    setNotice("Rascunho aberto no " + channel + ". Revise e confirme o envio no aplicativo.");
  }
  function openInternalConversation(channel) {
    if (!message) { setError("Prepare uma mensagem antes de abrir o atendimento."); return; }
    const recipient = recipientFor(channel, true);
    if (!recipient) return;
    if (!confirmLeave()) return;
    onOpenConversation?.(recipient, channel, message);
    setEditor(null);
  }
  async function run(action) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (e) { setError(e.message); } finally { busyRef.current = false; setBusy(false); }
  }
  function confirmLeave() {
    return !(message.trim() || serviceDraft || (editor && JSON.stringify(editor.values) !== JSON.stringify(editor.initialValues))) || window.confirm("Há alterações ou um rascunho de mensagem neste acompanhamento. Sair sem salvar?");
  }
  function prepareMessage(text) {
    if (message.trim() && message !== text && !window.confirm('Substituir o rascunho atual pelo novo texto?')) return;
    setMessage(text);
  }
  function edit(entity, record = {}, prefill = {}) {
    const values = { owner: user.name, owner_id: user.id, ...(entity === "invoices" ? { status: "Medição" } : { status: "Pendente", revision: 1, recurrence: "Não repetir", document_area: tab === "Banco DOC" ? "Banco DOC" : "Documentos gerais", ...(tab === "Banco DOC" ? { destination: "Gerdau / Bancodoc" } : {}) }), ...record, ...prefill };
    setEditor({ entity, record, values, initialValues: values });
    setMessage(""); setMessageContactId(""); setRevisionDate(record.due_date || ""); setServiceDraft(null); setError(""); setNotice("");
  }
  function field(key, options = {}) {
    const definition = models[editor.entity].fields.find((item) => item.key === key);
    const references = definition.type === "reference" ? (data[definition.entity] || []).filter((item) => key === "unit_id" ? true : key !== "service_id" || (item.unit_id === selected.unit_id && (!item.administrative_hidden || editor.record.service_id === item.id))) : null;
    const choices = key === "owner" ? [...new Set([...directory.map((person) => person.name), selected.owner].filter(Boolean))] : options.choices || definition.options;
    const change = (event) => {
      if(key==='unit_id'&&event.target.value&&!catalogClients.has(event.target.value)) {
        const unitId=event.target.value;
        run(async()=>{await post('/api/administrative/catalog',{action:'add-client',unit_id:unitId});await onReload();setServiceDraft(null);setEditor(current=>({...current,values:{...current.values,unit_id:unitId,service_id:''}}));});
        return;
      }
      if (key === "service_id") {
        const creating = event.target.value === "new-service";
        setServiceDraft(creating ? { name: serviceTypes[0]?.name || "", modality: serviceTypes[0]?.name || "", scope: "", external_reference: "" } : null);
        setEditor({ ...editor, values: { ...selected, service_id: creating ? "" : event.target.value } });
      } else {
        if (key === "unit_id") setServiceDraft(null);
        setEditor({ ...editor, values: { ...selected, [key]: event.target.value, ...(key === "owner" ? { owner_id: directory.find((person) => person.name === event.target.value)?.id || null } : {}), ...(key === "unit_id" ? { service_id: "" } : {}) } });
      }
    };
    const common = { value: key === "service_id" && serviceDraft ? "new-service" : selected[key] ?? "", onChange: change, required: options.required ?? definition.required, disabled: busy || options.disabled || (finalized && key !== "notes") };
    if(['url','invoice_url','bulletin','authorization'].includes(key)&&selected.document_file_ids?.[key])common.required=false;
    return <label key={key}>{options.label || definition.label}{common.required && " *"}{references || choices ? <select {...common}><option value="">Selecione</option>{references ? references.map((item) => <option key={item.id} value={item.id}>{item.modality && item.name !== item.modality ? `${item.modality} — ${item.name}` : item.name}</option>) : choices.map((value) => <option key={value}>{value}</option>)}{key === "service_id" && <option value="new-service" disabled={!selected.unit_id || !serviceTypes.length}>Cadastrar serviço para este cliente</option>}</select> : definition.type === "textarea" ? <textarea {...common} rows={3} /> : <input {...common} type={definition.type === "number" ? "number" : definition.type === "date" ? "date" : "text"} {...(definition.type === "number" ? { min: key === "revision" ? 1 : 0.01, step: key === "revision" ? 1 : "0.01" } : {})} />}{key === "service_id" && !selected.unit_id && <small>Selecione uma empresa incluída em Catálogos para cadastrar o serviço.</small>}{key === "unit_id" && !catalogClients.size && !editor.record.id && <small>Selecione uma empresa cadastrada acima ou abra <button type="button" onClick={() => { if (confirmLeave()) { setEditor(null); setTab("Catálogos"); } }}>Abrir Catálogos</button></small>}</label>;
  }
  const openQueueItem = (item) => {
    if (item.entity === "services") edit("invoices", {}, { unit_id: item.unit_id, service_id: item.record_id, name: item.name });
    else edit(item.entity, (data[item.entity] || []).find((record) => record.id === item.record_id));
  };
  function syncDocumentRecord(record) {
    setEditor(current=>{
      const changes=Object.fromEntries(Object.entries(current.values).filter(([key,value])=>!['document_file_ids','document_checklist','version','updated_at'].includes(key)&&JSON.stringify(value)!==JSON.stringify(current.initialValues[key])));
      const initialValues={...current.initialValues,...record};
      return {...current,record,initialValues,values:{...initialValues,...changes}};
    });
    onReload();
  }
  async function persistEditor(options={}) {
    const {skipAttachment,...overrides}=options;
    let saved=await post(`/api/records/${editor.entity}`,{data:{...selected,...overrides},id:editor.record.id,version:editor.record.version});
    setEditor(current=>({...current,record:saved,values:saved,initialValues:saved}));
    if(!skipAttachment&&editor.pendingAttachment){
      const {file,purpose}=editor.pendingAttachment;
      saved=await uploadRecordFile(editor.entity,saved,purpose,file,progress=>setNotice(`Anexando arquivo: ${progress}%`));
      setEditor(current=>({...current,record:saved,values:saved,initialValues:saved,pendingAttachment:null}));
    }
    await onReload();
    return saved;
  }
  return <section className="admin-desk">
    <div className="admin-intro"><FileCheck2 size={23} /><p>Da entrega à baixa: acompanhe boletins, liberações e documentos sem perder o próximo retorno.</p></div>
    <nav className="admin-tabs" aria-label="Áreas do administrativo">{["Prioridades", "Boletins e notas", "Documentos", "Banco DOC", "Dossiê", "Recebimentos", "Tarefas", "Catálogos"].map((name) => <button key={name} aria-pressed={tab === name} className={tab === name ? "active" : ""} onClick={() => { setTab(name); setSearch(""); setOwner(""); setIncludeClosed(false); }}>{name}</button>)}</nav>
    {error && !editor && <div className="error" role="alert">{error}</div>}
    {!["Catálogos", "Tarefas"].includes(tab) && <div className="admin-toolbar">
      <label className="admin-search">Buscar cliente ou referência<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cliente, documento ou nota" /></label>
      {tab !== "Recebimentos" && <label>Responsável<select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">Todos</option>{[...new Set([...directory.map((person) => person.name), ...queue.map((item) => item.owner).filter(Boolean)])].map((name) => <option key={name}>{name}</option>)}</select></label>}
      {tab === "Prioridades" ? <label>Prazo<select value={deadline} onChange={(e) => setDeadline(e.target.value)}>{["Todas", "Vencidas", "Hoje", "Sem data"].map((name) => <option key={name}>{name}</option>)}</select></label> : tab !== "Recebimentos" && <label className="admin-toggle"><input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />Incluir encerrados e arquivados</label>}
      {tab === "Boletins e notas" && <button className="primary" onClick={() => edit("invoices")}><Plus size={16} />Novo acompanhamento</button>}
      {["Documentos", "Banco DOC"].includes(tab) && <button className="primary" onClick={() => edit("admin_documents")}><Plus size={16} />{tab === "Banco DOC" ? "Nova postagem Banco DOC" : "Nova exigência"}</button>}
      {tab === "Recebimentos" && <button className="primary" onClick={() => onOpen("receipts")}><Plus size={16} />Registrar recebimento</button>}
    </div>}
    {tab === "Tarefas" && <><AgendaDesk data={data} user={user} directory={directory} onOpen={onOpen} tasksOnly /><h3>Pendências dos lançamentos</h3><p className="form-hint">Resolva no documento ou lançamento original.</p>{pending.map((item) => <button key={item.id} className="record-line" onClick={() => openQueueItem(item)}>{item.name} · {item.due_date || "Sem prazo"}</button>)}</>}
    {tab === "Catálogos" && <AdministrativeCatalog data={data} catalog={catalog} busy={busy} onRun={run} onOpen={onOpen} onAction={async (action) => { const result = await post("/api/administrative/catalog", action); await onReload(); setNotice("Catálogo atualizado. Os lançamentos anteriores foram preservados."); return result; }} />}
    {tab === 'Dossiê' && <DocumentDossier documents={documents.filter(matches)} client={client} onOpen={document=>edit('admin_documents',document)} />}
    
    {tab === "Prioridades" && <>
      <div className="admin-summary"><span><strong>{pending.length}</strong> pendências nos filtros</span><span><strong>{pending.filter((item) => item.due_date && item.due_date < today()).length}</strong> vencidas</span><span><strong>{pending.filter((item) => !item.due_date).length}</strong> com data a definir</span></div>
      <div className="admin-list">{pending.map((item) => <button className="admin-queue-item" key={item.id} onClick={() => openQueueItem(item)}><div><strong>{item.action}</strong><span>{item.name}</span><small>{client(item.unit_id)} · {item.reason}</small>{item.waiting_reason && <small>{waitingLabel(item)}</small>}<small>{item.stage_started_at ? `Último andamento em ${dateLabel(item.stage_started_at.slice(0,10))}` : "Início da etapa não registrado"}</small></div><div className="admin-queue-meta"><span className={item.due_date && item.due_date < today() ? "admin-overdue" : ""}>{dateLabel(item.due_date)}</span><small>{item.owner || "Definir responsável"}</small><ChevronRight size={17} /></div></button>)}{!pending.length && <div className="admin-empty"><strong>Nenhuma pendência nesta seleção.</strong><p>Boletins e documentos cadastrados geram sua próxima etapa automaticamente.</p></div>}</div>
      <details className="admin-explanation"><summary>Como os lembretes funcionam</summary><p>Um serviço entregue sem acompanhamento aparece para iniciar o boletim. A etapa registrada identifica a próxima ação: preparar boletim, solicitar liberação, emitir/enviar nota ou acompanhar recebimento. Após a emissão, o retorno registrado continua válido; na falta dele, o vencimento da nota orienta a fila. Documentos devolvidos pedem uma nova versão. Ao concluir uma exigência configurada como mensal, o próximo registro é criado uma única vez.</p><p>Datas sem informação ficam sinalizadas. Nenhuma mensagem, nota fiscal ou upload ao portal do cliente é enviado automaticamente.</p></details>
      <details className="admin-explanation"><summary>Agenda dos serviços ({services.length})</summary><p>Serviços vêm do fechamento comercial ou podem ser cadastrados com referência de origem para começar o acompanhamento.</p><button onClick={() => onOpen("services", {}, { owner_id: user.id })}><Plus size={16} />Registrar serviço</button><div className="admin-list">{services.filter(matches).map((service) => <div className="admin-receipt-row" key={service.id}><div><strong>{service.name}</strong><small>{client(service.unit_id)} · {service.status} · {dateLabel(service.scheduled_date)}</small></div><button onClick={() => onOpen("services", service)}>Atualizar serviço</button></div>)}</div></details>
    </>}
    {['Boletins e notas','Documentos','Banco DOC'].includes(tab)&&<div className="admin-document-entry">{tab==='Boletins e notas'&&<div><h3>Boletim de medição no modelo WorkGeo</h3><p>Preencha cliente, período e serviços para gerar PDF e Excel. Se já tem o documento pronto, anexe o arquivo abaixo.</p><button className="primary" onClick={()=>edit('invoices')}>Criar boletim em PDF e Excel</button></div>}<FileDrop label={tab==='Boletins e notas'?'Já tem um boletim? Arraste o arquivo aqui':'Arraste o documento aqui para anexar e conferir'} onFile={file=>{const entity=tab==='Boletins e notas'?'invoices':'admin_documents';edit(entity,{}, {name:file.name.replace(/\.[^.]+$/,'')});setEditor(current=>({...current,pendingAttachment:{file,purpose:entity==='invoices'?'bulletin':'url'}}));}}/></div>}
    {tab === "Boletins e notas" && <div className="admin-list">{invoices.filter(matches).filter((invoice) => includeClosed || !invoice.reconciled_date).map((invoice) => <button className="admin-queue-item" key={invoice.id} onClick={() => edit("invoices", invoice)}><div><strong>{invoice.name}</strong><span>{client(invoice.unit_id)} · {invoiceNextStep(invoice, allocations)}</span><small>{invoice.invoice_number ? `Nota ${invoice.invoice_number}` : "Nota ainda não registrada"} · Retorno: {dateLabel(invoice.next_date || (invoice.status === "Nota emitida" ? invoice.due_date : null))}</small></div><div className="admin-queue-meta"><strong>{currency(invoiceBalance(invoice, allocations))}</strong><small>Saldo a conciliar</small><ChevronRight size={17} /></div></button>)}{!invoices.filter(matches).filter((item) => includeClosed || !item.reconciled_date).length && <div className="admin-empty"><strong>Comece pelo serviço entregue.</strong><p>Registre valor, boletim e retorno. A fila acompanha a liberação, a nota e sua baixa.</p>{!services.length && <p>Cadastre o serviço e informe sua referência de origem para iniciar.</p>}</div>}</div>}
    {["Documentos", "Banco DOC"].includes(tab) && <><p className="admin-help">{tab === "Banco DOC" ? "Acompanhe o fluxo Gerdau / Bancodoc: módulo, tipo de registro, unidade, contrato, competência, checklist confirmado no portal e protocolo. As exigências variam por programa e contrato; confira a lista vigente antes de postar." : "Registre exigências gerais do cliente, destino, prazo e protocolo. Uma devolução preserva o envio anterior e permite criar uma versão corrigida."}</p><div className="admin-list">{documents.filter((item) => (item.document_area || "Documentos gerais") === (tab === "Banco DOC" ? "Banco DOC" : "Documentos gerais")).filter(matches).filter((item) => includeClosed || (!item.archived_at && !["Concluído", "Substituído"].includes(item.status))).map((document) => <button className="admin-queue-item" key={document.id} onClick={() => edit("admin_documents", document)}><div><strong>{document.name}</strong><span>{client(document.unit_id)} · Versão {document.revision}</span><small>{document.archived_at ? "Arquivado" : document.status}{document.recurrence === "Mensal" && " · Repetição mensal"}{document.previous_document_id && " · Vinculado ao registro anterior"}{document.protocol && " · Protocolo " + document.protocol}</small></div><div className="admin-queue-meta"><span>{dateLabel(document.due_date)}</span><small>{document.owner}</small></div></button>)}{!documents.filter((item) => (item.document_area || "Documentos gerais") === (tab === "Banco DOC" ? "Banco DOC" : "Documentos gerais")).filter(matches).filter((item) => includeClosed || (!item.archived_at && !["Concluído", "Substituído"].includes(item.status))).length && <div className="admin-empty"><strong>{tab === "Banco DOC" ? "Nenhuma postagem Banco DOC nesta seleção." : "Nenhum documento nesta seleção."}</strong><p>Adicione o primeiro registro com cliente, responsável e prazo.</p></div>}</div></>}
    {tab === "Recebimentos" && <><p className="admin-help">Registre o pagamento informado e distribua-o entre as notas correspondentes. Pagamentos parciais ou agrupados são conciliados manualmente; a baixa é conferida na nota.</p><div className="admin-list">{visibleReceipts.map((receipt) => {
      const remaining = Number(receipt.amount_cents) - allocations.filter((item) => item.receipt_id === receipt.id).reduce((sum, item) => sum + Number(item.amount_cents), 0);
      return <div className="admin-receipt-row" key={receipt.id}><div><strong>{receipt.name}</strong><small>{dateLabel(receipt.received_date)} · {currency(Number(receipt.amount_cents))} recebido · {currency(remaining)} sem alocação</small>{receiptLinks(receipt).length > 0 && <details className="admin-receipt-links"><summary>Notas vinculadas ({receiptLinks(receipt).length})</summary>{receiptLinks(receipt).map((link) => {
        const invoice = invoices.find((item) => item.id === link.invoice_id);
        return <div className="admin-allocation" key={link.id}><span>{invoice?.invoice_number ? `Nota ${invoice.invoice_number}` : invoice?.name || "Nota"} · {invoice && client(invoice.unit_id)} · {currency(Number(link.amount_cents))}</span><button type="button" disabled={busy} onClick={() => run(async () => {
          const reason = window.prompt("Por que deseja desfazer este vínculo? O pagamento será preservado, o saldo ficará disponível e a baixa da nota será reaberta, se já estiver conferida.");
          if (reason === null) return;
          await post("/api/allocations", { id: link.id, reason }, "DELETE");
          await onReload(); setNotice("Vínculo desfeito. O pagamento foi preservado e os saldos foram atualizados.");
        })}>Desfazer vínculo</button></div>;
      })}</details>}</div><div><button onClick={() => onOpen("receipts", receipt)}>Detalhes</button><button disabled={!remaining} onClick={() => onAllocate(receipt)}>Vincular a uma nota</button></div></div>;
    })}{!visibleReceipts.length && <div className="admin-empty"><strong>{receipts.length ? "Nenhum recebimento encontrado nesta busca." : "Nenhum recebimento registrado."}</strong><p>{receipts.length ? "Busque pela referência, cliente ou número da nota vinculada." : "Preencha a data, o valor e a evidência quando houver confirmação do pagamento."}</p></div>}</div></>}
    {editor && <div className="admin-editor-backdrop"><section ref={dialog} className="admin-editor" role="dialog" aria-modal="true" aria-label={editor.entity === "invoices" ? "Acompanhamento administrativo" : "Exigência documental"}><header><div><small>{editor.entity === "invoices" ? "Boletins e notas" : selected.document_area === "Banco DOC" ? "Banco DOC" : "Documentos"}</small><h2>{editor.record.id ? editor.record.name : editor.entity === "invoices" ? "Novo acompanhamento" : tab === "Banco DOC" ? "Nova postagem Banco DOC" : "Nova exigência"}</h2></div><button aria-label="Fechar acompanhamento" disabled={busy} onClick={() => { if (confirmLeave()) setEditor(null); }}><X size={18} /></button></header>
      {error && <div className="error" role="alert">{error}</div>}
      <form onSubmit={(event) => { event.preventDefault(); run(async () => { await persistEditor(); setEditor(null); setNotice(editor.entity === "admin_documents" && selected.status === "Concluído" && selected.recurrence === "Mensal" && editor.record.status !== "Concluído" ? "Documento concluído. A próxima exigência mensal foi criada." : "Acompanhamento e arquivos salvos."); }); }}>
        <fieldset><legend>Cliente e responsabilidade</legend><div className="admin-form-grid">{field("name", { disabled: documentFrozen })}{field("unit_id", { disabled: documentFrozen })}{field("service_id", { disabled: documentFrozen })}{field("owner", { required: true })}{editor.entity === "invoices" && field("amount")}</div></fieldset>
        {serviceDraft && <fieldset><legend>Cadastrar serviço</legend><p className="admin-help">O serviço ficará vinculado a {client(selected.unit_id)}. Escolha a modalidade e informe a referência e o escopo.</p><div className="admin-form-grid"><label>Modalidade<select required value={serviceDraft.modality} disabled={busy} onChange={(event) => setServiceDraft({ ...serviceDraft, modality: event.target.value, name: serviceDraft.name === serviceDraft.modality ? event.target.value : serviceDraft.name })}>{serviceTypes.map((type) => <option key={type.id} value={type.name}>{type.name}</option>)}</select></label><label>Nome do serviço<input value={serviceDraft.name} disabled={busy} onChange={(e) => setServiceDraft({ ...serviceDraft, name: e.target.value })} /></label><label>Referência de origem<input value={serviceDraft.external_reference} disabled={busy} placeholder="Pedido, planilha ou solicitação do cliente" onChange={(e) => setServiceDraft({ ...serviceDraft, external_reference: e.target.value })} /></label><label>Escopo do serviço<textarea value={serviceDraft.scope} disabled={busy} rows={2} onChange={(e) => setServiceDraft({ ...serviceDraft, scope: e.target.value })} /></label></div><div className="admin-message-actions"><button type="button" disabled={busy || !serviceDraft.name.trim() || !serviceDraft.scope.trim() || !serviceDraft.external_reference.trim()} onClick={() => run(async () => {
          const saved = await post("/api/records/services", { data: { ...serviceDraft, unit_id: selected.unit_id, owner: selected.owner || "Josi", status: "Preparação" } });
          setEditor((current) => ({ ...current, values: { ...current.values, service_id: saved.id } })); setServiceDraft(null); await onReload(); setNotice("Serviço cadastrado e selecionado.");
        })}>Cadastrar e selecionar serviço</button><button type="button" disabled={busy} onClick={() => setServiceDraft(null)}>Cancelar cadastro do serviço</button></div></fieldset>}
        {editor.entity === "invoices" ? <>
          <DocumentFiles entity="invoices" record={editor.record} disabled={busy||finalized} onRecord={syncDocumentRecord} onEnsureRecord={persistEditor} pending={editor.pendingAttachment} onPending={pendingAttachment=>setEditor(current=>({...current,pendingAttachment}))}/>
          <BulletinEditor record={editor.record} context={selected} data={data} disabled={busy||finalized} onRecord={syncDocumentRecord} onEnsureRecord={persistEditor}/>
          <div className="admin-stage"><Clock3 size={17} /><strong>{invoiceNextStep({ ...selected, amount_cents: Math.round(Number(selected.amount || 0) * 100) }, allocations)}</strong><span>Próxima etapa pelo registro atual</span></div>
          <fieldset><legend>Boletim e liberação</legend><div className="admin-form-grid">{field("status")}<details><summary>Link externo do boletim (opcional)</summary>{field("bulletin")}</details>{field("bulletin_sent_date")}{field("authorization", { required: ["Autorizada", "Nota emitida"].includes(selected.status) })}{field("next_action")}{field("next_date", { required: selected.status !== "Nota emitida" })}</div></fieldset>
          {selected.status === "Nota emitida" && <fieldset><legend>Nota e acompanhamento</legend><div className="admin-form-grid">{field("invoice_number", { required: true })}{field("invoice_url", { required: true })}{field("issued_date")}{field("due_date", { required: true })}{field("sent_date")}{field("sent_evidence", { required: Boolean(selected.sent_date) })}{field("reconciled_date", { disabled: !editor.record.id || invoiceBalance(editor.record, allocations) !== 0 })}</div><p className="admin-help">O vencimento é usado como lembrete se não houver outra data de retorno. Confirme a baixa somente depois da conciliação integral.</p></fieldset>}
          <details className="admin-explanation"><summary>Preparar mensagem para o cliente</summary><div className="admin-message-actions">{[["bulletin", "Boletim"], ["authorization", "Liberação"], ["invoice", "Envio de nota"]].map(([kind, label]) => <button type="button" key={kind} onClick={() => prepareMessage(administrativeMessage(selected, client(selected.unit_id), kind))}>{label}</button>)}</div>{message && <><MessageAssistant text={message} entity={editor.entity} id={editor.record.id} onApply={setMessage} /><label>Revise o texto antes de enviar<textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} /></label>{messageContacts.length > 1 && <label>Contato<select value={messageContact?.id || ""} onChange={(e) => setMessageContactId(e.target.value)}>{messageContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>}<div className="admin-message-actions"><details className="admin-channel-options"><summary>Atendimento integrado</summary><div className="admin-message-actions"><button type="button" onClick={() => openInternalConversation("WhatsApp")}>Revisar no atendimento WhatsApp</button><button type="button" onClick={() => openInternalConversation("E-mail")}>Revisar no atendimento por e-mail</button></div></details><button type="button" onClick={() => openMessageDraft("WhatsApp")}>Abrir rascunho no WhatsApp</button><button type="button" onClick={() => openMessageDraft("E-mail")}>Abrir rascunho no e-mail</button><button type="button" onClick={() => run(async () => { await navigator.clipboard.writeText(message); setNotice("Texto copiado. Revise no canal escolhido antes de enviar."); })}><Copy size={16} />Copiar texto</button></div></>}</details>
        </> : <>
          <DocumentFiles entity="admin_documents" record={editor.record} disabled={busy||documentFrozen||!!editor.record.archived_at} onRecord={syncDocumentRecord} onEnsureRecord={persistEditor} pending={editor.pendingAttachment} onPending={pendingAttachment=>setEditor(current=>({...current,pendingAttachment}))}/>
          <fieldset><legend>Documento e envio</legend><div className="admin-form-grid">
            {field("document_area", { disabled: documentFrozen })}
            {field("status", { choices: documentFrozen ? editor.record.status === "Enviado" ? ["Enviado", "Devolvido", "Concluído"] : [editor.record.status] : models.admin_documents.fields.find((item) => item.key === "status").options.filter((value) => value !== "Substituído") })}
            {field("revision", { disabled: documentFrozen })}
            {selected.document_area === "Banco DOC" && field("competence")}
            <details><summary>Usar link externo (opcional)</summary>{field("url", { disabled: documentFrozen, label:"Link externo do documento" })}</details>
            {field("destination")}
            {(["Enviado", "Devolvido", "Concluído", "Substituído"].includes(selected.status) || selected.sent_date || selected.protocol) && <>
              {field("sent_date", { disabled: documentFrozen, required: ["Enviado", "Devolvido", "Concluído"].includes(selected.status) })}
              {field("protocol", { disabled: documentFrozen, required: ["Enviado", "Devolvido", "Concluído"].includes(selected.status) })}
            </>}
            {selected.status === "Devolvido" && <>{field("rejection_reason", { required: true })}{field('rejection_category')}</>}
          </div>
          {selected.document_area === "Banco DOC" && <details className="admin-explanation"><summary>Dados do Banco DOC e checklist{selected.gerdau_contract && ` · ${selected.gerdau_contract}`}</summary><div className="admin-form-grid">
            {field("bankdoc_module")}{field("bankdoc_record_type")}{field("gerdau_unit")}{field("gerdau_contract")}
            {field('bankdoc_company_name')}{field('bankdoc_company_cnpj')}{field('bankdoc_subject_name')}{field('bankdoc_subject_id')}{field('bankdoc_job')}
            {field("submission_checklist", { label: "Checklist e instruções confirmadas no portal", disabled: documentFrozen })}
          </div></details>}
          <p className="admin-help">{selected.document_area === "Banco DOC" ? "Registre aqui a postagem feita no portal Gerdau / Bancodoc. Confira o módulo e as exigências do contrato antes de postar." : "Registre o documento, o prazo e a evidência do envio feito ao cliente."}</p></fieldset>
          {selected.document_area==='Banco DOC'&&<BankdocReview record={editor.record} values={selected} dirty={JSON.stringify(editor.values)!==JSON.stringify(editor.initialValues)} hasPendingFile={!!editor.pendingAttachment} onEnsureRecord={persistEditor} disabled={busy||documentFrozen||!!editor.record.archived_at} onChange={values=>setEditor(current=>({...current,values}))}/>} 
          <details className="admin-explanation" open={selected.document_checklist?.items?.length>0}><summary>Conferência manual (opcional)</summary><DocumentChecklist document={selected} disabled={busy || documentFrozen || Boolean(editor.record.archived_at)} onChange={value=>setEditor(current=>({...current,values:{...current.values,document_checklist:value}}))} /></details>
          <fieldset><legend>Prazo e repetição</legend><div className="admin-form-grid">{field("due_date")}{field("recurrence")}</div><p className="admin-help">“Mensal” cria o próximo registro após a conclusão, sem reutilizar arquivo ou protocolo. O dia do mês é preservado; meses curtos usam seu último dia.</p></fieldset>
          {editor.record.status === "Devolvido" && !editor.record.archived_at && <div className="admin-revision"><label>Prazo da versão corrigida<input type="date" value={revisionDate} required onChange={(e) => setRevisionDate(e.target.value)} /></label><button type="button" disabled={busy || !revisionDate} onClick={() => run(async () => { const next = await post("/api/administrative", { action: "revise-document", id: editor.record.id, version: editor.record.version, due_date: revisionDate }); await onReload(); edit("admin_documents", next); setNotice("Nova versão criada. O envio anterior foi preservado."); })}><RotateCcw size={16} />Criar versão {editor.record.revision + 1}</button></div>}
          <details className="admin-explanation"><summary>Preparar mensagem sobre o documento</summary><div className="admin-message-actions">{[["request", "Solicitar documentos"], ["status", "Cobrar atualização"], ["submitted", "Confirmar postagem"], ["returned", "Avisar devolução"]].map(([kind, label]) => <button type="button" key={kind} onClick={() => prepareMessage(administrativeDocumentMessage(selected, client(selected.unit_id), kind))}>{label}</button>)}</div>{message && <><MessageAssistant text={message} entity={editor.entity} id={editor.record.id} onApply={setMessage} /><label>Revise o texto antes de enviar<textarea rows={5} value={message} onChange={(e) => setMessage(e.target.value)} /></label>{messageContacts.length > 1 && <label>Contato<select value={messageContact?.id || ""} onChange={(e) => setMessageContactId(e.target.value)}>{messageContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>}<div className="admin-message-actions"><details className="admin-channel-options"><summary>Atendimento integrado</summary><div className="admin-message-actions"><button type="button" onClick={() => openInternalConversation("WhatsApp")}>Revisar no atendimento WhatsApp</button><button type="button" onClick={() => openInternalConversation("E-mail")}>Revisar no atendimento por e-mail</button></div></details><button type="button" onClick={() => openMessageDraft("WhatsApp")}>Abrir rascunho no WhatsApp</button><button type="button" onClick={() => openMessageDraft("E-mail")}>Abrir rascunho no e-mail</button><button type="button" onClick={() => run(async () => { await navigator.clipboard.writeText(message); setNotice("Texto copiado. Revise no canal escolhido antes de enviar."); })}><Copy size={16} />Copiar mensagem</button></div></>}</details>
        </>}
        <details><summary>Aguardando terceiro</summary><div className="admin-form-grid">{field('waiting_reason')}{field('waiting_until')}</div><p className="form-hint">A espera não conclui a pendência nem altera o prazo do documento. {waitingLabel(selected)}</p></details>
        {field("notes")}
        <footer><span>Apagar remove o lançamento do CRM; envios externos não são cancelados.</span><div className="admin-message-actions">{editor.record.id && <button type="button" disabled={busy} onClick={() => run(async () => { if (await onDeleteRecord(editor.entity, editor.record)) setEditor(null); })}><Trash2 size={16} />Apagar lançamento</button>}{editor.entity === "admin_documents" && editor.record.id && (editor.record.archived_at ? <button type="button" disabled={busy} onClick={() => run(async () => { await post("/api/administrative", { action: "restore-document", id: editor.record.id, version: editor.record.version }); await onReload(); setEditor(null); setNotice("Documento restaurado à fila."); })}>Restaurar à fila</button> : <button type="button" disabled={busy} onClick={() => run(async () => { const reason = window.prompt("Por que este documento será retirado da fila? O registro e o protocolo serão preservados."); if (reason === null) return; await post("/api/administrative", { action: "archive-document", id: editor.record.id, version: editor.record.version, reason }); await onReload(); setEditor(null); setNotice("Documento arquivado. O histórico e o protocolo foram preservados."); })}>Arquivar e retirar da fila</button>)}<button className="primary" disabled={busy || Boolean(serviceDraft)}>{busy ? "Salvando…" : "Salvar acompanhamento"}</button></div></footer>
      </form>
    </section></div>}
  </section>;
}
