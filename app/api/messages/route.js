import { requireUser, checkOrigin } from "../../../lib/auth.mjs";
import { recordMessage } from "../../../lib/messaging.mjs";
import { errorResponse, jsonBody } from "../../../lib/http.mjs";
export async function POST(request) {
  try {
    checkOrigin(request);
    return Response.json(
      await recordMessage(await requireUser(), await jsonBody(request)),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
