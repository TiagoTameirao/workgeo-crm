import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {createBackupBlobStore} from '../lib/backup-blob-store.mjs';
import {writeBackupChunks,readBackupChunks} from '../lib/backup-chunks.mjs';

test('adaptador privado distingue ausência de falha e integra retomada sem sobrescrever',async()=>{
 const objects=new Map();
 const upload=async(path,body,options)=>{assert.equal(options.access,'private');assert.equal(options.allowOverwrite,false);if(objects.has(path))throw Error('Duplicado');objects.set(path,Buffer.from(body));};
 const download=async(path,options)=>{assert.equal(options.access,'private');return objects.has(path)?{statusCode:200,stream:Readable.toWeb(Readable.from([objects.get(path)]))}:null;};
 const store=createBackupBlobStore({upload,download});const key=randomBytes(32),bytes=randomBytes(3500),id='teste-blob';
 assert.equal(await store.getIfPresent('ausente'),null);
 await writeBackupChunks({id,key,source:Readable.from([bytes]),store,chunkSize:1024,resume:true});
 await writeBackupChunks({id,key,source:Readable.from([bytes]),store,chunkSize:1024,resume:true});
 const output=[];for await(const part of readBackupChunks({id,key,store}))output.push(part);assert.deepEqual(Buffer.concat(output),bytes);
 const failing=createBackupBlobStore({upload,download:async()=>{throw Error('Falha de rede');}});
 await assert.rejects(failing.getIfPresent('ausente'),/Falha de rede/);
 await assert.rejects(store.get('../fora'),/inválido/);
});
