"use client";
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;};
export default function PilotMetrics({rows}){
 const measured=rows.filter(row=>row.measurement);
 const groups=new Map();
 for(const row of measured){const m=row.measurement,key=JSON.stringify([m.kind,m.phase,m.variant]);if(!groups.has(key))groups.set(key,{...m,values:[]});groups.get(key).values.push(m.minutes);}
 return <section className="panel"><h2>Medições do piloto</h2><p>Amostras manuais nos até 200 relatos disponíveis nesta lista. Compare tarefas de complexidade semelhante; os valores não representam toda a operação.</p>
 {measured.length?<><p>Período dos registros medidos: {measured.map(row=>row.created_at.slice(0,10)).sort()[0]} a {measured.map(row=>row.created_at.slice(0,10)).sort().at(-1)}.</p>{[...groups.entries()].map(([key,group])=><p key={key}>{group.kind} · {group.phase} · {group.variant}: mediana {median(group.values).toLocaleString('pt-BR')} minutos · amostra {group.values.length}</p>)}</>:<p>Sem medições registradas. Use a seção opcional de tempo em “Reportar atrito” durante a referência de cinco dias úteis e o piloto de dez dias úteis.</p>}
 </section>;
}
