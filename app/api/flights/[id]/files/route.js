import { requireUser, checkOrigin } from "../../../../../lib/auth.mjs";
import { attachFlightFile } from "../../../../../lib/flight-files.mjs";
import { fail } from "../../../../../lib/domain.mjs";
import { errorResponse } from "../../../../../lib/http.mjs";
export const runtime = "nodejs";
export async function POST(request, { params }) {
  try {
    checkOrigin(request); const user = await requireUser(), { id } = await params;
    if (Number(request.headers.get("content-length") || 0) > 3200000) fail("Limite de 3 MB por arquivo.", 413);
    const body = await request.formData(), file = body.get("file");
    if (!file || typeof file.arrayBuffer !== "function" || file.size > 3000000) fail("Selecione um documento com até 3 MB.");
    return Response.json(await attachFlightFile(user, id, body.get("kind"), file.name, Buffer.from(await file.arrayBuffer())));
  } catch (error) { return errorResponse(error); }
}
