import {handleUpload} from '@vercel/blob/client';
import {requireUser,checkOrigin} from '../../../../lib/auth.mjs';
import {errorResponse,jsonBody} from '../../../../lib/http.mjs';
import {query} from '../../../../lib/db.mjs';
import {documentRecord} from '../../../../lib/document-files.mjs';
import {fail} from '../../../../lib/domain.mjs';
export async function POST(request){try{const body=await jsonBody(request);return Response.json(await handleUpload({body,request,onBeforeGenerateToken:async(pathname,clientPayload)=>{
 checkOrigin(request);const user=await requireUser(),{key}=JSON.parse(clientPayload||'{}');if(!/^[a-f0-9-]{36}$/.test(key)||pathname!=='files/'+key)fail('Upload inválido.');
 const t=JSON.parse((await query('SELECT data FROM settings WHERE id=$1',['document-upload:'+key]))[0]?.data||'null');if(!t||t.user_id!==user.id||t.expires<Date.now())fail('Upload não autorizado.',403);await documentRecord(user,t.entity,t.record_id,true,t.purpose);
 return {maximumSizeInBytes:t.size,addRandomSuffix:false,allowOverwrite:false,tokenPayload:JSON.stringify({key})};
},onUploadCompleted:async()=>{}}));}catch(e){return errorResponse(e);}}
