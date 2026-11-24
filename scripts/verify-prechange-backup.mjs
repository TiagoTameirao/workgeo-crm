import {readFile,open} from 'node:fs/promises';
import {createHash,createDecipheriv} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';

const directory=path.resolve(process.argv[2]||'');
const restoreName=process.argv[3];
if(!restoreName||!/^[a-zA-Z0-9_-]+\.sqlite$/.test(restoreName))throw Error('Informe a pasta da cópia e um nome novo de arquivo SQLite dentro de runtime.');
const target=path.resolve('runtime',restoreName);
const key=Buffer.from(process.env.BACKUP_KEY||'','hex');
if(key.length!==32)throw Error('Configure BACKUP_KEY em ambiente local privado.');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report=JSON.parse(await readFile(path.join(directory,'verification.json'),'utf8'));
if(!report.complete||report.integrity_check!=='ok'||report.foreign_key_errors!==0)throw Error('A cópia não está marcada como completa e íntegra.');
const source=await readFile(path.join(directory,'source.tar.gz'));
if(sha(source)!==report.source_sha256)throw Error('Cópia do código diverge do relatório.');
const dump=await readFile(path.join(directory,'database.sql.gz.enc'));
if(dump.subarray(0,4).toString()!=='WGS1'||sha(dump)!==report.encrypted_dump_sha256)throw Error('Dump criptografado inválido ou alterado.');
const decipher=createDecipheriv('aes-256-gcm',key,dump.subarray(4,16));decipher.setAuthTag(dump.subarray(-16));
const sql=gunzipSync(Buffer.concat([decipher.update(dump.subarray(16,-16)),decipher.final()]));
if(sha(sql)!==report.sql_sha256)throw Error('Conteúdo do banco diverge do relatório.');
const decrypt=bytes=>{if(bytes.subarray(0,4).toString()!=='WG02')throw Error('Arquivo criptografado inválido.');const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(4,16));cipher.setAuthTag(bytes.subarray(16,32));return Buffer.concat([cipher.update(bytes.subarray(32)),cipher.final()]);};
const files=JSON.parse(decrypt(await readFile(path.join(directory,'files-manifest.enc'))));
for(const file of files){
 if(!/^[\w-]+$/.test(file.storage_key))throw Error('Chave de arquivo inválida.');
 const bytes=decrypt(await readFile(path.join(directory,'files',file.storage_key+'.enc')));
 if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error('Arquivo privado divergente.');
}
const handle=await open(target,'wx');await handle.close();
const db=new DatabaseSync(target);
try{
 db.exec(sql.toString('utf8'));
 for(const [table,expected] of Object.entries(report.tables)){
  if(!/^[a-z_]+$/.test(table))throw Error('Nome de tabela inválido.');
  if(Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)!==expected)throw Error(`Contagem divergente: ${table}`);
 }
 if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('A restauração contém inconsistências.');
 console.log(JSON.stringify({verified:true,tables:Object.keys(report.tables).length,files:files.length,prospects:report.tables.prospecting_candidates,restore_path:target}));
}finally{db.close();}
