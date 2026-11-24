"use client";
import {documentDossiers} from '../../lib/document-dossier.mjs';
import {checklistComplete} from '../../lib/document-checklist.mjs';
export default function DocumentDossier({documents,client,onOpen}) {
  const groups=documentDossiers(documents);
  const returns=documents.filter(item=>item.rejection_reason);
  const categories=Object.entries(returns.reduce((result,item)=>({...result,[item.rejection_category||'Sem categoria']:(result[item.rejection_category||'Sem categoria']||0)+1}),{}));
  return <section className="panel"><h3>Dossiê por cliente, contrato e competência</h3><p>Somente exigências cadastradas. A lista não comprova que todos os documentos exigidos pelo portal foram incluídos.</p>
    {groups.length?groups.map(group=><details key={group.key} className="operation-review"><summary>{client(group.unit_id)} · Contrato: {group.contract||'Não informado'} · Competência: {group.competence||'Não informada'}</summary>
    <p>{group.current.length} registros atuais · {group.returns.length} registros com devolução · {group.revisions.length} versões de correção</p>
    {group.current.map(document=><div className="record-line" key={document.id}><button type="button" className="text-button" onClick={()=>onOpen(document)}>{document.name} · versão {document.revision} · {document.status}</button><span>{checklistComplete(document.document_checklist)&&document.document_checklist.reviewed_at?'Conferência interna registrada':document.document_checklist?.items.length?'Conferência pendente':'Sem conferência estruturada'}</span>{document.url&&<a href={document.url} target="_blank" rel="noopener noreferrer">Abrir documento</a>}{document.protocol&&<span>Protocolo: {document.protocol}</span>}</div>)}
    {group.documents.length!==group.current.length&&<details><summary>Histórico e versões anteriores</summary>{group.documents.filter(document=>!group.current.includes(document)).map(document=><button type="button" className="record-line" key={document.id} onClick={()=>onOpen(document)}>{document.name} · versão {document.revision} · {document.archived_at?'Arquivado':document.status}</button>)}</details>}
    </details>):<p>Nenhuma exigência cadastrada nesta seleção.</p>}
    <h3>Causas de devolução registradas</h3>{returns.length?<><p>Amostra: {returns.length} registros com motivo de devolução, considerando o histórico disponível nesta seleção.</p>{categories.map(([category,count])=><p key={category}>{category}: {count}</p>)}</>:<p>Sem dados de devolução nesta seleção. Isso não demonstra ausência de retrabalho na operação.</p>}
  </section>;
}
