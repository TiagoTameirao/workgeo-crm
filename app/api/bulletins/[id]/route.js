import {requireUser,checkOrigin} from '../../../../lib/auth.mjs';
import {errorResponse,jsonBody} from '../../../../lib/http.mjs';
import {generateBulletin} from '../../../../lib/bulletin.mjs';
import {documentRecord} from '../../../../lib/document-files.mjs';
import {query} from '../../../../lib/db.mjs';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(request,{params}){try{const user=await requireUser(),{id}=await params;await documentRecord(user,'invoices',id);return Response.json((await query('SELECT id,revision,data,created_at FROM bulletin_versions WHERE invoice_id=$1 ORDER BY revision DESC',[id])).map(row=>({...row,data:JSON.parse(row.data)})));}catch(e){return errorResponse(e);}}
export async function POST(request,{params}){try{checkOrigin(request);const body=await jsonBody(request);return Response.json(await generateBulletin(await requireUser(),(await params).id,body.data,body.version));}catch(e){return errorResponse(e);}}
