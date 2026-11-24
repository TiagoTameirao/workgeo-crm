import { isManagement } from "../../../../lib/agenda.mjs";
import { requireUser, checkOrigin } from "../../../../lib/auth.mjs";
import { fail } from "../../../../lib/domain.mjs";
import { errorResponse, jsonBody } from "../../../../lib/http.mjs";
import { checkEmailConnection } from "../../../../lib/email-connection-check.mjs";
import { checkWhatsappConnection } from "../../../../lib/whatsapp-connection-check.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    checkOrigin(request);
    const user = await requireUser();
    if (!isManagement(user))
      fail("Acesso reservado ao administrador.", 403);
    const body = await jsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body))
      fail("Informe o canal que deseja testar.");
    const result =
      body.channel === "whatsapp"
        ? await checkWhatsappConnection()
        : await checkEmailConnection(body.channel);
    return Response.json({ ...result, checkedAt: new Date().toISOString() });
  } catch (error) {
    return errorResponse(error);
  }
}
