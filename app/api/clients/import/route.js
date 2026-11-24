import { requireUser, checkOrigin } from "../../../../lib/auth.mjs";
import { errorResponse, jsonBody } from "../../../../lib/http.mjs";
import { importClients } from "../../../../lib/client-import.mjs";

export async function POST(request) {
  try {
    checkOrigin(request);
    return Response.json(await importClients(await requireUser(), await jsonBody(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
