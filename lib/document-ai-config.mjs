import {query,transaction} from './db.mjs';
import {isManagement} from './agenda.mjs';
import {fail,audit} from './domain.mjs';
import {encryptBackup,decryptBackup} from './backup.mjs';
export const documentAIModel='qwen/qwen3.8-27b';
const setting='document-ai-configuration';
export async function documentAIEnvironment(){
  const row=(await query('SELECT data FROM settings WHERE id=$1',[setting]))[0];
  if(!row)return process.env;
  try{const saved=decryptBackup(Buffer.from(JSON.parse(row.data).encrypted,'base64'));return {...process.env,GROQ_API_KEY:saved.key,CRM_DOCUMENT_AI_ENABLED:saved.enabled?'true':'false',CRM_DOCUMENT_AI_ZDR_CONFIRMED:saved.zdr?'true':'false'};}
  catch{return {...process.env,GROQ_API_KEY:'',CRM_DOCUMENT_AI_ENABLED:'false'};}
}
export const documentAIConfigured=env=>env.CRM_DOCUMENT_AI_ENABLED==='true'&&Boolean(env.GROQ_API_KEY)&&env.CRM_DOCUMENT_AI_ZDR_CONFIRMED==='true';
export async function configureDocumentAI(user,input,{fetchImpl=fetch}={}){
  if(!isManagement(user))fail('Somente a administração pode configurar a integração.',403);
  if(typeof input?.enabled!=='boolean')fail('Configuração inválida.');
  const old=await documentAIEnvironment();
  const key=typeof input.key==='string'&&input.key.trim()?input.key.trim():old.GROQ_API_KEY;
  if(input.enabled){
    if(!key||key.length<20||key.length>300||/[\s\x00-\x1f]/.test(key))fail('Informe uma chave válida da Groq no campo privado.');
    if(input.free_plan!==true||input.zdr!==true)fail('Confirme a conta gratuita sem faturamento e a retenção zero na Groq.');
    let response;try{response=await fetchImpl('https://api.groq.com/openai/v1/models',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});}catch{fail('Não foi possível verificar a chave. Tente novamente.');}
    if(!response.ok)fail('A Groq não confirmou a chave. Confira a conta e tente novamente.');
    const models=await response.json();if(!models.data?.some(m=>m.id===documentAIModel))fail('O modelo selecionado não está disponível nesta conta. A integração continua desativada.');
  }
  const encrypted=encryptBackup({key:key||'',enabled:input.enabled,zdr:input.zdr===true,free_plan:input.free_plan===true}).toString('base64');
  await transaction(async()=>{await query('INSERT INTO settings(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2',[setting,JSON.stringify({encrypted})]);await audit(user,'settings',setting,input.enabled?'IA documental configurada':'IA documental desativada',null,{enabled:input.enabled,model:documentAIModel,zdr:input.zdr===true});});
  return {configured:input.enabled,model:documentAIModel};
}
