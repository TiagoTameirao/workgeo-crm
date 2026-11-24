import { requireUser, checkOrigin } from "../../../../lib/auth.mjs";
import { changeAdministrativeCatalog } from "../../../../lib/domain.mjs";
import { errorResponse, jsonBody } from "../../../../lib/http.mjs";
export const runtime = "nodejs";
export async function POST(request) {
  try {
    checkOrigin(request);
    return Response.json(await changeAdministrativeCatalog(await requireUser(), await jsonBody(request)));
  } catch (e) { return errorResponse(e); }
}
