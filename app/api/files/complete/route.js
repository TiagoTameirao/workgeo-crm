import { requireUser, checkOrigin } from "../../../../lib/auth.mjs";
import { completeUpload } from "../../../../lib/uploads.mjs";
import { errorResponse, jsonBody } from "../../../../lib/http.mjs";
export async function POST(request) {
  try {
    checkOrigin(request);
    return Response.json(
      await completeUpload(await requireUser(), (await jsonBody(request)).key),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
