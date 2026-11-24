import {randomUUID} from 'node:crypto';
import {requireUser,checkOrigin} from '../../../../lib/auth.mjs';
import {query,transaction,get,isPostgres} from '../../../../lib/db.mjs';
import {administrativeRoles} from '../../../../lib/administrative-workflow.mjs';
import {validateChecklist,resetChecklist} from '../../../../lib/document-checklist.mjs';
import {audit,fail} from '../../../../lib/domain.mjs';
import {errorResponse,jsonBody} from '../../../../lib/http.mjs';
export const runtime='nodejs';
const key='document-checklist-templates';
async function read(){const row=(await query('SELECT data FROM settings WHERE id=$1',[key]))[0];return row?JSON.parse(row.data):[];}
async function authorize(){const user=await requireUser();if(!administrativeRoles.includes(user.role))fail('Acesso restrito ao administrativo.',403);return user;}
export async function GET(){try{await authorize();return Response.json({templates:await read()});}catch(error){return errorResponse(error);}}
export async function POST(request){try{
 checkOrigin(request);const user=await authorize(), body=await jsonBody(request);
 if(typeof body.unit_id!=='string'||!await get('units',body.unit_id))fail('Escolha uma unidade válida.');
 if(typeof body.contract!=='string'||body.contract.length>500||typeof body.type!=='string'||body.type.length>120)fail('Contrato ou tipo inválido.');
 let checklist;try{checklist=resetChecklist(validateChecklist(body.checklist,{},null,user));}catch(error){fail(error.message);}
 if(!checklist?.items.length)fail('Inclua ao menos um item de conferência.');
 const templates=await transaction(async()=>{
   await query('INSERT INTO settings(id,data) VALUES($1,$2) ON CONFLICT(id) DO NOTHING',[key,'[]']);
   if(isPostgres())await query('SELECT id FROM settings WHERE id=$1 FOR UPDATE',[key]);
   const current=await read(); if(current.length>=100)fail('Limite de 100 modelos atingido. Revise os modelos com a gestão.');
   if(current.some(item=>item.unit_id===body.unit_id&&item.contract===body.contract&&item.type===body.type&&item.checklist.source===checklist.source&&item.checklist.source_version===checklist.source_version))fail('Já existe um modelo com esta fonte e versão para o contrato. Registre uma nova versão das instruções.');
   const next=[...current,{id:randomUUID(),unit_id:body.unit_id,contract:body.contract,type:body.type,checklist,created_by:user.id,created_at:new Date().toISOString()}];
   await query('INSERT INTO settings(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2',[key,JSON.stringify(next)]);await audit(user,'settings',key,'modelo de conferência cadastrado',current,next);return next;
 });return Response.json({templates});
 }catch(error){return errorResponse(error);}}
