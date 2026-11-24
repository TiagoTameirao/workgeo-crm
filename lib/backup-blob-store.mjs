import {put,get} from '@vercel/blob';

export function createBackupBlobStore({upload=put,download=get,prefix='files/backup-parts/'}={}) {
  if(!/^[a-z0-9/-]+\/$/.test(prefix)||prefix.includes('//')||prefix.includes('..'))throw new Error('Diretório de backup inválido.');
  const pathname=name=>{
    if(typeof name!=='string'||!/^[a-z0-9-]+$/.test(name))throw new Error('Nome de bloco inválido.');
    return prefix+name;
  };
  async function getIfPresent(name){
    const result=await download(pathname(name),{access:'private'});
    if(result==null)return null;
    if(result.statusCode!==200||!result.stream)throw new Error('Falha ao ler bloco privado.');
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
  return {
    async put(name,bytes){await upload(pathname(name),bytes,{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/octet-stream'});},
    getIfPresent,
    async get(name){const data=await getIfPresent(name);if(data==null)throw new Error('Bloco não encontrado.');return data;},
  };
}
