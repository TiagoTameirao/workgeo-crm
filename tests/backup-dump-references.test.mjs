import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {referencesFromDump} from '../lib/backup-dump-references.mjs';
const source=()=>`PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\nCREATE TABLE IF NOT EXISTS files(storage_key TEXT);\nCREATE TABLE IF NOT EXISTS flight_files(storage_key TEXT);\nCREATE TABLE IF NOT EXISTS messages(data TEXT);\nCREATE TABLE IF NOT EXISTS inbox_events(data TEXT);\nCREATE TABLE IF NOT EXISTS prospects(data TEXT);\nINSERT INTO prospects VALUES('ignorar; texto');\nINSERT INTO files VALUES('pdf-a');\nINSERT INTO flight_files VALUES('voo-b');\nINSERT INTO messages VALUES('{"attachments":[{"storage_key":"anexo-c"},{"storage_key":"pdf-a"}]}');\nINSERT INTO inbox_events VALUES('{"attachments":[]}');\nCOMMIT;\n`;
test('extrai referências sem carregar as outras tabelas',async()=>{
 const data=Buffer.from(source());assert.deepEqual(await referencesFromDump(Readable.from([data.subarray(0,31),data.subarray(31)])),['anexo-c','pdf-a','voo-b']);
});
test('interrompe a leitura quando a origem falha',async()=>{
 const broken=new Readable({read(){this.destroy(new Error('origem interrompida'));}});
 await assert.rejects(referencesFromDump(broken),/origem interrompida/);
});
test('rejeita dump incompleto, tabela duplicada e referência inválida',async()=>{
 await assert.rejects(referencesFromDump(Readable.from([source().replace('COMMIT;','')])),/incompleto/);
 await assert.rejects(referencesFromDump(Readable.from([source().replace('COMMIT;','CREATE TABLE IF NOT EXISTS files(storage_key TEXT);\nCOMMIT;')])),/duplicada/);
 await assert.rejects(referencesFromDump(Readable.from([source().replace('pdf-a','..\/fora')])),/inválida/);
 await assert.rejects(referencesFromDump(Readable.from([source().replace("INSERT INTO files VALUES('pdf-a');","INSERT INTO files VALUES('pdf-a')")])),/incompleto/);
});
