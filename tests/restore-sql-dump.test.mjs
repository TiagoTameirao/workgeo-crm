import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {restoreSqlDump} from '../lib/restore-sql-dump.mjs';

test('restaura texto UTF-8 dividido em blocos e não substitui banco existente',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'workgeo-restore-')),file=path.join(dir,'database.sqlite');
 try {
  const sql=Buffer.from("PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\nCREATE TABLE sample (value TEXT);\nINSERT INTO sample VALUES('ação');\nCOMMIT;\n");
  await restoreSqlDump(Readable.from(Array.from(sql,byte=>Buffer.from([byte]))),file);
  const db=new DatabaseSync(file,{readOnly:true});try{assert.equal(db.prepare('SELECT value FROM sample').get().value,'ação');}finally{db.close();}
  await assert.rejects(restoreSqlDump(Readable.from([sql]),file),error=>error.code==='EEXIST');
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('recusa dump truncado e erro de origem',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'workgeo-restore-'));
 try {
  await assert.rejects(restoreSqlDump(Readable.from(['BEGIN TRANSACTION;\nCREATE TABLE t(x);\n']),path.join(dir,'partial.sqlite')),/incompleto/);
  async function* broken(){yield Buffer.from('BEGIN TRANSACTION;\n');throw Error('origem interrompida');}
  await assert.rejects(restoreSqlDump(broken(),path.join(dir,'broken.sqlite')),/origem interrompida/);
 } finally {await rm(dir,{recursive:true,force:true});}
});
