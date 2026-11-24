import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {referencesFromSqlite} from '../lib/backup-sqlite-references.mjs';
test('lê anexos da cópia isolada e rejeita referências inválidas',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'wg-refs-')),filename=path.join(dir,'source.sqlite'),db=new DatabaseSync(filename);
 try{
  db.exec('CREATE TABLE files(storage_key TEXT); CREATE TABLE flight_files(storage_key TEXT); CREATE TABLE messages(data TEXT); CREATE TABLE inbox_events(data TEXT);');
  db.prepare('INSERT INTO files VALUES(?)').run('pdf-a');db.prepare('INSERT INTO flight_files VALUES(?)').run('voo-b');
  db.prepare('INSERT INTO messages VALUES(?)').run(JSON.stringify({attachments:[{storage_key:'anexo-c'},{storage_key:'pdf-a'}]}));
  db.prepare('INSERT INTO inbox_events VALUES(?)').run(JSON.stringify({attachments:[]}));
  assert.deepEqual(referencesFromSqlite(filename),['anexo-c','pdf-a','voo-b']);
  db.prepare('INSERT INTO files VALUES(?)').run('../fora');assert.throws(()=>referencesFromSqlite(filename),/inválida/);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
