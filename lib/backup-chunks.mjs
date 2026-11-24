import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function validate(id,key) {
  if(typeof id!=='string'||!/^[a-z0-9-]{1,100}$/.test(id)||!Buffer.isBuffer(key)||key.length!==32) throw new Error('Identificador ou chave de backup inválido.');
}
function seal(bytes,key,aad) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
  return Buffer.concat([Buffer.from('WGC1'),iv,cipher.getAuthTag(),ciphertext]);
}
function open(bytes,key,aad) {
  if(!Buffer.isBuffer(bytes)||bytes.length<32||bytes.subarray(0,4).toString()!=='WGC1')throw new Error('Bloco criptografado inválido.');
  const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(4,16));
  decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(bytes.subarray(16,32));
  return Buffer.concat([decipher.update(bytes.subarray(32)),decipher.final()]);
}
export async function writeBackupChunks({id,key,source,store,chunkSize=1024*1024,resume=false,allowEmpty=false}) {
  validate(id,key);
  if(!Number.isInteger(chunkSize)||chunkSize<1024||chunkSize>8*1024*1024)throw new Error('Tamanho de bloco inválido.');
  if(resume&&typeof store.getIfPresent!=='function')throw new Error('A retomada exige leitura explícita de arquivos ausentes.');
  const savedManifest=resume?await store.getIfPresent(`${id}-manifest`):null;
  const completed=savedManifest?JSON.parse(open(savedManifest,key,`${id}:manifest`).toString('utf8')):null;
  if(completed&&(completed.version!==1||completed.id!==id||!Array.isArray(completed.parts)))throw new Error('Manifesto inválido.');
  const digest=createHash('sha256'),parts=[];let pending=Buffer.alloc(0),total=0;
  async function save(part){
    const index=parts.length,name=`${id}-chunk-${index}`;
    const existing=resume?await store.getIfPresent(name):null;
    if(existing){
      if(!open(existing,key,`${id}:chunk:${index}`).equals(part))throw new Error('Bloco existente diverge da fonte; retomada interrompida.');
    }else{
      if(completed)throw new Error('Manifesto concluído aponta para bloco ausente.');
      await store.put(name,seal(part,key,`${id}:chunk:${index}`));
    }
    digest.update(part);total+=part.length;parts.push({index,bytes:part.length,sha256:hash(part)});
  }
  for await (const item of source){
    let data=Buffer.from(item);
    while(data.length){
      const size=Math.min(chunkSize-pending.length,data.length);
      pending=Buffer.concat([pending,data.subarray(0,size)]);data=data.subarray(size);
      if(pending.length===chunkSize){await save(pending);pending=Buffer.alloc(0);}
    }
  }
  if(pending.length)await save(pending);
  if(!parts.length&&!allowEmpty)throw new Error('O backup está vazio.');
  const manifest={version:1,id,bytes:total,sha256:digest.digest('hex'),parts};
  if(completed){
    if(JSON.stringify(completed)!==JSON.stringify(manifest))throw new Error('Backup concluído diverge da fonte; nada foi sobrescrito.');
  }else await store.put(`${id}-manifest`,seal(Buffer.from(JSON.stringify(manifest)),key,`${id}:manifest`));
  return {id,bytes:total,parts:parts.length,sha256:manifest.sha256};
}
export async function* readBackupChunks({id,key,store}) {
  validate(id,key);
  const manifest=JSON.parse(open(await store.get(`${id}-manifest`),key,`${id}:manifest`).toString('utf8'));
  if(manifest.version!==1||manifest.id!==id||!Array.isArray(manifest.parts)||manifest.parts.length>100000||(!manifest.parts.length&&manifest.bytes!==0))throw new Error('Manifesto inválido.');
  const digest=createHash('sha256');let total=0;
  for(let index=0;index<manifest.parts.length;index++){
    const entry=manifest.parts[index];
    if(entry.index!==index||!Number.isInteger(entry.bytes)||entry.bytes<=0||entry.bytes>8*1024*1024)throw new Error('Sequência inválida.');
    const part=open(await store.get(`${id}-chunk-${index}`),key,`${id}:chunk:${index}`);
    if(part.length!==entry.bytes||hash(part)!==entry.sha256)throw new Error('Bloco divergente.');
    total+=part.length;digest.update(part);yield part;
  }
  if(total!==manifest.bytes||digest.digest('hex')!==manifest.sha256)throw new Error('Backup incompleto ou alterado.');
}
