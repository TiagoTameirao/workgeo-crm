import { isManagement } from "../../../../lib/agenda.mjs";
import { requireUser, checkOrigin } from "../../../../lib/auth.mjs";
import { fail } from "../../../../lib/domain.mjs";
import { syncEmail } from "../../../../lib/email.mjs";
import { errorResponse } from "../../../../lib/http.mjs";
export async function POST(request) {
  try {
    checkOrigin(request);
    const u = await requireUser();
    if (!isManagement(u))
      fail("Acesso reservado ao administrador.", 403);
    return Response.json(await syncEmail());
  } catch (e) {
    return errorResponse(e);
  }
}
