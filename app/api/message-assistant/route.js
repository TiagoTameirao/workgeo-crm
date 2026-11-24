import {requireUser,checkOrigin} from '../../../lib/auth.mjs';
import {query,transaction,get,isPostgres} from '../../../lib/db.mjs';
import {recordAllowed,messagingRoles,audit,fail} from '../../../lib/domain.mjs';
import {assistantConfigured,rewriteMessage} from '../../../lib/message-assistant.mjs';
import {errorResponse,jsonBody} from '../../../lib/http.mjs';
export const runtime='nodejs';
export async function GET(){try{const user=await requireUser();if(!messagingRoles.includes(user.role))fail('Sem permissão de atendimento.',403);return Response.json({enabled:assistantConfigured()});}catch(error){return errorResponse(error);}}
export async function POST(request){try{
 checkOrigin(request);const user=await requireUser(),body=await jsonBody(request);
 if(!messagingRoles.includes(user.role))fail('Sem permissão de atendimento.',403);
 if(!['invoices','admin_documents','conversations'].includes(body.entity)||typeof body.id!=='string')fail('Salve o acompanhamento antes de usar a IA.');
 if(!await recordAllowed(user,body.entity,await get(body.entity,body.id)))fail('Registro sem acesso.',403);
 if(!assistantConfigured())fail('IA não ativada. Continue usando o modelo existente.',503);
 if(typeof body.text!=='string'||body.text.length>5000||!['improve','shorten','tone'].includes(body.action))fail('Texto ou ação inválidos.');
 const key='message-ai-limit:'+user.id+':'+new Date().toISOString().slice(0,10);
 await transaction(async()=>{
  await query('INSERT INTO settings(id,data) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[key,JSON.stringify({count:0})]);
  if(isPostgres())await query('SELECT id FROM settings WHERE id=$1 FOR UPDATE',[key]);
  const row=(await query('SELECT data FROM settings WHERE id=$1',[key]))[0],value=JSON.parse(row.data);
  if(value.count>=20)fail('Limite diário de 20 solicitações atingido. Use o modelo existente.',429);
  await query('UPDATE settings SET data=$1 WHERE id=$2',[JSON.stringify({count:value.count+1}),key]);
 });
 const result=await rewriteMessage(body.text,body.action);
 await audit(user,'message_assistant',body.id,'sugestão preparada, sem envio',null,{model:result.model,elapsed_ms:result.elapsed_ms,tokens:result.tokens});
 return Response.json(result);
 }catch(error){return errorResponse(error);}}
