import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {writeBackupChunks,readBackupChunks} from '../lib/backup-chunks.mjs';

function memoryStore(){const items=new Map();return {items,put:async(key,value)=>{if(items.has(key))throw Error('Arquivo existente');items.set(key,Buffer.from(value));},get:async key=>{if(!items.has(key))throw Error('Arquivo ausente');return items.get(key);},getIfPresent:async key=>items.get(key)||null};}
async function collect(stream){const chunks=[];for await(const chunk of stream)chunks.push(chunk);return Buffer.concat(chunks);}
test('backup em blocos preserva bytes e detecta falta ou adulteração',async()=>{
 const store=memoryStore(),key=randomBytes(32),id='copia-teste',data=randomBytes(2751);
 const report=await writeBackupChunks({id,key,source:Readable.from([data.subarray(0,17),data.subarray(17)]),store,chunkSize:1024});
 assert.equal(report.parts,3);assert.deepEqual(await collect(readBackupChunks({id,key,store})),data);
 await assert.rejects(collect(readBackupChunks({id,key:randomBytes(32),store})));
 await assert.rejects(writeBackupChunks({id,key,source:Readable.from([data]),store,chunkSize:1024}),/existente/);
 const original=Buffer.from(store.items.get(`${id}-chunk-1`));const altered=Buffer.from(original);altered[altered.length-1]^=1;store.items.set(`${id}-chunk-1`,altered);
 await assert.rejects(collect(readBackupChunks({id,key,store})));
 store.items.delete(`${id}-chunk-1`);await assert.rejects(collect(readBackupChunks({id,key,store})),/ausente/);
 store.items.set(`${id}-chunk-1`,store.items.get(`${id}-chunk-0`));await assert.rejects(collect(readBackupChunks({id,key,store})));
});
test('interrupção não publica manifesto e impede restauração incompleta',async()=>{
 const store=memoryStore(),key=randomBytes(32),id='interrompido';let count=0;
 const failing={...store,put:async(name,data)=>{if(++count===2)throw Error('Conexão interrompida');await store.put(name,data);}};
 await assert.rejects(writeBackupChunks({id,key,source:Readable.from([randomBytes(2200)]),store:failing,chunkSize:1024}),/interrompida/);
 assert.equal(store.items.has(`${id}-manifest`),false);
 await assert.rejects(collect(readBackupChunks({id,key,store})),/ausente/);
});
test('retomada valida conteúdo existente, inclusive resposta perdida, e não sobrescreve divergência',async()=>{
 const store=memoryStore(),key=randomBytes(32),id='retomada',data=randomBytes(2500);let calls=0;
 const interrupted={...store,put:async(name,bytes)=>{await store.put(name,bytes);if(++calls===2)throw Error('Resposta perdida após gravar');}};
 await assert.rejects(writeBackupChunks({id,key,source:Readable.from([data]),store:interrupted,chunkSize:1024,resume:true}),/Resposta perdida/);
 const before=Buffer.from(store.items.get(`${id}-chunk-0`));
 const different=Buffer.from(data);different[0]^=1;
 await assert.rejects(writeBackupChunks({id,key,source:Readable.from([different]),store,chunkSize:1024,resume:true}),/diverge/);
 assert.deepEqual(store.items.get(`${id}-chunk-0`),before);
 const result=await writeBackupChunks({id,key,source:Readable.from([data]),store,chunkSize:1024,resume:true});
 assert.equal(result.parts,3);assert.deepEqual(await collect(readBackupChunks({id,key,store})),data);
 assert.deepEqual(await writeBackupChunks({id,key,source:Readable.from([data]),store,chunkSize:1024,resume:true}),result);
 await assert.rejects(writeBackupChunks({id,key,source:Readable.from([data.subarray(0,1500)]),store,chunkSize:1024,resume:true}),/diverge/);
});
