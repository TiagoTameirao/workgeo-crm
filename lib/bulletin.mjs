import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {query,update,transaction,get} from './db.mjs';
import {documentRecord,insertDocumentFile} from './document-files.mjs';
import {audit,fail} from './domain.mjs';
import {validateBulletin} from './bulletin-values.mjs';
export {validateBulletin};
const money=c=>(c/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const brdate=v=>v.split('-').reverse().join('/');
export async function renderBulletin(data){
 const [{PDFDocument,StandardFonts,rgb},{default:ExcelJS}]=await Promise.all([import('pdf-lib'),import('exceljs')]);
 const pdf=await PDFDocument.create(),normal=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 let logo;try{logo=await pdf.embedPng(await readFile(path.join(process.cwd(),'data/bulletin-logo.png')));}catch{}
 const clean=s=>Array.from(String(s)).map(c=>{try{normal.encodeText(c);return c;}catch{return '?';}}).join('');
 const wrap=(value,width,size=8,font=normal)=>{
  const lines=[];let line='';
  for(const word of clean(value).split(/\s+/)) {
   if(line&&font.widthOfTextAtSize(line+' '+word,size)>width){lines.push(line);line='';}
   if(font.widthOfTextAtSize(word,size)>width){for(const char of word){if(font.widthOfTextAtSize(line+char,size)>width){lines.push(line);line='';}line+=char;}}
   else line+=(line?' ':'')+word;
  }
  if(line)lines.push(line);return lines;
 };
 let page,y;const widths=[214,100,76,82,72,262],xs=[18];widths.forEach(w=>xs.push(xs.at(-1)+w));
 const draw=(str,x,top,size=8,font=normal)=>page.drawText(clean(str),{x,y:595-top-size,size,font});
 const box=(x,top,w,h,fill=false)=>page.drawRectangle({x,y:595-top-h,width:w,height:h,borderWidth:0.7,borderColor:rgb(0,0,0),...(fill?{color:rgb(.85,.85,.85)}:{})});
 function header(){
  page=pdf.addPage([842,595]);
  const clientLines=wrap('Cliente: '+data.client,430,10,bold),upeLines=wrap('UPE: '+data.upe,430,10,bold);
  const meta=[['Período:',data.competence],['Medição Nº:',data.number],['Data Emissão:',brdate(data.issued_date)]].map(([label,value])=>({label,lines:wrap(value,175,8)}));
  const rightBottom=95+meta.reduce((n,r)=>n+Math.max(17,r.lines.length*10+7),0),leftBottom=114+(clientLines.length+upeLines.length)*12;
  const tableTop=Math.max(150,leftBottom+6,rightBottom+4);
  box(18,74,806,tableTop-78,true);box(18,74,94,tableTop-78);
  if(logo)page.drawImage(logo,{x:22,y:595-139,width:84,height:60});
  draw('BOLETIM DE MEDIÇÃO',385,77,14,bold);draw('WORKGEO GEOTECNOLOGIAS LTDA',115,97,12,bold);
  clientLines.forEach((l,i)=>draw(l,115,114+i*12,10,bold));upeLines.forEach((l,i)=>draw(l,115,114+(clientLines.length+i)*12,10,bold));
  let top=95;for(const row of meta){const height=Math.max(17,row.lines.length*10+7);box(555,top,269,height);draw(row.label,559,top+4,8,bold);row.lines.forEach((l,i)=>draw(l,645,top+4+i*10,8));top+=height;}
  ['DESCRIÇÃO DOS SERVIÇOS','UNIDADE','DATA','PREÇO POR UND.','QUANTIDADE','VALOR'].forEach((label,i)=>{box(xs[i],tableTop,widths[i],18,true);draw(label,xs[i]+4,tableTop+5,7,bold);});y=tableTop+18;
 }
 header();
 for(const row of data.items){const lines=wrap(row.description,widths[0]-8);for(let n=0;n<lines.length;n+=18){const part=lines.slice(n,n+18),h=Math.max(40,part.length*11+12);if(y+h>430)header();widths.forEach((w,i)=>box(xs[i],y,w,h));part.forEach((l,i)=>draw(l,22,y+6+i*11));const values=[row.unit,brdate(row.performed_date),'R$ '+money(Math.round(Number(row.unit_price)*100)),Number(row.quantity).toLocaleString('pt-BR',{maximumFractionDigits:6}),'R$ '+money(row.total_cents)];(n===0?values:values.map(()=>'')).forEach((v,i)=>wrap(v,widths[i+1]-8).forEach((l,j)=>draw(l,xs[i+1]+4,y+8+j*10)));y+=h;}}
 if(y+120>555)header();box(18,y,806,20,true);draw('VALOR TOTAL',560,y+5,9,bold);draw('R$ '+money(data.total_cents),700,y+5,10,bold);y+=25;
 for(const [i,label]of ['ADMINISTRATIVA RESPONSÁVEL (CONTRATADA)','GESTOR RESPONSÁVEL (CONTRATANTE)'].entries()){const x=18+i*403;box(x,y,403,82);box(x,y,403,18,true);draw(label,x+12,y+5,8,bold);page.drawLine({start:{x:x+60,y:595-y-52},end:{x:x+343,y:595-y-52},thickness:.6});const name=i?data.client_responsible:data.contractor_responsible;wrap(name,380).forEach((l,j)=>draw(l,x+12,y+58+j*10,8));}
 pdf.getPages().forEach((p,i)=>p.drawText(`${i+1} / ${pdf.getPageCount()}`,{x:785,y:20,size:8,font:normal}));
 const wb=new ExcelJS.Workbook();wb.creator='WorkGeo';wb.calcProperties.fullCalcOnLoad=true;const ws=wb.addWorksheet('Boletim',{pageSetup:{paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:6',margins:{left:.2,right:.2,top:.5,bottom:.4,header:.1,footer:.1}}});
 ws.columns=[{width:55},{width:20},{width:15},{width:20},{width:16},{width:25}];ws.mergeCells('A1:F1');ws.getCell('A1').value='BOLETIM DE MEDIÇÃO';ws.getRow(1).height=26;ws.getCell('A1').font={name:'Arial',bold:true,size:15};ws.getCell('A1').alignment={horizontal:'center'};
 ws.mergeCells('A2:F2');ws.getCell('A2').value='WORKGEO GEOTECNOLOGIAS LTDA';ws.mergeCells('A3:C3');ws.getCell('A3').value='Cliente: '+data.client;ws.mergeCells('D3:F3');ws.getCell('D3').value='Período: '+data.competence;ws.mergeCells('A4:C4');ws.getCell('A4').value='UPE: '+data.upe;ws.mergeCells('D4:F4');ws.getCell('D4').value='Medição Nº: '+data.number;ws.mergeCells('A5:F5');ws.getCell('A5').value='Data emissão: '+brdate(data.issued_date);
 ws.getRow(6).values=['DESCRIÇÃO DOS SERVIÇOS','UNIDADE','DATA','PREÇO POR UND.','QUANTIDADE','VALOR'];
 for(const [i,row]of data.items.entries()){const r=7+i;ws.getRow(r).values=[row.description,row.unit,brdate(row.performed_date),Number(row.unit_price),Number(row.quantity),{formula:`ROUND(D${r}*E${r},2)`,result:row.total_cents/100}];ws.getRow(r).height=Math.max(40,Math.ceil(row.description.length/50)*13);ws.getCell('D'+r).numFmt='"R$" #,##0.00';ws.getCell('E'+r).numFmt='0.######';ws.getCell('F'+r).numFmt='"R$" #,##0.00';}
 const last=6+data.items.length,total=last+1;ws.mergeCells(`A${total}:E${total}`);ws.getCell('A'+total).value='VALOR TOTAL';ws.getCell('F'+total).value={formula:`SUM(F7:F${last})`,result:data.total_cents/100};ws.getCell('F'+total).numFmt='"R$" #,##0.00';
 ws.mergeCells(`A${total+2}:C${total+2}`);ws.mergeCells(`D${total+2}:F${total+2}`);ws.getCell('A'+(total+2)).value='ADMINISTRATIVA RESPONSÁVEL (CONTRATADA)';ws.getCell('D'+(total+2)).value='GESTOR RESPONSÁVEL (CONTRATANTE)';ws.mergeCells(`A${total+3}:C${total+3}`);ws.mergeCells(`D${total+3}:F${total+3}`);ws.getRow(total+3).height=60;ws.getCell('A'+(total+3)).value='____________________________\n'+data.contractor_responsible;ws.getCell('D'+(total+3)).value='____________________________\n'+data.client_responsible;
 ws.eachRow((row,r)=>row.eachCell(cell=>{cell.alignment={...cell.alignment,vertical:'middle',wrapText:true};cell.border={top:{style:'thin'},left:{style:'thin'},bottom:{style:'thin'},right:{style:'thin'}};if(r!==1)cell.font={name:'Arial',size:10,bold:r<=6||r===total};if(r===1||r===6||r===total)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFD9D9D9'}};}));ws.pageSetup.printArea=`A1:F${total+3}`;
 return {pdf:Buffer.from(await pdf.save()),xlsx:Buffer.from(await wb.xlsx.writeBuffer())};
}
export async function generateBulletin(user,id,input,version){
 const old=await documentRecord(user,'invoices',id,true,'bulletin');if(old.version!==version)fail('Medição alterada. Salve e atualize antes de gerar.',409);
 const data=validateBulletin(input);if(data.total_cents!==Number(old.amount_cents))fail('O total do boletim deve corresponder ao valor da medição. Ajuste e salve a medição antes de gerar.');
 const output=await renderBulletin(data),generation=randomUUID();
 return transaction(async()=>{const record=await documentRecord(user,'invoices',id,true,'bulletin');if(record.version!==version)fail('Medição alterada durante a geração.',409);
 const revision=Number((await query('SELECT COALESCE(MAX(revision),0) n FROM bulletin_versions WHERE invoice_id=$1',[id]))[0].n)+1;
 const base='BM-'+data.number.replace(/[^\w-]/g,'-')+'-v'+revision;
 const pdf=await insertDocumentFile(user,'invoices',id,'bulletin',base+'.pdf',output.pdf,{generationId:generation}),xlsx=await insertDocumentFile(user,'invoices',id,'bulletin',base+'.xlsx',output.xlsx,{generationId:generation});
 const snapshot={...data,pdf_id:pdf.id,xlsx_id:xlsx.id};await query('INSERT INTO bulletin_versions(id,invoice_id,revision,data,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6)',[generation,id,revision,JSON.stringify(snapshot),user.id,new Date().toISOString()]);
 const saved=await update('invoices',id,{...record,bulletin_data:data,document_file_ids:{...record.document_file_ids,bulletin:pdf.id}},version);await audit(user,'invoices',id,'boletim PDF e Excel gerado',null,{generation,revision,total_cents:data.total_cents});return {record:saved,revision,...snapshot};});
}
