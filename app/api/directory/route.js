import { requireUser } from "../../../lib/auth.mjs";
import { query } from "../../../lib/db.mjs";
import { errorResponse } from "../../../lib/http.mjs";
export async function GET() {
  try {
    await requireUser();
    return Response.json(await query("SELECT id,name,role FROM users WHERE active=1 ORDER BY name"));
  } catch (error) { return errorResponse(error); }
}
