import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rewriteMessage} from '../lib/message-assistant.mjs';
const env={CRM_MESSAGE_AI_ENABLED:'true',GROQ_API_KEY:'fake-test-key',GROQ_MODEL:'test-model'};
const output=content=>({ok:true,json:async()=>({choices:[{message:{content}}],usage:{total_tokens:12}})});
test('assistente desativado não chama provedor e deixa o modelo manual disponível',async()=>{
 await assert.rejects(rewriteMessage('Solicitar liberação','improve',{env:{},fetchImpl:()=>{throw Error('Não deve chamar');}}),/não ativada/);
});
test('mantém referências numéricas e links em trinta variações sem dar acesso a ferramentas',async()=>{
 for(let i=1;i<=30;i++){
  const source=`Olá. Encaminho nota ${i}, competência 2026-10 e referência https://example.invalid/${i}. Obrigado.`;
  let payload;
  const result=await rewriteMessage(source,'improve',{env,fetchImpl:async(url,request)=>{assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');payload=JSON.parse(request.body);return output(payload.messages[1].content.replace('Olá.','Olá, equipe.'));}});
  assert.ok(result.suggestion.includes(`nota ${i}`));assert.ok(result.suggestion.includes('2026-10'));assert.ok(result.suggestion.includes(`https://example.invalid/${i}.`));assert.equal(payload.tools,undefined);
 }
});
test('recusa sugestão que altera fatos e falhas não revelam erro bruto do provedor',async()=>{
 await assert.rejects(rewriteMessage('Nota 123 para conferir','shorten',{env,fetchImpl:async()=>output('Nota 999 para conferir')}),/numérica/);
 await assert.rejects(rewriteMessage('Nota 123 para conferir','shorten',{env,fetchImpl:async()=>output('Nota para conferir')}),/referências/);
 await assert.rejects(rewriteMessage('Nota para conferir','tone',{env,fetchImpl:async()=>({ok:false,status:429})}),/Limite/);
 await assert.rejects(rewriteMessage('Nota para conferir','tone',{env,fetchImpl:async()=>{throw Error('secret-provider-diagnostic');}}),error=>error.status===503&&!error.message.includes('secret'));
 await assert.rejects(rewriteMessage('Nota para conferir','tone',{env,fetchImpl:async()=>({ok:true,json:async()=>{throw Error('invalid');}})}),/inválida/);
});
