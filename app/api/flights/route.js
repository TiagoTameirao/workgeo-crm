import { requireUser, checkOrigin } from "../../../lib/auth.mjs";
import { flightsFor, saveFlight } from "../../../lib/flights.mjs";
import { errorResponse, jsonBody } from "../../../lib/http.mjs";
export const runtime = "nodejs";
export async function GET() {
  try { return Response.json(await flightsFor(await requireUser())); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  try {
    checkOrigin(request); const user = await requireUser(), body = await jsonBody(request);
    return Response.json(await saveFlight(user, body?.data, body?.id, body?.version));
  } catch (error) { return errorResponse(error); }
}
