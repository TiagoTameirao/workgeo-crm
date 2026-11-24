import {DatabaseSync} from 'node:sqlite';
import {Readable} from 'node:stream';
import {createInterface} from 'node:readline';

// O exportador libSQL escreve uma instrução por linha, escapando quebras de linha em valores.
// Formato desconhecido ou truncado é rejeitado, não interpretado parcialmente.
export async function referencesFromDump(source) {
  const db=new DatabaseSync(':memory:'),seen=new Set(),tables=['files','flight_files','messages','inbox_events'];
  let started=false,committed=false,lines=0;
  try {
    db.exec('PRAGMA foreign_keys=OFF; PRAGMA trusted_schema=OFF;');
    const input=source instanceof Readable?source:Readable.from(source);
    const reader=createInterface({input,crlfDelay:Infinity});
    let sourceError;
    const onError=error=>{sourceError=error;reader.close();};
    input.on('error',onError);
    try { for await(const raw of reader){
      const line=raw.trim();if(!line)continue;
      if(line.length>2_000_000||!line.endsWith(';'))throw new Error('Formato do dump não suportado ou incompleto.');
      if(committed)throw new Error('Conteúdo após o fim do dump.');
      if(line==='BEGIN TRANSACTION;'){if(started)throw new Error('Transação duplicada no dump.');started=true;continue;}
      if(line==='COMMIT;'){if(!started)throw new Error('Fim do dump sem início.');committed=true;continue;}
      if(!started){if(line==='PRAGMA foreign_keys=OFF;')continue;throw new Error('Cabeçalho do dump inválido.');}
      const create=line.match(/^CREATE TABLE IF NOT EXISTS\s+"?(files|flight_files|record_files|messages|inbox_events)"?(?=\s|\()/i);
      const insert=line.match(/^INSERT INTO\s+"?(files|flight_files|record_files|messages|inbox_events)"?(?=\s|\()/i);
      if(create){const name=create[1].toLowerCase();if(seen.has(name))throw new Error('Tabela duplicada no dump.');db.exec(line);seen.add(name);}
      else if(insert){if(!seen.has(insert[1].toLowerCase()))throw new Error('Dados antes da tabela no dump.');db.exec(line);}
      lines++;
    } } finally {reader.close();input.off('error',onError);}
    if(sourceError)throw sourceError;
    if(!started||!committed||tables.some(table=>!seen.has(table)))throw new Error('Dump incompleto ou sem tabelas obrigatórias.');
    const keys=new Set();const add=value=>{if(typeof value!=='string'||!/^[\w-]{1,200}$/.test(value))throw new Error('Referência de arquivo inválida no dump.');keys.add(value);};
    for(const table of ['files','flight_files'])for(const row of db.prepare(`SELECT storage_key FROM ${table}`).iterate())add(row.storage_key);
    if(seen.has('record_files'))for(const row of db.prepare('SELECT storage_key FROM record_files').iterate())add(row.storage_key);
    for(const table of ['messages','inbox_events'])for(const row of db.prepare(`SELECT data FROM ${table}`).iterate()){
      const data=JSON.parse(row.data);if(!data||typeof data!=='object'||Array.isArray(data)||data.attachments!=null&&!Array.isArray(data.attachments))throw new Error('Dados de anexo inválidos no dump.');
      for(const attachment of data.attachments||[])if(attachment?.storage_key!=null)add(attachment.storage_key);
    }
    return [...keys].sort();
  } finally {db.close();}
}
