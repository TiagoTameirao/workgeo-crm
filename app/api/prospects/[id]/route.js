import { after } from "next/server";
import { dispatchNotifications } from "../../../../lib/notification-dispatch.mjs";
import { requireUser, checkOrigin } from "../../../../lib/auth.mjs";
import { errorResponse, jsonBody } from "../../../../lib/http.mjs";
import { getCandidateForReview, reviewCandidate } from "../../../../lib/prospecting-candidates.mjs";
import { convertProspectToClient } from "../../../../lib/prospecting-conversion.mjs";

export const maxDuration = 60;
export async function GET(request, { params }) {
  try { const { id } = await params; return Response.json(await getCandidateForReview(await requireUser(), id)); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request, { params }) {
  try { checkOrigin(request); const { id } = await params; return Response.json(await reviewCandidate(await requireUser(), id, await jsonBody(request))); }
  catch (error) { return errorResponse(error); }
}
export async function POST(request, { params }) {
  try { checkOrigin(request); const { id } = await params; const body = await jsonBody(request); const result = await convertProspectToClient(await requireUser(), { ...body, candidate_id:id }); after(async () => { try { await dispatchNotifications(); } catch { console.error("Agendamento de avisos pendente de reprocessamento."); } }); return Response.json(result); }
  catch (error) { return errorResponse(error); }
}
