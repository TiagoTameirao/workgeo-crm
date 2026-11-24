import { requireUser, checkOrigin } from "../../../../lib/auth.mjs";
import { assignUnits } from "../../../../lib/client-assignment.mjs";
import { errorResponse, jsonBody } from "../../../../lib/http.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    return Response.json(await assignUnits(user, await jsonBody(request)));
  } catch (error) {
    return errorResponse(error);
  }
}
