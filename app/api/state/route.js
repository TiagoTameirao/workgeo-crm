import { requireUser } from "../../../lib/auth.mjs";
import { stateFor } from "../../../lib/domain.mjs";
import { errorResponse } from "../../../lib/http.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(await stateFor(await requireUser()));
  } catch (e) {
    return errorResponse(e);
  }
}
