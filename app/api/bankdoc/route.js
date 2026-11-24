import {requireUser} from '../../../lib/auth.mjs';
import {errorResponse} from '../../../lib/http.mjs';
import {analysisOptions} from '../../../lib/bankdoc-analysis.mjs';
export const runtime='nodejs';
export async function GET(){try{return Response.json(await analysisOptions(await requireUser()));}catch(error){return errorResponse(error);}}
