import { requireUser, checkOrigin } from "../../../lib/auth.mjs";
import { errorResponse, jsonBody } from "../../../lib/http.mjs";
import { createFeedback, listFeedback, updateFeedbackStatus } from "../../../lib/pilot-feedback.mjs";

export async function GET() {
  try { return Response.json(await listFeedback(await requireUser())); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  try {
    checkOrigin(request);
    return Response.json(await createFeedback(await requireUser(), await jsonBody(request)), { status: 201 });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request) {
  try {
    checkOrigin(request);
    return Response.json(await updateFeedbackStatus(await requireUser(), await jsonBody(request)));
  } catch (error) { return errorResponse(error); }
}
