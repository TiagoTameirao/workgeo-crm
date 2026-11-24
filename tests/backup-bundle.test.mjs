import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {createBackupBundle,readBackupBundle} from '../lib/backup-bundle.mjs';
const collect=async stream=>{const parts=[];for await(const part of stream)parts.push(part);return Buffer.concat(parts);};
function store(){const data=new Map();return {data,put:async(k,v)=>{if(data.has(k))throw Error('duplicado');data.set(k,Buffer.from(v));},get:async k=>{if(!data.has(k))throw Error('ausente');return data.get(k);},getIfPresent:async k=>data.get(k)||null};}
test('restaura banco e todos os arquivos declarados na cópia, com retomada',async()=>{
 const blobs=store(),key=randomBytes(32),database=Buffer.from('banco isolado com referências');
 const files={'arquivo-a':Buffer.from('PDF A'),'arquivo-b':Buffer.from('PDF B'),'arquivo-vazio':Buffer.alloc(0)};
 const options={id:'ensaio',key,store:blobs,resume:true,chunkSize:1024,findReferences:async stream=>{assert.deepEqual(await collect(stream),database);return ['arquivo-b','arquivo-a','arquivo-a','arquivo-vazio'];},readFile:async name=>Readable.from([files[name]])};
 assert.deepEqual(await createBackupBundle({...options,database:Readable.from([database])}),{id:'ensaio',files:3});
 assert.deepEqual(await createBackupBundle({...options,database:Readable.from([database])}),{id:'ensaio',files:3});
 const result=await readBackupBundle(options);assert.equal(result.databaseFormat,'sqlite-gzip');assert.deepEqual(await collect(result.database()),database);
 for(const file of result.files)assert.deepEqual(await collect(file.read()),files[file.storage_key]);
});
test('registra explicitamente o formato SQL da cópia',async()=>{
 const blobs=store(),key=randomBytes(32),options={id:'sql',key,store:blobs,databaseFormat:'sql-gzip',findReferences:async stream=>{await collect(stream);return [];},readFile:async()=>Readable.from([])};
 await createBackupBundle({...options,database:Readable.from(['sql'])});
 assert.equal((await readBackupBundle(options)).databaseFormat,'sql-gzip');
 await assert.rejects(createBackupBundle({...options,id:'bad',databaseFormat:'invalido',database:Readable.from(['sql'])}),/Formato/);
});
test('arquivo ausente impede finalizar manifesto conjunto',async()=>{
 const blobs=store(),key=randomBytes(32),options={id:'incompleto',key,store:blobs,chunkSize:1024,findReferences:async stream=>{await collect(stream);return ['faltante'];},readFile:async()=>{throw Error('arquivo ausente');}};
 await assert.rejects(createBackupBundle({...options,database:Readable.from(['banco'])}),/ausente/);
 await assert.rejects(readBackupBundle(options),/ausente/);
});
test('não finaliza se o leitor interrompe antes de verificar o banco inteiro',async()=>{
 const blobs=store(),key=randomBytes(32),options={id:'leitura-parcial',key,store:blobs,chunkSize:1024,findReferences:async stream=>{for await(const part of stream){assert.ok(part.length);break;}return [];},readFile:async()=>Readable.from([])};
 await assert.rejects(createBackupBundle({...options,database:Readable.from([randomBytes(3000)])}),/até o fim/);
 await assert.rejects(readBackupBundle(options),/ausente/);
});
