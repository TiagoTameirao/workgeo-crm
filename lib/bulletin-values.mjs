const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const text=(v,max=200)=>{if(typeof v!=='string'||v.length>max)fail('Texto inválido no boletim.');return v.trim();};
const date=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v||'')||!Number.isFinite(Date.parse(v+'T12:00:00Z'))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)fail('Data inválida no boletim.');return v;};
export function validateBulletin(input){
 if(!input||!Array.isArray(input.items)||!input.items.length||input.items.length>100)fail('Informe de 1 a 100 serviços.');
 const data={};for(const key of ['client','upe','competence','number','contractor_responsible','client_responsible'])data[key]=text(input[key]||'');
 if(!data.client||!data.upe||!data.competence||!data.number)fail('Preencha cliente, UPE, competência e número da medição.');
 data.issued_date=date(input.issued_date);
 data.items=input.items.map(row=>{
  const description=text(row.description,1000),unit=text(row.unit||data.upe,100),performed_date=date(row.performed_date);
  if(!description||!unit)fail('Descreva o serviço e a unidade.');
  const q=String(row.quantity),p=String(row.unit_price);
  if(!/^\d{1,9}(\.\d{1,6})?$/.test(q)||!/^\d{1,9}(\.\d{1,2})?$/.test(p))fail('Quantidade: até 6 casas; preço: até 2 casas decimais.');
  const [qa,qb='']=q.split('.'),[pa,pb='']=p.split('.'),micros=BigInt(qa)*1000000n+BigInt(qb.padEnd(6,'0')),cents=BigInt(pa)*100n+BigInt(pb.padEnd(2,'0'));
  if(micros<=0n||cents<=0n)fail('Quantidade e preço devem ser positivos.');
  const total=(micros*cents+500000n)/1000000n;if(total>9007199254740991n||total===0n)fail('Valor do item fora do intervalo.');
  return {description,unit,performed_date,quantity:q,unit_price:p,total_cents:Number(total)};
 });
 data.total_cents=data.items.reduce((n,r)=>n+r.total_cents,0);if(!Number.isSafeInteger(data.total_cents))fail('Total fora do intervalo.');return data;
}
