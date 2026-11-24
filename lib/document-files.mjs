import {randomUUID,createHash} from 'node:crypto';
import {query,get,update,transaction} from './db.mjs';
import {canWrite} from './model.mjs';
import {audit,fail,recordAllowed} from './domain.mjs';
import {putFile,readStoredFile} from './storage.mjs';
import {documentPurposes,documentExtensions,maxDocumentBytes} from './document-files-model.mjs';
import {getFlight} from './flights.mjs';
import {attachFlightFile} from './flight-files.mjs';
import {flightEditors} from './access.mjs';

export async function documentRecord(user,entity,id,write=false,purpose) {
  if(!Object.hasOwn(documentPurposes,entity) || purpose && !Object.hasOwn(documentPurposes[entity],purpose))fail('Tipo de anexo inválido.');
  if(entity==='flight_authorizations'){const flight=await getFlight(user,id);if(!flight||write&&!flightEditors(user))fail('Operação indisponível para seu perfil.',403);return flight;}
  const record=await get(entity,id);
  if(!record || !await recordAllowed(user,entity,record) || write&&!canWrite(user.role,entity))fail('Registro indisponível para seu perfil.',403);
  if(write) {
    if(record.archived_at || entity==='admin_documents'&&['Enviado','Devolvido','Concluído','Substituído'].includes(record.status) || entity==='materials'&&record.status!=='Rascunho' || entity==='proposals'&&['Enviada','Aceita','Recusada','Substituída'].includes(record.status) || entity==='invoices'&&record.reconciled_date)fail('Crie uma nova versão ou restaure o registro antes de alterar seus arquivos.');
    if(entity==='services'&&purpose&&!['data_url','delivery_url'].includes(purpose))fail('Finalidade indisponível.',403);
  }
  return record;
}
export function inspectDocumentFile(filename,bytes) {
  if(typeof filename!=='string'||!filename||filename.length>200||!bytes.length||bytes.length>maxDocumentBytes)fail('Arquivo inválido. Limite: 30 MB.');
  const ext=filename.split('.').at(-1).toLowerCase();
  if(!documentExtensions.includes(ext))fail('Formato de arquivo não permitido.');
  const types={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',csv:'text/csv',kml:'application/vnd.google-earth.kml+xml',zip:'application/zip'};
  const zip=bytes[0]===80&&bytes[1]===75;
  if(ext==='pdf'&&bytes.subarray(0,5).toString()!=='%PDF-' || ext==='png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || ['jpg','jpeg'].includes(ext)&&!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255) || ['zip','xlsx','docx'].includes(ext)&&!zip)fail('O conteúdo não corresponde ao formato do arquivo.');
  return {filename:filename.replace(/[\x00-\x1f\x7f/\\"]/g,'_'),content_type:types[ext],sha256:createHash('sha256').update(bytes).digest('hex')};
}
export async function listDocumentFiles(user,entity,id) {
  await documentRecord(user,entity,id);
  return query('SELECT id,entity,record_id,purpose,filename,content_type,size_bytes,sha256,uploaded_by,created_at,generation_id FROM record_files WHERE entity=$1 AND record_id=$2 ORDER BY created_at DESC,id DESC',[entity,id]);
}
export async function insertDocumentFile(user,entity,recordId,purpose,filename,bytes,{generationId=null,key=randomUUID(),stored=false}={}) {
  const meta=inspectDocumentFile(filename,bytes);
  if(!stored)await putFile(key,bytes,meta.content_type);
  await query('INSERT INTO record_files(id,entity,record_id,purpose,filename,content_type,storage_key,size_bytes,sha256,uploaded_by,created_at,generation_id) VALUES($1,$2,$3,$4,$5,$6,$1,$7,$8,$9,$10,$11)',[key,entity,recordId,purpose,meta.filename,meta.content_type,bytes.length,meta.sha256,user.id,new Date().toISOString(),generationId]);
  return {id:key,...meta,size_bytes:bytes.length,purpose,generation_id:generationId};
}
export async function attachDocument(user,entity,id,purpose,filename,bytes,{expectedVersion,storageKey}={}) {
  if(!purpose)fail('Selecione a finalidade do arquivo.');
  const initial=await documentRecord(user,entity,id,true,purpose);
  if(expectedVersion!=null&&Number(expectedVersion)!==initial.version)fail('Registro alterado. Atualize antes de anexar.',409);
  if(entity==='flight_authorizations')return attachFlightFile(user,id,purpose,filename,bytes,{storageKey});
  const meta=inspectDocumentFile(filename,bytes),key=storageKey||randomUUID();
  if(!storageKey)await putFile(key,bytes,meta.content_type);
  return transaction(async()=>{
    if((await query('SELECT id FROM record_files WHERE id=$1',[key])).length)return {id:key};
    const old=await documentRecord(user,entity,id,true,purpose);
    if(expectedVersion!=null&&Number(expectedVersion)!==old.version)fail('Registro alterado. Atualize antes de anexar.',409);
    const file=await insertDocumentFile(user,entity,id,purpose,filename,bytes,{key,stored:true});
    const data={...old,document_file_ids:{...old.document_file_ids,[purpose]:key}};
    if(entity==='materials')data.file_id=key;
    if(entity==='admin_documents'&&data.document_checklist)data.document_checklist={...data.document_checklist,reviewed_at:null,reviewed_by:null,reviewed_name:null,context:null,items:data.document_checklist.items.map(i=>({...i,result:'Pendente',justification:''}))};
    const saved=await update(entity,id,data,old.version);
    await audit(user,entity,id,'arquivo privado anexado',old,{file,version:saved.version});
    return {...file,record:saved};
  });
}
export async function getDocumentFile(user,id) {
  const file=(await query('SELECT * FROM record_files WHERE id=$1',[id]))[0];
  if(!file)fail('Arquivo não encontrado.',404);
  await documentRecord(user,file.entity,file.record_id);
  return file;
}
export async function documentUploadTicket(user,input) {
  const {entity,record_id,purpose,filename,size,version}=input;
  await documentRecord(user,entity,record_id,true,purpose);
  if(typeof filename!=='string'||filename.length>200||!documentExtensions.includes(filename.split('.').at(-1).toLowerCase())||!Number.isInteger(size)||size<1||size>maxDocumentBytes||!Number.isInteger(version))fail('Arquivo inválido. Limite: 30 MB.');
  const key=randomUUID(),ticket={user_id:user.id,entity,record_id,purpose,filename,size,version,expires:Date.now()+30*60000};
  await query('INSERT INTO settings(id,data) VALUES($1,$2)',['document-upload:'+key,JSON.stringify(ticket)]);
  return {key};
}
export async function completeDocumentUpload(user,key) {
  if(!/^[a-f0-9-]{36}$/.test(key))fail('Identificador inválido.');
  const ticket=JSON.parse((await query('SELECT data FROM settings WHERE id=$1',['document-upload:'+key]))[0]?.data||'null');
  if(!ticket||ticket.user_id!==user.id||ticket.expires<Date.now())fail('Upload expirado ou não autorizado.',403);
  const bytes=await readStoredFile(key);
  if(bytes.length!==ticket.size)fail('Tamanho diferente do autorizado.');
  return attachDocument(user,ticket.entity,ticket.record_id,ticket.purpose,ticket.filename,bytes,{expectedVersion:ticket.version,storageKey:key});
}
