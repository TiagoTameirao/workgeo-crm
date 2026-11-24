import {requireUser,checkOrigin} from '../../../../lib/auth.mjs';
import {errorResponse,jsonBody} from '../../../../lib/http.mjs';
import {completeDocumentUpload} from '../../../../lib/document-files.mjs';
export async function POST(request){try{checkOrigin(request);return Response.json(await completeDocumentUpload(await requireUser(),(await jsonBody(request)).key));}catch(e){return errorResponse(e);}}
