import { requireUser, checkOrigin } from "../../../lib/auth.mjs";
import { allocate, unallocate } from "../../../lib/domain.mjs";
import { errorResponse, jsonBody } from "../../../lib/http.mjs";
export async function POST(request) {
  try {
    checkOrigin(request);
    const user = await requireUser(),
      b = await jsonBody(request);
    return Response.json(
      await allocate(user, b.receipt_id, b.invoice_id, b.amount),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(request) {
  try {
    checkOrigin(request);
    const user = await requireUser(), body = await jsonBody(request);
    if (typeof body.id !== "string" || !body.id) return Response.json({ error: "Selecione um vínculo válido." }, { status: 400 });
    return Response.json(await unallocate(user, body.id, body.reason));
  } catch (e) { return errorResponse(e); }
}
