import {requireUser,checkOrigin} from '../../../lib/auth.mjs';
import {errorResponse,jsonBody} from '../../../lib/http.mjs';
import {configureDocumentAI,documentAIConfigured,documentAIEnvironment,documentAIModel} from '../../../lib/document-ai-config.mjs';
import {isManagement} from '../../../lib/agenda.mjs';
export async function GET(){try{const user=await requireUser();return Response.json({configured:documentAIConfigured(await documentAIEnvironment()),can_configure:isManagement(user),model:documentAIModel});}catch(e){return errorResponse(e);}}
export async function POST(request){try{checkOrigin(request);return Response.json(await configureDocumentAI(await requireUser(),await jsonBody(request)));}catch(e){return errorResponse(e);}}
