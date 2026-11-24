import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {writeBackupChunks,readBackupChunks} from './backup-chunks.mjs';

const fileId=(id,storageKey)=>id+'-file-'+createHash('sha256').update(storageKey).digest('hex');
const verifyId=id=>{if(typeof id!=='string'||!/^[a-z0-9-]{1,29}$/.test(id))throw new Error('Identificador da cópia inválido.');};
const verifyKey=key=>{if(typeof key!=='string'||!/^[\w-]{1,200}$/.test(key))throw new Error('Referência de arquivo inválida.');};
async function collect(stream,limit=1024*1024){let size=0;const chunks=[];for await(const item of stream){size+=item.length;if(size>limit)throw new Error('Manifesto excede o limite.');chunks.push(item);}return Buffer.concat(chunks);}

export async function createBackupBundle({id,key,store,database,findReferences,readFile,resume=false,chunkSize,databaseFormat='sqlite-gzip'}) {
  verifyId(id);
  if(!['sqlite-gzip','sql-gzip'].includes(databaseFormat))throw new Error('Formato do banco inválido.');
  const options={key,store,resume,...(chunkSize?{chunkSize}:{})};
  const databaseId=id+'-database';
  await writeBackupChunks({id:databaseId,source:database,...options});
  // A extração de referências deve ocorrer sobre a cópia restaurada, nunca sobre uma segunda leitura do banco ativo.
  let databaseVerified=false;
  async function* verifiedDatabase(){
    yield* readBackupChunks({id:databaseId,key,store});
    databaseVerified=true;
  }
  const references=await findReferences(verifiedDatabase());
  if(!databaseVerified)throw new Error('A cópia do banco não foi lida e verificada até o fim.');
  if(!Array.isArray(references)||references.length>5000)throw new Error('Lista de arquivos inválida.');
  const unique=[...new Set(references)].sort();unique.forEach(verifyKey);
  for(const reference of unique){
    const source=await readFile(reference);
    if(!source||typeof source[Symbol.asyncIterator]!=='function')throw new Error('Arquivo privado indisponível.');
    await writeBackupChunks({id:fileId(id,reference),source,...options,allowEmpty:true});
  }
  const manifest={version:2,id,database:databaseId,database_format:databaseFormat,files:unique.map(reference=>({storage_key:reference,backup_id:fileId(id,reference)}))};
  await writeBackupChunks({id:id+'-bundle',source:Readable.from([Buffer.from(JSON.stringify(manifest))]),...options});
  return {id,files:unique.length};
}

export async function readBackupBundle({id,key,store}) {
  verifyId(id);
  const manifest=JSON.parse((await collect(readBackupChunks({id:id+'-bundle',key,store}))).toString('utf8'));
  if(![1,2].includes(manifest.version)||manifest.id!==id||manifest.database!==id+'-database'||!Array.isArray(manifest.files)||manifest.files.length>5000)throw new Error('Manifesto da cópia inválido.');
  const databaseFormat=manifest.version===1?'sqlite-gzip':manifest.database_format;
  if(!['sqlite-gzip','sql-gzip'].includes(databaseFormat))throw new Error('Formato do banco inválido.');
  const seen=new Set();
  for(const file of manifest.files){verifyKey(file.storage_key);if(seen.has(file.storage_key)||file.backup_id!==fileId(id,file.storage_key))throw new Error('Referência de arquivo divergente.');seen.add(file.storage_key);}
  return {databaseFormat,database:()=>readBackupChunks({id:manifest.database,key,store}),files:manifest.files.map(file=>({storage_key:file.storage_key,read:()=>readBackupChunks({id:file.backup_id,key,store})}))};
}
