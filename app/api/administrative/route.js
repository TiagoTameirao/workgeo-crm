import { requireUser, checkOrigin } from "../../../lib/auth.mjs";
import { archiveAdministrativeDocument, reviseAdministrativeDocument } from "../../../lib/domain.mjs";
import { errorResponse, jsonBody } from "../../../lib/http.mjs";
export const runtime = "nodejs";
export async function POST(request) {
  try {
    checkOrigin(request);
    const user = await requireUser(), body = await jsonBody(request);
    if (typeof body.id !== "string" || !Number.isInteger(body.version)) return Response.json({ error: "Ação administrativa inválida." }, { status: 400 });
    if (body.action === "revise-document") return Response.json(await reviseAdministrativeDocument(user, body.id, body.version, body.due_date));
    if (body.action === "archive-document" || body.action === "restore-document") return Response.json(await archiveAdministrativeDocument(user, body.id, body.version, body.reason, body.action === "restore-document"));
    return Response.json({ error: "Ação administrativa inválida." }, { status: 400 });
  } catch (e) { return errorResponse(e); }
}
