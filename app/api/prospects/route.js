import { requireUser, checkOrigin } from "../../../lib/auth.mjs";
import { errorResponse, jsonBody } from "../../../lib/http.mjs";
import { clearStaleCoordinateSuggestions, importCandidateBatch, importCoordinateSuggestions, listCandidateMap, listCandidatePage, listLeadPage, listLeadPerformance } from "../../../lib/prospecting-candidates.mjs";
import { listProspectingActivities, recordProspectingActivity } from "../../../lib/prospecting-activities.mjs";

export const maxDuration = 60;

export async function GET(request) {
  try {
    const user = await requireUser(), params = new URL(request.url).searchParams;
    return Response.json(params.get("view") === "map" ? await listCandidateMap(user, params) : params.get("view") === "leads" ? await listLeadPage(user, params) : params.get("view") === "lead-performance" ? await listLeadPerformance(user) : params.get("view") === "lead-activities" ? await listProspectingActivities(user, params.get("candidateId")) : await listCandidatePage(user, params));
  }
  catch (error) { return errorResponse(error); }
}
export async function POST(request) {
  try {
    checkOrigin(request);
    const user = await requireUser(), body = await jsonBody(request);
    if (body?.type === "lead-activity") return Response.json(await recordProspectingActivity(user, body.candidate_id, body), { status: 201 });
    if (body?.type === "coordinate-suggestions") return Response.json(await importCoordinateSuggestions(user, body.rows));
    if (body?.type === "clear-stale-coordinate-suggestions") return Response.json(await clearStaleCoordinateSuggestions(user, body.cnpjs));
    return Response.json(await importCandidateBatch(user, body));
  }
  catch (error) { return errorResponse(error); }
}
