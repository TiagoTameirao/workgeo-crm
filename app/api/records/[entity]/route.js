import { after } from "next/server";
import { safeActivity, isField } from "../../../../lib/agenda.mjs";
import { dispatchNotifications } from "../../../../lib/notification-dispatch.mjs";
import { requireUser, checkOrigin } from "../../../../lib/auth.mjs";
import { deleteAdministrativeRecord, saveRecord } from "../../../../lib/domain.mjs";
import { errorResponse, jsonBody } from "../../../../lib/http.mjs";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request, { params }) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    const { entity } = await params;
    const body = await jsonBody(request);
    const record = await saveRecord(user, entity, body.data, body.id, body.version);
    if (entity === "activities") after(async () => { try { await dispatchNotifications(); } catch { console.error("Agendamento de avisos pendente de reprocessamento."); } });
    if (entity === "activities") return Response.json(safeActivity(record, user));
    if (entity === "services" && isField(user)) { const { contract_id, external_reference, acceptance, ...safe } = record; return Response.json(safe); }
    return Response.json(record);
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(request, { params }) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    const { entity } = await params;
    const body = await jsonBody(request);
    return Response.json(await deleteAdministrativeRecord(user, entity, body.id, body.version));
  } catch (e) {
    return errorResponse(e);
  }
}
