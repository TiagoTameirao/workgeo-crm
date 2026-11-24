import {open} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {StringDecoder} from 'node:string_decoder';

export async function restoreSqlDump(source,filename) {
  const handle=await open(filename,'wx');await handle.close();
  const db=new DatabaseSync(filename);
  const decoder=new StringDecoder('utf8');
  let pending='',started=false,committed=false;
  function execute(raw){
    const line=raw.trim();if(!line)return;
    if(committed||line.length>2_000_000||!line.endsWith(';'))throw new Error('Dump SQL incompleto ou inválido.');
    if(line==='BEGIN TRANSACTION;'){if(started)throw new Error('Dump SQL inválido.');started=true;}
    else if(line==='COMMIT;'){if(!started)throw new Error('Dump SQL inválido.');committed=true;}
    else if(!started&&line!=='PRAGMA foreign_keys=OFF;')throw new Error('Cabeçalho SQL inválido.');
    try {db.exec(line);}catch {throw new Error('Não foi possível executar o dump SQL.');}
  }
  try {
    for await(const chunk of source){
      pending+=decoder.write(chunk);
      let end;while((end=pending.indexOf('\n'))!==-1){execute(pending.slice(0,end));pending=pending.slice(end+1);}
      if(pending.length>2_000_000)throw new Error('Linha SQL excede o limite.');
    }
    pending+=decoder.end();if(pending.trim())execute(pending);
    if(!started||!committed)throw new Error('Dump SQL incompleto ou inválido.');
  } finally {db.close();}
}
