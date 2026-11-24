"use client";
import {handoffWarnings,waitingLabel} from '../../lib/operation-flow.mjs';
export function HandoffReview({service,contacts}) {
 const warnings=handoffWarnings(service,contacts);
 return <section className="source-note operation-review"><strong>Passagem para a próxima etapa</strong><p>Confira o contexto com quem receberá o trabalho. Os avisos orientam a revisão e não autorizam voo nem substituem conferência técnica.</p>{warnings.length?<ul>{warnings.map(item=><li key={item}>{item}</li>)}</ul>:<p>Informações básicas preenchidas. Confirme sua atualidade com a equipe.</p>}{waitingLabel(service)&&<p>{waitingLabel(service)}</p>}</section>;
}
export default function OperationOverview({data,user,onPrepare,onOpen}) {
 const canPrepare=['Administrador','Administração','Administrativo','Aprovação comercial','Comercial'].includes(user.role);
 const won=canPrepare?(data.opportunities||[]).filter(item=>item.status==='Ganha' && !(data.services||[]).some(service=>(data.contracts||[]).some(contract=>contract.id===service.contract_id&&contract.opportunity_id===item.id))):[];
 const services=data.services||[];
 return <section className="panel"><h2>Continuidade dos serviços</h2><p>Comercial → campo → processamento → conferência → entrega → acompanhamento administrativo.</p>
 {won.length>0&&<><h3>Oportunidades ganhas sem operação preparada</h3>{won.map(item=><div className="record-line" key={item.id}><span>{item.name}</span><button type="button" onClick={()=>onPrepare(item)}>Preparar operação</button></div>)}</>}
 <div className="admin-summary"><span><strong>{services.filter(item=>handoffWarnings(item,data.contacts).length).length}</strong> serviços com informações a conferir</span><span><strong>{services.filter(item=>item.waiting_reason).length}</strong> aguardando terceiro</span></div>
 <details><summary>Conferir passagens por serviço</summary>{services.map(service=><div className="operation-review" key={service.id}><button className="text-button" onClick={()=>onOpen('services',service)}>{service.name} · {service.status}</button><HandoffReview service={service} contacts={data.contacts||[]} /></div>)}</details>
 </section>;
}
