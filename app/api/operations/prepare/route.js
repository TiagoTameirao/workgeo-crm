import {requireUser,checkOrigin} from '../../../../lib/auth.mjs';
import {prepareOperation} from '../../../../lib/domain.mjs';
import {errorResponse,jsonBody} from '../../../../lib/http.mjs';
export const runtime='nodejs';
export async function POST(request){try{checkOrigin(request);const user=await requireUser(),body=await jsonBody(request);if(typeof body.id!=='string'||!Number.isInteger(body.version))return Response.json({error:'Oportunidade inválida.'},{status:400});return Response.json(await prepareOperation(user,body.id,body.version));}catch(error){return errorResponse(error);}}
