import {DatabaseSync} from 'node:sqlite';

export function referencesFromSqlite(filename) {
  const database=new DatabaseSync(filename,{readOnly:true});
  try {
    if(database.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||database.prepare('PRAGMA foreign_key_check').all().length)throw new Error('A cópia do banco não passou na conferência de integridade.');
    const keys=new Set();
    const add=value=>{if(typeof value!=='string'||!/^[\w-]{1,200}$/.test(value))throw new Error('Referência de arquivo inválida na cópia.');keys.add(value);};
    for(const table of ['files','flight_files'])for(const row of database.prepare(`SELECT storage_key FROM ${table}`).iterate())add(row.storage_key);
    if(database.prepare("SELECT name FROM sqlite_master WHERE name='record_files'").get())for(const row of database.prepare('SELECT storage_key FROM record_files').iterate())add(row.storage_key);
    for(const table of ['messages','inbox_events'])for(const row of database.prepare(`SELECT data FROM ${table}`).iterate()) {
      const data=JSON.parse(row.data);
      if(!data||typeof data!=='object'||Array.isArray(data)||data.attachments!=null&&!Array.isArray(data.attachments))throw new Error('Dados de anexo inválidos na cópia.');
      for(const attachment of data.attachments||[])if(attachment?.storage_key!=null)add(attachment.storage_key);
    }
    return [...keys].sort();
  } finally {database.close();}
}
