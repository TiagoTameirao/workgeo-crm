import {requireUser,checkOrigin} from '../../../lib/auth.mjs';
import {errorResponse,jsonBody} from '../../../lib/http.mjs';
import {attachDocument,listDocumentFiles,documentUploadTicket} from '../../../lib/document-files.mjs';
export const runtime='nodejs';
export async function GET(request){try{const user=await requireUser(),p=new URL(request.url).searchParams;return Response.json(await listDocumentFiles(user,p.get('entity'),p.get('record_id')));}catch(e){return errorResponse(e);}}
export async function POST(request){try{checkOrigin(request);const user=await requireUser();
 if(request.headers.get('content-type')?.includes('application/json'))return Response.json(await documentUploadTicket(user,await jsonBody(request)));
 if(Number(request.headers.get('content-length'))>4_000_000)return Response.json({error:'Use envio direto para arquivos acima de 3 MB.'},{status:413});
 const form=await request.formData(),file=form.get('file');if(!file||!file.name||file.size>3_000_000)return Response.json({error:'Arquivo inválido. Use envio direto acima de 3 MB.'},{status:400});
 return Response.json(await attachDocument(user,form.get('entity'),form.get('record_id'),form.get('purpose'),file.name,Buffer.from(await file.arrayBuffer()),{expectedVersion:Number(form.get('version'))}));
 }catch(e){return errorResponse(e);}}
