"use client";
export default function ClientContext({unit,data,onOpen}) {
 const linked=entity=>(data[entity]||[]).filter(item=>item.unit_id===unit.id);
 const conversations=new Set(linked('conversations').map(item=>item.id));
 const interactions=[...(data.messages||[]).filter(item=>conversations.has(item.conversation_id)).map(item=>({...item,entity:'messages',name:item.body?.slice(0,140)||'Mensagem registrada'})),...linked('activities').filter(item=>item.status==='Concluída').map(item=>({...item,entity:'activities'}))].sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
 const opportunities=linked('opportunities').filter(item=>!['Ganha','Perdida'].includes(item.status));
 const services=linked('services');
 const documents=linked('admin_documents').filter(item=>!item.archived_at&&!['Concluído','Substituído'].includes(item.status));
 const materials=(data.materials||[]).filter(item=>item.status==='Aprovado'&&(!item.unit_id||item.unit_id===unit.id)&&(!item.segment||item.segment==='Todos'||item.segment===unit.segment));
 return <section className="related"><h3>Antes do próximo contato</h3>
 <p><strong>Próxima ação:</strong> {unit.next_action||'A definir'}{unit.next_date?` · ${unit.next_date}`:''}</p>
 {interactions.length?<><p><strong>Interação mais recente registrada:</strong> {interactions[0].name}{interactions[0].created_at?` · ${interactions[0].created_at.slice(0,10)}`:''}</p><button type="button" className="text-button" onClick={()=>interactions[0].entity==='messages'?onOpen('conversations',(data.conversations||[]).find(item=>item.id===interactions[0].conversation_id)):onOpen('activities',interactions[0])}>Abrir origem da interação</button></>:<p>Nenhuma interação registrada no CRM. Contatos fora do sistema podem ter ocorrido.</p>}
 {opportunities.length>0&&<><h4>Oportunidades em andamento</h4>{opportunities.map(item=><button type="button" className="record-line" key={item.id} onClick={()=>onOpen('opportunities',item)}>{item.name} · {item.status} · {item.next_action||'Próxima ação a definir'}</button>)}</>}
 {services.length>0&&<><h4>Serviços registrados</h4>{services.map(item=><button type="button" className="record-line" key={item.id} onClick={()=>onOpen('services',item)}>{item.name} · {item.status}</button>)}</>}
 {documents.length>0&&<><h4>Documentos pendentes</h4>{documents.map(item=><button type="button" className="record-line" key={item.id} onClick={()=>onOpen('admin_documents',item)}>{item.name} · {item.status} · {item.due_date||'Prazo a definir'}</button>)}</>}
 {materials.length>0&&<><h4>Materiais aprovados pertinentes ao cadastro</h4>{materials.map(item=><button type="button" className="record-line" key={item.id} onClick={()=>onOpen('materials',item)}>{item.name} · versão {item.revision}</button>)}<p className="form-hint">Confira se o material atende à demanda antes de enviar.</p></>}
 {!unit.owner_id&&<p>Responsável comercial ainda não vinculado a uma conta.</p>}
 </section>;
}
