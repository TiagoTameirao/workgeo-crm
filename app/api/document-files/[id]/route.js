import {requireUser} from '../../../../lib/auth.mjs';
import {errorResponse} from '../../../../lib/http.mjs';
import {getDocumentFile} from '../../../../lib/document-files.mjs';
import {storedFileStream} from '../../../../lib/storage.mjs';
export const runtime='nodejs';
export async function GET(request,{params}){try{const f=await getDocumentFile(await requireUser(),(await params).id),name=f.filename.replace(/[^\x20-\x7e]|["\\]/g,'_');return new Response(await storedFileStream(f.storage_key),{headers:{'Content-Type':f.content_type,'Content-Disposition':`attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(f.filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,'Content-Length':String(f.size_bytes),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}catch(e){return errorResponse(e);}}
