import { requireUser, checkOrigin } from "../../../lib/auth.mjs";
import { createClient } from "../../../lib/clients.mjs";
import { errorResponse, jsonBody } from "../../../lib/http.mjs";
export async function POST(request) {
  try {
    checkOrigin(request);
    return Response.json(
      await createClient(await requireUser(), (await jsonBody(request)).data),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
