import {requireUser,checkOrigin} from '../../../../lib/auth.mjs';
import {errorResponse,jsonBody} from '../../../../lib/http.mjs';
import {analysisList,startAnalysis,stepAnalysis} from '../../../../lib/bankdoc-analysis.mjs';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(request,{params}){try{return Response.json(await analysisList(await requireUser(),(await params).id));}catch(e){return errorResponse(e);}}
export async function POST(request,{params}){try{checkOrigin(request);const user=await requireUser(),{id}=await params,body=await jsonBody(request);return Response.json(body.action==='continue'?await stepAnalysis(user,id,body.analysis_id):await startAnalysis(user,id));}catch(e){return errorResponse(e);}}
